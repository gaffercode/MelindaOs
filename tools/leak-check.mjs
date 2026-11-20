#!/usr/bin/env node
// Scans a folder (the public tree) for personal data, secrets, hospital business content and unreviewed binary files
// before anything is published. Text rules cannot read a picture or a PDF, so every binary file must be listed in
// REVIEWED_ASSETS with the SHA-256 of the exact file someone looked at.
// Usage: node tools/leak-check.mjs <folder> [--names <private directory.json>]
// --names takes the private staff directory (dashboard/data/hrd/directory.json, gitignored) and flags every staff or
// official name found in the folder; the names are read from the private file, so this checker never contains them.
// Exit code 0 = clean, 1 = findings. Values are never printed in full, only their first characters.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { isPublished } from "./private-data.mjs";

const MAX_BYTES = 5 * 1024 * 1024;
const BINARY = /\.(png|jpe?g|webp|gif|ico|pdf|xlsx|xls|docx?|pptx?|mp4|mov|webm|woff2?|ttf|otf|zip|gz)$/i;

export const RULES = {
  // Indonesian NIK and similar 16-digit identifiers.
  nik: /(?<![\d.])\d{16}(?![\d.])/g,
  // Indonesian mobile and landline numbers.
  phone: /(?<![\d])(?:\+62|62|0)8\d{7,11}(?![\d])/g,
  email: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g,
  secret:
    /sk-(?:ant|proj|live)-[A-Za-z0-9_-]{16,}|sb_secret_[A-Za-z0-9_-]{16,}|eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[0-9A-Z]{16}/g,
  // Money: hospital budgets, debts, offers and payments (an "Rp" amount with thousands separators or a "juta" suffix).
  rupiah: /Rp\.? ?\d{1,3}(?:[.,]\d{3})+(?:,\d+)?|Rp\.? ?\d+(?:[.,]\d+)? ?(?:jt|juta|rb|ribu|M|miliar|milyar)\b/g,
  // Companies: vendors, banks and partners named in internal work ("PT" or "CV" followed by a capitalised name).
  company: /\b(?:PT|CV)\.? (?:[A-Z][A-Za-z&]+\.? ?){1,4}/g,
  // The hospital's letter and document numbers: number / type code / unit / Roman month / year.
  docnumber: /\b\d{2,5}\/(?:S\.Pern|SK(?:-DIR)?|SPO|SP|ST|SE|UND|PKS|MOU|BA)\/[A-Za-z0-9.-]+\/[IVX]{1,4}\/20\d{2}\b/g,
  // Many references to the private hospital documents in one file usually mean quoted content (a readiness queue).
  "private-refs": /knowledge\/(?:0[1-7]|99)_[A-Z_]+\//g,
};
const PRIVATE_REFS_LIMIT = 20;
// Fictional samples use the CONTOH marker or the year 2099.
const SYNTHETIC_DOCNUMBER = /CONTOH|\/2099$/;

// Emails that are placeholders, package metadata or the hospital's own published mailboxes (on its letterhead and its
// public social profiles: the melinda.co.id domain and melinda.rsia@yahoo.com),
// not personal data. A personal address on melinda.co.id would still need review by hand.
const SAFE_EMAIL = /^git@github\.com$|^melinda\.rsia@yahoo\.com$|@(?:example\.(?:com|org|net|test)|[a-z0-9-]+\.test|test\.local|[a-z0-9.-]*synthetic[a-z0-9.-]*|users\.noreply\.github\.com|noreply\.github\.com|anthropic\.com|melinda\.co\.id|[a-z0-9-]+\.service)$/i;

// Test fixtures use patterned numbers (3571010101010001, 081234567890, +6281200000001); real identifiers do not.
const SYNTHETIC_NUMBER = /(\d)\1{4,}|123456|234567|345678|456789|(?:01){4,}|9007199254740991/;

