"""Extract the complete EP register from the official STARKES instrument (Kepdirjen Yankes HK.02.02/D/47104/2024).

Run: uv run --no-project --with pymupdf python -X utf8 dashboard/scripts/extract_starkes_instrument.py <pdf>

The PDF must match the SHA-256 recorded in dashboard/data/starkes/baseline.json. Every EP table is tied to the
nearest "Elemen Penilaian <CODE> <n>" heading above it. Rows the parser cannot read cleanly are written to
dashboard/data/starkes/extraction-anomalies.json instead of being guessed. Existing records whose id is already in
requirements.json (the reviewed pilot) are kept unchanged.
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

import pymupdf

DATA = Path(__file__).resolve().parents[1] / "data" / "starkes"
CODES = ["TKRS", "KPS", "MFK", "PMKP", "MRMIK", "PPI", "PPK", "AKP", "HPK", "PP", "PAP", "PAB", "PKPO", "KE", "SKP", "PROGNAS"]
CODE_ALT = "|".join(sorted(CODES + ["Prognas"], key=len, reverse=True))
# The PDF itself spells this heading several ways: "Elemen penilaian", "Eleman Penilaian", "Elemen Penelitian KPS 13",
# "Elemen penialaian PAP 2.4", "Elemen Penilaian Standar Prognas 1.1", "Elemen Penilaian dari PP 3.9", "Elemen Penilaian 6"
# (chapter code left out: the chapter in progress applies).
HEADING = re.compile(
    rf"^\s*(?:\d+\)|[a-z][.)])?\s*(?i:elem[ae]n\s+pen\w+)\s*(?i:standar\s+|dari\s+)?\.?\s*({CODE_ALT})?\s*\.?\s*(\d+(?:\.\d+)*)\s*\.?\s*$"
)
STANDARD = re.compile(rf"^\s*(?:\d+\)|[a-z][.)])?\s*Standar\s+({CODE_ALT})\s*\.?\s*(\d+(?:\.\d+)*)\s*$")

# Misprints in the instrument, each resolved by reading the PDF page (workspace rule: never guess; resolve against the source).
HEADING_FIXES = {
    # p349 prints "Standar PKPO 3, 3.1, 3.2, 3.3" and "5) Maksud dan Tujuan PKPO 3, PKPO 3.1, PKPO 3.2, PKPO 3.3";
    # the next heading "6) Elemen Penilaian PKPO 2" on p352 introduces the EPs of PKPO 3 (storage), not PKPO 2.
    (352, "PKPO", "2"): ("PKPO", "3"),
}
# EPs whose Skoring cell is empty in the official PDF (checked on the rendered page); the scale is inferred, not printed.
SCORE_INFERRED = {
    "47104-2024:TKRS:4:2": {
        "allowedScores": [0, 5, 10],
        "basis": "p18-19: Skoring cell empty. TKRS 4 a) has the same evidence (R, D, W) and scores 0/5/10, as do 8 of the "
        "10 EPs with R, D, W evidence. Director delegated the choice (2026-11-07).",
    },
}
# Stray EP labels printed beside another EP's text: (page, label, rounded y). Checked on the rendered page:
# p210 "d)" sits on the last line of PPI 12 c) ("Mutu setiap tiga bulan."); PPI 12 has three EPs.
STRAY_LABELS = {(210, "d)", 731)}
LABEL_MISPRINTS = {
    "PP 1.1": "p278: the sixth EP of the PP 1.1 table is printed 'a)' after 'e)'; it stays the sixth EP.",
    "PP 1.2": "p278-279: after the first EP the PP 1.2 table restarts its labels at 'a)'; the rows stay in printed order.",
}
# "a)" / "1)"; a few rows lost the bracket in the text layer ("a Rumah sakit ...").
NUMBERING = re.compile(r"^\s*(?:(\d+|[a-z])\)|([a-z])\.?\s+(?=[A-Z]))\s*")
KIND = re.compile(r"\b([RDOWS])\b")
KINDS_CELL = re.compile(r"^(?:[RDOWS]\s*)+$")
SCORE_CELL = re.compile(r"^(?:(?:10|5|0|-|–|TDD)\s*)+$")
TEXT_ZONE = 0.3  # the EP text column starts in the left 30% of the table


def clean(text: str | None) -> str:
    return re.sub(r"\s+", " ", (text or "").replace("­", "")).strip()


def headings(page: pymupdf.Page, number: int, pattern: re.Pattern[str] = HEADING) -> list[tuple[int, float, str, str]]:
    found = []
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            text = "".join(span["text"] for span in line["spans"])
            match = pattern.match(text)
            if match:
                code = (match.group(1) or "").upper()
                found.append((number, line["bbox"][1], code, match.group(2)))
    return found


def header_rows(page: pymupdf.Page) -> list[float]:
    """y of every EP column-header row ("Elemen Penilaian | Kelengkapan Bukti | Skoring")."""
    lines: dict[int, list[str]] = {}
    for w in page.get_text("words"):
        lines.setdefault(round(w[1] / 3), []).append(w[4])
    return [key * 3.0 for key, words in lines.items() if "Kelengkapan" in words and "Skoring" in words]


def _mode(values: list[float], prefer: float | None = None) -> float | None:
    if not values:
        return None
    counts: dict[int, int] = {}
    for v in values:
        counts[round(v / 4)] = counts.get(round(v / 4), 0) + 1
    # ties go to the column nearest the previous region's ("a) - f)" in EP text, a section letter "f." left of the labels)
    return max(counts, key=lambda k: (counts[k], -abs(k * 4.0 - prefer) if prefer is not None else 0)) * 4.0


LABEL_WORD = re.compile(r"(\d+|[a-z])\)|[a-z]\.|[a-z]")  # "a)", "1)", "a." (PAB 3.2), "a" (bracket lost)
LABEL_MARK = re.compile(r"(\d+|[a-z])\)|[a-z]\.")
SCORE_WORD = re.compile(r"10|5|0|-|–|TDD")
KIND_LEAD = 12  # a kind letter sits vertically centred in its evidence cell, up to this far above the EP label
SCORE_REACH = 24  # a score stack "10/5/0" may start this far above its EP label (centred in a tall cell)
ALIGN = 6  # same printed line
Geometry = dict  # {"label_x", "kind_x", "score_x"}


@dataclass
class Region:
    """EP rows of one table region. rows[0] has an empty label when the region starts with the previous EP's tail."""
    rows: list[dict]  # {"text": str, "kinds": set[str], "scores": list[str], "labelled": bool}
    tail: dict | None  # an incomplete score stack (no "0" yet) at the region bottom, with the kind letters on its lines
    lead_aligned: bool  # the region opens with score tokens printed on the first EP label's line (a stack split over pages)


