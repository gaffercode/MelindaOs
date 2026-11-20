"""Require deliberate opt-in before running legacy bulk-overwrite scripts."""
from __future__ import annotations

import argparse
from collections.abc import Sequence


def require_legacy_overwrite(script_name: str, argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog=script_name)
    parser.add_argument(
        "--allow-legacy-overwrite",
        action="store_true",
        help="explicitly permit this legacy script to rewrite knowledge documents",
    )
    args = parser.parse_args(argv)
    if not args.allow_legacy_overwrite:
        print(
            f"{script_name} is a legacy bulk writer and is blocked by default. "
            "Use tools/governance/transform_documents.py --refresh "
            "for the maintained workflow, or pass --allow-legacy-overwrite only for a deliberate recovery."
        )
        raise SystemExit("Refusing to rewrite repository documents without explicit opt-in.")
