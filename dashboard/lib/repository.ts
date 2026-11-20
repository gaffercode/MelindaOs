import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import MiniSearch, { type Options } from "minisearch";
import type {
  AiFill,
  DashboardData,
  KnowledgeChunk,
  KnowledgeDocument,
  ProviderRecord,
  SearchResult,
  ValidationCategory,
  ValidationCount,
  ValidationSnapshot,
} from "./contracts";

const execFileAsync = promisify(execFile);
const KNOWLEDGE_DIRS = [
  "knowledge/01_HOSPITAL",
  "knowledge/02_PATIENT_ACCESS",
  "knowledge/03_INSURANCE",
  "knowledge/04_BPJS",
  "knowledge/05_REFERRAL",
  "knowledge/06_CLINICAL_SAFETY",
  "knowledge/07_LEGAL_REGULATORY",
] as const;
const FORMAT_DIRS = [...KNOWLEDGE_DIRS, "knowledge/08_AGENT_POLICY", "knowledge/09_AGENT_ARCHITECTURE", "knowledge/10_TOOL_CONTRACTS", "knowledge/11_MACHINE_READABLE"] as const;
const SKIP_PARTS = new Set([".git", ".venv", "node_modules", ".next", "coverage", "sources", "99_ARCHIVE"]);
const PROVENANCE_FILE = path.join("knowledge", "12_GOVERNANCE", "knowledge", "readiness-provenance.jsonl");

/** Fills per document path from the readiness provenance log; a missing log or a malformed line yields nothing. */
export async function readAiFills(root: string): Promise<Map<string, AiFill[]>> {
  const fills = new Map<string, AiFill[]>();
  let raw: string;
  try { raw = await fs.readFile(path.join(root, PROVENANCE_FILE), "utf8"); } catch { return fills; }
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line) as { docPath?: string; placeholder?: string; value?: string; method?: string; sourceRef?: string };
      if (typeof record.docPath !== "string" || typeof record.placeholder !== "string") continue;
      const list = fills.get(record.docPath) ?? [];
      list.push({ placeholder: record.placeholder, value: String(record.value ?? ""), method: String(record.method ?? ""), sourceRef: String(record.sourceRef ?? "") });
      fills.set(record.docPath, list);
    } catch { continue; }
  }
  return fills;
}
const VALIDATION_LIMITATION = "Mengukur format dokumen dan governance canonical; bukan akurasi semantik, kelengkapan, atau freshness knowledge.";
const CI_VALIDATION = "Checker berjalan di CI.";
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { expiresAt: number; value: Promise<unknown>; refreshing?: boolean }>();

/** `staleWhileRevalidate` serves an expired value at once and refreshes it in the background. */
function cached<T>(key: string, load: () => Promise<T>, { ttl = CACHE_TTL_MS, staleWhileRevalidate = false } = {}): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as Promise<T>;
  if (hit && staleWhileRevalidate) {
    if (!hit.refreshing) {
      hit.refreshing = true;
      const next = load();
      next.then(() => cache.set(key, { expiresAt: Date.now() + ttl, value: next }), () => { hit.refreshing = false; });
    }
    return hit.value as Promise<T>;
  }
  const value = load();
  cache.set(key, { expiresAt: Date.now() + ttl, value });
  value.catch(() => { if (cache.get(key)?.value === value) cache.delete(key); });
  return value;
}

export function repositoryRoot(): string {
  const configured = process.env.MELINDAOS_ROOT;
  return configured ? path.resolve(configured) : path.resolve(/*turbopackIgnore: true*/ process.cwd(), "..");
}

export function parseValidationOutput(output: string, scannedAt = new Date().toISOString()): ValidationSnapshot | null {
  const counts: ValidationCount[] = [];
  for (const category of ["A", "B", "C"] as ValidationCategory[]) {
    const match = output.match(new RegExp(`Kategori ${category}:\\s*(\\d+) lolos dari (\\d+) file`));
    if (!match) return null;
    counts.push({ category, passed: Number(match[1]), total: Number(match[2]) });
  }
  const totalMatch = output.match(/TOTAL:\s*(\d+) lolos dari (\d+) file/);
  if (!totalMatch) return null;
  return {
    status: "available",
    scannedAt,
    counts,
    passed: Number(totalMatch[1]),
    total: Number(totalMatch[2]),
    limitation: VALIDATION_LIMITATION,
    source: "live",
  };
}

