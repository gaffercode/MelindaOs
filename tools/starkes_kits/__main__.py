"""Build one Evidence Kit per STARKES EP: blank form (D), photo checklist (O), interview practice (W).

    uv run --no-project python -X utf8 tools/starkes_kits

Kits are built from the official EP text and the regulations already mapped to it; nothing is filled in and no fact
is invented, so no AI call is needed. Output: dashboard/data/starkes/kits/<CHAPTER>.json.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "dashboard" / "data" / "starkes"
FORM_FIELDS = [
    {"label": "Tanggal pelaksanaan", "type": "date"},
    {"label": "Unit / ruangan", "type": "text"},
    {"label": "Uraian pelaksanaan", "type": "text"},
    {"label": "Sesuai regulasi rumah sakit", "type": "check"},
    {"label": "Nama dan tanda tangan penanggung jawab", "type": "signature"},
]


def short(text: str, limit: int = 140) -> str:
    text = re.sub(r"\s+", " ", text).strip().rstrip(".")
    return text if len(text) <= limit else text[: limit - 1].rsplit(" ", 1)[0] + "…"


def kit(ep: dict, presets: list[str], titles: dict[str, str]) -> dict:
    kinds = set(ep["evidenceKinds"])
    regulation = [titles.get(d, d) for d in ep["documentIds"]]  # Studio package ids have no KB title
    std = ep["standardCode"]
    return {
        "epId": ep["id"],
        "regulation": {"docIds": ep["documentIds"], "studioPresetCodes": [p for p in presets if f"({std})" in p]},
        "form": {"title": f"Bukti pelaksanaan {std} EP {ep['epCode']}: {short(ep['text'], 90)}", "fields": FORM_FIELDS} if "D" in kinds else None,
        "photoChecklist": [
            f"Foto memperlihatkan: {short(ep['text'])}",
            "Tanggal, jam, dan lokasi foto dicatat",
            "Tidak ada wajah, nama, atau nomor rekam medis pasien pada foto",
        ] if "O" in kinds else None,
        "practice": [{
            "role": "Staf pelaksana",
            "question": f"Bagaimana unit Anda menerapkan ketentuan ini: {short(ep['text'])}?",
            "keyAnswer": (f"Jelaskan langkah sesuai {'; '.join(regulation)}." if regulation
                          else "Jelaskan langkah yang berlaku di unit; regulasi rumah sakit untuk EP ini belum ada di KB."),
        }] if "W" in kinds else None,
    }


def main() -> int:
    register = json.loads((DATA / "requirements.json").read_text(encoding="utf-8"))["requirements"]
    chapters = json.loads((DATA / "chapter-map.json").read_text(encoding="utf-8"))
    index = ROOT / "dashboard" / "data" / "knowledge-index.json"
    titles = {d["docId"]: d["title"] for d in json.loads(index.read_text(encoding="utf-8"))["documents"]} if index.exists() else {}
    out = DATA / "kits"
    out.mkdir(exist_ok=True)
    for code, info in chapters.items():
        kits = [kit(ep, info["studioPresetCodes"], titles) for ep in register if ep["chapterCode"] == code]
        (out / f"{code}.json").write_text(json.dumps(kits, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
    print(sum(1 for ep in register), "kits in", len(chapters), "chapters")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
