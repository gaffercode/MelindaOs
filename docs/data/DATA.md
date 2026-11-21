# MelindaOS data model

MelindaOS keeps data in four places: the git-tracked knowledge library, build-time index files, a Supabase Postgres database, and local files that are never committed. This document lists each one, how it is written and read, and what is not known. Table names come from `create table` statements in `dashboard/supabase/migrations/`.

## 1. Knowledge library (git)

- `knowledge/00_INDEX` to `knowledge/12_GOVERNANCE` hold the hospital documents, agent rules, tool contracts and machine-readable schemas. Retired material is in `knowledge/99_ARCHIVE`. Finance-dispute and operational-permit evidence lives outside the knowledge tree, in `docs/operations/ssot/operational-evidence/` (Bufferstock finance and the hospital operational permit), so the checker and the index never see it.
- The format checker `tools/governance/validate_frontmatter.py` sorts files into three classes:
  - **A**: knowledge documents;
  - **B**: agent rule files;
  - **C**: JSON schemas.

  Only class A files that pass get the `APPROVED` governance block.
- **Readiness records:**
  - `knowledge/12_GOVERNANCE/knowledge/readiness-provenance.jsonl` logs every automatic or Director fill;
  - `readiness-director-queue.json` lists the open Director-only placeholders, and a test keeps it equal to the documents.

## 2. Build-time indexes (generated, git-ignored)

- `npm run knowledge-index`, which also runs before every build, generates the indexes in `dashboard/data/` (`dashboard/scripts/build-knowledge-index.ts`):
  - the knowledge index and `knowledge-search-index.json`;
  - `studio-source-snapshot.json`;
  - the Director queue copy `director-queue.json`.

  The full list of generated files is the `dashboard/data/` part of `mutableStatePaths` in `project.contract.json`.
- On Vercel the library folders are not read at runtime; the dashboard reads these files instead (`dashboard/lib/repository.ts`).
- `dashboard/data/validation.json` is committed. It holds the last checker result, and the same script refreshes it on every build. `tools/governance/check_validation_snapshot.py` fails when it no longer matches.

## 3. Supabase database

All tables live in the private schema `melinda_private`. The server reaches them only through named database functions, called by `SupabaseDirectorStore` (`dashboard/lib/director/director-store.ts`).

| Area | Tables | Function | Migration |
|---|---|---|---|
| Director core: sessions, rate limits, reviews, submissions and publications, audit | `sessions`, `rate_limits`, `reviews`, `submissions`, `revisions`, `publications`, `audit` | `melinda_director` | `202610030001` |
| Instructions ledger | `instructions` | `melinda_director_instructions` | `202610070001` and later |
| Officials | `officials` | `melinda_director_officials` | `202610070002`, `202611020001` |
| Daily documents | `daily_documents` | `melinda_daily_documents` | `202610240001` and later |
| Daily pipeline and unit reports (the pipeline was removed 2026-11-12; `/laporan-unit` still exchanges its capability link and submits reports through this function) | `daily_source_reports`, `daily_alert_deliveries`, `daily_pipeline_runs` | `melinda_daily_pipeline` | `202611060001` |
| STARKES | `starkes_ep_scores`, `starkes_evidence` | `melinda_starkes_audit`, `melinda_starkes_evidence` | `202611050001`, `202611070001` |
| Studio | `studio_packages`, `studio_revisions`, `studio_events`, `studio_number_series`, `studio_number_allocations` | `melinda_studio_documents` | `202611050002` |
| Tasks and schedule | `schedule_items`, `staff_replies`, `agent_heartbeats` | `melinda_director_tasks` | `202611080001`, `202611090003` |
| Executive office | `executive_calendar`, `executive_meeting_archive`, `executive_outbox`, `executive_readiness`, `task_archive_receipts`, `executive_recipient_directory` | `melinda_executive_office` | `202611080002`, `202611080003` |
| Pharmacy orders | `pharmacy_orders`, `pharmacy_order_decisions`, `pharmacy_order_removed` | `melinda_pharmacy_orders` | `202611090001`, `202611090002` |
| Agent drafts (gateway removed; review kept) | `agent_knowledge_submissions`, `agent_audit`, `agent_data_records` | `melinda_agent_gateway` | `202611100001`, `202611110001` to `202611110003` |
| Melinda conversations | `melinda_conversations`, `melinda_messages` | `melinda_agent` | `202611100002` || Migration ledger | `schema_migrations` | `melinda_schema_status` | `202611100003`, `202611100004`, `202611110004` |
| Director marks | `director_marks` | `melinda_director_marks` | `202611110005` |
| Accounts and access | `access_users`, `access_sessions`, `access_audit` | `melinda_access` | `202611120001` |
| Director answers | `director_answers` | `melinda_director_answers` | `202611120002` |

Each table is listed under the migration that creates it. The functions come from the store class. A row groups them by feature. It does not list every column; read the migration for the details.

### Migrations

- 33 files in `dashboard/supabase/migrations/`, named `YYYYMMDDNNNN_<topic>.sql`.
- `dashboard/lib/migration-names.ts` lists them. `dashboard/tests/migration-names.test.ts` keeps that list equal to the folder.
- They are applied by hand in the Supabase SQL Editor. Nothing in the repository applies them to production.
- Every migration after `202611100003` starts, inside its transaction, with `select melinda_private.record_migration('<version>', '<file name>');`. The ledger records it, and a second paste fails.
- The home page status card compares the ledger with `MIGRATION_NAMES` and names the migrations not yet applied (`dashboard/lib/ops-alerts.ts`).
- SQL acceptance tests are in `dashboard/supabase/tests/`, 17 files. CI applies every migration to an empty PostgreSQL 16 and runs them (`dashboard/scripts/db-test.sh`).

