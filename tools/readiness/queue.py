"""Director queue: the open placeholders of approved documents, one item per document line, for the dashboard."""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

from readiness.ai_fill import MAX_VALUE_LEN, META_VALUE
from readiness.apply import RESIDUALS
from readiness.facts import load_facts
from readiness.resolve_facts import resolve_by_fact
from readiness.scan import DRAFT_MARKER, Placeholder, scan_text

QUEUE = "knowledge/12_GOVERNANCE/knowledge/readiness-director-queue.json"
# The dashboard stores an answer per line; these are the limits its database function enforces.
MAX_LINE = 2000
MAX_PLACEHOLDER = 200
MAX_SLOTS = 12
SIGN_OFF_CELLS = ("disusun oleh", "diperiksa oleh", "disetujui oleh", "disahkan oleh", "ditetapkan oleh")
TITLE = re.compile(r'^title:\s*"?(.*?)"?\s*$')
TABLE_RULE = re.compile(r"[\s|:-]*-[\s|:-]*")


class QueueError(ValueError):
    """The documents and the recorded Director rows cannot be turned into a queue; the message names the document."""


def item_id(doc_path: str, text: str, nth: int) -> str:
    """Stable id of one document line: it changes when the line's text changes, never when the line only moves."""
    return hashlib.sha256(f"{doc_path}\n{text}\n{nth}".encode()).hexdigest()[:16]


def line_ids(doc_path: str, lines: list[str], pending: list[Placeholder]) -> dict[int, str]:
    """Item id of every line that holds a pending placeholder. Identical lines are told apart by their order."""
    seen: dict[str, int] = {}
    ids: dict[int, str] = {}
    for number in sorted({p.line for p in pending}):
        text = lines[number - 1]
        ids[number] = item_id(doc_path, text, seen.get(text, 0))
        seen[text] = seen.get(text, 0) + 1
    return ids


def _table_cells(line_text: str) -> tuple[str, int | None]:
    """First cell (lowercase) and the column where the last cell starts; `("", None)` when the line is not a table row."""
    stripped = line_text.strip()
    if not stripped.startswith("|"):
        return "", None
    body = line_text.rstrip().removesuffix("|")
    return stripped.strip("|").split("|")[0].strip().lower(), body.rfind("|") + 1


def slot_lock(p: Placeholder, line_text: str, detail: str | None) -> str | None:
    """Why the Director cannot answer this placeholder by typing, or None when he can."""
    if line_text.lstrip().startswith("#"):
        # A heading names the markers (a list of corrections, say) far more often than it holds a gap.
        return "heading"
    if p.clinical:
        return "clinical"
    first_cell, last_cell_start = _table_cells(line_text)
    detail = detail or ""
    if first_cell == "nomor dokumen" or detail.startswith("Nomor dokumen"):
        return "number"
    if first_cell.startswith("tanggal") or detail.startswith("Tanggal"):
        return "date"
    if first_cell in SIGN_OFF_CELLS and p.kind == "ISI" and last_cell_start is not None and p.column >= last_cell_start:
        return "signature"
    return None


def _cells(line_text: str) -> list[str]:
    return [cell.strip().strip("*").strip() for cell in line_text.strip().removeprefix("|").removesuffix("|").split("|")]


def column_headers(lines: list[str], number: int) -> list[str]:
    """Header cells of the table that holds line `number`; empty when the line is not a row below a header row."""
    top = number - 1
    if not lines[top].lstrip().startswith("|"):
        return []
    while top > 0 and lines[top - 1].lstrip().startswith("|"):
        top -= 1
    if top + 1 >= number - 1 or not TABLE_RULE.fullmatch(lines[top + 1]):
        return []
    return _cells(lines[top])


def slot_header(p: Placeholder, line_text: str, headers: list[str]) -> str | None:
    """The header of the table column the placeholder sits in, so two gaps on one row can be told apart."""
    cell = line_text[:p.column].count("|") - 1
    return (headers[cell] or None) if 0 <= cell < len(headers) else None


def pending_placeholders(doc_path: str, text: str, facts: dict[str, str]) -> list[Placeholder]:
    """Placeholders outside code that no registered fact fills, in document order."""
    lines = text.splitlines()
    return [p for p in scan_text(doc_path, text) if not p.in_code and resolve_by_fact(p, lines[p.line - 1], facts) is None]


def _title(lines: list[str], path: Path) -> str:
    if lines and lines[0].strip() == "---":
        for line in lines[1:]:
            if line.strip() == "---":
                break
            match = TITLE.match(line)
            if match and match.group(1):
                return match.group(1)
    return path.name


def _director_rows(root: Path) -> dict[str, list[dict]]:
    path = root / RESIDUALS
    recorded: dict[str, list[dict]] = {}
    if path.is_file():
        for row in json.loads(path.read_text(encoding="utf-8")):
            if row.get("reason") == "director":
                recorded.setdefault(row["docPath"], []).append(row)
    return recorded


def build_queue(root: Path) -> dict:
    facts = load_facts(root)
    items: list[dict] = []
    drafts: list[str] = []
    for doc_path, recorded in sorted(_director_rows(root).items()):
        path = root / doc_path
        if not path.is_file():
            raise QueueError(f"{doc_path}: document not found")
        rows = [row for row in recorded if row["placeholder"] != DRAFT_MARKER]
        if not rows:
            drafts.append(doc_path)
            continue
        with open(path, encoding="utf-8", newline="") as handle:
            text = handle.read()
        lines = text.splitlines()
        pending = pending_placeholders(doc_path, text, facts)
        if [p.raw for p in pending] != [row["placeholder"] for row in rows]:
            raise QueueError(f"{doc_path}: the recorded Director rows do not match the document's open placeholders, in order")
        by_line: dict[int, list[tuple[Placeholder, dict]]] = {}
        for p, row in zip(pending, rows):
            by_line.setdefault(p.line, []).append((p, row))
        title = _title(lines, path)
        ids = line_ids(doc_path, lines, pending)
        for number, slots in sorted(by_line.items()):
            line_text = lines[number - 1]
            headers = column_headers(lines, number)
            if len(line_text) > MAX_LINE or len(slots) > MAX_SLOTS or any(len(p.raw) > MAX_PLACEHOLDER for p, _ in slots):
                raise QueueError(f"{doc_path}: line {number} is over the queue limits ({MAX_LINE} characters, {MAX_SLOTS} placeholders, {MAX_PLACEHOLDER} per placeholder)")
            items.append({
                "id": ids[number],
                "docPath": doc_path,
                "docTitle": title,
                "heading": slots[0][0].heading,
                "text": line_text,
                "slots": [
                    {"column": p.column, "placeholder": p.raw, "kind": p.kind, "detail": row.get("detail"), "lock": slot_lock(p, line_text, row.get("detail")), "header": slot_header(p, line_text, headers)}
                    for p, row in slots
                ],
            })
    return {"valueRules": {"maxLength": MAX_VALUE_LEN, "refusePattern": META_VALUE.pattern}, "items": items, "drafts": drafts}


def render(queue: dict) -> str:
    return json.dumps(queue, ensure_ascii=False, indent=2) + "\n"


def write_queue(root: Path, queue: dict | None = None) -> Path:
    path = root / QUEUE
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(render(build_queue(root) if queue is None else queue))
    return path
