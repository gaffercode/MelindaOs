"""Guards for the repository-root resolver in ``tools/_paths.py``.

Machine-specific paths must live only in ``tools/_paths.py`` (the Windows font
fallback). These tests pin that rule for the two patterns Task 1 removes:
the old ``D:\\DEV`` root and the raw ``C:\\Windows\\Fonts`` literals. The Linux
``/home`` and ``/mnt`` paths under ``tools/kredensial/`` are handled by the
later ``check_no_machine_paths.py`` governance check, not here.
"""

from pathlib import Path

from _paths import REPO_ROOT, first_font, repo

TOOLS = REPO_ROOT / "tools"


def test_repo_root_resolves():
    assert REPO_ROOT.is_dir()
    assert (REPO_ROOT / "dashboard").is_dir()
    assert (REPO_ROOT / "knowledge").is_dir()


def test_repo_helper_resolves_knowledge():
    # 00_INDEX exists in both the private repository and the public tree, where 01-07 are left out.
    assert repo("knowledge", "00_INDEX").is_dir()


def test_first_font_prefers_bundled():
    path = first_font("Calibri-Regular.ttf", "calibri.ttf")
    assert path.is_file()
    assert path.parent in (
        REPO_ROOT / "dashboard" / "assets" / "fonts",
        REPO_ROOT / "dashboard" / "assets" / "fonts" / "carlito",
    )


def test_no_machine_paths_remain_in_tools():
    offenders: list[str] = []
    for py in TOOLS.rglob("*.py"):
        if py.name == "_paths.py":
            continue
        text = py.read_text(encoding="utf-8", errors="replace")
        if "D:\\DEV" in text or "D:/DEV" in text:
            offenders.append(f"{py}: D:\\DEV")
        if "C:\\Windows\\Fonts" in text or "C:/Windows/Fonts" in text:
            offenders.append(f"{py}: C:\\Windows\\Fonts")
    assert offenders == [], f"machine-specific paths remain: {offenders}"
