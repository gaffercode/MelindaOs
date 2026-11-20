"""CLI: `PYTHONPATH=tools python -X utf8 -m readiness [--apply] [--path <file>] [--fills <json>] [--template <json>] [--ai]`.

Dry run (default) prints the report. Values come from the fact registry and from `--fills`, a JSON file of
decisions made in the Claude Code session (`--template` writes the undecided placeholders in that shape).
The Claude API is only used with `--ai` and ANTHROPIC_API_KEY (paid; needs the Director's approval).
`--apply` refuses to write while any placeholder is still undecided.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from readiness.ai_fill import api_key_from_env, http_transport, model_name
from readiness.answers import apply_answers, load_answers
from readiness.apply import PROVENANCE, RESIDUALS, load_manual, run, template_rows
from readiness.queue import QUEUE, QueueError, build_queue, write_queue
from readiness.scan import REPO_ROOT


def queue_command() -> int:
    """`--queue`: write the Director queue file the dashboard bundles."""
    try:
        queue = build_queue(REPO_ROOT)
    except QueueError as error:
        print(f"queue: {error}")
        return 2
    write_queue(REPO_ROOT, queue)
    slots = [slot for item in queue["items"] for slot in item["slots"]]
    locked = sum(1 for slot in slots if slot["lock"])
    print(f"queue: {len(queue['items'])} lines, {len(slots)} placeholders ({len(slots) - locked} open, {locked} locked), {len(queue['drafts'])} draft-only documents -> {QUEUE}")
    return 0


def _refresh_queue() -> int:
    """After a run that wrote documents: the queue file must follow them. 3 when it cannot be regenerated."""
    try:
        write_queue(REPO_ROOT)
    except QueueError as error:
        print(f"queue file not regenerated: {error}. Fix the recorded rows, then run --queue.")
        return 3
    return 0


def answers_command(file: Path, apply: bool) -> int:
    """`--answers`: apply the Director's answers downloaded from the dashboard. Only answered placeholders change."""
    report = apply_answers(REPO_ROOT, load_answers(file), apply=apply)
    print(f"{'APPLIED' if apply else 'DRY RUN'}: applied={len(report.applied)} corrections={len(report.corrections)} stale={len(report.stale)} refused={len(report.refused)} files_changed={report.files_changed}")
    for fill, row in report.applied:
        print(f"  fill {row['id']} {row['docPath']} {row['placeholder']} -> {fill.value!r}")
    for row in report.corrections:
        print(f"  correction {row['id']} {row['docPath']} {row['placeholder']}: {row['text']}")
    for row in report.stale:
        print(f"  stale {row['id']} {row['docPath']} {row['placeholder']}")
    for row, reason in report.refused:
        print(f"  refused {row['id']} {row['docPath']} {row['placeholder']} ({reason})")
    return _refresh_queue() if apply else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="readiness", description=__doc__)
    parser.add_argument("--apply", action="store_true", help="write fills into the documents (default: dry run)")
    parser.add_argument("--path", type=Path, help="restrict the run to one document")
    parser.add_argument("--fills", type=Path, help="JSON decisions (value or residual per placeholder) made in the Claude Code session")
    parser.add_argument("--template", type=Path, help="write the undecided placeholders as a JSON template for --fills, then exit")
    parser.add_argument("--ai", action="store_true", help="use the Claude API (paid) for undecided placeholders; off by default")
    parser.add_argument("--model", default=None, help=f"Claude model id for --ai (default: env MELINDAOS_READINESS_MODEL or {model_name()})")
    parser.add_argument("--queue", action="store_true", help="write the Director queue file from a fresh scan, then exit")
    parser.add_argument("--answers", type=Path, help="JSON answers downloaded from the dashboard's Director queue; changes only answered placeholders")
    args = parser.parse_args(argv)

    if args.queue:
        return queue_command()
    if args.answers:
        if args.fills or args.template or args.ai or args.path:
            print("--answers cannot be combined with --fills, --template, --ai or --path. Nothing done.")
            return 2
        return answers_command(args.answers, args.apply)
    manual = load_manual(args.fills) if args.fills else None
    key = api_key_from_env() if args.ai else None
    if args.ai and not key:
        print("--ai given but ANTHROPIC_API_KEY is not set. Nothing done.")
        return 2
    transport = http_transport(key) if key else None

    def progress(line: str) -> None:
        print(f"  … {line}", file=sys.stderr, flush=True)

    if args.template:
        probe = run(REPO_ROOT, apply=False, transport=None, model=args.model, only=args.path, manual=manual)
        rows = template_rows(REPO_ROOT, probe.pending_items)
        args.template.write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"template: {len(rows)} undecided placeholders -> {args.template}")
        return 0
    if args.apply and transport is None:
        probe = run(REPO_ROOT, apply=False, transport=None, model=args.model, only=args.path, manual=manual)
        if probe.ai_pending:
            print(f"Refusing --apply: {probe.ai_pending} placeholders are still undecided (no --fills row, no --ai). Nothing written.")
            for p in probe.pending_items:
                print(f"  undecided {p.doc_path}:{p.line}:{p.column} {p.raw}")
            return 2

    report = run(REPO_ROOT, apply=args.apply, transport=transport, model=args.model, only=args.path, progress=progress, manual=manual)
    mode = "APPLIED" if args.apply else "DRY RUN"
    print(f"{mode}: files_changed={report.files_changed} fills={report.fills} residuals={report.residuals} ai_pending={report.ai_pending}")
    if report.by_method:
        print("fills by method: " + ", ".join(f"{k}={v}" for k, v in sorted(report.by_method.items())))
    if report.by_reason:
        print("residuals by reason: " + ", ".join(f"{k}={v}" for k, v in sorted(report.by_reason.items())))
    for fill in report.fill_items:
        p = fill.placeholder
        print(f"  fill {p.doc_path}:{p.line} {p.raw} -> {fill.value!r} [{fill.method}] {fill.source_ref}")
    for residual in report.residual_items:
        p = residual.placeholder
        print(f"  residual {p.doc_path}:{p.line} {p.raw} ({residual.reason}){' — ' + residual.detail if residual.detail else ''}")
    if args.apply:
        print(f"provenance: {PROVENANCE}\nresiduals: {RESIDUALS}")
        return _refresh_queue()
    return 0


if __name__ == "__main__":
    sys.exit(main())