export async function runValidation(root = repositoryRoot()): Promise<ValidationSnapshot> {
  const script = path.join(root, "tools", "governance", "validate_frontmatter.py");
  const args = ["run", "--no-project", "--with", "pyyaml", "--with", "jsonschema", "python", "-X", "utf8", script];
  const scannedAt = new Date().toISOString();
  try {
    const { stdout } = await execFileAsync("uv", args, { cwd: root, timeout: 45_000, maxBuffer: 2_000_000 });
    return parseValidationOutput(stdout, scannedAt) ?? unavailable(scannedAt, "Output checker tidak dapat diparse.");
  } catch (error: unknown) {
    const candidate = error as { stdout?: string; message?: string; killed?: boolean };
    if (candidate.stdout) {
      const parsed = parseValidationOutput(candidate.stdout, scannedAt);
      if (parsed) return parsed;
    }
    return unavailable(scannedAt, candidate.killed ? "Checker melewati batas waktu." : candidate.message ?? "Checker gagal dijalankan.");
  }
}

function unavailable(scannedAt: string, error: string): ValidationSnapshot {
  return { status: "unavailable", scannedAt, counts: [], passed: 0, total: 0, limitation: VALIDATION_LIMITATION, error };
}

async function collectFiles(base: string, rootReal: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (SKIP_PARTS.has(entry.name)) continue;
      const candidate = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await walk(candidate);
      } else if (entry.isFile()) {
        const real = await fs.realpath(candidate);
        if (real === rootReal || real.startsWith(`${rootReal}${path.sep}`)) files.push(real);
      }
    }
  }
  await walk(base);
  return files;
}

