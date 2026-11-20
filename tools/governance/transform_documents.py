#!/usr/bin/env python3
"""Classify and convert MelindaOS documents into the A/B/C agent-ready formats.

Without flags: print the classification summary and write nothing.
With --write-inventory: also save the classification inventory.
With --apply: rewrite documents in place, rename files, update references,
and record the checker result for every converted file.

PDF text-layer repair needs PyMuPDF:
    uv run --no-project --with pyyaml --with pymupdf python transform_documents.py --apply
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from dataclasses import asdict, dataclass, field
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))
import validate_frontmatter as spec  # noqa: E402

try:
    import pymupdf
except ImportError:
    pymupdf = None

REPO_ROOT = spec.REPO_ROOT
INVENTORY = REPO_ROOT / "knowledge/11_MACHINE_READABLE" / "manifest" / "document_format_inventory.json"
TODAY = "2026-09-28"
SKIP_PARTS = spec.SKIP_PARTS | {"sources", "99_ARCHIVE", ".claude"}
EMPTY_MARK = "Tidak diatur dalam dokumen sumber."
BASE_CONTEXT = (
    "RSIA Melinda DHAI adalah rumah sakit ibu dan anak di Kediri, Jawa Timur. "
    "Dokumen ini bagian dari MelindaOS, sumber kebenaran tunggal untuk agent rumah sakit."
)
DEFAULT_GUARDRAIL = (
    "Dokumen sumber tidak memuat batasan khusus. Batas global tetap berlaku: "
    "`knowledge/08_AGENT_POLICY/communications/agent-global-conduct-rules.prompt.md` dan "
    "tindakan klinis L5 hanya oleh klinisi (`knowledge/09_AGENT_ARCHITECTURE/orchestration/authority_matrix.yaml`)."
)
EWS_FORM = "knowledge/06_CLINICAL_SAFETY/nursing_midwifery/contoh_formulir_peneliaian_ews.md"
EWS_SCHEMA = "knowledge/11_MACHINE_READABLE/core/schema-meows-observation.json"

B_TARGETS = {
    "knowledge/08_AGENT_POLICY/bpjs_runbooks/06_agent_runbook_and_cheatsheet.md": "bpjs-runbook",
    "knowledge/08_AGENT_POLICY/communications/GLOBAL_CONDUCT.md": "global-conduct",
    "knowledge/08_AGENT_POLICY/communications/SOCIAL_CONTENT_POLICY.md": "social-content",
    "knowledge/08_AGENT_POLICY/core/CONFIRMATION_POLICY.md": "confirmation",
    "knowledge/08_AGENT_POLICY/core/dynamic-live-only.md": "dynamic-live-only",
    "knowledge/08_AGENT_POLICY/core/melinda_knowledge_policy.md": "knowledge-policy",
    "knowledge/08_AGENT_POLICY/core/PERMISSION_MATRIX.md": "permission-matrix",
    "knowledge/08_AGENT_POLICY/governance/AUTOMATION_ABOVE_ALL.md": "automation-above-all",
    "knowledge/08_AGENT_POLICY/licensing/LEGAL_HIERARCHY_AND_FRESHNESS.md": "licensing-legal-hierarchy",
    "knowledge/08_AGENT_POLICY/licensing/QUERY_ROUTER.md": "licensing-query-router",
    "knowledge/08_AGENT_POLICY/licensing/RETRIEVAL_POLICY.md": "licensing-retrieval",
    "knowledge/08_AGENT_POLICY/licensing/SYSTEM_PROMPT.md": "licensing",
    "knowledge/08_AGENT_POLICY/referral/CONVERSATION_PLAYBOOK.md": "referral-conversation",
    "knowledge/08_AGENT_POLICY/security/SECRETS_AND_IDENTITY.md": "secrets-identity",
    "knowledge/08_AGENT_POLICY/security/vault/README.md": "vault",
    "knowledge/09_AGENT_ARCHITECTURE/agents/aegis.md": "aegis",
    "knowledge/09_AGENT_ARCHITECTURE/agents/atlas.md": "atlas",
    "knowledge/09_AGENT_ARCHITECTURE/agents/claims.md": "claims",
    "knowledge/09_AGENT_ARCHITECTURE/agents/flow.md": "flow",
    "knowledge/09_AGENT_ARCHITECTURE/agents/guardian.md": "guardian",
    "knowledge/09_AGENT_ARCHITECTURE/agents/ledger.md": "ledger",
    "knowledge/09_AGENT_ARCHITECTURE/agents/nexus.md": "nexus",
    "knowledge/09_AGENT_ARCHITECTURE/agents/ops.md": "ops",
    "knowledge/09_AGENT_ARCHITECTURE/agents/people.md": "people",
    "knowledge/09_AGENT_ARCHITECTURE/agents/README.md": "pack",
    "knowledge/09_AGENT_ARCHITECTURE/specialists/prisma.md": "prisma",
    "knowledge/09_AGENT_ARCHITECTURE/bpjs/00_system_prompt_agent_architecture.md": "bpjs-claim-advisor",
    "knowledge/09_AGENT_ARCHITECTURE/orchestration/handoff_protocol.md": "handoff-protocol",
    "knowledge/09_AGENT_ARCHITECTURE/templates/director_morning_brief.md": "director-morning-brief",
}
PROSE_A: dict[str, tuple[str, str]] = {}
PROSE_DIR_DEFAULTS = {
    "knowledge/10_TOOL_CONTRACTS/core": ("Operasional", "Unit IT"),
    "knowledge/10_TOOL_CONTRACTS/mcp": ("Operasional", "Unit IT"),
    "knowledge/10_TOOL_CONTRACTS/integrations": ("Operasional", "Humas & Digital"),
    "knowledge/11_MACHINE_READABLE/core": ("Manajemen", "Unit IT"),
    "knowledge/11_MACHINE_READABLE/licensing": ("Manajemen", "Hukum"),
    "knowledge/11_MACHINE_READABLE/live_data_requirements": ("Operasional", "Unit IT"),
    "knowledge/11_MACHINE_READABLE/referral": ("Klinis", "Rujukan"),
}
SUBFOLDER_DEPARTMENT = {
    "governance": "Direksi",
    "hospital_sop": "Pelayanan Medis",
    "reference": "Rumah Sakit",
    "schedules": "Poliklinik",
    "registration_and_identity": "Pendaftaran",
    "admedika": "Penjamin & Asuransi",
    "owlexa": "Penjamin & Asuransi",
    "coordination_of_benefits": "Penjamin & Asuransi",
    "eligibility": "Penjamin & Asuransi",
    "guarantee": "Penjamin & Asuransi",
    "handoff": "Penjamin & Asuransi",
    "overview": "Penjamin & Asuransi",
    "scenarios": "Penjamin & Asuransi",
    "dispute_prevention": "Casemix",
    "maternal_obstetrics": "Poli Obgyn",
    "pediatric_neonatal": "Poli Anak",
    "referral_and_emergency": "IGD",
    "tariff": "Casemix",
    "bpjs": "Casemix",
    "fktp_partnership": "Rujukan",
    "patient_routing": "Rujukan",
    "private_insurance": "Penjamin & Asuransi",
    "bpjs_checklists": "Casemix",
    "maternal_sop": "Kebidanan & Kandungan",
    "nursing_midwifery": "Keperawatan & Kebidanan",
    "referral": "IGD",
    "restricted": "Komite Medis",
    "building_spatial": "Sarana & Prasarana",
    "core": "Hukum",
    "data_quality": "Mutu",
    "environmental": "Kesehatan Lingkungan",
    "hospital_regulations": "Hukum",
    "it_governance": "Unit IT",
    "medical_records_rme": "Rekam Medis",
    "oss_rba": "Perizinan",
    "pharmacy_policies": "Farmasi",
    "playbooks": "Hukum",
    "special_services": "Pelayanan Penunjang",
    "workforce_str_sip": "SDM",
}
DEPARTMENT_RULES = [
    (r"\b(cssd|steril|sterilisasi|autoclav|alat kotor|recall)\b", "CSSD"),
    (r"\b(rm|erm|rekam medis|icd|urmik|mrmik|penomoran|formulir rm|tata naskah)\b", "Rekam Medis"),
    (r"\b(anestesi|anestesia|sedasi|trolly|suction|oxymeter|defibrilator)\b", "Anestesi & Kamar Operasi"),
    (r"\b(ubs)\b", "Unit Bedah Sentral"),
    (r"\b(bayi|neonatus|neonatal|inkubator|cpap|ogt|spo2|fototerapi|kanguru|susu formula|gemeli|perinatal)\b", "Perinatologi"),
    (r"\b(persalinan|ponek|sectio|caesarea|episiotomi|distosia|serviks|perineum|plasenta|prolaps|curetase|abortus|ket|kista|iud|implan|uterotonika|hpp|atonia|janin|perdarahan|eklamsi|preeklamsi|peb|term|ruptur|ruptura|imd|rawat gabung|kiakb|pkbrs)\b", "Kebidanan & Kandungan"),
    (r"\b(gizi)\b", "Gizi"),
    (r"\b(loundry|laundry)\b", "Laundry"),
    (r"\b(lab)\b", "Laboratorium"),
    (r"\b(sdm)\b", "SDM"),
    (r"\b(sekretariat)\b", "Sekretariat"),
    (r"\b(kppirs|apd)\b", "PPI"),
    (r"\b(audit medis)\b", "Komite Medis"),
    (r"\b(audit keperawatan|komite keperawatan)\b", "Komite Keperawatan"),
    (r"\b(profesi lain)\b", "Komite Tenaga Kesehatan Lain"),
    (r"\b(hpk)\b", "Hak Pasien & Keluarga"),
    (r"\b(stunting|wasting|anak)\b", "Poli Anak"),
    (r"\b(dnr|resusistasi|dpjp|konsultasi antar dokter)\b", "Pelayanan Medis"),
]
ACRONYMS = {
    "spo", "sop", "sk", "rm", "erm", "icd", "ppa", "it", "rsia", "rs", "urmik", "mrmik", "apd",
    "cssd", "kppirs", "ubs", "sdm", "iud", "ket", "hpk", "hpp", "ogt", "spo2", "cpap", "gda",
    "dnr", "dpjp", "pews", "meows", "igd", "bpjs", "tpa", "cob", "fktp", "oss", "rba", "pbg",
    "slf", "kkpr", "b3", "str", "sip", "pdp", "rme", "simrs", "hbl", "msbl", "nsbl", "dhai",
    "peb", "kpd", "imd", "ews", "sbar", "kb", "kia", "kiakb", "pkbrs", "umku", "kbli", "vip",
    "vvip", "jkn", "ina", "cbg", "mcp", "api", "nicu", "picu", "bhd", "pap", "lab",
}
GENERIC_STEMS = {"readme"}
OUTPUT_HEADING = re.compile(r"format|output|template|laporan|report|respons|response|jawaban|brief", re.I)
SAFETY_HEADING = re.compile(
    r"batas|larang|guardrail|keamanan|keselamatan|safety|confidential|kerahasiaan|rahasia|eskalasi|"
    r"escalat|hard.?stop|prohibit|restrict|privacy|privasi|pdp|secret|credential|kewenangan|"
    r"red.?flag|emergency|darurat|never|jangan|risk|risiko",
    re.I,
)
CONTEXT_HEADING = re.compile(
    r"konteks|context|latar|tujuan|mission|misi|purpose|pengertian|hubungan|overview|ringkasan|"
    r"scope|lingkup|definisi|background|prinsip|principle",
    re.I,
)
SCAN_BOILERPLATE = re.compile(r"^\s*(?:[-*]\s*)?Dipindai\s*dengan\s*CamScanner\s*$", re.I)


@dataclass
class Entry:
    source: str
    category: str
    action: str
    target: str = ""
    domain: str = ""
    department: str = ""
    reason: str = ""
    status: str = "PLANNED"
    errors: list[str] = field(default_factory=list)


def kebab(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii").lower()
    return re.sub(r"[^a-z0-9]+", "-", text).strip("-")


def kb_parts(rel: Path) -> tuple[str, ...]:
    """Parts of a repo-relative path with `knowledge/<folder>` joined into one, so part 0 is still the top folder."""
    parts = rel.parts
    return ("/".join(parts[:2]), *parts[2:]) if len(parts) > 1 and parts[0] == "knowledge" else parts


def topic_for(rel: Path) -> str:
    topic = kebab(rel.name[: -len(".md")] if rel.name.endswith(".md") else rel.stem)
    topic = re.sub(r"^\d+-", "", topic)
    if topic.startswith("fix-") and not (REPO_ROOT / rel.parent / rel.name[len("fix_"):]).exists():
        topic = topic[len("fix-"):]
    if topic in GENERIC_STEMS:
        topic = f"{kebab(rel.parent.name)}-{topic}"
    return topic or "dokumen"


def load_frontmatter(path: Path) -> tuple[dict, str]:
    text = path.read_text(encoding="utf-8")
    data, body = spec.split_frontmatter(text)
    return (data or {}), (body if data is not None else text)


def a_domain_and_department(rel: Path, data: dict) -> tuple[str, str]:
    posix = rel.as_posix()
    if posix in PROSE_A:
        return PROSE_A[posix]
    parent = rel.parent.as_posix()
    if parent in PROSE_DIR_DEFAULTS:
        return PROSE_DIR_DEFAULTS[parent]
    domain = data.get("knowledge_domain") or data.get("domain")
    if domain not in spec.DOMAINS:
        domain = "Operasional"
    parts = kb_parts(rel)
    subfolder = parts[1] if len(parts) > 2 else ""
    department = SUBFOLDER_DEPARTMENT.get(subfolder, "Rumah Sakit")
    if subfolder in {"hospital_sop", "governance"}:
        words = " ".join(topic_for(rel).split("-"))
        for pattern, name in DEPARTMENT_RULES:
            if re.search(pattern, words):
                department = name
                break
    return domain, department


def record_reason(rel: Path) -> str:
    parts = kb_parts(rel)
    top = parts[0] if len(parts) > 1 else ""
    suffix = rel.suffix.lower()
    if top == "sources":
        return "Sumber mentah. Teksnya sudah diekstrak menjadi dokumen Kategori A."
    if top == "knowledge/99_ARCHIVE":
        return "Arsip. Tidak dipakai sebagai fakta rumah sakit."
    if top == "knowledge/00_INDEX":
        return "Indeks navigasi repositori. Tidak termasuk A/B/C; perlu keputusan Chief."
    if top == "13_TOKEN_DESIGN":
        return "Sistem desain antarmuka Sentra, bukan SOP rumah sakit."
    if top == "knowledge/12_GOVERNANCE" and suffix == ".md":
        return "Dokumen program dan tes. Tidak termasuk A/B/C; perlu keputusan Chief."
    if suffix in {".py", ".toml", ".lock", ".hcl", ".example", ".txt", ".gitignore"} or rel.name.startswith("."):
        return "Kode atau konfigurasi."
    if suffix in {".yaml", ".yml", ".json", ".jsonl", ".csv"}:
        return "Data atau konfigurasi mesin, bukan formulir input."
    if suffix in {".png", ".jpg", ".jpeg", ".svg", ".html"}:
        return "Aset visual."
    if rel.name == "README.md":
        return "README repositori atau runtime."
    return "Tidak termasuk kategori A/B/C."


def build_inventory() -> list[Entry]:
    entries: list[Entry] = []
    a_entries: list[tuple[Entry, Path]] = []
    for path in sorted(REPO_ROOT.rglob("*")):
        if not path.is_file() or any(part in spec.SKIP_PARTS or part == ".claude" for part in path.parts):
            continue
        rel = path.relative_to(REPO_ROOT)
        posix = rel.as_posix()
        if path == INVENTORY:
            continue
        parts = kb_parts(rel)
        top = parts[0] if len(parts) > 1 else ""
        if posix == EWS_FORM:
            entries.append(Entry(posix, "C", "convert", EWS_SCHEMA, "Klinis", "Keperawatan & Kebidanan",
                                 "Formulir MEOWS menjadi JSON Schema. Markdown lama memuat identitas pasien dan dihapus."))
        elif posix in B_TARGETS:
            target = rel.parent / f"agent-{B_TARGETS[posix]}-rules.prompt.md"
            entries.append(Entry(posix, "B", "convert", target.as_posix(), reason="Aturan atau persona agent."))
        elif posix.startswith("knowledge/11_MACHINE_READABLE/core/") and rel.name.endswith(".schema.json"):
            entity = kebab(rel.name[: -len(".schema.json")])
            target = rel.parent / f"schema-{entity}.json"
            entries.append(Entry(posix, "C", "convert", target.as_posix(), reason="Kontrak input tool."))
        elif rel.suffix == ".md" and (
            top in spec.KNOWLEDGE_DIRS or top in {"knowledge/10_TOOL_CONTRACTS", "knowledge/11_MACHINE_READABLE"} or posix in PROSE_A
        ):
            data, _ = load_frontmatter(path)
            domain, department = a_domain_and_department(rel, data)
            entry = Entry(posix, "A", "convert", domain=domain, department=department, reason="Knowledge base.")
            entries.append(entry)
            a_entries.append((entry, rel))
        else:
            entries.append(Entry(posix, "RECORD", "record", reason=record_reason(rel)))

    topics = {id(entry): topic_for(rel) for entry, rel in a_entries}
    counts: dict[str, int] = {}
    for topic in topics.values():
        counts[topic] = counts.get(topic, 0) + 1
    for entry, rel in a_entries:
        topic = topics[id(entry)]
        if counts[topic] > 1:
            topic = f"{topic}-{kebab(rel.parent.name)}"
        entry.target = (rel.parent / f"kb-{entry.domain.lower()}-{topic}.md").as_posix()
    seen: dict[str, str] = {}
    for entry in entries:
        if entry.target:
            if entry.target in seen:
                raise RuntimeError(f"target collision: {entry.target} from {seen[entry.target]} and {entry.source}")
            seen[entry.target] = entry.source
    return entries


def clean_title(title: str) -> str:
    words = []
    for word in re.split(r"(\s+)", title.strip()):
        core = re.sub(r"[^A-Za-z0-9]", "", word).lower()
        words.append(word.upper() if core in ACRONYMS else word)
    return "".join(words)


def strip_boilerplate(body: str) -> str:
    return "\n".join(line for line in body.splitlines() if not SCAN_BOILERPLATE.match(line))


def normalize_headings(body: str, title: str) -> str:
    lines = body.splitlines()
    out: list[str] = []
    fenced = False
    seen_h1 = False
    previous = 0
    for line in lines:
        if line.lstrip().startswith("```"):
            fenced = not fenced
            out.append(line)
            continue
        match = None if fenced else re.match(r"^(#{1,6}) (.*)$", line)
        if not match:
            out.append(line)
            continue
        level = len(match.group(1))
        text = match.group(2)
        if level == 1 and not seen_h1:
            seen_h1 = True
            previous = 1
            out.append(f"# {title}")
            continue
        if level == 1:
            level = 2
        if level > previous + 1:
            level = previous + 1
        previous = level
        out.append(f"{'#' * level} {text}")
    if not seen_h1:
        out = [f"# {title}", ""] + out
        previous = 1
    text = "\n".join(out).strip("\n")
    return text + "\n"


def fix_tables(body: str) -> str:
    lines = body.splitlines()
    out: list[str] = []
    fenced = False
    index = 0
    while index < len(lines):
        line = lines[index]
        if line.lstrip().startswith("```"):
            fenced = not fenced
        if fenced or not line.strip().startswith("|"):
            out.append(line)
            index += 1
            continue
        block = []
        while index < len(lines) and lines[index].strip().startswith("|"):
            block.append(lines[index].strip())
            index += 1
        if len(block) < 2 or not spec.is_separator(block[1]):
            width = len(spec.row_cells(block[0]))
            block.insert(1, "| " + " | ".join(["---"] * width) + " |")
        if out and out[-1].strip():
            out.append("")
        out.extend(block)
        if index < len(lines) and lines[index].strip():
            out.append("")
    return "\n".join(out) + "\n"


def pdf_text(path: Path) -> str | None:
    if pymupdf is None or not path.exists() or path.suffix.lower() != ".pdf":
        return None
    pages = [page.get_text() for page in pymupdf.open(path)]
    return "\n".join(pages) if any(len(page.strip()) > 100 for page in pages) else None


def repair_glue(body: str, source: str) -> tuple[str, int]:
    positions = [i for i, char in enumerate(source) if char.isalnum()]
    stream = "".join(source[i] for i in positions)
    repaired = 0

    def replace(match: re.Match) -> str:
        nonlocal repaired
        token = match.group(0)
        start = stream.find(token)
        if start < 0:
            return token
        segment = source[positions[start]: positions[start + len(token) - 1] + 1]
        spaced = re.sub(r"\s+", " ", segment).strip()
        if spaced == token or " " not in spaced:
            return token
        repaired += 1
        return spaced

    lines = []
    fenced = False
    for line in body.splitlines():
        if line.lstrip().startswith("```"):
            fenced = not fenced
        lines.append(line if fenced else spec.GLUE.sub(replace, line))
    return "\n".join(lines) + "\n", repaired


def quoted(value: object) -> str:
    return json.dumps(value, ensure_ascii=False)


def render_a_frontmatter(head: dict, legacy: dict, anomalies: list[str]) -> str:
    lines = ["---"]
    for key in spec.A_REQUIRED:
        value = head[key]
        if isinstance(value, bool):
            lines.append(f"{key}: {'true' if value else 'false'}")
        elif isinstance(value, list):
            lines.append(f"{key}: [{', '.join(quoted(item) for item in value)}]")
        else:
            lines.append(f"{key}: {quoted(value)}")
    if legacy:
        lines.append(yaml.safe_dump(legacy, sort_keys=False, allow_unicode=True, width=1000).strip())
    lines.extend(governance_or_review(anomalies))
    lines.append("---")
    return "\n".join(lines) + "\n"


def governance_or_review(anomalies: list[str]) -> list[str]:
    if anomalies:
        lines = ['review_status: "NEEDS_CHIEF_REVIEW"', "anomalies:"]
        lines.extend(f"  - {quoted(item)}" for item in anomalies)
        return lines
    lines = ["governance:"]
    lines.extend(f"  {key}: {quoted(value)}" for key, value in spec.GOVERNANCE_FIELDS.items())
    return lines


def unique(items: list[str]) -> list[str]:
    result: list[str] = []
    for item in items:
        if item and item not in result:
            result.append(item)
    return result


def convert_a(entry: Entry) -> list[str]:
    source = REPO_ROOT / entry.source
    rel = Path(entry.source)
    data, body = load_frontmatter(source)
    first_h1 = next((line[2:].strip() for line in body.splitlines() if line.startswith("# ")), "")
    raw_title = str(data.get("title") or first_h1 or rel.stem.replace("_", " ").title())
    title = clean_title(raw_title) if data else raw_title
    topic = Path(entry.target).name[len(f"kb-{entry.domain.lower()}-"): -len(".md")]
    parts = kb_parts(rel)
    subfolder = parts[1] if len(parts) > 2 else parts[0]

    body = strip_boilerplate(body)
    raw_path = data.get("source_raw_path")
    if raw_path:
        text_layer = pdf_text(REPO_ROOT / str(raw_path).replace("\\", "/"))
        if text_layer:
            body, _ = repair_glue(body, text_layer)
    body = normalize_headings(body, title)
    body = fix_tables(body)

    head = {
        "doc_id": f"SOP-{spec.DOMAINS[entry.domain]}-{topic.upper()}",
        "title": title,
        "domain": entry.domain,
        "department": entry.department,
        "version": str(data.get("version") or "1.0"),
        "last_reviewed": TODAY,
        "ftdr_safety_override": entry.domain == "Klinis" or data.get("authority_level") == "L5_CLINICAL_ONLY",
        "tags": unique([entry.domain.lower(), kebab(entry.department), kebab(subfolder), topic]),
    }
    legacy = {
        key: data[key]
        for key in ("authority_level", "target_agents", "freshness_ttl_days", "allowed_tools", "source_raw_path")
        if key in data
    }
    anomalies = spec.quality_issues(body, raw_path)
    target = REPO_ROOT / entry.target
    target.write_text(render_a_frontmatter(head, legacy, anomalies) + "\n" + body, encoding="utf-8")
    if target != source:
        source.unlink()
    return anomalies


def refresh_a(path: Path) -> None:
    data, body = load_frontmatter(path)
    body = normalize_headings(fix_tables(strip_boilerplate(body)), str(data["title"]))
    head = {key: data[key] for key in spec.A_REQUIRED}
    head["version"] = str(head["version"])
    head["last_reviewed"] = str(head["last_reviewed"])
    legacy = {
        key: data[key]
        for key in (
            "authority_level", "target_agents", "freshness_ttl_days", "allowed_tools",
            "source_raw_path", "source_extraction",
        )
        if key in data
    }
    anomalies = spec.quality_issues(body, data.get("source_raw_path"), data.get("source_extraction"))
    path.write_text(render_a_frontmatter(head, legacy, anomalies) + "\n" + body, encoding="utf-8")


def split_chunks(body: str) -> tuple[str, list[str], list[tuple[str, list[str]]]]:
    title = ""
    preamble: list[str] = []
    chunks: list[tuple[str, list[str]]] = []
    fenced = False
    for line in body.splitlines():
        if line.lstrip().startswith("```"):
            fenced = not fenced
        heading = None if fenced else re.match(r"^(#{1,3}) (.*)$", line)
        if heading and len(heading.group(1)) == 1 and not title:
            title = heading.group(2).strip()
            continue
        if heading:
            chunks.append((heading.group(2).strip(), []))
            continue
        if chunks:
            chunks[-1][1].append(line)
        else:
            preamble.append(line)
    return title, preamble, chunks


def render_chunk(heading: str, lines: list[str]) -> str:
    content = []
    for line in lines:
        deep = re.match(r"^#{4,6} (.*)$", line)
        content.append(f"### {deep.group(1)}" if deep else line)
    text = "\n".join(content).strip()
    return f"## {heading}\n\n{text}" if text else ""


def convert_b(entry: Entry) -> list[str]:
    source = REPO_ROOT / entry.source
    body = source.read_text(encoding="utf-8")
    role_name = Path(entry.target).name[len("agent-"): -len("-rules.prompt.md")]
    title, preamble, chunks = split_chunks(body)
    title = title or role_name.replace("-", " ").title()

    role_lines = [title]
    context_parts = [BASE_CONTEXT]
    buckets: dict[str, list[str]] = {"safety": [], "instructions": [], "output": []}
    intro = []
    for line in preamble:
        if line.strip().startswith("Anda adalah"):
            role_lines.append(line.strip())
        else:
            intro.append(line)
    if "\n".join(intro).strip():
        context_parts.append("\n".join(intro).strip())
    for heading, lines in chunks:
        kept = []
        for line in lines:
            if line.strip().startswith("Anda adalah"):
                role_lines.append(line.strip())
            else:
                kept.append(line)
        rendered = render_chunk(heading, kept)
        if not rendered:
            continue
        if OUTPUT_HEADING.search(heading):
            buckets["output"].append(rendered)
        elif SAFETY_HEADING.search(heading):
            buckets["safety"].append(rendered)
        elif CONTEXT_HEADING.search(heading):
            context_parts.append(rendered)
        else:
            buckets["instructions"].append(rendered)

    def block(tag: str, parts: list[str], fallback: str) -> str:
        content = "\n\n".join(parts) if parts else fallback
        return f"<{tag}>\n\n{content.strip()}\n\n</{tag}>"

    spec_body = "\n\n".join([
        "<agent_specification>",
        block("role", ["\n\n".join(role_lines)], title),
        block("context", context_parts, BASE_CONTEXT),
        block("safety_guardrails", buckets["safety"], DEFAULT_GUARDRAIL),
        block("instructions", buckets["instructions"], EMPTY_MARK),
        block("output_format", buckets["output"], EMPTY_MARK),
        "</agent_specification>",
    ])
    output = f"# {title}\n\n{spec_body}\n"

    source_lines = {line.strip() for line in body.splitlines() if line.strip() and not line.lstrip().startswith("#")}
    output_lines = {line.strip() for line in output.splitlines()}
    lost = source_lines - output_lines
    if lost:
        raise RuntimeError(f"{entry.source}: content lost during B conversion: {sorted(lost)[:3]}")

    anomalies = [issue for issue in spec.quality_issues(output) if issue.startswith(("PII", "NOISE"))]
    frontmatter = ["---"]
    frontmatter.append(f"doc_id: {quoted('AGT-' + role_name.upper())}")
    frontmatter.append(f"title: {quoted(title)}")
    frontmatter.append(f"version: {quoted('1.0')}")
    frontmatter.append(f"last_reviewed: {quoted(TODAY)}")
    frontmatter.append(f"tags: [{', '.join(quoted(tag) for tag in ['agent', role_name])}]")
    frontmatter.extend(governance_or_review(anomalies))
    frontmatter.append("---")
    target = REPO_ROOT / entry.target
    target.write_text("\n".join(frontmatter) + "\n\n" + output, encoding="utf-8")
    if target != source:
        source.unlink()
    return anomalies


SCHEMA_DESCRIPTIONS: dict[str, dict[str, str]] = {
    "appointment-cancel-input": {
        "": "Input for appointment.cancel: cancel an existing appointment. Risk R4; confirmation and authentication required.",
        "appointment_reference": "Reference of the appointment to cancel, obtained from an authorized appointment lookup.",
        "reason_code": "Optional controlled cancellation reason.",
        "confirmation_token": "Token proving explicit user confirmation bound to this exact normalized cancel action.",
        "idempotency_key": "Client-generated key that makes retries of the same request safe.",
    },
    "appointment-create-input": {
        "": "Input for appointment.create: book a confirmed appointment in a bookable slot. Risk R3. Requires patient_ref or pre_registration_token.",
        "slot_id": "Bookable slot identifier returned by appointment.find_slots.",
        "patient_ref": "Opaque patient reference from patient.resolve_administrative_identity.",
        "pre_registration_token": "Pre-registration token from patient.pre_register for a new patient.",
        "contact_preference": "Preferred channel for appointment communication.",
        "payer_type": "Payer type, when required by hospital policy.",
        "confirmation_token": "Token proving explicit user confirmation bound to this exact normalized booking action.",
        "idempotency_key": "Client-generated key that makes retries of the same request safe.",
    },
    "appointment-find-slots-input": {
        "": "Input for appointment.find_slots: find bookable slots for a doctor or a service. Risk R1. Requires doctor_id or service_id.",
        "doctor_id": "Doctor identifier from doctor.search.",
        "service_id": "Service identifier from service.search.",
        "date_from": "First date of the search range (ISO 8601 date).",
        "date_to": "Last date of the search range (ISO 8601 date).",
        "time_preference": "Optional preferred part of the day.",
        "location_id": "Optional hospital location identifier.",
        "payer_type": "Optional payer type for the requested visit.",
    },
    "handoff-create-input": {
        "": "Input for handoff.create: structured handoff to human staff or an authorized department. Risk R3.",
        "destination": "Target department or staff queue.",
        "reason_code": "Controlled reason for the handoff.",
        "case_summary": "What the user needs, what is verified, actions already attempted, and the unresolved issue.",
        "contact_preference": "Preferred channel for staff to reach the user.",
        "sensitivity": "Data sensitivity class: D0 public, D1 internal operational, D2 personal administrative, D3 sensitive identifier.",
        "conversation_ref": "Reference to the originating conversation.",
        "patient_ref": "Optional opaque patient reference, only when authorized.",
        "idempotency_key": "Client-generated key that makes retries of the same request safe.",
    },
    "melinda-normalized-error": {
        "": "Normalized error payload returned by Melinda tools.",
        "ok": "Always false for an error payload.",
        "error": "Error details.",
        "error.code": "Canonical machine-readable error code from ERROR_CONTRACT.",
        "error.message": "Internal diagnostic message.",
        "error.retryable": "Whether the same request may be retried.",
        "error.safe_user_message": "User-facing message: what happened and the next safe option, without blaming the user or exposing internals.",
        "error.handoff_recommended": "Whether a human handoff is recommended.",
        "error.correlation_id": "Identifier linking the error to server-side audit and traces.",
    },
    "notification-send-input": {
        "": "Input for notification.send: transactional confirmation, reminder, or handoff notification through an approved provider. Risk R4.",
        "recipient_ref": "Recipient reference, not an arbitrary destination.",
        "template_id": "Approved message template identifier.",
        "template_variables": "Structured variables for the approved template.",
        "channel": "Delivery channel.",
        "confirmation_token": "Confirmation token; required unless hospital policy permits automatic sending for an already-confirmed transaction.",
        "idempotency_key": "Client-generated key that makes retries of the same request safe.",
    },
    "patient-pre-register-input": {
        "": "Input for patient.pre_register: minimum administrative pre-registration for a new patient. Risk R3. No clinical history.",
        "full_name": "Patient full name.",
        "date_of_birth": "Patient date of birth (ISO 8601 date).",
        "sex_admin": "Administrative sex.",
        "phone": "Contact phone number.",
        "email": "Optional contact email address.",
        "government_id": "Government identifier, only when required by hospital policy. Sensitivity D3.",
        "payer_id": "Insurance or payer member identifier, only when required. Sensitivity D3.",
        "privacy_notice_acknowledged": "Must be true: the privacy notice was acknowledged.",
        "confirmation_token": "Token proving explicit user confirmation bound to this exact pre-registration action.",
        "idempotency_key": "Client-generated key that makes retries of the same request safe.",
    },
}

MEOWS_SCHEMA = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "MEOWS observation",
    "description": (
        "Satu observasi Modified Early Obstetric Warning Score (MEOWS) dari formulir penilaian EWS RSIA Melinda. "
        "Skema ini menyimpan nilai observasi, bukan algoritme skor: nilai skor per pita tidak terbaca pada scan sumber. "
        "Sumber: sources/raw/6-nursing-midwifery/escalation-physician-procedure/Contoh formulir peneliaian EWS.pdf."
    ),
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "patient_ref": {
            "type": "string",
            "minLength": 1,
            "description": "Referensi pasien opak. Formulir kertas memuat nama, tanggal lahir, dan nomor RM; data itu tidak disimpan di sini.",
        },
        "ward": {"type": "string", "description": "Ruang tempat observasi."},
        "care_class": {"type": "string", "description": "Kelas perawatan."},
        "observed_at": {"type": "string", "format": "date-time", "description": "Tanggal dan jam observasi."},
        "respiratory_rate_per_min": {
            "type": "integer", "minimum": 0,
            "description": "Respirasi per menit. Pita pada formulir: <12, 13-20, 21-25, >25.",
        },
        "spo2_percent": {
            "type": "number", "minimum": 0, "maximum": 100,
            "description": "Saturasi O2 (%). Pita pada formulir: <92, 92-95, >95.",
        },
        "supplemental_oxygen": {"type": "boolean", "description": "Suplemen O2 diberikan saat observasi."},
        "temperature_celsius": {
            "type": "number",
            "description": "Suhu (derajat Celsius). Pita pada formulir: <36, 36,1-37,2, 37,3-37,7, >37,7.",
        },
        "systolic_bp_mmhg": {
            "type": "integer", "minimum": 0,
            "description": "Tekanan darah sistolik (mmHg). Pita pada formulir: <90, 90-140, 140-150, 150-160, >160.",
        },
        "diastolic_bp_mmhg": {
            "type": "integer", "minimum": 0,
            "description": "Tekanan darah diastolik (mmHg). Pita pada formulir: <90, 90-100, 100-110, >110.",
        },
        "heart_rate_per_min": {
            "type": "integer", "minimum": 0,
            "description": "Detak jantung per menit. Pita pada formulir: <50, 50-60, 60-100, 100-110 (tertulis '10-110' pada scan), 110-120, >120.",
        },
        "consciousness": {
            "type": "string", "enum": ["sadar", "nyeri_verbal_atau_tidak_respons"],
            "description": "Kesadaran: sadar, atau hanya respons terhadap nyeri/verbal/tidak respons.",
        },
        "pain": {"type": "string", "enum": ["normal", "abnormal"], "description": "Penilaian nyeri."},
        "discharge_lochia": {"type": "string", "enum": ["normal", "abnormal"], "description": "Discharge/lochia."},
        "proteinuria": {
            "type": "string",
            "description": "Proteinuria per hari. Pita nilai tidak terbaca pada scan sumber.",
        },
        "total_score": {
            "type": "integer", "minimum": 0,
            "description": (
                "Total skor MEOWS. Formulir: skor 1-4 risiko ringan, eskalasi perawatan dan monitoring lebih dini; "
                "skor 5-6 atau salah satu parameter bernilai 3 risiko sedang, monitoring tiap jam dan pertimbangkan area dengan monitor. "
                "Kategori di atasnya tidak terbaca utuh. Henti napas/jantung: resusitasi (tertulis 'RIP' pada scan) dan aktifkan tim CODE BLUE, respons maksimal 5 menit."
            ),
        },
    },
    "required": [
        "patient_ref",
        "observed_at",
        "respiratory_rate_per_min",
        "spo2_percent",
        "temperature_celsius",
        "systolic_bp_mmhg",
        "diastolic_bp_mmhg",
        "heart_rate_per_min",
        "consciousness",
        "total_score",
    ],
}


def describe(properties: dict, texts: dict[str, str], prefix: str = "") -> None:
    for name, node in properties.items():
        key = f"{prefix}{name}"
        if key not in texts:
            raise RuntimeError(f"missing description for {key}")
        node["description"] = texts[key]
        if isinstance(node.get("properties"), dict):
            describe(node["properties"], texts, f"{key}.")


def convert_c(entry: Entry) -> list[str]:
    source = REPO_ROOT / entry.source
    target = REPO_ROOT / entry.target
    if entry.source == EWS_FORM:
        schema = json.loads(json.dumps(MEOWS_SCHEMA))
    else:
        schema = json.loads(source.read_text(encoding="utf-8"))
        entity = target.name[len("schema-"): -len(".json")]
        texts = SCHEMA_DESCRIPTIONS[entity]
        ordered = {"$schema": schema.pop("$schema"), "title": schema.pop("title"), "description": texts[""]}
        ordered.update(schema)
        schema = ordered
        describe(schema["properties"], texts)
    schema["governance"] = dict(spec.GOVERNANCE_FIELDS)
    target.write_text(json.dumps(schema, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    if target != source:
        source.unlink()
    return []


def update_references(renames: dict[str, str]) -> int:
    changed = 0
    basenames: dict[str, list[str]] = {}
    for old in renames:
        basenames.setdefault(Path(old).name, []).append(old)
    replacements: list[tuple[re.Pattern, str]] = []
    for old, new in sorted(renames.items(), key=lambda item: -len(item[0])):
        for old_form, new_form in (
            (old, new),
            (old.replace("/", "\\"), new.replace("/", "\\")),
            (old.replace("/", "\\\\"), new.replace("/", "\\\\")),
        ):
            replacements.append((re.compile(re.escape(old_form)), new_form))
    for name, olds in basenames.items():
        if len(olds) == 1 and name != "README.md":
            new_name = Path(renames[olds[0]]).name
            replacements.append((re.compile(rf"(?<![\w/\\.-]){re.escape(name)}(?!\w)"), new_name))
    for path in sorted(REPO_ROOT.rglob("*")):
        if not path.is_file() or any(part in SKIP_PARTS for part in path.parts) or path == INVENTORY:
            continue
        if path.parent == Path(__file__).resolve().parent:
            continue
        if path.suffix.lower() not in {".md", ".py", ".yaml", ".yml", ".json", ".jsonl", ".csv", ".toml"}:
            continue
        text = path.read_text(encoding="utf-8", errors="strict")
        updated = text
        for pattern, value in replacements:
            updated = pattern.sub(lambda _match, value=value: value, updated)
        if updated != text:
            path.write_text(updated, encoding="utf-8")
            changed += 1
    return changed


def write_inventory(entries: list[Entry], applied: bool) -> None:
    counts: dict[str, dict[str, int]] = {}
    for entry in entries:
        bucket = counts.setdefault(entry.category, {})
        bucket[entry.status] = bucket.get(entry.status, 0) + 1
    payload = {
        "audit_date": TODAY,
        "applied": applied,
        "rule": "PASS hanya jika validate_frontmatter.py meloloskan file. File FAIL tidak memuat blok governance.",
        "counts": counts,
        "documents": [asdict(entry) for entry in entries],
    }
    INVENTORY.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="rewrite documents in place")
    parser.add_argument("--refresh", action="store_true", help="re-clean converted kb-*.md files and update inventory status")
    parser.add_argument("--write-inventory", action="store_true", help="save the classification inventory (resets recorded statuses)")
    args = parser.parse_args()

    if args.refresh:
        for path in sorted(REPO_ROOT.rglob("kb-*.md")):
            if not any(part in SKIP_PARTS for part in path.parts):
                refresh_a(path)
        payload = json.loads(INVENTORY.read_text(encoding="utf-8"))
        results = {row["path"]: row for row in spec.evaluate()}
        counts: dict[str, dict[str, int]] = {}
        for doc in payload["documents"]:
            if doc["category"] in {"A", "B", "C"}:
                row = results.get(doc["target"])
                doc["status"] = "PASS" if row and row["passed"] else "FAIL"
                doc["errors"] = row["errors"] if row else ["file hasil tidak ditemukan pemeriksa"]
            bucket = counts.setdefault(doc["category"], {})
            bucket[doc["status"]] = bucket.get(doc["status"], 0) + 1
        payload["counts"] = counts
        INVENTORY.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"refreshed: {counts}")
        return 0

    entries = build_inventory()
    if not args.apply:
        if args.write_inventory:
            write_inventory(entries, applied=False)
        summary: dict[str, int] = {}
        for entry in entries:
            summary[entry.category] = summary.get(entry.category, 0) + 1
        print(f"inventory: {summary}")
        return 0

    converters = {"A": convert_a, "B": convert_b, "C": convert_c}
    renames: dict[str, str] = {}
    for entry in entries:
        if entry.category in converters:
            converters[entry.category](entry)
            if entry.target != entry.source:
                renames[entry.source] = entry.target
    changed = update_references(renames)

    results = {row["path"]: row for row in spec.evaluate()}
    for entry in entries:
        if entry.category in converters:
            row = results.get(entry.target)
            entry.status = "PASS" if row and row["passed"] else "FAIL"
            entry.errors = row["errors"] if row else ["file hasil tidak ditemukan pemeriksa"]
        else:
            entry.status = "RECORDED"
    write_inventory(entries, applied=True)
    print(f"converted={len(renames)} references_updated_in={changed}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
