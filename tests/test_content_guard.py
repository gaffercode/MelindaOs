"""Regression guard against content errors corrected on 2026-11-07 (plan 02).

Forbidden:
- the revoked standard ``1128/2022`` cited on a line that does not also name
  the current standard ``1596/2024``;
- the wrong owner spelling ``PT RSIA Melinda`` (with or without the dot);
- the non-existent chapter code ``PANDU`` in the STARKES catalog and KB;
- the Director's former spelling ``Ferdi Iskandar`` in the knowledge library, tools, dashboard source and
  root documents (official since 2026-11-02: dr. Ferdi Andriska). History files are out of scope.
"""
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SKIP_PARTS = {"99_ARCHIVE", "sources", ".git", "node_modules", ".next", ".superpowers", ".claude", "coverage"}
KB_SUFFIXES = {".md", ".json", ".yaml", ".yml"}
DASHBOARD_SOURCE_DIRS = ("lib", "components", "app", "data")
SELF = Path(__file__).resolve()
# Plan texts quote the forbidden phrases on purpose.
PLANS_DIR = REPO_ROOT / "docs" / "superpowers" / "plans"

REVOKED_STANDARD = re.compile(r"1128/2022")
CURRENT_STANDARD = re.compile(r"1596/2024")
WRONG_OWNER = re.compile(r"PT\.?\s+RSIA\s+Melinda", re.IGNORECASE)
PANDU = re.compile(r"\bPANDU\b")
WRONG_DIRECTOR = re.compile(r"Ferdi\s+Iskandar")
DIRECTOR_NAME_ROOTS = ("AGENTS.md", "CONTRIBUTING.md", "SECURITY.md", "README.md", "LICENSE", "tools", "runtime", "dashboard/lib", "dashboard/components", "dashboard/app", "dashboard/scripts")


# Generated build snapshots embed quoted source text (including the plan notes
# that document these exact corrections), so they are never scanned as source.
GENERATED_SNAPSHOTS = {
    "dashboard/data/knowledge-index.json",
    "dashboard/data/knowledge-chunks.json",
    "dashboard/data/knowledge-search-index.json",
    "dashboard/data/agent-files.json",
    "dashboard/data/agent-file-contents.json",
    "dashboard/data/validation.json",
    "dashboard/data/studio-source-snapshot.json",
}


def _skip(path: Path) -> bool:
    rel = path.relative_to(REPO_ROOT).as_posix()
    return (
        any(part in SKIP_PARTS for part in path.relative_to(REPO_ROOT).parts)
        or path == SELF
        or PLANS_DIR in path.parents
        or rel in GENERATED_SNAPSHOTS
    )


def kb_files() -> list[Path]:
    return sorted(p for p in REPO_ROOT.rglob("*") if p.is_file() and p.suffix in KB_SUFFIXES and not _skip(p))


def dashboard_source_files() -> list[Path]:
    found: list[Path] = []
    for folder in DASHBOARD_SOURCE_DIRS:
        base = REPO_ROOT / "dashboard" / folder
        if base.exists():
            found.extend(p for p in base.rglob("*") if p.is_file() and not _skip(p))
    return sorted(set(found))


def pandu_scope() -> list[Path]:
    starkes_lib = REPO_ROOT / "dashboard" / "lib" / "starkes"
    kb_dir = REPO_ROOT / "knowledge/07_LEGAL_REGULATORY" / "data_quality"
    files = [p for p in starkes_lib.rglob("*") if p.is_file()] if starkes_lib.exists() else []
    files += [p for p in kb_dir.glob("kb-*starkes*") if p.is_file()]
    return sorted(set(files))


def _lines(path: Path):
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return []
    return enumerate(text.splitlines(), start=1)


def _rel(path: Path) -> str:
    return path.relative_to(REPO_ROOT).as_posix()


def find_revoked_standard(files: list[Path]) -> list[str]:
    return [
        f"{_rel(path)}:{number}"
        for path in files
        for number, line in _lines(path)
        if REVOKED_STANDARD.search(line) and not CURRENT_STANDARD.search(line)
    ]


def find_wrong_owner(files: list[Path]) -> list[str]:
    return [f"{_rel(path)}:{number}" for path in files for number, line in _lines(path) if WRONG_OWNER.search(line)]


def find_pandu(files: list[Path]) -> list[str]:
    return [f"{_rel(path)}:{number}" for path in files for number, line in _lines(path) if PANDU.search(line)]


def test_revoked_standard_is_not_cited_alone():
    hits = find_revoked_standard(kb_files() + dashboard_source_files())
    assert not hits, "1128/2022 cited without 1596/2024 on the same line:\n" + "\n".join(hits)


def test_owner_is_not_spelled_pt_rsia_melinda():
    hits = find_wrong_owner(kb_files() + dashboard_source_files())
    assert not hits, "Owner must be 'PT. Adianda Melinda Putri Iskandar':\n" + "\n".join(hits)


def test_pandu_is_not_a_chapter_code():
    hits = find_pandu(pandu_scope())
    assert not hits, "Chapter 16 is PPK, not PANDU:\n" + "\n".join(hits)


def director_name_scope() -> list[Path]:
    roots = [REPO_ROOT / name for name in DIRECTOR_NAME_ROOTS] + [p for p in (REPO_ROOT / "knowledge").iterdir() if re.match(r"(0\d|1[01])_", p.name)]
    files = [p for root in roots for p in ([root] if root.is_file() else root.rglob("*")) if p.is_file() and not _skip(p)]
    return sorted(set(files))


def test_director_is_spelled_ferdi_andriska():
    hits = [f"{_rel(path)}:{number}" for path in director_name_scope() for number, line in _lines(path) if WRONG_DIRECTOR.search(line)]
    assert not hits, "Director must be written 'dr. Ferdi Andriska':\n" + "\n".join(hits)
