#!/usr/bin/env python3
"""CI freshness check: dashboard/data/validation.json must match the real checker.

Compares only semantic fields (status, counts, passed, total), so the
scannedAt timestamp never causes churn. On mismatch, regenerate with:

    cd dashboard && npm run knowledge-index

then commit dashboard/data/validation.json.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT_FILE = REPO_ROOT / "dashboard" / "data" / "validation.json"
CHECKER = REPO_ROOT / "tools" / "governance" / "validate_frontmatter.py"


def parse_counts(output: str) -> dict | None:
    counts = []
    for category in ("A", "B", "C"):
        match = re.search(rf"Kategori {category}:\s*(\d+) lolos dari (\d+) file", output)
        if not match:
            return None
        counts.append({"category": category, "passed": int(match.group(1)), "total": int(match.group(2))})
    total = re.search(r"TOTAL:\s*(\d+) lolos dari (\d+) file", output)
    if not total:
        return None
    return {"counts": counts, "passed": int(total.group(1)), "total": int(total.group(2))}


def main() -> int:
    try:
        committed = json.loads(SNAPSHOT_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        print(f"validation snapshot unreadable: {SNAPSHOT_FILE}: {error}")
        return 1
    completed = subprocess.run(
        [sys.executable, "-X", "utf8", str(CHECKER)],
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
    )
    fresh = parse_counts(completed.stdout)
    if fresh is None:
        print("cannot parse checker output; checker output:")
        print(completed.stdout[-2000:])
        return 1
    problems = []
    if committed.get("status") != "available":
        problems.append(f"status={committed.get('status')!r}, expected 'available'")
    for key in ("counts", "passed", "total"):
        if committed.get(key) != fresh[key]:
            problems.append(f"{key}: snapshot={committed.get(key)!r} checker={fresh[key]!r}")
    if problems:
        print("dashboard/data/validation.json is stale:")
        for problem in problems:
            print(f"- {problem}")
        print("Regenerate: cd dashboard && npm run knowledge-index, lalu commit dashboard/data/validation.json.")
        return 1
    print(f"validation snapshot fresh: {fresh['passed']}/{fresh['total']} "
          f"(A {fresh['counts'][0]['passed']}/{fresh['counts'][0]['total']}, "
          f"B {fresh['counts'][1]['passed']}/{fresh['counts'][1]['total']}, "
          f"C {fresh['counts'][2]['passed']}/{fresh['counts'][2]['total']}).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
