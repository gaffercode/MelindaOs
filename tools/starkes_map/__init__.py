"""Map existing KB regulations to STARKES EPs that need R (regulation) evidence.

candidates() narrows the KB to a few documents by word overlap; choose() asks a chooser (the Claude Code session or a
transport) which of them are regulations for the EP. Ids outside the candidates are dropped, so the chooser can never
invent a document.
"""

from __future__ import annotations

import re
from collections.abc import Callable

STOP = {
    "dan", "atau", "yang", "di", "ke", "dari", "untuk", "dengan", "dalam", "pada", "oleh", "ada", "adalah", "serta",
    "secara", "sesuai", "telah", "akan", "bila", "jika", "ini", "itu", "rumah", "sakit", "rs", "bukti", "tersebut",
    "setiap", "semua", "tentang", "terhadap", "termasuk", "melalui", "sebagai", "antara", "lain", "para", "hal",
}


def words(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", text.lower()) if len(w) > 2 and w not in STOP}


def candidates(ep: dict, index: list[dict], k: int = 8) -> list[str]:
    """docIds of the k KB documents whose title and tags share the most words with the EP (category A only)."""
    target = words(f"{ep['text']} {ep['standardCode']}")
    scored = []
    for doc in index:
        if doc.get("category") != "A":
            continue
        overlap = len(target & words(f"{doc['title']} {doc.get('tags', '')}"))
        if overlap:
            scored.append((-overlap, doc["docId"]))
    return [doc_id for _, doc_id in sorted(scored)[:k]]


def choose(ep: dict, candidate_docs: list[dict], transport: Callable[[dict], list[str]]) -> list[str]:
    """0-3 candidate docIds the chooser names as regulations for this EP; anything else is dropped."""
    allowed = [d["docId"] for d in candidate_docs]
    picked = transport({"ep": {"id": ep["id"], "text": ep["text"]}, "candidates": [{"docId": d["docId"], "title": d["title"]} for d in candidate_docs]})
    return [doc_id for doc_id in dict.fromkeys(picked) if doc_id in allowed][:3]


def map_register(register: dict, index: list[dict], transport: Callable[[dict], list[str]]) -> list[dict]:
    """Fill documentIds of R EPs that have none. Returns provenance rows; reviewed (non-empty) mappings are kept."""
    by_id = {d["docId"]: d for d in index}
    provenance = []
    for ep in register["requirements"]:
        if "R" not in ep["evidenceKinds"] or ep["documentIds"]:
            continue
        pool = [by_id[i] for i in candidates(ep, index)]
        chosen = choose(ep, pool, transport) if pool else []
        ep["documentIds"] = chosen
        ep["disposition"] = "mapped" if chosen else "unmapped"
        provenance.append({"epId": ep["id"], "candidates": [d["docId"] for d in pool], "chosen": chosen})
    return provenance


def r_gaps(register: dict) -> dict[str, list[str]]:
    """R EPs still without a regulation, per chapter."""
    gaps: dict[str, list[str]] = {}
    for ep in register["requirements"]:
        if "R" in ep["evidenceKinds"] and not ep["documentIds"]:
            gaps.setdefault(ep["chapterCode"], []).append(ep["id"])
    return gaps
