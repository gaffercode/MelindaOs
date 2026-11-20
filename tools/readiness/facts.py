"""Institution fact registry: verified Studio facts, the org-structure table, and the employee master data."""
from __future__ import annotations

import csv
import json
import re
from pathlib import Path

FACTS_JSON = "dashboard/data/studio/facts.json"
ORG_KB = "knowledge/01_HOSPITAL/governance/kb-manajemen-struktur-organisasi-rs.md"
EMPLOYEES_CSV = "knowledge/11_MACHINE_READABLE/manifest/employees_2026.csv"

PREFIX_TITLES = {"dr.", "drg.", "apt.", "ns.", "prof.", "ir."}
PARENTHETICAL = re.compile(r"\s*\([^)]*\)")
ORG_HEADER = ("Jabatan", "Nama", "Melapor kepada")


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().lower())


def _studio_facts(root: Path) -> dict[str, str]:
    path = root / FACTS_JSON
    if not path.exists():
        return {}
    rows = json.loads(path.read_text(encoding="utf-8"))
    return {row["key"]: str(row["value"]) for row in rows if row.get("status") == "verified" and row.get("key") and row.get("value")}


def _org_roles(root: Path) -> dict[str, str]:
    path = root / ORG_KB
    if not path.exists():
        return {}
    roles: dict[str, str] = {}
    in_table = False
    for line in path.read_text(encoding="utf-8").splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")] if line.strip().startswith("|") else None
        if cells and tuple(cells[:3]) == ORG_HEADER:
            in_table = True
            continue
        if not in_table:
            continue
        if not cells:
            in_table = False
            continue
        if len(cells) < 2 or set(cells[0]) <= {"-", ":"}:
            continue
        role, name = normalize(cells[0]), PARENTHETICAL.sub("", cells[1]).strip()
        if role and name and f"role:{role}" not in roles:
            roles[f"role:{role}"] = name
    return roles


def full_name(nama: str, gelar: str) -> str:
    """Assemble `dr. Nama, S.H., M.Kn.` from the CSV's split name and titles."""
    parts = [p.strip() for p in gelar.split(",") if p.strip()]
    prefix = [p for p in parts if p.lower() in PREFIX_TITLES]
    suffix = [p for p in parts if p.lower() not in PREFIX_TITLES]
    name = " ".join([*prefix, nama.strip()])
    return f"{name}, {', '.join(suffix)}" if suffix else name


def _employees(root: Path) -> dict[str, str]:
    path = root / EMPLOYEES_CSV
    if not path.exists():
        return {}
    found: dict[str, str] = {}
    with path.open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            nama = (row.get("Nama Lengkap") or "").strip()
            if not nama:
                continue
            name = full_name(nama, row.get("Gelar") or "")
            found.setdefault(f"employee:{normalize(nama)}", name)
            jabatan = normalize(row.get("Jabatan") or "")
            if jabatan:
                found.setdefault(f"role:{jabatan}", name)
    return found


def load_facts(root: Path) -> dict[str, str]:
    """Precedence: verified Studio facts, then the org-structure table, then the employee CSV."""
    facts: dict[str, str] = {}
    for source in (_studio_facts(root), _org_roles(root), _employees(root)):
        for key, value in source.items():
            facts.setdefault(key, value)
    return facts


def source_for(key: str) -> str:
    if key.startswith("employee:"):
        return f"{EMPLOYEES_CSV}#{key}"
    if key.startswith("role:"):
        return f"{ORG_KB}#{key}"
    return f"{FACTS_JSON}#{key}"
