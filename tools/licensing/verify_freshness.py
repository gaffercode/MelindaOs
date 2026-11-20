#!/usr/bin/env python3
from pathlib import Path
import json
from datetime import date, datetime

ROOT = Path(__file__).resolve().parents[2] / "knowledge/10_TOOL_CONTRACTS"
SRC = ROOT/"10_MACHINE"/"sources.jsonl"
today = date.today()
limits = {"P0":30, "P1":90, "P2":180}
stale = []
for line in SRC.read_text(encoding="utf-8").splitlines():
    if not line.strip():
        continue
    x = json.loads(line)
    vd = datetime.strptime(x["verified_date"], "%Y-%m-%d").date()
    age = (today-vd).days
    limit = limits.get(x.get("priority","P1"),90)
    if age > limit:
        stale.append((x["id"], age, limit))
if stale:
    print("SOURCES NEED RE-VERIFICATION:")
    for sid, age, limit in stale:
        print(f"- {sid}: {age} days old (limit {limit})")
else:
    print("No source exceeds configured freshness threshold.")
