"""Tests for the migration RLS guard (tools/governance/check_migration_rls.py)."""

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = REPO_ROOT / "tools" / "governance"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from check_migration_rls import findings, main

GOOD = """\
begin;
create table melinda_private.things (id int primary key);
alter table melinda_private.things enable row level security;
revoke all on melinda_private.things from public, anon, authenticated, service_role;
"""

MISSING_RLS = """\
begin;
create table melinda_private.things (id int primary key);
revoke all on melinda_private.things from public, anon, authenticated, service_role;
"""

MISSING_REVOKE = """\
begin;
create table melinda_private.things (id int primary key);
alter table melinda_private.things enable row level security;
"""

SCHEMA_WIDE = """\
begin;
create table melinda_private.things (id int primary key);
alter table melinda_private.things enable row level security;
revoke all on all tables in schema melinda_private from public, anon, authenticated, service_role;
"""


def test_good_migration_is_clean(tmp_path: Path):
    file = tmp_path / "x_good.sql"
    file.write_text(GOOD, encoding="utf-8")
    assert findings(file) == []


def test_missing_rls_is_reported(tmp_path: Path):
    file = tmp_path / "x_no_rls.sql"
    file.write_text(MISSING_RLS, encoding="utf-8")
    assert "lacks 'enable row level security'" in findings(file)[0]


def test_missing_revoke_is_reported(tmp_path: Path):
    file = tmp_path / "x_no_revoke.sql"
    file.write_text(MISSING_REVOKE, encoding="utf-8")
    assert "lacks a revoke" in findings(file)[0]


def test_schema_wide_revoke_covers_same_file(tmp_path: Path):
    file = tmp_path / "x_schema_wide.sql"
    file.write_text(SCHEMA_WIDE, encoding="utf-8")
    assert findings(file) == []


def test_real_migrations_are_clean():
    assert main([]) == 0