function readScalar(frontmatter: string, key: string): string {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*["']?([^\\n"']*)["']?\\s*$`, "m"));
  return match?.[1]?.trim() ?? "";
}

function readTags(frontmatter: string): string[] {
  const inline = readScalar(frontmatter, "tags");
  if (inline.startsWith("[") && inline.endsWith("]")) {
    return inline.slice(1, -1).split(",").map((tag) => tag.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
  }
  const block = frontmatter.match(/^tags:\s*\n((?:\s+-\s+.*\n?)*)/m)?.[1] ?? "";
  return block.split(/\r?\n/).map((line) => line.replace(/^\s*-\s+/, "").trim()).filter(Boolean);
}

function splitFrontmatter(text: string): { frontmatter: string; body: string } {
  const match = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/);
  return match ? { frontmatter: match[1], body: match[2] } : { frontmatter: "", body: text };
}

function categoryFor(relativePath: string, name: string): ValidationCategory | null {
  if (KNOWLEDGE_DIRS.some((directory) => relativePath.startsWith(`${directory}/`)) && name.startsWith("kb-") && name.endsWith(".md")) return "A";
  if ((relativePath.startsWith("knowledge/08_AGENT_POLICY/") || relativePath.startsWith("knowledge/09_AGENT_ARCHITECTURE/")) && name.startsWith("agent-") && name.endsWith("-rules.prompt.md")) return "B";
  if ((relativePath.startsWith("knowledge/10_TOOL_CONTRACTS/") || relativePath.startsWith("knowledge/11_MACHINE_READABLE/")) && name.startsWith("schema-") && name.endsWith(".json")) return "C";
  return null;
}

export type KnowledgeIndex = { generatedAt: string; documents: KnowledgeDocument[]; providers: ProviderRecord[] };

const CHUNK_MAX = 1600;

export function knowledgeIndexPath(): string {
  return path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "knowledge-index.json");
}

export function knowledgeChunksPath(): string {
  return path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "knowledge-chunks.json");
}

/** Checker snapshot written by `npm run knowledge-index`; served when the live repo is absent (e.g. Vercel). */
export function validationFilePath(): string {
  return path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "validation.json");
}

function isAvailableValidationSnapshot(value: unknown): value is ValidationSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<ValidationSnapshot>;
  return (
    snapshot.status === "available" &&
    typeof snapshot.passed === "number" &&
    typeof snapshot.total === "number" &&
    snapshot.total > 0 &&
    Array.isArray(snapshot.counts)
  );
}

/** Reads the committed/generated validation snapshot; null when missing, corrupt, or not available. */
export async function readValidationFile(file = validationFilePath()): Promise<ValidationSnapshot | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(/*turbopackIgnore: true*/ file, "utf8")) as unknown;
    return isAvailableValidationSnapshot(parsed) ? (parsed as ValidationSnapshot) : null;
  } catch {
    return null;
  }
}

function slug(parts: string[]): string {
  return parts.join(" ").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "bagian";
}

/** Packs paragraphs into pieces of at most CHUNK_MAX chars; a single oversized paragraph is cut at whitespace. */
function packParagraphs(text: string): string[] {
  const pieces: string[] = [];
  let current = "";
  for (let paragraph of text.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean)) {
    while (paragraph.length > CHUNK_MAX) {
      if (current) { pieces.push(current); current = ""; }
      const cut = paragraph.lastIndexOf(" ", CHUNK_MAX) > 0 ? paragraph.lastIndexOf(" ", CHUNK_MAX) : CHUNK_MAX;
      pieces.push(paragraph.slice(0, cut).trim());
      paragraph = paragraph.slice(cut).trim();
    }
    if (current && current.length + 2 + paragraph.length > CHUNK_MAX) { pieces.push(current); current = ""; }
    current = current ? `${current}\n\n${paragraph}` : paragraph;
  }
  if (current) pieces.push(current);
  return pieces;
}

/** Splits a markdown body into `##`/`###` sections; text before the first `##` (title, intro) is not a chunk. */
export function chunkDocument(doc: { docId: string; path: string; title: string; body: string }): KnowledgeChunk[] {
  const sections: { headingPath: string[]; lines: string[] }[] = [];
  let h2 = "";
  let inFence = false;
  for (const line of doc.body.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const heading = inFence ? null : line.match(/^(##|###)\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const text = heading[2].trim();
      if (heading[1] === "##") h2 = text;
      sections.push({ headingPath: heading[1] === "##" || !h2 ? [text] : [h2, text], lines: [] });
    } else sections.at(-1)?.lines.push(line);
  }
  const base = doc.docId || doc.path;
  const seen = new Map<string, number>();
  const chunks: KnowledgeChunk[] = [];
  for (const section of sections) {
    // Only real tags (`<b>`, `</span>`, `<br/>`): a looser `<[^>]+>` would delete thresholds like "TD <90 ... >100".
    for (const text of packParagraphs(section.lines.join("\n").replace(/<\/?[a-zA-Z][^<>]*>/g, ""))) {
      const key = `${base}#${slug(section.headingPath)}`;
      const count = (seen.get(key) ?? 0) + 1;
      seen.set(key, count);
      chunks.push({ id: count === 1 ? key : `${key}-${count}`, docId: doc.docId, path: doc.path, title: doc.title, headingPath: section.headingPath, text });
    }
  }
  return chunks;
}

async function hasLiveRepository(root: string): Promise<boolean> {
  try { return (await fs.stat(path.join(root, "knowledge/01_HOSPITAL"))).isDirectory(); } catch { return false; }
}

async function readKnowledgeIndex(file: string): Promise<KnowledgeIndex> {
  try { return JSON.parse(await fs.readFile(file, "utf8")) as KnowledgeIndex; } catch (error) { throw new Error("knowledge_index_missing", { cause: error }); }
}

function indexed(file: string): Promise<KnowledgeIndex> {
  return cached(`index:${path.resolve(file)}`, () => readKnowledgeIndex(file), { ttl: Infinity });
}

/** `chunks` is written to its own file (knowledge-chunks.json), not into knowledge-index.json. */
export async function buildKnowledgeIndex(root = repositoryRoot()): Promise<KnowledgeIndex & { chunks: KnowledgeChunk[] }> {
  const chunks: KnowledgeChunk[] = [];
  const [documents, providers] = await Promise.all([readKnowledgeDocuments(root, chunks), loadProviders(root)]);
  return { generatedAt: new Date().toISOString(), documents, providers, chunks };
}

export function loadKnowledgeDocuments(root = repositoryRoot(), indexFile = knowledgeIndexPath()): Promise<KnowledgeDocument[]> {
  return cached(`documents:${path.resolve(root)}`, async () => await hasLiveRepository(root) ? readKnowledgeDocuments(root) : (await indexed(indexFile)).documents);
}

async function readKnowledgeChunksFile(file: string): Promise<KnowledgeChunk[]> {
  try { return JSON.parse(await fs.readFile(file, "utf8")) as KnowledgeChunk[]; } catch (error) { throw new Error("knowledge_index_missing", { cause: error }); }
}

export function loadKnowledgeChunks(root = repositoryRoot(), chunksFile = knowledgeChunksPath()): Promise<KnowledgeChunk[]> {
  return cached(`chunks:${path.resolve(root)}`, async () => {
    if (!await hasLiveRepository(root)) return readKnowledgeChunksFile(chunksFile);
    const chunks: KnowledgeChunk[] = [];
    await readKnowledgeDocuments(root, chunks);
    return chunks;
  }, { ttl: Infinity });
}

async function readKnowledgeDocuments(root: string, chunks?: KnowledgeChunk[]): Promise<KnowledgeDocument[]> {
  const rootReal = await fs.realpath(root);
  const allFiles: string[] = [];
  for (const directory of FORMAT_DIRS) {
    const base = path.join(rootReal, directory);
    try {
      allFiles.push(...await collectFiles(base, rootReal));
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  const aiFills = await readAiFills(rootReal);
  const documents: KnowledgeDocument[] = [];
  for (const file of allFiles) {
    const relativePath = path.relative(rootReal, file).split(path.sep).join("/");
    const category = categoryFor(relativePath, path.basename(file));
    if (!category) continue;
    const raw = await fs.readFile(file, "utf8");
    if (category === "C") {
      try {
        const schema = JSON.parse(raw) as { title?: string; description?: string; governance?: { status?: string }; properties?: Record<string, unknown> };
        if (schema.governance?.status !== "APPROVED") continue;
        const title = schema.title ?? path.basename(file, ".json");
        const body = `${schema.description ?? ""} ${Object.keys(schema.properties ?? {}).join(" ")}`;
        documents.push({ path: relativePath, category, title, docId: "", domain: "Machine readable", department: "", lastReviewed: "", tags: [], searchableText: `${title} ${relativePath} ${body}`.toLowerCase() });
      } catch {
        continue;
      }
      continue;
    }
    const { frontmatter, body } = splitFrontmatter(raw);
    if (readScalar(frontmatter, "status") !== "APPROVED" && !/governance:\s*[\s\S]*?status:\s*["']?APPROVED["']?\s*$/m.test(frontmatter)) continue;
    const title = readScalar(frontmatter, "title") || body.match(/^#\s+(.+)$/m)?.[1]?.trim() || path.basename(file);
    const docId = readScalar(frontmatter, "doc_id");
    const domain = readScalar(frontmatter, "domain") || (category === "B" ? "Agent policy" : "");
    const department = readScalar(frontmatter, "department");
    const lastReviewed = readScalar(frontmatter, "last_reviewed");
    const tags = readTags(frontmatter);
    const bodyForSearch = category === "A" ? body.replace(/<[^>]+>/g, " ") : "";
    const fills = aiFills.get(relativePath);
    if (chunks && category === "A") chunks.push(...chunkDocument({ docId, path: relativePath, title, body }));
    documents.push({ path: relativePath, category, title, docId, domain, department, lastReviewed, tags, searchableText: `${title} ${docId} ${domain} ${department} ${tags.join(" ")} ${relativePath} ${bodyForSearch}`.toLowerCase(), ...(fills ? { aiFills: fills } : {}) });
  }
  chunks?.sort((left, right) => left.path.localeCompare(right.path));
  return documents.sort((left, right) => left.title.localeCompare(right.title));
}

/** Digits and single letters must match a whole word: "10" is not "100", and "k" is not every k-word. */
const exactOnly = (term: string) => term.length < 2 || /^\d+$/.test(term);
const SEARCH_OPTIONS: Options<KnowledgeDocument> = {
  idField: "path",
  fields: ["title", "docId", "tags", "searchableText"],
  extractField: (document, field) => field === "tags" ? document.tags.join(" ") : String(document[field as keyof KnowledgeDocument]),
  // Typo tolerance only from five letters up, so a short abbreviation never stretches to a different one (IGD is not ICD).
  searchOptions: { boost: { title: 3, docId: 2, tags: 2 }, prefix: (term) => !exactOnly(term), fuzzy: (term) => term.length >= 5 ? 0.2 : false, combineWith: "OR" },
};
const tokenizeQuery = MiniSearch.getDefault("tokenize") as (text: string) => string[];
/** One index per loaded document list. The list is cached by its loader, so the index is rebuilt only when the list is reloaded. */
const searchIndexes = new WeakMap<KnowledgeDocument[], MiniSearch<KnowledgeDocument>>();

function searchIndexFor(documents: KnowledgeDocument[]): MiniSearch<KnowledgeDocument> {
  let index = searchIndexes.get(documents);
  if (!index) {
    index = new MiniSearch<KnowledgeDocument>(SEARCH_OPTIONS);
    index.addAll(documents);
    searchIndexes.set(documents, index);
  }
  return index;
}

/**
 * Ranked search over every document category, in three tiers:
 * 1. `full`: every query word appears as typed, and each of its parts matches a word (a prefix is enough, except for digits and single letters).
 * 2. `partial`: every query word appears somewhere, but only inside longer words or not as whole words ("bersih" in "membersihkan").
 * 3. `partial`: only some words match, or a word matches through typo tolerance.
 * Within a tier the ranking score decides. A near-miss is never labelled `full`.
 */
export function searchDocuments(documents: KnowledgeDocument[], query: string, limit = 18): SearchResult[] {
  const words = [...new Set(query.toLowerCase().trim().split(/\s+/).filter(Boolean))].slice(0, 6);
  const terms = [...new Set(words.flatMap((word) => tokenizeQuery(word)).filter(Boolean))];
  if (!terms.length) return [];
  const hits = new Map(searchIndexFor(documents).search(terms.join(" ")).map((hit) => [hit.id as string, hit]));
  const ranked: { document: KnowledgeDocument; anchors: string[]; score: number; tier: number }[] = [];
  for (const document of documents) {
    const hit = hits.get(document.path);
    const contains = words.every((word) => document.searchableText.includes(word));
    if (!hit && !contains) continue;
    const everyTerm = !!hit && terms.every((term) => hit.terms.some((word) => exactOnly(term) ? word === term : word.startsWith(term)));
    ranked.push({ document, anchors: [...words, ...terms, ...(hit?.terms ?? [])], score: hit?.score ?? 0, tier: everyTerm && contains ? 0 : contains ? 1 : 2 });
  }
  return ranked
    .sort((left, right) => left.tier - right.tier || right.score - left.score)
    .slice(0, limit)
    .map(({ document: { searchableText, ...document }, anchors, tier }) => {
      const anchor = anchors.map((word) => searchableText.indexOf(word)).find((position) => position >= 0) ?? 0;
      const start = Math.max(0, anchor - 65);
      const snippet = searchableText.slice(start, start + 190).replace(/\s+/g, " ").trim();
      return { ...document, snippet, match: tier === 0 ? "full" as const : "partial" as const };
    });
}

async function loadProviders(root: string): Promise<ProviderRecord[]> {
  const raw = await fs.readFile(path.join(root, "knowledge/11_MACHINE_READABLE", "agentic_config", "providers.yaml"), "utf8");
  const records: ProviderRecord[] = [];
  const chunks = raw.split(/^  (?=[a-z0-9_-]+:\s*$)/m).slice(1);
  for (const chunk of chunks) {
    const name = chunk.match(/^([a-z0-9_-]+):/m)?.[1];
    if (!name) continue;
    const authStrategy = chunk.match(/^\s{4}primary_auth:\s*(.+)$/m)?.[1]?.trim() ?? "not declared";
    const capabilities = (chunk.match(/^\s{4}capabilities:\s*\[(.*)]$/m)?.[1] ?? "").split(",").map((item) => item.trim()).filter(Boolean);
    records.push({ name, authStrategy, capabilities, status: "declared" });
  }
  return records;
}

/** A failed scan never wins over the committed snapshot: unavailable results fall back to the file, marked by source. */
async function withSnapshotFallback(validation: ValidationSnapshot, validationFile: string): Promise<ValidationSnapshot> {
  if (validation.status === "available") return validation;
  const snapshot = await readValidationFile(validationFile);
  return snapshot ? { ...snapshot, source: "snapshot" } : validation;
}

export async function getDashboardData(root = repositoryRoot(), indexFile = knowledgeIndexPath(), validationFile = validationFilePath()): Promise<DashboardData> {
  if (!await hasLiveRepository(root)) {
    const index = await indexed(indexFile);
    const snapshot = await withSnapshotFallback(unavailable(index.generatedAt, CI_VALIDATION), validationFile);
    return { validation: snapshot, providers: index.providers, documentCount: index.documents.length };
  }
  const validation = cached(`validation:${path.resolve(root)}`, () => runValidation(root), { staleWhileRevalidate: true });
  const [snapshot, providers, documents] = await Promise.all([validation, loadProviders(root), loadKnowledgeDocuments(root, indexFile)]);
  return { validation: await withSnapshotFallback(snapshot, validationFile), providers, documentCount: documents.length };
}
