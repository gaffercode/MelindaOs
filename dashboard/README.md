# MelindaOS dashboard

Working local dashboard for the director and knowledge operators of RSIA Melinda DHAI. Next.js 16 / React 19 / TypeScript 6 / Tailwind 4 / Lucide. The Metrix-inspired layout uses a white Melinda brand theme.

## Brand identity

Brandbook page 5 supplies Deep Teal `#078D8F`, Neon Orange `#F97316`, Soft Lavender `#E2E8F0`, and Obsidian Black `#0F172A`. Backgrounds/cards are white per the user's latest instruction; teal carries identity/actions, orange is a secondary chart/priority accent, lavender supplies borders, and obsidian supplies text. Accessible darker teal `#067476` is used for small text and white-text buttons (5.57:1 contrast); base brand colors remain unchanged for graphics. Critical/warning colors retain their semantic purpose.

The transparent logo in `public/brand/melindaos-logo.png` is the original embedded brandbook page-3 image (PDF image xref 4 plus its native alpha mask xref 5), 375×382 RGBA. No drawing, recoloring or AI recreation was used. The supplied `Logo27.png` and `Melinda2027.png` are byte-identical RGB files with a baked checkerboard, so the clean version of the same official mark was recovered from the brandbook. Display width is 92px with 40px clear space above/below and at least 40px horizontally. Inter remains unchanged because this request changed colors/logo, not typography.

## Run and build

Prerequisites: Node.js 24, installed dashboard dependencies, the MelindaOS repository, and `uv` on PATH. The checker runs Python with `pyyaml` and `jsonschema` through uv; unavailable checker output is explicitly labeled, not replaced with invented counts.

From this directory:

```powershell
npm run dev
npm run typecheck
npm run lint
npm test -- --run tests/dashboard-ui.test.tsx
npm run test:run
npm run test:coverage
npm run build
npm audit --omit=dev
npm start
```

Root CI (`.github/workflows/quality.yml`) runs the same dashboard gates in this order: `npm ci`, `npm run lint`,
`npm run typecheck`, `npm run test:coverage`, `npm run build`, `npm audit --omit=dev`; the Python and SQL jobs run
separately.

Stop dev/production preview before building in this checkout: concurrent Next processes share `.next`. `PORT` controls the listening port; defaults to 3000. Scripts bind to loopback for local use. Do not expose the unauthenticated prototype publicly.

`MELINDAOS_ROOT` optionally supplies the absolute repository root. Default: the parent of this dashboard directory. API calls use same-origin relative paths; no deployment host is embedded in components.

## Repository and deployment boundary

