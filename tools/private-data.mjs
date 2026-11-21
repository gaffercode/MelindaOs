import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Paths that never go to the public MelindaOS repository (Gaffer, 2026-11-19: public code, private data in
// Supabase and on the owner's machine). Folders end with "/". Used by tools/export-public.mjs.
// The monorepo keeps tracking these files locally, so their version history stays intact; only the export
// leaves them out.
export const PRIVATE_PATHS = [
  "knowledge/", // the institutional knowledge base: SOPs, governance, staffing and credentialing documents
  "sources/", // raw scans and photos, may contain patient content
  "dashboard/data/", // operational data (director days, pharmacy orders, formularium, STARKES, studio)
  "HANDOFF.md", // internal working notes
  ".agents/",
  ".claude/",
  "AGENTS.md", // AI agent instructions stay out of the public tree
  "dashboard/AGENTS.md",
  "dashboard/CLAUDE.md",
  "dashboard/docs/", // audits, reviews and acceptance notes
  "dashboard/deploy/", // server layout and access setup
  "docs/architecture/",
  "docs/engineering/",
  "docs/governance/",
  "docs/handoff-archive/",
  "docs/integrations/",
  "docs/operations/",
  "docs/plans/",
  "docs/product/",
  "docs/reviews/",
  "docs/security/",
  "docs/superpowers/",
  "docs/ARCHITECTURE-OVERVIEW.md", // internal architecture audit with open findings
  "CHANGELOG.md", // internal history, including open security items
  "tools/kredensial/", // one-off builders for the BPJS credentialing documents; they carry staff names (Gaffer, 2026-11-19)
  "tools/pathways/", // one-off clinical pathway and credential generators; same reason
  // Previews of official hospital documents. The published tree does not carry them and no one has reviewed them for
  // publication (tools/leak-check.mjs REVIEWED_ASSETS), so they stay here.
  "dashboard/public/branding/official-template-preview.png",
  "dashboard/public/branding/preview-spo-ppi1-official.png",
];

// Exceptions inside a private folder that the public tree keeps (Gaffer, 2026-11-19): fictional samples, the national
// STARKES 47104/2024 instrument and its derived maps (no hospital scores), and templates and configuration.
export const PUBLIC_EXCEPTIONS = [
  "dashboard/data/synthetic/", // fictional sample data, labelled as such
  "dashboard/data/starkes/", // the Kemenkes STARKES 47104/2024 instrument, pass rules and kits
  "dashboard/data/director/templates/",
  // The SATU SEHAT runner for the Biznet server: unit files and install scripts, no secrets; the env example holds empty
  // values (Gaffer, 2026-11-20).
  "dashboard/deploy/biznet-satusehat/",
  "dashboard/data/studio/", // document package catalogue, numbering seeds and source configuration
  "dashboard/data/validation.json", // the last knowledge checker result (counts only)
  // The knowledge library's non-hospital layers (Gaffer, 2026-11-19): index, agent rules, agent architecture, tool
  // contracts, machine-readable schemas and governance. The hospital documents in 01-07 and the archive stay private.
  "knowledge/00_INDEX/",
  "knowledge/08_AGENT_POLICY/",
  "knowledge/09_AGENT_ARCHITECTURE/",
  "knowledge/10_TOOL_CONTRACTS/",
  "knowledge/11_MACHINE_READABLE/",
  "knowledge/12_GOVERNANCE/",
];

// Line edits for files the public tree keeps whose wording only fits the private repository. Each "find" must occur
// exactly once, so a change to the original stops the export instead of publishing the old wording.
export const PUBLIC_EDITS = [
  {
    // The private .gitignore keeps the whole knowledge library and dashboard/data out of Git; the public tree must
    // track its public layers and samples, and ignore only the private files when they are on disk.
    file: ".gitignore",
    find: [
      "# --- Hospital data: never published ---",
      "# The repository is public. Internal RSIA Melinda documents, staff lists, procurement",
      "# files and the knowledge base built from them stay on the owner's machine. Production",
      "# receives them through a direct Vercel CLI deploy, never through Git.",
      "/sources/",
      "/knowledge/",
      "dashboard/data/*",
      "!dashboard/data/synthetic/",
    ].join("\n"),
    replace: [
      "# --- Hospital data: never published ---",
      "# This is the public source. Hospital documents and operational data live in private storage; the production",
      "# build fetches them (dashboard/scripts/fetch-private-data.mjs). These rules keep them out of Git when on disk.",
      "/sources/",
      "/knowledge/01_HOSPITAL/",
      "/knowledge/02_PATIENT_ACCESS/",
      "/knowledge/03_INSURANCE/",
      "/knowledge/04_BPJS/",
      "/knowledge/05_REFERRAL/",
      "/knowledge/06_CLINICAL_SAFETY/",
      "/knowledge/07_LEGAL_REGULATORY/",
      "/knowledge/99_ARCHIVE/",
      "/knowledge/11_MACHINE_READABLE/manifest/",
      "/knowledge/12_GOVERNANCE/agentic_os/docs/superpowers/",
      "dashboard/data/*",
      "!dashboard/data/synthetic/",
      "!dashboard/data/starkes/",
      "!dashboard/data/studio/",
      "!dashboard/data/validation.json",
      "!dashboard/data/director/",
      "dashboard/data/director/*",
      "!dashboard/data/director/templates/",
      "!dashboard/data/kredensial/",
      "dashboard/data/kredensial/*",
      "!dashboard/data/kredensial/index.json",
      "!dashboard/data/content/",
      "",
      "# Internal plans and the readiness outputs quoted from the private hospital documents: real files come from private",
      "# storage at build time (dashboard/scripts/fetch-private-data.mjs); the repository keeps fictional or empty stand-ins",
      "# for the files the code reads.",
      "/knowledge/12_GOVERNANCE/knowledge/URUTAN_PEMBARUAN_DOKUMEN.md",
      "/knowledge/12_GOVERNANCE/knowledge/MISSING_DOCUMENTS.md",
      "/knowledge/12_GOVERNANCE/knowledge/starkes-r-gaps-review.md",
      "/knowledge/12_GOVERNANCE/knowledge/readiness-director-items.md",
    ].join("\n"),
  },
  {
    file: "README.md",
    find: "> **Private · internal confidential.** No patient identifiers, no secrets, no `.env` contents in git.",
    replace: "> **Public source, private data.** This repository holds code only: no patient or staff data, no hospital documents, no secrets, no `.env` contents.",
  },
  {
    // Here the test reads the fictional source folder, because data/content/ holds the real files. In the public tree
    // it must check data/content/ itself, so a real file put there by mistake fails CI.
    file: "dashboard/tests/content-file.test.ts",
    find: [
      "    // The fictional files live in data/synthetic/content; the public tree gets a copy of them as data/content.",
      '    const folder = join(process.cwd(), "data", "synthetic", "content");',
    ].join("\n"),
    replace: '    const folder = join(process.cwd(), "data", "content");',
  },
];

// Private even inside a public exception.
export const ALWAYS_PRIVATE = [
  "knowledge/11_MACHINE_READABLE/manifest/", // the 2026 staff master list, rooms and beds, and raw source file mappings
  "knowledge/12_GOVERNANCE/agentic_os/docs/superpowers/", // AI working plans and specs
  // Internal plans and gap reviews built from the private hospital documents (Gaffer, 2026-11-20).
  "knowledge/12_GOVERNANCE/knowledge/URUTAN_PEMBARUAN_DOKUMEN.md",
  "knowledge/12_GOVERNANCE/knowledge/MISSING_DOCUMENTS.md",
  "knowledge/12_GOVERNANCE/knowledge/starkes-r-gaps-review.md",
  "knowledge/12_GOVERNANCE/knowledge/readiness-director-items.md",
  // The Director queue, its provenance and its residuals are built from the private hospital documents; the public tree
  // gets empty stand-ins (PUBLIC_SUBSTITUTES) and production fetches the real files (REQUIRED_FILES).
  "knowledge/12_GOVERNANCE/knowledge/readiness-director-queue.json",
  "knowledge/12_GOVERNANCE/knowledge/readiness-provenance.jsonl",
  "knowledge/12_GOVERNANCE/knowledge/readiness-residuals.json",
];

// Files the build imports but whose real content is private: the public tree gets the fictional sample at the same path.
// A folder entry ("/" at the end) copies the whole folder.
export const PUBLIC_SUBSTITUTES = [
  { from: "dashboard/data/synthetic/kredensial-index.json", to: "dashboard/data/kredensial/index.json" },
  { from: "dashboard/data/synthetic/studio-sources.json", to: "dashboard/data/studio/sources.json" }, // public sources only
  { from: "dashboard/data/synthetic/studio-facts.json", to: "dashboard/data/studio/facts.json" },
  // The checker result for the public knowledge layers only. Regenerate after those layers change: export, then run
  // `npm run knowledge-index` in the public tree's dashboard and copy data/validation.json back here.
  { from: "dashboard/data/synthetic/validation-public.json", to: "dashboard/data/validation.json" },
  // Public-tree variants of two build checks, kept beside the originals: a coverage floor for the director modules that
  // the public tests reach, and a trace manifest that does not require the private November drug order PDF.
  { from: "dashboard/data/synthetic/public-tree/vitest.config.ts", to: "dashboard/vitest.config.ts" },
  { from: "dashboard/data/synthetic/public-tree/trace-manifest.json", to: "dashboard/scripts/trace-manifest.json" },
  // The internal SECURITY.md carries an internal classification and open security items; the public tree gets a
  // reporting policy instead.
  { from: "dashboard/data/synthetic/public-tree/SECURITY.md", to: "SECURITY.md" },
  // The internal LICENSE forbids publication and carries an internal classification; the public tree gets a
  // view-only proprietary license. Gaffer approves its wording before the first publication.
  { from: "dashboard/data/synthetic/public-tree/LICENSE", to: "LICENSE" },
  // The hospital's wording (management tasks, forum schedule, document presets, brief and news copy) lives in
  // dashboard/data/content/, which is private here. The public tree gets the fictional files; production replaces them
  // with the real ones (dashboard/scripts/fetch-private-data.mjs REQUIRED_FILES).
  { from: "dashboard/data/synthetic/content/", to: "dashboard/data/content/" },
  { from: "dashboard/data/synthetic/public-tree/readiness/", to: "knowledge/12_GOVERNANCE/knowledge/" },
];

// Tests that read private material: the real hospital examples (director day of 3 Oct and morning brief of 23 Oct
// 2026, the November drug order and formularium, the credentialing index), the knowledge library and its index, and the
// private deploy and docs folders. They run in the private monorepo only.
export const PRIVATE_TESTS = [
  "dashboard/tests/ask-retrieve.test.ts",
  "dashboard/tests/canonical-origin.test.ts",
  "dashboard/tests/director-submission.test.ts",
  "dashboard/tests/executive-brief.test.tsx",
  "dashboard/tests/formularium.test.ts",
  "dashboard/tests/knowledge-layout.test.ts",
  "dashboard/tests/kredensial-storage.test.ts",
  "dashboard/tests/kredensial-view.test.tsx",
  "dashboard/tests/medify-biznet-deploy.test.ts",
  "dashboard/tests/satusehat-biznet-deploy.test.ts",
  "dashboard/tests/mcp-route.test.ts", // needs the generated knowledge index, which CI builds only after the tests
  "dashboard/tests/order-obat-api.test.ts",
  "dashboard/tests/order-obat-grid.test.ts",
  "dashboard/tests/pharmacy-order-pdf.test.ts",
  "dashboard/tests/pharmacy-order-view.test.tsx",
  "dashboard/tests/rbac-route-matrix.test.ts", // same reason
  "dashboard/tests/routes.test.tsx",
  "dashboard/tests/daily-documents.test.ts",
  "dashboard/tests/dash-schedule-home.test.tsx",
  "dashboard/tests/medify-pull.test.ts",
  "dashboard/tests/melinda-brief-contract.test.ts",
  "dashboard/tests/melinda-brief-honesty.test.tsx",
  "dashboard/tests/melinda-brief-roles.test.tsx",
  "dashboard/tests/order-obat-reading.test.ts",
  "dashboard/tests/pharmacy-order.test.ts",
  "dashboard/tests/service-summary-table.test.tsx",
  "dashboard/tests/simrs-snapshot.test.tsx",
  "tests/test_readiness_queue.py", // compares the Director queue with the private hospital documents
];

const matches = (file, entry) => (entry.endsWith("/") ? file.startsWith(entry) : file === entry);
export const isPrivate = (file) =>
  PRIVATE_TESTS.includes(file) ||
  ALWAYS_PRIVATE.some((entry) => matches(file, entry)) ||
  (PRIVATE_PATHS.some((entry) => matches(file, entry)) && !PUBLIC_EXCEPTIONS.some((entry) => matches(file, entry)));

const CAPSULE = fileURLToPath(new URL("../", import.meta.url));

/** True when the public tree may hold `file`: it is not private, or it is where a fictional substitute is put. */
export const isPublished = (file) =>
  !isPrivate(file) ||
  PUBLIC_SUBSTITUTES.some(({ from, to }) =>
    to.endsWith("/") ? file.startsWith(to) && existsSync(join(CAPSULE, from, file.slice(to.length))) : to === file);
