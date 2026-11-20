#!/usr/bin/env python3
"""Validate MelindaOS documents against the A/B/C agent-ready format brief.

A: kb-[domain]-[topik].md with the required YAML frontmatter.
B: agent-[role]-rules.prompt.md wrapped in <agent_specification>.
C: schema-[entitas].json as a valid JSON Schema.

A document passes only when every rule holds, including the governance block.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import yaml

try:
    import jsonschema
except ImportError:
    jsonschema = None

REPO_ROOT = Path(__file__).resolve().parents[2]
KNOWLEDGE_DIRS = [
    "knowledge/01_HOSPITAL",
    "knowledge/02_PATIENT_ACCESS",
    "knowledge/03_INSURANCE",
    "knowledge/04_BPJS",
    "knowledge/05_REFERRAL",
    "knowledge/06_CLINICAL_SAFETY",
    "knowledge/07_LEGAL_REGULATORY",
]
FORMAT_DIRS = KNOWLEDGE_DIRS + [
    "knowledge/08_AGENT_POLICY",
    "knowledge/09_AGENT_ARCHITECTURE",
    "knowledge/10_TOOL_CONTRACTS",
    "knowledge/11_MACHINE_READABLE",
]
SKIP_PARTS = {
    ".venv",
    ".pytest_cache",
    "__pycache__",
    ".git",
    "node_modules",
    ".next",
    "coverage",
}

DOMAINS = {"Klinis": "KLI", "Operasional": "OPS", "Finansial": "FIN", "Manajemen": "MGT"}
GOVERNANCE_FIELDS = {
    "status": "APPROVED",
    "validation_level": "CANONICAL",
    "validated_by": "dr. Ferdi Andriska, S.H., M.Kn., CMDC",
    "role": "Director in Command",
    "date_enacted": "2026-09-28",
    "enforcement": "Strict / Mandatory",
}
A_REQUIRED = [
    "doc_id",
    "title",
    "domain",
    "department",
    "version",
    "last_reviewed",
    "ftdr_safety_override",
    "tags",
]
A_FORBIDDEN = {"id", "knowledge_domain"}
B_REQUIRED = ["doc_id", "title", "version", "last_reviewed", "tags"]
B_TAGS = ["role", "context", "safety_guardrails", "instructions", "output_format"]
SCHEMA_URIS = {
    "https://json-schema.org/draft/2020-12/schema",
    "http://json-schema.org/draft-07/schema#",
    "http://json-schema.org/draft-07/schema",
}

A_NAME = re.compile(r"^kb-(klinis|operasional|finansial|manajemen)-[a-z0-9]+(?:-[a-z0-9]+)*\.md$")
B_NAME = re.compile(r"^agent-[a-z0-9]+(?:-[a-z0-9]+)*-rules\.prompt\.md$")
C_NAME = re.compile(r"^schema-[a-z0-9]+(?:-[a-z0-9]+)*\.json$")
DOC_ID = re.compile(r"^SOP-(KLI|OPS|FIN|MGT)-[A-Z0-9]+(?:-[A-Z0-9]+)*$")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
SEPARATOR_CELL = re.compile(r"^:?-{3,}:?$")
GLUE = re.compile(r"[A-Za-z]{25,}")
NOISE = [
    (re.compile(r"<!--\s*Page", re.I), "penanda halaman"),
    (re.compile(r"CamScanner", re.I), "stempel CamScanner"),
    (re.compile(r"\\(?:rtf1|insrsid|fcs\d|loch|hich)\b"), "kode RTF mentah"),
    (re.compile("\f"), "page break"),
    (re.compile(r"Bagian ini belum tersedia", re.I), "placeholder bagian kosong"),
]
PII = [
    (re.compile(r"(?<!\d)\d{16}(?!\d)"), "angka 16 digit (kemungkinan NIK)"),
    (re.compile(r"(?i)\b(?:no\.?\s*rm|nomor\s*rm|no\.?\s*rekam\s*medis)\s*[:.]?\s*\d{4,}"), "nomor RM pasien"),
    (re.compile(r"\b(?:NY|TN|AN|BY)\s*\(\s*[PL]\s*\)"), "identitas pasien NY/TN/AN(P/L)"),
    (re.compile(r"(?i)tanggal\s*lahir\s*[:\-]?\s*\d{1,2}[/-]\d{1,2}[/-]\d{2,4}"), "tanggal lahir pasien"),
]
STRUCTURE_LOST_EXT = (".doc", ".rtf")
TABLE_AWARE_EXTRACTION = "word-binary-table-aware"


def split_frontmatter(text: str) -> tuple[dict | None, str]:
    if not text.startswith("---"):
        return None, text
    parts = text.split("---", 2)
    if len(parts) < 3:
        return None, text
    data = yaml.safe_load(parts[1])
    return (data if isinstance(data, dict) else None), parts[2]


def lines_outside_fences(body: str) -> list[str]:
    kept: list[str] = []
    fenced = False
    for line in body.splitlines():
        if line.lstrip().startswith("```"):
            fenced = not fenced
            continue
        if not fenced:
            kept.append(line)
    return kept


def prose_text(body: str) -> str:
    text = "\n".join(lines_outside_fences(body))
    text = re.sub(r"`[^`\n]*`", " ", text)
    return re.sub(r"https?://\S+", " ", text)


def table_blocks(lines: list[str]) -> list[list[str]]:
    blocks: list[list[str]] = []
    current: list[str] = []
    for line in lines:
        if line.strip().startswith("|"):
            current.append(line)
        elif current:
            blocks.append(current)
            current = []
    if current:
        blocks.append(current)
    return blocks


def row_cells(line: str) -> list[str]:
    stripped = line.strip()
    if stripped.startswith("|"):
        stripped = stripped[1:]
    if stripped.endswith("|"):
        stripped = stripped[:-1]
    return [cell.strip() for cell in stripped.split("|")]


def is_separator(line: str) -> bool:
    cells = row_cells(line)
    return bool(cells) and all(SEPARATOR_CELL.match(cell) for cell in cells)


def table_issues(body: str) -> list[str]:
    issues: list[str] = []
    lines = lines_outside_fences(body)
    for block in table_blocks(lines):
        if len(block) < 2 or not is_separator(block[1]):
            issues.append(f"TABEL: baris pemisah kolom tidak ada setelah '{block[0].strip()[:60]}'")
            continue
        widths = {len(row_cells(row)) for row in block}
        if len(widths) > 1:
            issues.append(f"TABEL: jumlah kolom tidak rata ({sorted(widths)}) pada '{block[0].strip()[:60]}'")
    return issues


def heading_issues(body: str) -> list[str]:
    issues: list[str] = []
    lines = lines_outside_fences(body)
    first = next((line for line in lines if line.strip()), "")
    if not first.startswith("# "):
        issues.append("HEADING: baris pertama isi bukan judul '# '")
    levels = [len(m.group(1)) for m in (re.match(r"^(#{1,6}) ", line) for line in lines) if m]
    if levels.count(1) != 1:
        issues.append(f"HEADING: harus tepat satu '# ', ditemukan {levels.count(1)}")
    for previous, current in zip(levels, levels[1:]):
        if current > previous + 1:
            issues.append(f"HEADING: loncat dari level {previous} ke {current}")
            break
    return issues


def empty_sections(body: str) -> list[str]:
    headings = []
    lines = lines_outside_fences(body)
    for index, line in enumerate(lines):
        match = re.match(r"^(#{1,6}) (.*)$", line)
        if not match:
            continue
        level = len(match.group(1))
        rest = lines[index + 1:]
        content = False
        for nxt in rest:
            deeper = re.match(r"^(#{1,6}) ", nxt)
            if deeper:
                content = content or len(deeper.group(1)) > level
                break
            if nxt.strip():
                content = True
                break
        if not content:
            headings.append(match.group(2).strip())
    return headings


def quality_issues(
    body: str, source_raw_path: str | None = None, source_extraction: str | None = None
) -> list[str]:
    issues: list[str] = []
    empty = empty_sections(body)
    if empty:
        issues.append(f"KOSONG: {len(empty)} heading tanpa isi, contoh '{empty[0][:40]}'")
    text = prose_text(body)
    glued = GLUE.findall(text)
    if glued:
        issues.append(f"OCR: {len(glued)} kata menempel, contoh '{glued[0][:40]}'")
    for pattern, label in NOISE:
        if pattern.search(body):
            issues.append(f"NOISE: {label}")
    for pattern, label in PII:
        if pattern.search(body):
            issues.append(f"PII: {label}")
    if (
        source_raw_path
        and source_raw_path.lower().endswith(STRUCTURE_LOST_EXT)
        and source_extraction != TABLE_AWARE_EXTRACTION
    ):
        issues.append("STRUKTUR: ekstraksi .doc/.rtf meratakan tabel dan hierarki sumber")
    issues.extend(table_issues(body))
    return issues


PLACEHOLDER = re.compile(r"\[(ISI|CEK)(?::\s*|\s+)?([^\]]*)\]")
DRAFT_MARKER = "DRAF UNTUK KOREKSI"


RESIDUALS_FILE = "knowledge/12_GOVERNANCE/knowledge/readiness-residuals.json"
_director_cache: dict[str, dict[str, list[str]]] = {}


def director_residuals(root: Path) -> dict[str, list[str]]:
    """Placeholders the readiness engine recorded as facts only the Director can supply, per document path."""
    key = str(root.resolve())
    if key not in _director_cache:
        recorded: dict[str, list[str]] = {}
        path = root / RESIDUALS_FILE
        if path.is_file():
            for row in json.loads(path.read_text(encoding="utf-8")):
                if row.get("reason") == "director":
                    recorded.setdefault(row["docPath"], []).append(row["placeholder"])
        _director_cache[key] = recorded
    return _director_cache[key]


def readiness_issues(data: dict, body: str, recorded: list[str] = ()) -> list[str]:
    """An APPROVED document may carry [ISI]/[CEK] outside code only where the readiness residuals record them as
    the Director's items (Director decision 2026-11-07); the draft marker is allowed only on such a document."""
    governance = data.get("governance")
    if not isinstance(governance, dict) or governance.get("status") != "APPROVED":
        return []
    text = prose_text(body)
    pool = list(recorded)
    unrecorded = []
    for match in PLACEHOLDER.finditer(text):
        if match.group(0) in pool:
            pool.remove(match.group(0))
        else:
            unrecorded.append(match.group(0))
    issues: list[str] = []
    if unrecorded:
        issues.append(f"placeholder_on_approved: {len(unrecorded)} placeholder [ISI]/[CEK] tidak tercatat sebagai butir Direktur di {RESIDUALS_FILE}")
    if DRAFT_MARKER in text and not recorded:
        issues.append(f"placeholder_on_approved: status '{DRAFT_MARKER}' pada dokumen APPROVED tanpa butir Direktur tercatat")
    return issues