// Reviewed findings that are not leaks. Each entry needs a reason; keep this list short.
export const ALLOW = [
  { path: "dashboard/tests/leak-check.test.ts", kinds: ["rupiah", "company", "docnumber"], reason: "made-up examples the checker must flag" },
  { path: "dashboard/tests/composer-compose.test.ts", kinds: ["rupiah"], reason: "the synthetic pharmacy stock value from tests/fixtures/medify-snapshot.ts" },
  { path: "dashboard/tests/composer-grounding.test.ts", kinds: ["rupiah"], reason: "made-up amount the grounding check must recognise" },
  { path: "knowledge/08_AGENT_POLICY/governance/agent-farmasi-pengajuan-obat-rules.prompt.md", kinds: ["rupiah"], reason: "the drug-request approval threshold in the public agent rules (Gaffer, 2026-11-19: layer 08 is public)" },
  { path: "knowledge/12_GOVERNANCE/knowledge/readiness-director-queue.json", kinds: ["rupiah"], reason: "none expected: the repository copy is a fictional stand-in" },
  { path: "dashboard/tests/content-guard.test.ts", kinds: ["company"], reason: "a wrong hospital name the content guard must reject" },
  { path: "tests/test_content_guard.py", kinds: ["company"], reason: "the owner company as printed on the hospital letterhead, and a wrong name the guard must reject" },
  { path: "dashboard/tests/helpers/xlsx-fixture.ts", kinds: ["company"], reason: "made-up supplier names in a spreadsheet fixture" },
  { path: "tools/doc_generator/generate_sk_direktur.py", kinds: ["company"], reason: "the owner company as printed on the hospital letterhead" },
  { path: "uv.lock", kinds: ["nik", "phone"], reason: "package hashes and timestamps" },
  { path: "dashboard/package-lock.json", kinds: ["nik", "phone", "email"], reason: "package hashes and metadata" },
  { path: "dashboard/tests/health-route.test.ts", kinds: ["secret"], reason: "fake key stubbed into the test environment" },
  { path: "knowledge/11_MACHINE_READABLE/agentic_config/official_channels.yaml", kinds: ["nik"], reason: "the hospital's Meta business ID, shown on its public pages" },
  { path: "dashboard/tests/director-marks-api.test.ts", kinds: ["email"], reason: "made-up personal mailboxes the API must reject" },
  { path: "dashboard/tests/email-triage-marks.test.tsx", kinds: ["email"], reason: "made-up personal mailboxes and the hospital's own Yahoo mailbox" },
];

// Binary files someone has looked at (Claude, 2026-11-20). A changed file gets a new hash and must be looked at again.
export const REVIEWED_ASSETS = {
  "dashboard/app/fonts/inter-latin-ext-variable.woff2": { sha256: "34b9c504cab7a73e37b746343a449132e56cf7b5481af2cb81dc74dcff25c956", note: "Inter font, SIL OFL" },
  "dashboard/app/fonts/inter-latin-variable.woff2": { sha256: "3100e775e8616cd2611beecfa23a4263d7037586789b43f035236a2e6fbd4c62", note: "Inter font, SIL OFL" },
  "dashboard/app/fonts/newsreader-variable.woff2": { sha256: "52f54c34206c51e23e2907bfda4f04fb11ac6ba7f75f8021b2d0075b091d1308", note: "Newsreader font, SIL OFL" },
  "dashboard/assets/fonts/carlito/Carlito-Bold.ttf": { sha256: "bb5d20f79b82599ec72983597437373a80f2d2085fa91fc144fd74e876a594db", note: "Carlito font, SIL OFL" },
  "dashboard/assets/fonts/carlito/Carlito-Italic.ttf": { sha256: "0b019225e58d702bfedcbd35c21696769f8ee115cb6343f84c2f240312450d1c", note: "Carlito font, SIL OFL" },
  "dashboard/assets/fonts/carlito/Carlito-Regular.ttf": { sha256: "f6418f708baede9789daef5d458c0f53d2a888af9820e8062934e504fedc6595", note: "Carlito font, SIL OFL" },
  "dashboard/public/brand/melindaos-logo.png": { sha256: "b24e77192bb7b5a5bad31473b4226e6b162c23a80124f8223b64ece93521ed09", note: "MelindaOS logo" },
  "dashboard/public/branding/rsia-melinda-logo-official.png": { sha256: "6fd6347edd413e709926acd011936f18362f972212f64d588c80e8ac5b93b2c2", note: "hospital logo, shown on its public pages" },
  "dashboard/public/kredensial/assets/logo_melinda_official.png": { sha256: "6fd6347edd413e709926acd011936f18362f972212f64d588c80e8ac5b93b2c2", note: "hospital logo, same file" },
  "dashboard/public/melinda-orb.mp4": { sha256: "ea2aa016055a46212a1b34718af468f85274fe6503eb47797f788190873ba59c", note: "abstract animated orb" },
  "dashboard/public/sentra/founder.webp": { sha256: "b81f327bac6d333050366a0d4fc8a93eb03dcc54eae698a6a0fde8df632a7de8", note: "founder portrait for the Sentra page" },
  "docs/assets/rujukan-assist-2026-11-18.png": { sha256: "0dfa0014a64e5751b114da34748164025ea77956c625c0045a09aed7bee399e7", note: "empty referral form" },
  "docs/assets/rujukan-e2e-2026-11-17.png": { sha256: "534ad611104e6fa95a9e0ac177b4c076658ea7d25af898eb467a8fea907f5948", note: "referral form with test data (Pasien Tes E2E)" },
  "docs/assets/rujukan-ttv-dasar-2026-11-17.png": { sha256: "49fc17d7a88361c9d30a172794014d0e0fe4b75b5a2cbe88b05593bc22e46311", note: "empty referral form" },
  "docs/assets/rujukan-ttv-lokasi-2026-11-17.png": { sha256: "b8ddfd0961c544eca810054e6088a17ea4147732f59bafe4bf35d8e07455a53e", note: "referral form with test data (Pasien Tes E2E)" },
};