### Storage

Two private Storage buckets exist, both created once by SQL files under `dashboard/supabase/storage/` that are **not** migrations:

- `kredensial` — the BPJS 2026 credentialing files, served by `/api/director/kredensial/<path>` (`kredensial-bucket.sql`).
- `order-obat` — the Director's Order obat uploads (PDF, CSV, XLSX), 15 MB, served by the `order-obat` routes (`order-obat-bucket.sql`).

## 4. Local files (never committed)

| Path | Content |
|---|---|
| `sources/raw/`, `sources/images/` | Source PDFs and photos for the knowledge library |
| `dashboard/data/director/`, `melinda/`, `simrs/`, `medify/` and related folders | File-mode daily documents, for development only |
| `dashboard/public/kredensial/0*_…`, `knowledge/07_LEGAL_REGULATORY/kredensial/berkas_2026/bukti_foto` | Credentialing scans and evidence photos |
| `dashboard/.env.local` | Secrets |

The paths are listed in `project.contract.json` `mutableStatePaths`, so the SAFRS extraction skips them.

## 5. Retention and deletion

- The code deletes only short-lived rows: expired sessions and rate-limit counters older than a day (`202610030001_director.sql`), and replaced schedule items (`202611080001_director_tasks.sql`).
- No retention period for other data is defined in code or in a migration.
- Any retention obligation of the hospital is outside this repository and is **not verified** here. Do not read this section as a retention policy.

## 6. Private storage buckets and the public tree

- Supabase Storage holds four private buckets (`public = false`, no `storage.objects` policies, read only with the service key on the server):
  - `kredensial`: the BPJS credentialing files (`dashboard/supabase/storage/kredensial-bucket.sql`);
  - `signatures`: the Director's signature and stamp images (`dashboard/supabase/storage/signatures-bucket.sql`);
  - `hrd`: `directory.json` (staff list and officials' phone numbers, read by `/hrd`) and `starkes-team.json` (accreditation working groups, read by `/starkes`), through `dashboard/lib/storage/private-json.ts` (`dashboard/supabase/storage/hrd-bucket.sql`).
  - `build-data`: the private files the production build needs (knowledge `01` to `07` and the archive, operational data under `dashboard/data/`, and the real versions of the public substitutes), one release per upload with a SHA-256 manifest and `current.json`. `node --env-file=dashboard/.env.local tools/publish-private-data.mjs` uploads a release (`--dry-run`, `--verify`); `dashboard/scripts/fetch-private-data.mjs` downloads it as the first step of `npm run build` when `MELINDAOS_PRIVATE_DATA=required` (production only) and stops the build on any missing or altered file. It also stops when the release lacks one of the eight files in `REQUIRED_FILES` (same script): the five content files below and the three readiness files `readiness-director-queue.json`, `readiness-provenance.jsonl` and `readiness-residuals.json` under `knowledge/12_GOVERNANCE/knowledge/`. A Vercel production build without the flag and without `knowledge/01_HOSPITAL` on disk stops as well.
- The hospital's own wording lives in five content files, not in code: `dashboard/data/content/task-vault.json` (management tasks), `baseline-schedule.json` (forum schedule), `studio-presets.json` (document presets), `brief-copy.json` and `news-edition.json`. Each module checks its file's shape when it loads (`dashboard/lib/content/content-file.ts`), so a malformed file fails the build instead of a page. The real files are tracked here and private. Fictional versions with the same shape are in `dashboard/data/synthetic/content/`; the tests read those (alias in `dashboard/vitest.config.ts`), and the public tree gets them as `dashboard/data/content/`.
- Without Supabase configured, the same documents are read from `dashboard/data/hrd/` (git-ignored), then from the fictional samples in `dashboard/data/synthetic/`, which are labelled as fictional on screen.
- The public repository is built with `node tools/export-public.mjs <empty folder>` from this folder. It copies the tracked files except the paths in `tools/private-data.mjs`, puts the fictional substitutes listed there in place, then runs `tools/leak-check.mjs`, which blocks identity numbers, personal phone numbers and email addresses, secrets, large files, binary files nobody has reviewed (`REVIEWED_ASSETS`), and staff names read from the local private directory. Names of officials, specialist doctors and unit heads may stay, because they are printed on hospital decrees and letters; their phone numbers may not.
- The public tree keeps the knowledge layers that hold no hospital documents (`00_INDEX`, `08_AGENT_POLICY` to `12_GOVERNANCE`, without `11_MACHINE_READABLE/manifest/` and the AI working plans), the STARKES 47104/2024 instrument, and the Studio templates. The hospital documents (`01` to `07`, `99_ARCHIVE`), the daily operational data and the tests that read them stay private. So do the real content files, the three readiness files (the public tree gets empty stand-ins), four internal plans and gap reviews under `knowledge/12_GOVERNANCE/knowledge/`, and two previews of official documents under `dashboard/public/branding/`. Under `dashboard/deploy/`, only `biznet-satusehat/` is public (unit files and install scripts, no secrets). The public tree passes the same CI gates as this repository, with a lower coverage floor for `lib/director/` because the director tests that read real examples stay private.

## 7. Not known from the repository

- Which migrations are applied in production. The ledger records it there, but this repository does not.
- Database backups and point-in-time recovery settings, which live in Supabase.
- Row counts and real data volumes.