def word_rows(page: pymupdf.Page, top: float, bottom: float, previous: Geometry) -> tuple[Region | None, Geometry]:
    """EP rows of one table region read from word positions: label column, EP text, kind letters (R/D/O/W/S), scores.

    Table cells are unreliable in this PDF (kind letters merged into the evidence text, score cells carrying notes,
    rows shifted between cells), so the table finder only bounds the region. Column positions carry over from the
    previous region when a region lacks them. A score stack starts at "10" and belongs to the nearest EP label; kind
    letters printed on a stack's first line go with that stack, other kind letters with the EP whose label they precede
    by at most KIND_LEAD.
    """
    words = sorted(
        (w for w in page.get_text("words") if top <= w[1] < bottom and (page.number + 1, w[4], round(w[1])) not in STRAY_LABELS),
        key=lambda w: (round(w[1]), w[0]),
    )
    width = page.rect.width
    geometry = {
        "label_x": _mode([w[0] for w in words if LABEL_MARK.fullmatch(w[4]) and w[0] < 0.35 * width], previous.get("label_x")),
        "kind_x": _mode([w[0] for w in words if re.fullmatch(r"[RDOWS]", w[4]) and 0.35 * width < w[0] < 0.7 * width], previous.get("kind_x")),
        "score_x": _mode([w[0] for w in words if w[4] == "10" and w[0] > 0.72 * width], previous.get("score_x")),
    }
    for key, value in previous.items():
        if geometry[key] is None:
            geometry[key] = value
    label_x, kind_x, score_x = geometry["label_x"], geometry["kind_x"], geometry["score_x"]
    if kind_x is None or score_x is None:
        return None, geometry

    def is_label(i: int) -> bool:
        w = words[i]
        if label_x is None or abs(w[0] - label_x) > 6 or not LABEL_WORD.fullmatch(w[4]):
            return False
        return bool(LABEL_MARK.fullmatch(w[4]))

    labels = [w[1] for i, w in enumerate(words) if is_label(i)]
    has_tail_row = not labels or labels[0] > top + 2
    rows = ([{"text": "", "kinds": set(), "scores": [], "labelled": False}] if has_tail_row else []) + [
        {"text": "", "kinds": set(), "scores": [], "labelled": True} for _ in labels
    ]
    offset = 1 if has_tail_row else 0

    def text_row(y: float) -> int:
        index = sum(1 for label in labels if label - 2 <= y)
        return index - 1 + offset if index else 0

    texts: dict[int, list[str]] = {}
    for w in words:
        if w[0] < kind_x - 3 and (label_x is None or w[0] >= label_x - 6):
            texts.setdefault(text_row(w[1]), []).append(w[4])
    for index, parts in texts.items():
        rows[index]["text"] = re.sub(r"\s+([,.;:])", r"\1", clean(" ".join(parts)))

    # Score stacks.
    stacks: list[dict] = []
    for w in (w for w in words if w[0] >= score_x - 15 and SCORE_WORD.fullmatch(w[4])):
        if w[4] == "10" or not stacks:
            stacks.append({"anchor": w[1] if w[4] == "10" else None, "tokens": [], "kinds": set()})
        stacks[-1]["tokens"].append((w[1], w[4]))

    def stack_row(stack: dict) -> int:
        anchor = stack["anchor"]
        if anchor is None or not labels or anchor < labels[0] - SCORE_REACH:
            return 0 if has_tail_row else -1
        nearest = min(range(len(labels)), key=lambda i: abs(labels[i] - anchor))
        return nearest + offset

    lead_aligned = bool(stacks and stacks[0]["anchor"] is None and labels and abs(stacks[0]["tokens"][0][0] - labels[0]) <= ALIGN)
    for w in (w for w in words if abs(w[0] - kind_x) <= 8 and re.fullmatch(r"[RDOWS]", w[4])):
        stack = next((s for s in stacks if s["anchor"] is not None and abs(s["anchor"] - w[1]) <= 4), None)
        if stack is not None:
            stack["kinds"].add(w[4])
            continue
        index = sum(1 for label in labels if label - KIND_LEAD <= w[1])
        rows[index - 1 + offset if index else 0]["kinds"].add(w[4])
    tail = None
    for n, stack in enumerate(stacks):
        tokens = [t for _, t in stack["tokens"]]
        last = n == len(stacks) - 1
        if last and stack["anchor"] is not None and "0" not in tokens and stack["anchor"] > (labels[-1] if labels else top) + ALIGN:
            tail = {"kinds": stack["kinds"], "scores": tokens}  # may belong to the EP that opens the next page
            continue
        if n == 0 and lead_aligned:
            target = offset  # the first EP label of this region
        else:
            target = stack_row(stack)
        target = max(target, 0)
        rows[target]["scores"].extend(tokens)
        rows[target]["kinds"] |= stack["kinds"]
    return Region(rows, tail, lead_aligned), geometry


