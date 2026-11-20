#!/usr/bin/env python3
"""Guard: every table a migration creates must be locked down in the same file.

For each `create table <schema>.<name>` the file must, in that same file, both
`alter table <name> enable row level security` and revoke access to it — either
a per-table `revoke all on ... <name> ... from public ...` or a schema-wide
`revoke all on all tables in schema <schema> from public, anon, authenticated, service_role`.
Access is only through `security definer` functions; a table that misses either
half would be reachable with the service key alone (the only credential the
server holds). CI runs this so a future migration cannot open that door.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DIR = REPO_ROOT / "dashboard" / "supabase" / "migrations"

CREATE_TABLE = re.compile(r"create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z0-9_.]+)", re.IGNORECASE)
ENABLE_RLS = re.compile(r"alter\s+table\s+([a-z0-9_.]+)\s+enable\s+row\s+level\s+security", re.IGNORECASE)
# Per-table revoke: the target list between `revoke all on` and its `from public` (statements may span lines).
REVOKE_TABLE = re.compile(r"revoke\s+all\s+on\b(.*?)\bfrom\s+public", re.IGNORECASE | re.DOTALL)
TOKEN = re.compile(r"[a-z0-9_]+")


def short(name: str) -> str:
    return name.rsplit(".", 1)[-1]


def schema_of(name: str) -> str | None:
    return name.split(".", 1)[0].lower() if "." in name else None


def is_revoked(text: str, name: str, schema: str | None) -> bool:
    for match in REVOKE_TABLE.finditer(text):
        target = match.group(1)
        if short(name) in {token.lower() for token in TOKEN.findall(target)}:
            return True
    if schema is not None:
        schema_wide = re.compile(r"revoke\s+all\s+on\s+all\s+tables\s+in\s+schema\s+" + re.escape(schema), re.IGNORECASE)
        if schema_wide.search(text):
            return True
    return False


def findings(file: Path) -> list[str]:
    text = file.read_text(encoding="utf-8")
    problems: list[str] = []
    enabled = {short(match.group(1)) for match in ENABLE_RLS.finditer(text)}
    for match in CREATE_TABLE.finditer(text):
        name = match.group(1)
        base = short(name)
        schema = schema_of(name)
        if base not in enabled:
            problems.append(f"{file.name}: {base} lacks 'enable row level security'")
        if not is_revoked(text, name, schema):
            problems.append(f"{file.name}: {base} lacks a revoke from public, anon, authenticated, service_role")
    return problems


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    directory = Path(args[0]) if args else DEFAULT_DIR
    problems: list[str] = []
    files = sorted(directory.glob("*.sql"))
    for file in files:
        problems.extend(findings(file))
    for problem in problems:
        print(problem)
    print(f"migration RLS: {len(files)} files, {len(problems)} problems")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