const allowed = (path, kind) => ALLOW.some((entry) => entry.path === path && entry.kinds.includes(kind));

function walk(root) {
  const files = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) files.push(full);
    }
  };
  visit(root);
  return files;
}

/**
 * Full staff names (without academic titles) from the private directory; short single names are skipped to avoid noise.
 * The officials' names are left out on purpose: they are printed on every SK and letterhead, so they may stay in the
 * public code (Gaffer, 2026-11-19). Specialist doctors (DPJP, a title with "Sp.") are left out for the same reason: the
 * hospital publishes them on its practice schedule (Gaffer, 2026-11-19). Unit heads (a position that starts with Kepala,
 * Koordinator, Ketua or Penanggung Jawab) and the Staf Khusus Direktur are left out too: their names are printed as author
 * or signatory on SPOs and order letters (Gaffer, 2026-11-19). Phone numbers may not stay, and the phone rule above still
 * catches those.
 */
export function namesFrom(directoryFile) {
  if (!directoryFile || !existsSync(directoryFile)) return [];
  const doc = JSON.parse(readFileSync(directoryFile, "utf8"));
  const strip = (name) => name.replace(/^(?:dr\.|drg\.|Hj?\.|Ns\.)\s*/i, "").split(",")[0].replace(/\s*\(.*\)$/, "").trim();
  const officials = (doc.officials ?? []).map((person) => strip(String(person.name ?? "")));
  const isOfficial = (name) => officials.some((official) => official.includes(name) || name.includes(official));
  const isSpecialist = (person) => /\bSp\./.test(String(person.title ?? ""));
  const isUnitHead = (person) => /^(?:Kepala|Koordinator|Ketua|Penanggung Jawab)\b|^Staf Khusus Direktur$/i.test(String(person.position ?? ""));
  const names = (doc.staff ?? []).filter((person) => !isSpecialist(person) && !isUnitHead(person)).map((person) => strip(String(person.name ?? ""))).filter((name) => !isOfficial(name));
  return [...new Set(names.filter((name) => name.length >= 8 && name.includes(" ")))];
}

export function scan(root, { names = [] } = {}) {
  const findings = [];
  for (const full of walk(root)) {
    const path = relative(root, full).split(sep).join("/");
    if (!isPublished(path)) { findings.push({ path, kind: "private-path", count: 1, sample: "" }); continue; }
    const size = statSync(full).size;
    if (size > MAX_BYTES) findings.push({ path, kind: "large-file", count: 1, sample: `${(size / 1048576).toFixed(1)} MB` });
    if (BINARY.test(path)) {
      const reviewed = REVIEWED_ASSETS[path];
      const digest = createHash("sha256").update(readFileSync(full)).digest("hex");
      if (!reviewed || reviewed.sha256 !== digest) findings.push({ path, kind: "unreviewed-asset", count: 1, sample: digest.slice(0, 8) });
      continue;
    }
    if (size > MAX_BYTES) continue;
    const text = readFileSync(full, "utf8");
    for (const [kind, rule] of Object.entries(RULES)) {
      if (allowed(path, kind)) continue;
      let hits = [...text.matchAll(rule)].map((match) => match[0]);
      if (kind === "email") hits = hits.filter((value) => !SAFE_EMAIL.test(value));
      if (kind === "nik" || kind === "phone") hits = hits.filter((value) => !SYNTHETIC_NUMBER.test(value));
      if (kind === "docnumber") hits = hits.filter((value) => !SYNTHETIC_DOCNUMBER.test(value));
      if (kind === "private-refs" && hits.length <= PRIVATE_REFS_LIMIT) hits = [];
      if (hits.length) findings.push({ path, kind, count: hits.length, sample: `${hits[0].slice(0, 6)}…` });
    }
    const named = names.filter((name) => text.includes(name));
    if (named.length) findings.push({ path, kind: "staff-name", count: named.length, sample: `${named[0].slice(0, 3)}…` });
  }
  return findings;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const namesAt = args.indexOf("--names");
  const namesFile = namesAt >= 0 ? args[namesAt + 1] : "";
  const root = args.find((arg, index) => !arg.startsWith("--") && index !== namesAt + 1);
  if (!root) { console.error("Usage: node tools/leak-check.mjs <folder> [--names <private directory.json>]"); process.exit(2); }
  const findings = scan(root, { names: namesFrom(namesFile) });
  for (const f of findings) console.log(`${f.kind.padEnd(12)} ${String(f.count).padStart(4)}  ${f.path}  ${f.sample}`);
  console.log(findings.length ? `leak-check: ${findings.length} finding(s); nothing may be published until they are fixed or reviewed.` : "leak-check: clean.");
  process.exitCode = findings.length ? 1 : 0;
}
