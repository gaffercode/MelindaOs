"""Map KB regulations to R EPs without the paid API: the Claude Code session chooses.

    uv run --no-project python -X utf8 tools/starkes_map candidates OUT.json   # R EPs with their candidate documents
    uv run --no-project python -X utf8 tools/starkes_map apply CHOICES.json    # {"<epId>": ["<docId>", ...]} chosen in session

apply keeps reviewed mappings, drops any id outside an EP's candidates, then writes documentIds into the register,
provenance rows, and r-gaps.json (R EPs still without a regulation).
"""

from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from starkes_map import candidates, map_register, r_gaps

ROOT = Path(__file__).resolve().parents[2]
REGISTER = ROOT / "dashboard" / "data" / "starkes" / "requirements.json"
INDEX = ROOT / "dashboard" / "data" / "knowledge-index.json"
GAPS = ROOT / "dashboard" / "data" / "starkes" / "r-gaps.json"
PROVENANCE = ROOT / "knowledge/12_GOVERNANCE" / "knowledge" / "starkes-mapping-provenance.jsonl"
SESSION_MODEL = "claude-opus-5-5 (Claude Code session)"


def write_register(register: dict) -> None:
    head = json.dumps({k: v for k, v in register.items() if k != "requirements"}, ensure_ascii=False, indent=2)[:-2]
    body = ",\n".join("    " + json.dumps(ep, ensure_ascii=False, separators=(",", ":")) for ep in register["requirements"])
    REGISTER.write_text(f'{head},\n  "requirements": [\n{body}\n  ]\n}}\n', encoding="utf-8", newline="\n")


def main(argv: list[str]) -> int:
    register = json.loads(REGISTER.read_text(encoding="utf-8"))
    index = json.loads(INDEX.read_text(encoding="utf-8"))["documents"]
    titles = {d["docId"]: d["title"] for d in index}
    if argv[:1] == ["candidates"] and len(argv) == 2:
        rows = [
            {"epId": ep["id"], "text": ep["text"], "candidates": [{"docId": i, "title": titles[i]} for i in candidates(ep, index)]}
            for ep in register["requirements"] if "R" in ep["evidenceKinds"] and not ep["documentIds"]
        ]
        Path(argv[1]).write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"{len(rows)} R EPs without a regulation")
        return 0
    if argv[:1] == ["apply"] and len(argv) == 2:
        choices = json.loads(Path(argv[1]).read_text(encoding="utf-8"))
        rows = map_register(register, index, lambda request: choices.get(request["ep"]["id"], []))
        write_register(register)
        today = date.today().isoformat()
        with PROVENANCE.open("a", encoding="utf-8", newline="\n") as out:
            for row in rows:
                out.write(json.dumps({**row, "method": "session", "model": SESSION_MODEL, "date": today}, ensure_ascii=False) + "\n")
        gaps = r_gaps(register)
        GAPS.write_text(json.dumps(gaps, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
        print("mapped:", sum(1 for r in rows if r["chosen"]), "gaps per chapter:", {k: len(v) for k, v in gaps.items()})
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
