"""Single source for repository and asset locations used by the Python tools.

The repository used to live at ``D:\\DEV\\melindaOs``; it is now the SAFRS
capsule ``projects/healthcare/melindaos`` inside the monorepo. Tools must
resolve paths through this module instead of hard-coding a machine directory.

Machine-specific paths are allowed *only* here, and only as a last-resort
fallback (the Windows font directory). The governance check
``tools/governance/check_no_machine_paths.py`` enforces that rule.
"""

from __future__ import annotations

from pathlib import Path

# tools/_paths.py -> tools/ (parents[0]) -> capsule root (parents[1]).
REPO_ROOT = Path(__file__).resolve().parents[1]

# Last-resort font location; bundled fonts under dashboard/assets/fonts are tried first.
WINDOWS_FONT_DIR = Path("C:/Windows/Fonts")

# Metric-compatible open-source Carlito font mapping when proprietary Calibri is absent in CI/Linux
_FONT_FALLBACKS: dict[str, str] = {
    "Calibri-Regular.ttf": "Carlito-Regular.ttf",
    "Calibri-Bold.ttf": "Carlito-Bold.ttf",
    "Calibri-Italic.ttf": "Carlito-Italic.ttf",
    "calibri.ttf": "Carlito-Regular.ttf",
    "calibrib.ttf": "Carlito-Bold.ttf",
    "calibrii.ttf": "Carlito-Italic.ttf",
}


def repo(*parts: str) -> Path:
    """Path under the repository root, e.g. ``repo("knowledge", "01_HOSPITAL")``."""
    return REPO_ROOT.joinpath(*parts)


def first_font(*names: str) -> Path:
    """First existing font among ``names``, searching bundled fonts, carlito, then Windows.

    Callers pass the bundled name first and the Windows name second, e.g.
    ``first_font("Calibri-Regular.ttf", "calibri.ttf")``.
    """
    directories = (
        repo("dashboard", "assets", "fonts"),
        repo("dashboard", "assets", "fonts", "carlito"),
        WINDOWS_FONT_DIR,
    )
    expanded_names: list[str] = list(names)
    for name in names:
        if name in _FONT_FALLBACKS and _FONT_FALLBACKS[name] not in expanded_names:
            expanded_names.append(_FONT_FALLBACKS[name])

    for directory in directories:
        for name in expanded_names:
            candidate = directory / name
            if candidate.is_file():
                return candidate
    searched = ", ".join(str(directory) for directory in directories)
    raise FileNotFoundError(f"none of {', '.join(expanded_names)} found under {searched}")
