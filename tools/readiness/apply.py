"""Stage 4: write fills into documents, log provenance, collect residuals."""
from __future__ import annotations

import io
import json
import re
import shutil
import tempfile
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone, UTC
from pathlib import Path

from readiness.ai_fill import SESSION_METHOD, SESSION_MODEL, Residual, ai_fill, check_value, model_name, related_docs
from readiness.facts import load_facts
from readiness.resolve_facts import Fill, resolve_by_fact
from readiness.scan import DRAFT_MARKER, REPO_ROOT, Placeholder, category_a_files, scan_text

PROVENANCE = "knowledge/12_GOVERNANCE/knowledge/readiness-provenance.jsonl"
RESIDUALS = "knowledge/12_GOVERNANCE/knowledge/readiness-residuals.json"
BACKUP_DIR = Path(tempfile.gettempdir()) / "melinda_src"
STATUS_LINE = re.compile(r"^\s*Status:\s*DRAF UNTUK KOREKSI.*$")
FENCE = re.compile(r"^\s*```")
DRAFT_STATUS_DETAIL = "Status draf tanpa celah isian: menunggu penetapan/pengesahan Direktur"


@dataclass
class RunReport:
    files_changed: int = 0
    fills: int = 0
    residuals: int = 0
    ai_pending: int = 0
    by_method: dict[str, int] = field(default_factory=dict)
    by_reason: dict[str, int] = field(default_factory=dict)
    residual_items: list[Residual] = field(default_factory=list)
    fill_items: list[Fill] = field(default_factory=list)
    pending_items: list[Placeholder] = field(default_factory=list)


ManualKey = tuple[str, int, int]


def manual_key(p: Placeholder) -> ManualKey:
    return (p.doc_path, p.line, p.column)


def load_manual(path: Path) -> dict[ManualKey, dict]:
    """Decisions made in the Claude Code session: `{"docPath","line","column","placeholder","value"|"residual","sourceRef","quote","note"}` rows."""
    rows = json.loads(path.read_text(encoding="utf-8"))
    return {(row["docPath"], int(row["line"]), int(row["column"])): row for row in rows}


def template_rows(root: Path, items: list[Placeholder]) -> list[dict]:
    """One row per undecided placeholder, to be completed by hand (value or residual)."""
    lines_of: dict[str, list[str]] = {}
    rows = []
    for p in items:
        if p.doc_path not in lines_of:
            text = _read(root / p.doc_path)
            lines_of[p.doc_path] = text.split(_newline(text))
        rows.append({
            "docPath": p.doc_path, "line": p.line, "column": p.column, "placeholder": p.raw, "kind": p.kind, "clinical": p.clinical,
            "heading": p.heading, "text": lines_of[p.doc_path][p.line - 1].strip(), "value": None, "sourceRef": None, "quote": None, "residual": None, "note": None,
        })
    return rows


def _newline(text: str) -> str:
    return "\r\n" if "\r\n" in text else "\n"


def apply_fills(text: str, fills: list[Fill], ready: bool = True) -> str:
    """Replace placeholders right-to-left per line (columns stay valid); drop the draft marker when `ready`."""
    nl = _newline(text)
    lines = text.split(nl)
    by_line: dict[int, list[Fill]] = {}
    for fill in fills:
        by_line.setdefault(fill.placeholder.line, []).append(fill)
    for number, items in by_line.items():
        line = lines[number - 1]
        for fill in sorted(items, key=lambda f: f.placeholder.column, reverse=True):
            p = fill.placeholder
            if line[p.column:p.column + len(p.raw)] != p.raw:
                raise ValueError(f"{p.doc_path}:{p.line}:{p.column} does not hold {p.raw!r} any more")
            start = p.column
            if fill.value == "" and start > 0 and line[start - 1] == " ":
                start -= 1  # a confirmed [CEK] vanishes together with its leading space
            line = line[:start] + fill.value + line[p.column + len(p.raw):]
        lines[number - 1] = line
    if ready:
        out: list[str] = []
        fenced = False
        for line in lines:
            if FENCE.match(line):
                fenced = not fenced
            if not fenced and STATUS_LINE.match(line):
                continue
            out.append(line if fenced else line.replace(DRAFT_MARKER, "BERLAKU"))
        lines = out
    return nl.join(lines)


def provenance_record(fill: Fill, at: str) -> dict:
    p = fill.placeholder
    return {
        "docPath": p.doc_path, "line": p.line, "placeholder": p.raw, "value": fill.value, "method": fill.method,
        "sourceRef": fill.source_ref, "quote": fill.quote, "model": fill.model, "at": at,
    }