def is_header(row: list[str]) -> bool:
    """The EP column-header row, also when printed "ElemenPenilaian" or "Elemen Penilaian PKPO 4 1"."""
    squeezed = [re.sub(r"\s+", "", cell).lower() for cell in row]
    return any(c.startswith("elemenpenilaian") for c in squeezed) and any("kelengkapan" in c for c in squeezed)


def classify(table) -> list[tuple[str, list[str], str]]:
    """Per row: (EP text cell, evidence-kind letters, score tokens), whatever the column layout of the table."""
    x0, x1 = table.bbox[0], table.bbox[2]
    limit = x0 + TEXT_ZONE * (x1 - x0)
    out = []
    for row, texts in zip(table.rows, table.extract()):
        ep_text, kinds, scores = "", [], []
        for cell, raw in zip(row.cells, texts):
            text = clean(raw)
            if cell is None or not text:
                continue
            if KINDS_CELL.match(text):
                kinds.extend(KIND.findall(text))
            elif SCORE_CELL.match(text):
                scores.append(text)
            elif cell[0] < limit and not ep_text:
                ep_text = text
        out.append((ep_text, kinds, " ".join(scores)))
    return out


def scores_of(cell: str) -> tuple[list[int], bool]:
    tokens = re.findall(r"10|5|0|TDD", cell)
    numbers = sorted({int(t) for t in tokens if t != "TDD"})
    return numbers, "TDD" in tokens


