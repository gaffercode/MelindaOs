#!/usr/bin/env python3
from pathlib import Path
import json
import sys

import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
LOCAL_ROOT = Path(__file__).resolve().parents[1]

# Support runtime src import
for candidate in [REPO_ROOT / "runtime" / "src", LOCAL_ROOT / "src"]:
    if candidate.exists() and str(candidate) not in sys.path:
        sys.path.insert(0, str(candidate))

from melinda_maaf.validation import validate_package


ROOT = REPO_ROOT if (REPO_ROOT / "knowledge/09_AGENT_ARCHITECTURE").exists() else LOCAL_ROOT
SKIP_PARTS = {".git", ".venv", ".cursor", "node_modules", ".next", "coverage"}


def main() -> int:
    parse_errors = []
    for path in ROOT.rglob("*.yaml"):
        if any(part in SKIP_PARTS for part in path.parts):
            continue
        try:
            yaml.safe_load(path.read_text(encoding="utf-8"))
        except Exception as exc:
            parse_errors.append(f"{path.relative_to(ROOT)}: YAML error: {exc}")

    for path in ROOT.rglob("*.json"):
        if any(part in SKIP_PARTS for part in path.parts):
            continue
        try:
            json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:
            parse_errors.append(f"{path.relative_to(ROOT)}: JSON error: {exc}")

    errors = parse_errors + validate_package(ROOT)
    if errors:
        print("PACKAGE VALIDATION FAILED")
        for err in errors:
            print(f"- {err}")
        return 1
    print("PACKAGE VALIDATION PASSED")
    print("- YAML/JSON valid")
    print("- >=30 routines present")
    print("- Automation Above All doctrine present")
    print("- No raw secret-like assignments detected")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