def append_provenance(path: Path, fills: list[Fill], at: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8", newline="\n") as handle:
        for fill in fills:
            handle.write(json.dumps(provenance_record(fill, at), ensure_ascii=False) + "\n")


def write_residuals(path: Path, residuals: list[Residual], only_doc: str | None = None) -> None:
    """Replace the residuals file; with `only_doc`, replace that document's rows and keep every other document's."""
    path.parent.mkdir(parents=True, exist_ok=True)
    rows = [
        {"docPath": r.placeholder.doc_path, "line": r.placeholder.line, "placeholder": r.placeholder.raw, "reason": r.reason, "detail": r.detail}
        for r in residuals
    ]
    if only_doc is not None and path.is_file():
        existing = json.loads(path.read_text(encoding="utf-8"))
        at = next((i for i, row in enumerate(existing) if row.get("docPath") == only_doc), len(existing))
        rows = [row for row in existing[:at] if row.get("docPath") != only_doc] + rows + [row for row in existing[at:] if row.get("docPath") != only_doc]
    path.write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def backup(path: Path, root: Path, backup_dir: Path = BACKUP_DIR) -> Path:
    target = backup_dir / path.resolve().relative_to(root.resolve())
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(path, target)
    return target


def _read(path: Path) -> str:
    return open(path, encoding="utf-8", newline="").read()


def _write(path: Path, text: str) -> None:
    open(path, "w", encoding="utf-8", newline="").write(text)


def process_file(
    path: Path, root: Path, facts: dict[str, str], transport: Callable[[dict], dict] | None, model: str,
    manual: dict[ManualKey, dict] | None = None,
) -> tuple[list[Fill], list[Residual], list[Placeholder]]:
    """Resolve every placeholder of one file: facts, then session decisions, then AI (if a transport is given)."""
    doc_path = path.resolve().relative_to(root.resolve()).as_posix()
    text = _read(path)
    items: list[Placeholder] = scan_text(doc_path, text)
    lines = text.split(_newline(text))
    fills: list[Fill] = []
    residuals: list[Residual] = []
    pending: list[Placeholder] = []
    context: list[tuple[str, str]] | None = None
    for p in items:
        if p.in_code:
            residuals.append(Residual(p, "inside_code"))
            continue
        fill = resolve_by_fact(p, lines[p.line - 1], facts)
        if fill:
            fills.append(fill)
            continue
        decision = (manual or {}).get(manual_key(p))
        if decision is not None:
            if decision.get("placeholder") != p.raw:
                raise ValueError(f"{doc_path}:{p.line}:{p.column} holds {p.raw!r}, decision says {decision.get('placeholder')!r}")
            if decision.get("residual"):
                residuals.append(Residual(p, "director", decision.get("note")))
            elif decision.get("form"):
                # A blank form or checklist cell is the finished form, not a gap in the document.
                fills.append(Fill(p, "", SESSION_METHOD, decision.get("sourceRef") or doc_path, None, SESSION_MODEL))
            else:
                result = check_value(p, decision.get("value"), decision.get("sourceRef"), decision.get("quote"), SESSION_METHOD, SESSION_MODEL, [], root)
                (fills if isinstance(result, Fill) else residuals).append(result)  # type: ignore[arg-type]
            continue
        if transport is None:
            pending.append(p)
            continue
        if context is None:
            context = related_docs(root, doc_path)
        result = ai_fill(p, text, context, transport, model, root=root)
        (fills if isinstance(result, Fill) else residuals).append(result)  # type: ignore[arg-type]
    if not fills and not pending and not any(r.reason == "director" for r in residuals):
        # No gap to fill (or only code samples), but a draft marker is still a Director's item: the document waits for his enactment.
        residuals.extend(draft_status_residuals(doc_path, lines))
    return fills, residuals, pending


def draft_status_residuals(doc_path: str, lines: list[str]) -> list[Residual]:
    """One Director's item per unfenced line that still carries the draft marker."""
    found: list[Residual] = []
    fenced = False
    for n, line in enumerate(lines, start=1):
        if FENCE.match(line):
            fenced = not fenced
        if not fenced and DRAFT_MARKER in line:
            p = Placeholder(doc_path, n, line.index(DRAFT_MARKER), DRAFT_MARKER, "CEK", None, False, False, None)
            found.append(Residual(p, "director", DRAFT_STATUS_DETAIL))
    return found


def run(
    root: Path = REPO_ROOT,
    apply: bool = False,
    transport: Callable[[dict], dict] | None = None,
    model: str | None = None,
    only: Path | None = None,
    backup_dir: Path = BACKUP_DIR,
    progress: Callable[[str], None] | None = None,
    manual: dict[ManualKey, dict] | None = None,
) -> RunReport:
    model = model or model_name()
    facts = load_facts(root)
    report = RunReport()
    at = datetime.now(UTC).isoformat(timespec="seconds")
    all_residuals: list[Residual] = []
    files = [only] if only else category_a_files(root)
    for path in files:
        fills, residuals, pending_items = process_file(path, root, facts, transport, model, manual)
        pending = len(pending_items)
        if progress and (fills or residuals or pending):
            progress(f"{path.resolve().relative_to(root.resolve()).as_posix()}: fills={len(fills)} residuals={len(residuals)} pending={pending}")
        report.fill_items.extend(fills)
        report.pending_items.extend(pending_items)
        report.fills += len(fills)
        report.ai_pending += pending
        report.residuals += len(residuals)
        all_residuals.extend(residuals)
        for fill in fills:
            report.by_method[fill.method] = report.by_method.get(fill.method, 0) + 1
        for residual in residuals:
            report.by_reason[residual.reason] = report.by_reason.get(residual.reason, 0) + 1
        if not apply or not fills:
            continue
        if any(r.reason == "api_error" for r in residuals):
            continue  # all-or-nothing per file: an API failure leaves the file untouched
        ready = not residuals and pending == 0
        new_text = apply_fills(_read(path), fills, ready=ready)
        backup(path, root, backup_dir)
        _write(path, new_text)
        append_provenance(root / PROVENANCE, fills, at)
        report.files_changed += 1
    report.residual_items = all_residuals
    if apply:
        only_doc = only.resolve().relative_to(root.resolve()).as_posix() if only else None
        write_residuals(root / RESIDUALS, all_residuals, only_doc)
    return report
