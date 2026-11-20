"""Apply the Director's answers downloaded from the dashboard queue. Only answered placeholders change."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from readiness.ai_fill import Residual, check_value
from readiness.apply import (
    BACKUP_DIR,
    PROVENANCE,
    RESIDUALS,
    _newline,
    _read,
    _write,
    apply_fills,
    backup,
    draft_status_residuals,
    provenance_record,
)
from readiness.facts import load_facts
from readiness.queue import line_ids, pending_placeholders
from readiness.resolve_facts import Fill
from readiness.scan import DRAFT_MARKER, Placeholder

METHOD = "director"
# A value is written into one line of a document: no control character or line separator, no pipe (table cell),
# no backtick (inline code would hide the line's other placeholders from the scanner). The dashboard refuses these too.
UNSAFE = re.compile("[\x00-\x1f\x7f-\x9f\u2028\u2029`|]")
REQUIRED = ("id", "docPath", "lineText", "column", "placeholder", "decision", "text", "answeredBy", "answeredAt")


@dataclass
class AnswerReport:
    """`applied` holds the fills a run made, or would make in a dry run, each with the answer row it came from."""
    applied: list[tuple[Fill, dict]] = field(default_factory=list)
    corrections: list[dict] = field(default_factory=list)
    stale: list[dict] = field(default_factory=list)
    refused: list[tuple[dict, str]] = field(default_factory=list)
    files_changed: int = 0


def load_answers(path: Path) -> list[dict]:
    """The `rows` of a file downloaded from `/api/director/document-answers/unduh`."""
    rows = json.loads(path.read_text(encoding="utf-8"))["rows"]
    for index, row in enumerate(rows):
        missing = [key for key in REQUIRED if key not in row]
        if missing:
            raise ValueError(f"answer row {index} has no {', '.join(missing)}")
    return rows


def _document(root: Path, doc_path: str) -> Path | None:
    """The document inside the repository, or None when the path is missing or leaves the repository."""
    path = (root / doc_path).resolve()
    return path if path.is_file() and path.is_relative_to(root.resolve()) else None


def _source_ref(row: dict) -> str:
    return f"director-answer:{row['id']}"


def _applied_before(root: Path) -> set[tuple[str, str]]:
    """Source reference and answer time of every Director answer an earlier run wrote."""
    path = root / PROVENANCE
    if not path.is_file():
        return set()
    records = (json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip())
    return {(r["sourceRef"], r["answeredAt"]) for r in records if r.get("method") == METHOD and "answeredAt" in r}


def _decide(rows: list[dict], pending: list[Placeholder], lines: list[str], ids: dict[int, str], done: set[tuple[str, str]], root: Path, report: AnswerReport) -> list[tuple[Fill, dict]]:
    """Sort one document's rows into fills, corrections, stale rows and refusals."""
    fills: list[tuple[Fill, dict]] = []
    taken: set[tuple[int, int]] = set()
    for row in rows:
        # The id tells identical lines apart: the answer for the second one must not land on the first.
        p = next((c for c in pending if ids[c.line] == row["id"] and c.column == row["column"] and c.raw == row["placeholder"] and lines[c.line - 1] == row["lineText"]), None)
        if p is None:
            report.stale.append(row)
        elif row["decision"] == "correction":
            report.corrections.append(row)
        elif row["decision"] not in ("value", "confirm"):
            report.refused.append((row, "unknown_decision"))
        elif (_source_ref(row), row["answeredAt"]) in done:
            # Once a line is filled, an identical line below it inherits its id, and with it the stored answer.
            report.refused.append((row, "already_applied"))
        elif (p.line, p.column) in taken:
            report.refused.append((row, "duplicate"))
        elif row["decision"] == "value" and UNSAFE.search(str(row["text"]).strip()):
            report.refused.append((row, "unsafe_value"))
        else:
            value = row["text"] if row["decision"] == "value" else ""
            result = check_value(p, value, _source_ref(row), None, METHOD, None, [], root)
            if isinstance(result, Residual):
                report.refused.append((row, result.reason))
            else:
                taken.add((p.line, p.column))
                fills.append((result, row))
    return fills


