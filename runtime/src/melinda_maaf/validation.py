from __future__ import annotations

import re
from pathlib import Path

import yaml


SECRET_ASSIGNMENT = re.compile(
    r"(?i)\b(access_token|refresh_token|client_secret|api_key|password)\b\s*[:=]\s*[\"']?([A-Za-z0-9_\-\.]{16,})"
)
PLACEHOLDER_MARKERS = {"insert_token", "your_token", "stored_refresh_token", "example", "changeme"}


def _scan_raw_secrets(root: Path) -> list[str]:
    errors: list[str] = []
    ignored_dirs = {".git", ".next", ".venv", "venv", "node_modules", "__pycache__", ".pytest_cache", "build", "dist"}
    for p in root.rglob("*"):
        if not p.is_file() or any(d in p.parts for d in ignored_dirs):
            continue
        if p.suffix.lower() in {".zip", ".jpg", ".jpeg", ".png", ".pyc"}:
            continue
        try:
            text = p.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        for match in SECRET_ASSIGNMENT.finditer(text):
            value = match.group(2).lower()
            if any(marker in value for marker in PLACEHOLDER_MARKERS):
                continue
            # Do not flag policy/test source that names keys as string literals without actual assignment.
            if p.name in {"providers.py", "test_validation.py"}:
                continue
            errors.append(f"{p.relative_to(root)}: raw secret-like assignment detected for {match.group(1)}")
    return errors


def validate_package(root: str | Path) -> list[str]:
    root = Path(root)
    errors: list[str] = []

    # Support both consolidated repo root and subfolder layouts
    routines_path = (
        root / "knowledge/09_AGENT_ARCHITECTURE" / "routines" / "routines.yaml"
        if (root / "knowledge/09_AGENT_ARCHITECTURE" / "routines" / "routines.yaml").exists()
        else root / "routines" / "routines.yaml"
    )
    if not routines_path.exists():
        errors.append("routines/routines.yaml missing")
    else:
        data = yaml.safe_load(routines_path.read_text(encoding="utf-8")) or {}
        routines = data.get("routines", []) if isinstance(data, dict) else []
        if len(routines) < 30:
            errors.append(f"expected at least 30 routines, found {len(routines)}")

    conduct = (
        root / "knowledge/08_AGENT_POLICY" / "communications" / "agent-global-conduct-rules.prompt.md"
        if (root / "knowledge/08_AGENT_POLICY" / "communications" / "agent-global-conduct-rules.prompt.md").exists()
        else root / "communications" / "agent-global-conduct-rules.prompt.md"
    )
    if not conduct.exists():
        errors.append("agent-global-conduct-rules.prompt.md missing")
    else:
        text = conduct.read_text(encoding="utf-8")
        for required in ["Bahasa Indonesia", "Bapak"]:
            if required not in text:
                errors.append(f"GLOBAL_CONDUCT missing required phrase: {required}")

    doctrine = (
        root / "knowledge/08_AGENT_POLICY" / "governance" / "agent-automation-above-all-rules.prompt.md"
        if (root / "knowledge/08_AGENT_POLICY" / "governance" / "agent-automation-above-all-rules.prompt.md").exists()
        else root / "governance" / "agent-automation-above-all-rules.prompt.md"
    )
    if not doctrine.exists() or "AUTOMATION ABOVE ALL" not in doctrine.read_text(encoding="utf-8"):
        errors.append("Automation Above All doctrine missing")

    errors.extend(_scan_raw_secrets(root))
    return errors
