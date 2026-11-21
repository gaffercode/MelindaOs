# Contributing to Melinda Knowledge OS

## 1. Scope

This repository is the canonical knowledge SSOT for agents at RSIA Melinda DHAI, and it holds the Director dashboard.
- **Engineering focus:** the dashboard (`dashboard/`).
- **Ongoing knowledge work:** document completeness and format standardization.

It is a SAFRS capsule in the monorepo (`projects/healthcare/melindaos`), published on its own as `gaffercode/MelindaOs`.

## 2. Ground rules

- Communicate in Bahasa Indonesia; keep code, identifiers, and commands in English.
- Read `AGENTS.md` and `.agents/HANDOFF.md` before you start.
- Never re-run the legacy scripts (`extract_and_map_raw.py`, `inject_frontmatter.py`, `ocr_transcribe_all.py`, `clean_and_structure_knowledge.py`). They overwrite the canonical format. Use `transform_documents.py --refresh` instead. A new scan enters through `tools/governance/intake_pdf.py`.
- Never guess OCR-glued or truncated text. Recover it from the source in `sources/raw/`, or leave the `[tidak terbaca pada sumber]` marker for review.
- No patient PII/PHI in any committed file. Never commit secrets; `dashboard/.env.local` and the other local paths in `project.contract.json` `mutableStatePaths` are git-ignored.
- Install the commit hook once per clone: `git config core.hooksPath .githooks`. It runs `tools/secret-scan.mjs` on what is staged and refuses secrets and local data files (env files, keys, databases, dumps). CI runs the same scan over every tracked file.
- Back up before a bulk rewrite. Git is the only rollback.
- Add no new dependency without review. Install from the lockfiles only (`uv sync --locked`, `npm ci`).

## 3. Document format brief

- **A** — `kb-[domain]-[topik].md` with YAML frontmatter (`doc_id`, `title`, `domain`, `department`, `version`, `last_reviewed`, `ftdr_safety_override`, `tags`), strict Markdown headings, and pipe tables with separator rows.
- **B** — `agent-[role]-rules.prompt.md` with a closed `<agent_specification>` (`role`, `context`, `safety_guardrails`, `instructions`, `output_format`).
- **C** — `schema-[entitas].json`, valid JSON Schema with `type`, `required`, and field descriptions.
- The `governance` block (APPROVED / CANONICAL / dr. Ferdi Andriska) belongs only on files that pass the checker.

## 4. Verification (required before every commit)

For a document change:

```bash
uv run --locked python -X utf8 tools/governance/validate_frontmatter.py
uv run --locked pytest -q
```

For a code change, also run the capsule stages:

```bash
node tools/capsule.mjs lint
node tools/capsule.mjs typecheck
node tools/capsule.mjs test
```

- A change is "done" only when the fresh checker passes every file it covers.
- Report status as checker-verified counts (pass vs fail), never from memory.
- Details are in `docs/engineering/TESTING.md` and `docs/engineering/VERIFICATION.md`.

## 5. Branches, commits and approval

- Work on a branch named `type/topic`. In the monorepo, use a worktree under `../Monorepo.worktrees/`.
- Make small, surgical commits, one concern per commit, with the message `type(scope): summary`.
- Do not commit generated artifacts (`.venv/`, `node_modules/`, `.next/`, `coverage/`, `*.tsbuildinfo`); they are already in `.gitignore`.
- Changes to sensitive paths need independent review. These are clinical documents, agent policy, tool contracts, the runtime, the governance and readiness tools, access control and migrations (`docs/governance/BOUNDARIES.md`).
- Nothing is pushed, merged, deployed or published without the owner's explicit approval.
- Update `.agents/HANDOFF.md` at the end of each session.

## 6. Questions and problems

- Ask the owner named in `project.contract.json` about scope or about a document's content.
- Report a security problem as `SECURITY.md` says: directly to the owner, never in a public issue.