def governance_issues(data: dict) -> list[str]:
    governance = data.get("governance")
    if not isinstance(governance, dict):
        return ["GOVERNANCE: blok governance tidak ada"]
    return [
        f"GOVERNANCE: governance.{key} harus {expected!r}"
        for key, expected in GOVERNANCE_FIELDS.items()
        if governance.get(key) != expected
    ]


def check_a(path: Path, root: Path = REPO_ROOT) -> list[str]:
    errors: list[str] = []
    try:
        doc_path = path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        doc_path = ""
    recorded = director_residuals(root).get(doc_path, [])
    if not A_NAME.match(path.name):
        errors.append("NAMA: bukan kb-[klinis|operasional|finansial|manajemen]-[topik].md")
    data, body = split_frontmatter(path.read_text(encoding="utf-8"))
    if data is None:
        return errors + ["FRONTMATTER: YAML frontmatter tidak ada atau rusak"]
    missing = [key for key in A_REQUIRED if key not in data]
    if missing:
        errors.append(f"FRONTMATTER: field wajib hilang {missing}")
    leftover = sorted(A_FORBIDDEN & set(data))
    if leftover:
        errors.append(f"FRONTMATTER: field lama masih ada {leftover}")
    domain = data.get("domain")
    if domain not in DOMAINS:
        errors.append(f"FRONTMATTER: domain {domain!r} bukan Klinis/Operasional/Finansial/Manajemen")
    else:
        if A_NAME.match(path.name) and not path.name.startswith(f"kb-{domain.lower()}-"):
            errors.append("NAMA: domain di nama file tidak sama dengan frontmatter")
        doc_id = str(data.get("doc_id", ""))
        if not DOC_ID.match(doc_id) or not doc_id.startswith(f"SOP-{DOMAINS[domain]}-"):
            errors.append(f"FRONTMATTER: doc_id {doc_id!r} bukan SOP-{DOMAINS[domain]}-...")
    if not isinstance(data.get("version"), str):
        errors.append("FRONTMATTER: version harus string")
    if not (isinstance(data.get("last_reviewed"), str) and DATE.match(data["last_reviewed"])):
        errors.append("FRONTMATTER: last_reviewed harus string YYYY-MM-DD")
    if not isinstance(data.get("ftdr_safety_override"), bool):
        errors.append("FRONTMATTER: ftdr_safety_override harus true/false")
    tags = data.get("tags")
    if not (isinstance(tags, list) and tags and all(isinstance(tag, str) for tag in tags)):
        errors.append("FRONTMATTER: tags harus daftar string")
    errors.extend(heading_issues(body))
    errors.extend(quality_issues(body, data.get("source_raw_path"), data.get("source_extraction")))
    errors.extend(readiness_issues(data, body, recorded))
    errors.extend(governance_issues(data))
    return errors