The dashboard remains one application inside the MelindaOS repository. Keep its own package manifest, lockfile, build configuration, tests and assets together; no workspace framework or folder migration is needed for this single app. This follows the supported [Next.js project structure](https://nextjs.org/docs/app/getting-started/project-structure).

```text
MelindaOS/
  dashboard/
    app/                 routes and server API handlers
    components/          interface components
    lib/                 data contracts and application logic
    tests/               application tests and synthetic fixtures
    public/              browser-public logo and fonts only
    data/director/       labeled example, not a live publishing store
    docs/                application contracts and acceptance evidence
    package.json
    package-lock.json
  knowledge/
    01_HOSPITAL/         canonical knowledge, outside public assets
    ...                  other existing knowledge domains
    12_GOVERNANCE/
  docs/plans/            implementation plans
  sources/               local only, excluded from Git
    raw/                 source scans
    images/              raw photos
```

Source and the explicitly labeled 3 October example are versioned. Dependencies, build output, coverage, environment secrets, deployment metadata, databases and other daily JSON reports are ignored. Use an approved persistent source outside the checkout for live reports via `MELINDAOS_DIRECTOR_DATA_DIR`; never put operational reports or knowledge documents in `public/`.

On Vercel, set `dashboard` as the project Root Directory and keep "Include files outside the Root Directory in the Build Step" enabled; see [Vercel monorepos](https://vercel.com/docs/monorepos). `npm run build` runs `prebuild`, which snapshots approved knowledge metadata and searchable text into `data/knowledge-index.json` (gitignored, bundled into the API functions) and refreshes the checker snapshot in `data/validation.json` (versioned) when the Python checker can run. At runtime the app reads those files when the repository root is absent, so the hosted Governance card and `GET /api/v1/agent/overview` report the real checker counts; when no snapshot is available they fall back to "Checker berjalan di CI." CI verifies `data/validation.json` is fresh via `check_validation_snapshot.py`. Every reader and API stays behind the director session in protected mode. `GET /api/health` reports mode, director configuration, and index presence without exposing values.

## Routes and actions

| Page | Route | Functional controls |
| --- | --- | --- |
| Management Morning Brief | `/` (`?tanggal=YYYY-MM-DD`) | Server-rendered published brief for the date (or the newest within six days, labeled); census snapshot overlay; "Beri arahan" through the real Director instruction pipeline; browser-only agenda notes and `[ISI]` notes |
| Arahan Direktur | `/arahan` (`?hari=7\|14\|31`) | Server-rendered register of every instruction not yet `selesai` in the window, overdue first; "Beri arahan" on each row and a free-form "Arahan baru" (section `umum`, migration `202610280001`); protected mode only |
| Warta & Regulasi | `/berita` (`?tanggal=YYYY-MM-DD`) | Server-rendered The Gaffer Times edition published for the date; empty state when none is stored |
| Melinda Studio | `/studio` | Client-side SPO/Pedoman, SK Direktur and Formulir editor seeded from `components/studio/document-studio-presets.ts`; PDF through Node `POST /api/studio/generate` (SPO/SK/Form; works on Vercel) |
| STARKES Command | `/starkes` | Client-side R-D-O-W matrix and mock interview bank seeded from `components/starkes-tracker-data.ts`; practice scores persist in browser (`lib/starkes-practice-storage.ts`); dossier PDF through Node `POST /api/starkes/bundle` (works on Vercel) |
| Casemix Simulator | `/casemix` | Client-side INA-CBG tariff examples; no automatic tariff lookup |
| Director Login | `/director-login` (`?returnTo=/path`) | Passcode login in protected mode; `returnTo` is sanitised to a same-site path |
| Review laporan | `/director-review` (`?tanggal=YYYY-MM-DD`) | Submission queue for stored daily reports: approve-and-publish or reject |
| Ruang kerja | `/ruang-kerja` | Landing page for staff accounts: menu limited to the role's pages, Ask Melinda, link to `/ganti-password`; staff roles without `executive.view` land here after sign-in |
| Pengguna | `/pengguna` | Director only: create, disable, enable and reset accounts (Vice Director and four staff roles), change role, audit trail; the temporary password is shown once |
| Ganti password | `/ganti-password` | Any signed-in account sets a new password; required on first sign-in and after a reset |
| Overview | `/overview` | Snapshot refresh/retry; Volume/Coverage chart toggle; agent registry; Briefing preview; local decision drafts (browser only) |
| Knowledge | `/knowledge?q=...` | Both search forms submit real repository searches; encoded query survives reload; clear search by submitting empty text |
| Integrations | `/integrations` | Declared provider capabilities; global refresh; runtime health explicitly unavailable |

Access by role is defined once in `lib/access/access-control.ts` (`ROLE_PERMISSIONS`, `PAGE_PERMISSIONS`, `API_PERMISSIONS`); a route not listed there is Director only. `/director-login` offers the Director passcode or an account (email and password). Account endpoints: `POST/DELETE /api/access/session` (sign in/out, `GET` returns the CSRF token), `POST /api/access/password` (change own password), `GET/POST /api/access/users`, `PATCH /api/access/users/[id]`, `POST /api/access/users/[id]/password` (reset), `GET /api/access/audit`; the last four are Director only. Roles and risks: `docs/superpowers/specs/2026-11-11-rbac-access-design.md`.

`/melinda` permanently redirects to `/`, keeping a `?tanggal` shaped `YYYY-MM-DD` and dropping anything else. `/decisions` and `/audit` were retired (browser-only drafts are not an institutional record; Director instructions are). Unknown page slugs return 404. Every page except `/director-login` and the `/melinda` redirect passes through `lib/director/director-access.ts`: in protected mode a missing or expired session redirects to `/director-login?returnTo=...`; in file mode the gate is skipped. `tests/routes.test.tsx` pins these entry points.

### Management Morning Brief as published data

The home page no longer embeds the brief in the application bundle. It reads the brief with
`GET /api/director/melinda-brief` and the census with the stored SIMRS or Medify snapshot. In protected mode
they live in Supabase (`melinda_private.daily_documents`, migration `202610240001`); in file mode they are read
from `data/melinda/`, `data/simrs/` and `data/medify/`. `data/melinda/2026-10-23.json` is the labeled example.
No bot publishes the brief any more: the only automatic writer is the Medify publisher on the Biznet server
(`POST /api/director/medify-snapshot` and `POST /api/director/medify-run-status`, see
[Medify pull](docs/medify/medify-pull.md)). The page never substitutes a sample: when nothing is stored in the
lookback window it says so. Both Medify endpoints accept `?periksa=1`: same token, contract and
patient-identifier checks, nothing stored, `200 {valid:true, kind, date, payloadHash}`.

In the Next.js runtime the stored documents are read through `unstable_cache` tagged per kind and a publish
revalidates the tag, so every Vercel instance shows a new document at once.

The status card on the Director pages lists handed-over instructions past their deadline (14-day window) and a
missing or stale census (`lib/ops-alerts.ts`). A follow-up stored with `instructionId` prints that id and shows the
instruction's live status under the item; `GET /api/director/instructions?tanggal=…&id=IOC-…` (Director session,
repeatable `id`) returns those linked instructions alongside the date's own.

The **Arahan** button in the header of every Director page (and on `/kredensial`) opens a panel: the Director
writes or dictates a note (up to 2,000 characters), `POST /api/director/instructions/draft` (Director session)
turns it into up to eight draft instructions with the Claude API (`claude-haiku-5-5`, structured output,
patient identifiers blocked first), and the Director edits, previews and saves them through the normal create
endpoint. Instructions are stored in the instruction ledger only; nothing sends them on, so the Director passes the
text to staff. Recipients (`pic`) are free text on every action. The Polish button uses the same Claude client. Both
need the server-only `ANTHROPIC_API_KEY`; without it they answer 503 and the rest of the dashboard is unaffected.

## Director daily publishing

The default page preserves the standard full-width Metrix dashboard shell: original sidebar, header, KPI components, and card surfaces. Desktop uses four KPI cards and a two-column section grid; phone screens stack into one column with the original navigation drawer. There is no centered maximum-width dashboard container. Daily content remains server-rendered and reads a dated JSON file on every request, without calling the knowledge checker. `/?tanggal=2026-10-03` selects that exact day; `/` first checks today's **Asia/Jakarta** date, then checks the previous six dates if today's report is missing. A fallback is labeled with its actual date and as historical, never presented as today's data. Invalid sources remain explicit errors; no sample or invented zero activity is substituted.

Daily files live in `data/director/YYYY-MM-DD.json`. `data/director/2026-10-03.json` now contains the user's explicitly requested first example: a Medify-derived brief at 10:30 WIB, visibly marked **CONTOH PERTAMA · BUKAN DATA LIVE**. It is not an automatic Medify feed. For a new day, publish newly sourced values and provenance; never relabel old sample counts as fresh data. Configure `MELINDAOS_DIRECTOR_DATA_DIR` with an absolute directory to read another process's output; the dashboard never writes these source files. Keep this folder outside `public/`. Publish a complete UTF-8 file by atomic rename on the same filesystem; do not update a live file in place.

Contract (`lib/director/director-data.ts` validates all fields; unknown fields are rejected):

- Root: `schemaVersion: 1`, `date: YYYY-MM-DD`, required `schedule`, `agenda`, `priorities`, `decisions`, `followUps`, `dailyReport`, and optional `brief`. Old files without `brief` remain valid.
- Every section: `updatedAt` (ISO timestamp with `Z` or explicit offset, preferably `+07:00`), `source` (human-readable official source). Use `null` timestamp while unconnected; populated sections require a timestamp. The page displays each source time/date in 24-hour WIB, flags updates outside the report date, and warns about future source clocks.
- `schedule` and `agenda`: `items` with `id`, `start`, `end`, `title`, `note`. Times are local WIB `HH:MM`, and end must be after start. Split overnight events into the two relevant daily files. IDs must be unique in each section, use letters/digits/hyphens/underscores, and be at most 80 characters.
- `priorities`: `items` with `id`, `title`, `note`, `urgent` (boolean). Source order is retained; urgent items have a text marker as well as an orange border.
- `decisions`: `items` with `id`, `title`, `note`, `options` (2–6 unique `{id,label}` entries). The source lists pending decisions. Picking an option and pressing **Simpan draf lokal** persists only to this browser; it does not resolve the official queue, send approval or write an institutional audit. Draft identity includes date and full decision/options; changing source material invalidates reuse. Corrupt/blocked/quota-limited storage reports an error without silently overwriting the old draft.
- `followUps`: `items` with `id`, `title`, `status`, `pic`, `updatedAt`. PIC is the responsible staff role/unit; never a patient.
- `dailyReport`: `updatedAt`, `source`, `visits` (daily aggregate visits), `bpjsSubmitted` (submitted claim files), `bpjsPending` (pending claim files as of source cutoff), `revenue` (daily receipts, integer rupiah), `expenses` (daily expenditure, integer rupiah). Each number is nonnegative and safe-integer, or `null` if unavailable. Zero means a verified zero, not missing data. Define visit counting/cutoff and claim snapshot semantics in the source publisher; the dashboard does not infer these from KB documents.
- Optional `brief`: `updatedAt`, `source`, `example` (boolean), `inpatient`, `outpatient`, `emergency`, `systems`, `positiveNotes`, `validationNotes`. The checked-in example documents the exact closed structure. Inpatient includes occupied/capacity/vacant/rounded occupancy percentage and ward aggregates; unknown ward capacity remains `null`. Totals and percentages are checked for consistency. Outpatient has independently dated daily totals/Obgyn/Anak, pediatric visits in the last 31 days, new-patient percentage, and the 31-day payer mix. Emergency days have independent visit counts and optional WIB `cutoff`. Systems are reported observations, not live connector health. All nested unknown fields are rejected.

The requested example distinguishes 1–2 October poli from 3 October IGD through 10:00 WIB, and distinguishes the 31-day payer/Anak figures from daily totals. Today's poli total, official appointments, running follow-ups, claim amounts and finances were not supplied and remain unavailable. The brief's “Senin 29 Sep” label is preserved as an anomaly: 29 September 2026 is Tuesday. Example decisions express proposed assignments/studies, not approved or executed programs.

Max 100 items per section, 500 characters per text field and 256 KB per file. File symlinks escaping the configured folder are rejected. Structural validation is **not a PHI detector**: publishers must exclude patient names, medical record identifiers, individual clinical data and patient-specific free text. No live daily reporting feed was found in canonical repository filenames; existing historical policies/reports are not converted into today's operational numbers.

Hosting remains the existing local Next.js preview. Production needs authentication/RBAC, approved director access and a persistent read-only data source. On a persistent Node/Docker/VPS host, a publisher can update the configured folder without rebuilding. Vercel's deployed filesystem is not a persistent daily publishing store: use a read-only object-storage/API adapter there, or redeploy bundled files; do not promise daily JSON edits will persist on Vercel. No credentials, calendar/SIMRS connector, public domain or official decision backend are configured. Phone-sized browser layout is supported; loopback preview is not reachable from another physical device.

## Component and state structure

- `app/page.tsx` and `app/[view]/page.tsx`: server route entry points, validated slugs, URL search initialization.
- `app/{berita,studio,starkes,casemix}/page.tsx`: Director tool and daily pages; each resolves the date, runs the Director gate and renders its view inside `components/director/director-shell.tsx`.
- `components/shell.tsx`: shared shell pieces (`Sidebar`, `MobileDrawer`, `Kpi`, `navItems`, `classNames`).
- `components/dashboard-app.tsx`: six views, tables, forms, dialogs and event bindings.
- `components/studio/document-studio-view.tsx` and `components/starkes-tracker-view.tsx`: the client entry points for Studio and STARKES; they keep state, effects and API calls, and re-export their public types. Their immutable presets, chapters and questions live in `components/studio/document-studio-presets.ts` and `components/starkes-tracker-data.ts`.
- `lib/date-label.ts`: the one UTC date-only Indonesian "day short-month" formatter used by the Medify blocks.
- `components/decision/decision-provider.tsx`: shared session state mounted in the root layout; decisions/audit remain available across route changes even when browser persistence is blocked.
- `lib/navigation.ts`: closed route map and safe query construction.
- `lib/client-api.ts`: validated response contracts, HTTP/JSON errors, cancellable requests.
- `lib/decision/decision-form.ts`: form mapping and validation before invoking save.
- `lib/decision/decision-state.ts`: immutable create/edit/resolve/reopen/purge transitions and local audit.
- `lib/decision/decision-storage.ts`: runtime validation before loading browser data.
- `lib/repository.ts`: canonical-only indexing, registry/provider reads, fresh frontmatter checker execution.

Example of the actual event chain:

```tsx
<button type="button" onClick={() => onResolve(decision)}
  aria-label={`Resolve ${decision.title}`}>
  <CheckCircle2 />
</button>
```

```ts
const errors = saveDecisionForm(form, existing, at, id, (decision) => {
  state = decisionReducer(state, {
    type: "create", decision, eventId, correlationId,
  });
});
```

## Backend contracts and error handling

`GET /api/dashboard` returns `DashboardData`: validation snapshot, defined agents, declared providers and indexed document count. `GET /api/search?q=...` returns `{ query, results }`; query limit 120 characters. Both endpoints return no-store responses. Search excludes `sources/raw` and `knowledge/99_ARCHIVE`. Read failures return generic 500 errors; diagnostic details remain in server logs. Checker availability and format/governance validation are not semantic accuracy or operational freshness.

Client errors are visible with refresh/retry or resubmission. Refresh and search abort superseded/unmounted requests; stale responses cannot overwrite current results. Forms validate title/owner, strict due date, priority, recommendation and lengths.

Decisions persist under `melindaos.command-pulse.v1` in localStorage. An absent value seeds clearly labeled example drafts; an intentionally empty saved state stays empty. Corrupt JSON, invalid dates or wrong shapes cause a visible session-only fallback. Original unreadable storage is not silently overwritten. Confirmed Purge explicitly resets it. Blocked/quota-limited browser storage is reported; session state still works. Do not store PHI. Browser state is not institution-wide, trusted or tamper-evident, and concurrent-tab collaboration is not supported.

## Tests and verification limits

Vitest tests cover reducer transitions, form→reducer→storage integration, corrupted storage, API payloads/errors/cancellation, real search logic, every page entry point (including the `/melinda` redirect and the Director tool pages), the extracted Studio/STARKES data, all six page renders, and actual sidebar/table/filter/search/purge callback bindings. Render tests use React server rendering; handler tests invoke the callbacks attached to real React elements, not a replacement dashboard. Browser QA separately verifies mounted effects, native form submission, routing, persistence and responsive behavior. No additional DOM-test package is required.

Target a file with `npm test -- --run tests/<name>.test.ts`; TSX files are supported. `npm run test:run` runs the full dashboard suite. The SQL acceptance tests in `supabase/tests/` run in CI against a real PostgreSQL service (`scripts/db-test.sh`, every migration applied to an empty database); locally: `DATABASE_URL=postgres://... scripts/db-test.sh` against a disposable database. Node 24 is pinned by `.nvmrc` and `engine-strict`. Typecheck, ESLint and production build must pass before claiming completion. See the root HANDOFF for dated verification evidence.

## Motion and accessibility

Animated counters, the header notification bell, toasts, the AI status line and the brief's scroll progress pill are [Rare UI](https://rareui.com) components (MIT + Commons Clause + Attribution, Swami Malode), installed verbatim into `components/ui/` through the shadcn CLI; see `components/ui/RARE-UI.md` for the file hashes and the documented local edits. Credit lives here and in `components/ui/RARE-UI.md`; the sidebar footer no longer carries it (redesign 2026-11-09).

Shared dashboard styling uses 150–220 ms control transitions, a readable page fade, short KPI entrances, and mobile drawer entry/exit. KPI figures render as plain text on the server and roll (Rare UI animated counter) only when a value changes after mount; nothing counts up from zero and reduced motion shows the final digits at once. Hover movement applies only to fine pointers; keyboard focus stays explicit.

`prefers-reduced-motion: reduce` disables decorative animations and removes the drawer exit wait. The drawer reads its rendered CSS animation duration, caps exit waits at 500 ms, cancels timers on unmount, and ignores duplicate close requests. Saved/error draft feedback remains visible rather than disappearing after an animation. No animation package is required. Typography, layout, data contracts, and official decision authority are unchanged.

`tests/motion.test.ts` covers timing, reduced motion, cancellation and invalid durations. Browser QA checks rendered motion rules, navigation, focus restoration, local draft feedback and responsive widths; OS-level reduced-motion switching requires a separate manual device check.

## Still requires production backend wiring

Institutional identity/RBAC, shared decision storage, server-authoritative/tamper-evident audit, SIMRS read-only integration, live agent/provider telemetry and deployment access controls. No simulated operational data is represented as live hospital state. The current repository-backed read APIs are real; decision mutations intentionally remain local.

## Director store setup (Supabase + Vercel)

The protected dashboard uses the Supabase store and a human reviewer login. This replaces the local daily-file
setup when `MELINDAOS_DIRECTOR_STORE=supabase` is configured.

1. Apply `supabase/migrations/202610030001_director.sql` to the approved project after
   backup, then run `supabase/tests/director.sql` in a dedicated synthetic test project.
   Record SQL acceptance separately from local application tests.
   Accounts and roles need `supabase/migrations/202611120001_access_rbac.sql` as well; the Director applies
   it in the Supabase SQL Editor (after a backup) before deploying, then creates accounts at `/pengguna`.
   It adds no environment variables: accounts use the same Supabase settings and `MELINDAOS_APP_ORIGIN`.
   Its acceptance test is `supabase/tests/access.sql`.
2. Populate the server-only settings in [.env.example](.env.example): exact HTTPS
   `MELINDAOS_APP_ORIGIN`, Supabase URL/secret key, reviewer ID and passcode hash, and the
   Medify publisher hash. Keep the Supabase secret key on the server.
3. Use `node scripts/hash-director-credentials.mjs` with a temporary `MELINDAOS_PROVISION_PASSCODE`.
   Output contains only the named hash. Keep the raw director passcode with the reviewer.
   The Medify publisher key is generated on the Biznet server by `deploy/biznet-medify/install.sh`,
   which prints only its SHA-256.

Database migration/acceptance, hosting, backup restoration and the Medify schedule require their own
recorded operator checks. Packaged code and synthetic CLI tests do not establish that these live steps
have succeeded.

The opt-in `tests/director-publishing.integration.test.ts` uses real Supabase RPC
and route handlers on a dedicated disposable QA project. It requires explicit QA
credentials and retains synthetic history; a default skipped run is not acceptance.