def extract(pdf_path: Path) -> tuple[list[dict], list[dict]]:
    doc = pymupdf.open(pdf_path)
    events: list[tuple[int, float, str, object]] = []
    standards: dict[str, int] = {}
    for index in range(doc.page_count):
        page = doc[index]
        number = index + 1
        marks = [(h, "heading") for h in headings(page, number)] + [(s, "standard") for s in headings(page, number, STANDARD)]
        for h, kind in marks:
            events.append((h[0], h[1], kind, (h[2], h[3])))
            if kind == "standard":
                standards.setdefault(f"{h[2]} {h[3]}", h[0])
        tables = page.find_tables().tables
        regions: list[tuple[float, float, bool]] = []
        for table in tables:
            has_header = is_header([clean(c) for c in table.extract()[0]])
            top = table.rows[0].bbox[3] if has_header else table.bbox[1]
            regions.append((top, table.bbox[3], has_header))
        for y in header_rows(page):
            if any(t.bbox[1] - 4 <= y <= t.bbox[3] for t in tables):
                continue
            # A header row the table finder missed: the region runs to the next heading (or the page end).
            later = sorted(e[1] for e in events if e[0] == number and e[2] in ("heading", "standard") and e[1] > y)
            regions.append((y + 12, later[0] if later else page.rect.height, True))
        for top, bottom, has_header in regions:
            events.append((number, top, "region", (page, top, bottom, has_header)))
    events.sort(key=lambda e: (e[0], e[1], 0 if e[2] != "region" else 1))

    eps: list[dict] = []
    anomalies: list[dict] = []
    current: tuple[str, str] | None = None
    code_in_progress = ""
    last_ep: dict | None = None
    pending_tail: tuple[dict, dict] | None = None  # (EP it defaults to, tail) from the previous region
    geometry: Geometry = {}

    def add(ep: dict, kinds: set[str], scores: list[str]) -> None:
        numbers, tdd = scores_of(" ".join(scores))
        ep["evidenceKinds"] = sorted(set(ep["evidenceKinds"]) | kinds, key="RDOWS".index)
        ep["allowedScores"] = sorted(set(ep["allowedScores"]) | set(numbers))
        ep["allowsTdd"] = ep["allowsTdd"] or tdd

    def settle_tail(owner: dict | None) -> None:
        nonlocal pending_tail
        if pending_tail is not None:
            default, tail = pending_tail
            add(owner or default, tail["kinds"], tail["scores"])
            pending_tail = None

    for page_number, _, kind, payload in events:
        if kind in ("heading", "standard"):
            settle_tail(None)
            code, number = payload  # type: ignore[misc]
            code = code or code_in_progress
            if kind == "heading":
                code, number = HEADING_FIXES.get((page_number, code, number), (code, number))
            code_in_progress = code
            # An EP heading names the section of the tables below it; a bare "Standar X" heading does too when the
            # PDF prints no EP heading for that standard (e.g. HPK 1.2, HPK 1.3).
            current = (code, f"{code} {number}")
            last_ep = None
            continue
        page, top, bottom, has_header = payload  # type: ignore[misc]
        if current is None:
            continue
        if not has_header and last_ep is None:
            continue  # a table that is not an EP table (and not a continuation of one)
        region, geometry = word_rows(page, top, bottom, geometry)
        if region is None:
            continue
        first_new: dict | None = None
        for row in region.rows:
            ep_text = row["text"]
            match = NUMBERING.match(ep_text) if row["labelled"] else None
            if not match:
                if last_ep is None:
                    if ep_text or row["kinds"] or row["scores"]:
                        anomalies.append({"page": page_number, "standard": current[1], "reason": "row without a numbered EP before it", "row": [ep_text, sorted(row["kinds"]), row["scores"]]})
                    continue
                # Same EP: an extra evidence row, or its text continued after a page break.
                if ep_text:
                    last_ep["text"] = clean(f"{last_ep['text']} {ep_text}")
                add(last_ep, row["kinds"], row["scores"])
                continue
            code, standard = current
            same = [ep for ep in eps if ep["standardCode"] == standard]
            ep_code = str(len(same) + 1)
            last_ep = {
                "id": f"47104-2024:{code}:{standard.split(' ', 1)[1]}:{ep_code}",
                "chapterCode": code,
                "standardCode": standard,
                "epCode": ep_code,
                "label": match.group(1) or match.group(2),
                "text": clean(ep_text[match.end():]),
                "evidenceKinds": [],
                "allowedScores": [],
                "allowsTdd": False,
                "sourceId": "INSTRUMEN-47104-2024",
                "page": page_number,
                "disposition": "unmapped",
                "documentIds": [],
            }
            add(last_ep, row["kinds"], row["scores"])
            eps.append(last_ep)
            first_new = first_new or last_ep
        # A score stack cut by the page break belongs to the EP whose label carries its "0" on the next page.
        settle_tail(first_new if region.lead_aligned else None)
        if region.tail is not None and last_ep is not None:
            pending_tail = (last_ep, region.tail)
    settle_tail(None)
    for ep in eps:
        problems = []
        if not ep["evidenceKinds"]:
            problems.append("no evidence kind")
        if not ep["allowedScores"] and ep["id"] in SCORE_INFERRED:
            ep["allowedScores"] = SCORE_INFERRED[ep["id"]]["allowedScores"]
        if not ep["allowedScores"]:
            problems.append("no score")
        if ep["allowedScores"] and ep["allowedScores"][-1] != 10:
            problems.append(f"scores {ep['allowedScores']}")
        if problems:
            anomalies.append({"page": ep["page"], "standard": ep["standardCode"], "ep": ep["id"], "reason": "; ".join(problems), "text": ep["text"][:120]})
    # Labels inside a standard must run 1), 2), ... or a), b), ... without gaps.
    by_standard: dict[str, list[dict]] = {}
    for ep in eps:
        by_standard.setdefault(ep["standardCode"], []).append(ep)
    # Every "Standar X" heading needs EPs of its own.
    for standard, page in standards.items():
        if standard not in by_standard:
            anomalies.append({"page": page, "standard": standard, "reason": "standard heading without EPs"})
    for standard, items in by_standard.items():
        labels = [ep["label"] for ep in items]
        expected = [str(i) for i in range(1, len(items) + 1)] if labels[0].isdigit() else [chr(ord("a") + i) for i in range(len(items))]
        if labels != expected and standard not in LABEL_MISPRINTS:
            anomalies.append({"page": items[0]["page"], "standard": standard, "reason": f"labels {labels} expected {expected}"})
    return eps, anomalies