def check_b(path: Path) -> list[str]:
    errors: list[str] = []
    if not B_NAME.match(path.name):
        errors.append("NAMA: bukan agent-[role]-rules.prompt.md")
    data, body = split_frontmatter(path.read_text(encoding="utf-8"))
    if data is None:
        return errors + ["FRONTMATTER: YAML frontmatter tidak ada atau rusak"]
    missing = [key for key in B_REQUIRED if key not in data]
    if missing:
        errors.append(f"FRONTMATTER: field wajib hilang {missing}")
    if body.count("<agent_specification>") != 1 or body.count("</agent_specification>") != 1:
        errors.append("XML: <agent_specification> harus dibuka dan ditutup tepat sekali")
    else:
        inner = body.split("<agent_specification>", 1)[1].split("</agent_specification>", 1)[0]
        cursor = 0
        for tag in B_TAGS:
            opening, closing = f"<{tag}>", f"</{tag}>"
            if inner.count(opening) != 1 or inner.count(closing) != 1:
                errors.append(f"XML: <{tag}> harus dibuka dan ditutup tepat sekali")
                continue
            start = inner.index(opening)
            end = inner.index(closing)
            if start < cursor or end < start:
                errors.append(f"XML: <{tag}> tidak berurutan atau tidak tertutup")
                continue
            if not inner[start + len(opening):end].strip():
                errors.append(f"XML: <{tag}> kosong")
            cursor = end
    for pattern, label in PII:
        if pattern.search(body):
            errors.append(f"PII: {label}")
    errors.extend(governance_issues(data))
    return errors