def _is_open_row(row: dict, doc_path: str) -> bool:
    return row.get("docPath") == doc_path and row.get("reason") == "director" and row.get("placeholder") != DRAFT_MARKER


def _refreshed_residuals(rows: list[dict], doc_path: str, pending: list[Placeholder], applied: set[tuple[int, int]], new_lines: list[str]) -> list[dict]:
    """The residual rows after a document's fills: applied rows dropped, the others on their real lines, in place."""
    paired = iter(pending)
    out: list[dict] = []
    at: int | None = None
    for row in rows:
        if not _is_open_row(row, doc_path):
            out.append(row)
            continue
        if at is None:
            at = len(out)
        p = next(paired)
        if (p.line, p.column) not in applied:
            out.append({**row, "line": p.line})
    if at is not None and not any(_is_open_row(row, doc_path) for row in out):
        # The last gap is filled but the draft marker stays: the document now waits for the Director's enactment.
        out = [row for row in out if not (row.get("docPath") == doc_path and row.get("placeholder") == DRAFT_MARKER)]
        drafts = [{"docPath": doc_path, "line": r.placeholder.line, "placeholder": DRAFT_MARKER, "reason": r.reason, "detail": r.detail} for r in draft_status_residuals(doc_path, new_lines)]
        at = min(at, len(out))
        out[at:at] = drafts
    return out


def apply_answers(root: Path, rows: list[dict], apply: bool = False, backup_dir: Path = BACKUP_DIR) -> AnswerReport:
    report = AnswerReport()
    facts = load_facts(root)
    done = _applied_before(root)
    at = datetime.now(UTC).isoformat(timespec="seconds")
    by_doc: dict[str, list[dict]] = {}
    for row in rows:
        by_doc.setdefault(row["docPath"], []).append(row)
    for doc_path, doc_rows in by_doc.items():
        path = _document(root, doc_path)
        if path is None:
            report.stale.extend(doc_rows)
            continue
        text = _read(path)
        pending = pending_placeholders(doc_path, text, facts)
        lines = text.splitlines()
        fills = _decide(doc_rows, pending, lines, line_ids(doc_path, lines, pending), done, root, report)
        if not fills:
            continue
        residuals_path = root / RESIDUALS
        residuals = json.loads(residuals_path.read_text(encoding="utf-8")) if residuals_path.is_file() else []
        if [row["placeholder"] for row in residuals if _is_open_row(row, doc_path)] != [p.raw for p in pending]:
            report.refused.extend((row, "residuals_out_of_order") for _, row in fills)
            continue
        new_text = apply_fills(text, [fill for fill, _ in fills], ready=False)
        applied = {(fill.placeholder.line, fill.placeholder.column) for fill, _ in fills}
        if [p.raw for p in pending_placeholders(doc_path, new_text, facts)] != [p.raw for p in pending if (p.line, p.column) not in applied]:
            # A typed value (a role word, say) would let a registered fact fill a neighbouring placeholder on the next run.
            report.refused.extend((row, "side_effect") for _, row in fills)
            continue
        report.applied.extend(fills)
        if not apply:
            continue
        backup(path, root, backup_dir)
        _write(path, new_text)
        provenance = root / PROVENANCE
        provenance.parent.mkdir(parents=True, exist_ok=True)
        with provenance.open("a", encoding="utf-8", newline="\n") as handle:
            for fill, row in fills:
                record = {**provenance_record(fill, at), "answeredBy": row["answeredBy"], "answeredAt": row["answeredAt"]}
                handle.write(json.dumps(record, ensure_ascii=False) + "\n")
        refreshed = _refreshed_residuals(residuals, doc_path, pending, applied, new_text.split(_newline(new_text)))
        residuals_path.write_text(json.dumps(refreshed, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        report.files_changed += 1
    return report