def main(argv: list[str]) -> int:
    pdf = Path(argv[1])
    baseline_path = DATA / "baseline.json"
    baseline = json.loads(baseline_path.read_text(encoding="utf-8"))
    digest = hashlib.sha256(pdf.read_bytes()).hexdigest()
    if digest != baseline["sources"][0]["sha256"]:
        print(f"SHA-256 mismatch: {digest}")
        return 2
    eps, anomalies = extract(pdf)
    register_path = DATA / "requirements.json"
    register = json.loads(register_path.read_text(encoding="utf-8"))
    reviewed = {ep["id"]: ep for ep in register["requirements"] if ep["disposition"] == "mapped"}  # reviewed mappings only
    records = []
    for ep in eps:
        ep.pop("label")
        records.append(reviewed.get(ep["id"], ep))
    counts = {code: sum(1 for ep in records if ep["chapterCode"] == code) for code in CODES}
    (DATA / "extraction-anomalies.json").write_text(json.dumps(anomalies, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print("per chapter:", counts, "total:", len(records), "anomalies:", len(anomalies))
    if anomalies or "--write" not in argv:
        print("register not written" + (" (anomalies present)" if anomalies else " (pass --write)"))
        return 1 if anomalies else 0
    register["complete"] = True
    register["requirements"] = records
    body = ",\n".join("    " + json.dumps(ep, ensure_ascii=False, separators=(",", ":")) for ep in records)
    head = json.dumps({k: v for k, v in register.items() if k != "requirements"}, ensure_ascii=False, indent=2)[:-2]
    register_path.write_text(f"{head},\n  \"requirements\": [\n{body}\n  ]\n}}\n", encoding="utf-8", newline="\n")
    baseline["status"] = "verified"
    baseline["epTotal"] = len(records)
    baseline["epCountByChapter"] = counts
    baseline.pop("scoreNotPrinted", None)
    baseline["scoreInferred"] = [{"id": k, **v} for k, v in sorted(SCORE_INFERRED.items())]
    baseline_path.write_text(json.dumps(baseline, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print("register written")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
