from pathlib import Path
import sys

import pytest

from melinda_maaf.validation import validate_package


REPO_ROOT = Path(__file__).resolve().parents[1]
LOCAL_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = REPO_ROOT / "tools" / "governance"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from legacy_write_guard import require_legacy_overwrite


def test_package_has_required_agent_count_and_automation_doctrine():
    target = REPO_ROOT if (REPO_ROOT / 'knowledge/09_AGENT_ARCHITECTURE').exists() else LOCAL_ROOT
    errors = validate_package(target)
    assert errors == []


def test_validator_rejects_raw_secret_assignment(tmp_path):
    (tmp_path / 'routines').mkdir()
    (tmp_path / 'communications').mkdir()
    (tmp_path / 'communications' / 'agent-global-conduct-rules.prompt.md').write_text('Bahasa Indonesia Bapak Automation Above All', encoding='utf-8')
    (tmp_path / 'routines' / 'routines.yaml').write_text('routines: []', encoding='utf-8')
    (tmp_path / 'bad.txt').write_text('access_token=abc123-real-secret', encoding='utf-8')
    errors = validate_package(tmp_path)
    assert any('raw secret-like assignment' in e for e in errors)


def test_secret_scan_still_checks_cursor_config(tmp_path):
    cursor_dir = tmp_path / ".cursor"
    cursor_dir.mkdir()
    (cursor_dir / "settings.txt").write_text("access_token=abc123-real-secret", encoding="utf-8")

    errors = validate_package(tmp_path)

    assert any("settings.txt: raw secret-like assignment" in error for error in errors)


def test_legacy_writer_requires_explicit_overwrite_consent(capsys):
    with pytest.raises(SystemExit, match="Refusing to rewrite"):
        require_legacy_overwrite("legacy-tool", [])

    assert "transform_documents.py --refresh" in capsys.readouterr().out


def test_legacy_writer_runs_only_with_explicit_overwrite_flag():
    require_legacy_overwrite("legacy-tool", ["--allow-legacy-overwrite"])
