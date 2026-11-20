"""Placeholder scanner for Category A knowledge documents."""
from __future__ import annotations

import importlib.util
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

REPO_ROOT = Path(__file__).resolve().parents[2]
VALIDATOR = REPO_ROOT / "tools" / "governance" / "validate_frontmatter.py"

PLACEHOLDER = re.compile(r"\[(ISI|CEK)(?::\s*|\s+)?([^\]]*)\]")
INLINE_CODE = re.compile(r"`[^`\n]*`")
# Plan regex, except that the bare word "unit" counts only after a number or a placeholder: in Indonesian
# documents "Unit pemilik" / "Kepala unit" name an organisational unit, not a dose unit.
CLINICAL_UNIT = re.compile(r"\b(mg|mcg|µg|mL|ml|IU|tetes|mmHg|°C|kali/menit|x/menit|mEq|g/dL|mmol)\b|(?:\d|\])\s*\bunit\b", re.IGNORECASE)
HEADING = re.compile(r"^\s{0,3}#{1,6}\s+\S")
DRAFT_MARKER = "DRAF UNTUK KOREKSI"


@dataclass(frozen=True)
class Placeholder:
    doc_path: str
    line: int
    column: int
    raw: str
    kind: Literal["ISI", "CEK"]
    hint: str | None
    in_code: bool
    clinical: bool
    heading: str | None


def _inline_code_spans(line: str) -> list[tuple[int, int]]:
    return [(m.start(), m.end()) for m in INLINE_CODE.finditer(line)]


def scan_text(doc_path: str, text: str) -> list[Placeholder]:
    found: list[Placeholder] = []
    fenced = False
    heading: str | None = None
    in_frontmatter = text.startswith("---")
    for number, line in enumerate(text.splitlines(), start=1):
        if in_frontmatter:
            # YAML frontmatter (title, tags) is metadata, never a gap to fill; the validator checks the body too.
            if number > 1 and line.strip() == "---":
                in_frontmatter = False
            continue
        stripped = line.lstrip()
        if stripped.startswith("```"):
            fenced = not fenced
            continue
        if not fenced and HEADING.match(line):
            heading = line.strip()
        spans = [] if fenced else _inline_code_spans(line)
        clinical_line = bool(CLINICAL_UNIT.search(line)) or bool(heading and "dosis" in heading.lower())
        for match in PLACEHOLDER.finditer(line):
            hint = match.group(2).strip() or None
            in_code = fenced or any(start <= match.start() < end for start, end in spans)
            found.append(Placeholder(
                doc_path=doc_path,
                line=number,
                column=match.start(),
                raw=match.group(0),
                kind=match.group(1),  # type: ignore[arg-type]
                hint=hint,
                in_code=in_code,
                clinical=clinical_line,
                heading=heading,
            ))
    return found


def _doc_path(path: Path, root: Path = REPO_ROOT) -> str:
    try:
        return path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return path.as_posix()


def scan_file(path: Path, root: Path = REPO_ROOT) -> list[Placeholder]:
    return scan_text(_doc_path(path, root), path.read_text(encoding="utf-8"))


def draft_marker_lines(path: Path) -> list[int]:
    return [n for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1) if DRAFT_MARKER in line]


def _validator():
    spec = importlib.util.spec_from_file_location("validate_frontmatter", VALIDATOR)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def category_a_files(root: Path = REPO_ROOT) -> list[Path]:
    """Category A files exactly as the frontmatter validator classes them (never knowledge/99_ARCHIVE/sources/raw)."""
    vf = _validator()
    return [path for category, path in vf.collect(root) if category == "A"]


def scan_repo(root: Path = REPO_ROOT) -> list[Placeholder]:
    found: list[Placeholder] = []
    for path in category_a_files(root):
        found.extend(scan_file(path, root))
    return found


def summary(items: list[Placeholder]) -> dict[str, dict[str, int]]:
    per_dir: dict[str, dict[str, int]] = {}
    files: dict[str, set[str]] = {}
    for item in items:
        top = item.doc_path.split("/", 1)[0]
        bucket = per_dir.setdefault(top, {"placeholders": 0, "in_code": 0, "clinical": 0, "files": 0})
        bucket["placeholders"] += 1
        bucket["in_code"] += int(item.in_code)
        bucket["clinical"] += int(item.clinical)
        files.setdefault(top, set()).add(item.doc_path)
    for top, names in files.items():
        per_dir[top]["files"] = len(names)
    return dict(sorted(per_dir.items()))


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    items = scan_repo()
    if "--summary" in args:
        total = {"files": len({i.doc_path for i in items}), "placeholders": len(items), "in_code": sum(i.in_code for i in items), "clinical": sum(i.clinical for i in items)}
        for top, counts in summary(items).items():
            print(f"{top:24} files={counts['files']:3} placeholders={counts['placeholders']:4} in_code={counts['in_code']:3} clinical={counts['clinical']:3}")
        print(f"{'TOTAL':24} files={total['files']:3} placeholders={total['placeholders']:4} in_code={total['in_code']:3} clinical={total['clinical']:3}")
        return 0
    for item in items:
        print(f"{item.doc_path}:{item.line}:{item.column} {item.raw}{' [code]' if item.in_code else ''}{' [clinical]' if item.clinical else ''}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