def property_issues(properties: dict, trail: str) -> list[str]:
    issues: list[str] = []
    for name, spec in properties.items():
        where = f"{trail}{name}"
        if not isinstance(spec, dict):
            issues.append(f"SCHEMA: {where} bukan objek")
            continue
        if not str(spec.get("description", "")).strip():
            issues.append(f"SCHEMA: {where} tanpa description")
        if not any(key in spec for key in ("type", "enum", "const", "anyOf", "oneOf", "$ref")):
            issues.append(f"SCHEMA: {where} tanpa type")
        if isinstance(spec.get("properties"), dict):
            issues.extend(property_issues(spec["properties"], f"{where}."))
    return issues


def has_format_rule(node: object) -> bool:
    if isinstance(node, dict):
        if any(key in node for key in ("pattern", "enum", "format", "const")):
            return True
        return any(has_format_rule(value) for value in node.values())
    if isinstance(node, list):
        return any(has_format_rule(item) for item in node)
    return False


def check_c(path: Path) -> list[str]:
    errors: list[str] = []
    if not C_NAME.match(path.name):
        errors.append("NAMA: bukan schema-[entitas].json")
    try:
        schema = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return errors + [f"JSON: tidak valid ({exc})"]
    if schema.get("$schema") not in SCHEMA_URIS:
        errors.append("SCHEMA: $schema bukan Draft 7 atau 2020-12")
    if schema.get("type") != "object":
        errors.append("SCHEMA: type tingkat atas harus object")
    properties = schema.get("properties")
    required = schema.get("required")
    if not isinstance(properties, dict) or not properties:
        errors.append("SCHEMA: properties kosong")
        properties = {}
    if not (isinstance(required, list) and required):
        errors.append("SCHEMA: required kosong")
    elif not set(required) <= set(properties):
        errors.append(f"SCHEMA: required memuat field tak dikenal {sorted(set(required) - set(properties))}")
    if not str(schema.get("description", "")).strip():
        errors.append("SCHEMA: description tingkat atas tidak ada")
    errors.extend(property_issues(properties, ""))
    if not has_format_rule(properties):
        errors.append("SCHEMA: tidak ada validasi pattern/enum/format/const")
    if jsonschema is not None:
        try:
            jsonschema.validators.validator_for(schema).check_schema(schema)
        except jsonschema.exceptions.SchemaError as exc:
            errors.append(f"SCHEMA: gagal metaschema ({exc.message})")
    errors.extend(governance_issues(schema))
    return errors


def collect(root: Path) -> list[tuple[str, Path]]:
    found: list[tuple[str, Path]] = []
    for folder in FORMAT_DIRS:
        base = root / folder
        if not base.exists():
            continue
        for path in sorted(base.rglob("*")):
            if not path.is_file() or any(part in SKIP_PARTS for part in path.parts):
                continue
            name = path.name
            if name.endswith(".prompt.md") or name.startswith("agent-") and name.endswith(".md"):
                found.append(("B", path))
            elif name.startswith("kb-") and name.endswith(".md"):
                found.append(("A", path))
            elif folder in KNOWLEDGE_DIRS and name.endswith(".md"):
                found.append(("A", path))
            elif name.startswith("schema-") and name.endswith(".json") or name.endswith(".schema.json"):
                found.append(("C", path))
    return found


def evaluate(root: Path = REPO_ROOT) -> list[dict]:
    checkers = {"A": check_a, "B": check_b, "C": check_c}
    results = []
    for category, path in collect(root):
        errors = check_a(path, root) if category == "A" else checkers[category](path)
        results.append({
            "category": category,
            "path": path.relative_to(root).as_posix(),
            "passed": not errors,
            "errors": errors,
        })
    return results


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verbose", action="store_true", help="list every failing file")
    args = parser.parse_args()

    results = evaluate()
    for category in ("A", "B", "C"):
        rows = [row for row in results if row["category"] == category]
        passed = sum(row["passed"] for row in rows)
        print(f"Kategori {category}: {passed} lolos dari {len(rows)} file")

    reasons: dict[str, int] = {}
    for row in results:
        for kind in sorted({error.split(":", 1)[0] for error in row["errors"]}):
            reasons[kind] = reasons.get(kind, 0) + 1
    if reasons:
        print("File gagal per alasan:")
        for kind, count in sorted(reasons.items(), key=lambda item: -item[1]):
            print(f"- {kind}: {count}")
    if jsonschema is None:
        print("Catatan: paket jsonschema tidak tersedia, cek metaschema dilewati.")
    if args.verbose:
        for row in results:
            if not row["passed"]:
                print(f"{row['path']}: {'; '.join(row['errors'])}")

    failed = [row for row in results if not row["passed"]]
    total = len(results)
    print(f"TOTAL: {total - len(failed)} lolos dari {total} file")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
