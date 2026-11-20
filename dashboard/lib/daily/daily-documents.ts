import { mkdir, readdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { revalidateTag, unstable_cache } from "next/cache";
import { authConfiguration, protectedDirectorMode, type DirectorAuthConfiguration } from "../director/director-auth";
import { validReportDate } from "../director/director-data";
import { DirectorStoreError, canonicalHash } from "../director/director-store";

/**
 * Daily documents are published once per report date and read by the dashboard:
 * - `management_brief`: the Management Morning Brief (see `melinda-brief-contract.ts`).
 * - `simrs_snapshot`: the aggregate census export from Medify (see `simrs-snapshot.ts`).
 * - `puskesmas_brief`: aggregate Puskesmas Balowerti brief for one date. Kept in the DB contract; served by the
 *   separate `drferdi/BalowertiOs` app since 2026-11-06. MelindaOS no longer reads or writes it.
 * - `news_edition`: Warta & Regulasi edition for one date.
 * - `medify_snapshot`: aggregate counts pulled from Medify (see `medify-snapshot-contract.ts`).
 * - `medify_run_status`: safe result metadata for a scheduled Medify pull.
 * - `satusehat_snapshot`: aggregate FHIR resource counts pulled from Kemenkes SATUSEHAT (see `satusehat-snapshot-contract.ts`).
 *
 * Protected mode stores them in Supabase through the `melinda_daily_documents` RPC.
 * File mode (local development) reads one JSON file per date under `data/melinda`,
 * `data/simrs`, `data/puskesmas`, `data/news`, `data/medify`, or `data/satusehat`.
 */
export type DailyDocumentKind = "management_brief" | "simrs_snapshot" | "puskesmas_brief" | "news_edition" | "medify_snapshot" | "medify_run_status" | "satusehat_snapshot";
export type StoredDailyDocument = { id: string; kind: DailyDocumentKind; report_date: string; producer: string; payload: unknown; payload_hash: string; received_at: string };
export type DailyDocumentReceipt = { replayed: boolean; id: string; kind: DailyDocumentKind; date: string; payloadHash: string; receivedAt: string };
export type DailyDocumentRead = { document: StoredDailyDocument | null; source: "supabase" | "file" };

export const DAILY_DOCUMENT_MAX_BYTES = 256_000;
export const DAILY_LOOKBACK_DAYS = 6;
const RPC = "melinda_daily_documents";
const DIRECTORIES: Record<DailyDocumentKind, { env: string; folder: string }> = {
  management_brief: { env: "MELINDAOS_MELINDA_BRIEF_DIR", folder: "melinda" },
  simrs_snapshot: { env: "MELINDAOS_SIMRS_DIR", folder: "simrs" },
  puskesmas_brief: { env: "MELINDAOS_PUSKESMAS_BRIEF_DIR", folder: "puskesmas" },
  news_edition: { env: "MELINDAOS_NEWS_EDITION_DIR", folder: "news" },
  medify_snapshot: { env: "MELINDAOS_MEDIFY_DIR", folder: "medify" },
  medify_run_status: { env: "MELINDAOS_MEDIFY_RUN_STATUS_DIR", folder: "medify-run-status" },
  satusehat_snapshot: { env: "MELINDAOS_SATUSEHAT_DIR", folder: "satusehat" },
};

export function documentDirectory(kind: DailyDocumentKind): string {
  const { env, folder } = DIRECTORIES[kind];
  return process.env[env] || join(/*turbopackIgnore: true*/ process.cwd(), "data", folder);
}

export function previousDates(date: string, days: number): string[] {
  return Array.from({ length: days }, (_, index) => {
    const candidate = new Date(`${date}T00:00:00Z`);
    candidate.setUTCDate(candidate.getUTCDate() - index - 1);
    return candidate.toISOString().slice(0, 10);
  });
}

async function readDocumentFile(kind: DailyDocumentKind, directory: string, date: string): Promise<StoredDailyDocument | null> {
  try {
    const root = await realpath(resolve(/*turbopackIgnore: true*/ directory));
    const file = await realpath(join(/*turbopackIgnore: true*/ root, `${date}.json`));
    const child = relative(root, file);
    if (child.startsWith("..") || isAbsolute(child)) return null;
    const info = await stat(file);
    if (info.size > DAILY_DOCUMENT_MAX_BYTES) return null;
    const payload: unknown = JSON.parse(await readFile(file, "utf8"));
    return { id: `file:${kind}:${date}`, kind, report_date: date, producer: "file", payload, payload_hash: canonicalHash(payload), received_at: info.mtime.toISOString() };
  } catch {
    return null;
  }
}

async function readFromFiles(kind: DailyDocumentKind, date: string, lookbackDays: number, directory: string): Promise<DailyDocumentRead> {
  const exact = await readDocumentFile(kind, directory, date);
  if (exact || lookbackDays <= 0) return { document: exact, source: "file" };
  let names: Set<string>;
  try { names = new Set(await readdir(/*turbopackIgnore: true*/ directory)); } catch { return { document: null, source: "file" }; }
  for (const candidate of previousDates(date, Math.min(lookbackDays, DAILY_LOOKBACK_DAYS))) {
    if (!names.has(`${candidate}.json`)) continue;
    const document = await readDocumentFile(kind, directory, candidate);
    if (document) return { document, source: "file" };
  }
  return { document: null, source: "file" };
}

function validDocument(value: unknown, kind: DailyDocumentKind): StoredDailyDocument | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.kind !== kind || typeof record.id !== "string" || typeof record.report_date !== "string" || !validReportDate(record.report_date)) return null;
  if (typeof record.producer !== "string" || typeof record.payload_hash !== "string" || typeof record.received_at !== "string" || !Number.isFinite(Date.parse(record.received_at))) return null;
  if (!("payload" in record) || canonicalHash(record.payload) !== record.payload_hash) return null;
  return { id: record.id, kind, report_date: record.report_date, producer: record.producer, payload: record.payload, payload_hash: record.payload_hash, received_at: record.received_at };
}

/**
 * Read the newest document for `date`, or the newest one within `lookbackDays` before it.
 * Throws in protected mode when the store is unreachable so callers can label the page honestly.
 */
export async function readDailyDocument(kind: DailyDocumentKind, date: string, lookbackDays = DAILY_LOOKBACK_DAYS, options: { directory?: string; config?: DirectorAuthConfiguration | null } = {}): Promise<DailyDocumentRead> {
  if (!validReportDate(date)) return { document: null, source: protectedDirectorMode() ? "supabase" : "file" };
  if (!protectedDirectorMode()) return readFromFiles(kind, date, lookbackDays, options.directory ?? documentDirectory(kind));
  const config = options.config === undefined ? authConfiguration() : options.config;
  if (!config) throw new Error("Secure configuration required");
  if (inNextRuntime()) {
    return unstable_cache(() => readFromStore(config, kind, date, lookbackDays), [kind, date, String(lookbackDays)], { tags: [dailyDocumentTag(kind)], revalidate: READ_CACHE_TTL_MS / 1000 })();
  }
  const key = `${kind}:${date}:${lookbackDays}`, hit = readCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const value = readFromStore(config, kind, date, lookbackDays);
  readCache.set(key, { expiresAt: Date.now() + READ_CACHE_TTL_MS, value });
  value.catch(() => { if (readCache.get(key)?.value === value) readCache.delete(key); });
  return value;
}

/**
 * Inside the Next.js runtime store reads go through `unstable_cache` (the Data Cache, shared by every
 * instance on Vercel), tagged per kind. A publish expires that tag immediately. `revalidateTag(tag, "max")`
 * would keep serving the previous read for up to a year, so `/puskesmas` stayed on the pre-submit brief.
 * Outside Next (tests, scripts) reads are cached per process and a publish clears that kind.
 * Errors are never cached on either path.
 */
const READ_CACHE_TTL_MS = 60_000;
export function dailyDocumentTag(kind: DailyDocumentKind): string { return `daily-document:${kind}`; }
function inNextRuntime(): boolean { return Boolean(process.env.NEXT_RUNTIME); }
const readCache = new Map<string, { expiresAt: number; value: Promise<DailyDocumentRead> }>();

export function clearDailyDocumentCache(kind?: DailyDocumentKind): void {
  for (const key of readCache.keys()) if (!kind || key.startsWith(`${kind}:`)) readCache.delete(key);
}

function invalidateDailyDocumentRead(kind: DailyDocumentKind): void {
  clearDailyDocumentCache(kind);
  if (!inNextRuntime()) return;
  revalidateTag(dailyDocumentTag(kind), { expire: 0 });
}

async function readFromStore(config: DirectorAuthConfiguration, kind: DailyDocumentKind, date: string, lookbackDays: number): Promise<DailyDocumentRead> {
  const { document } = await config.store.call<{ document: unknown }>("read", { kind, date, lookbackDays }, RPC);
  if (document === null) return { document: null, source: "supabase" };
  const valid = validDocument(document, kind);
  if (!valid) throw new Error("Invalid stored document");
  return { document: valid, source: "supabase" };
}

type IdempotencyRecord = { date: string; payloadHash: string; id: string; receivedAt: string };
type IdempotencyMap = Record<string, IdempotencyRecord>;

async function readIdempotencyMap(directory: string): Promise<IdempotencyMap> {
  try {
    const raw: unknown = JSON.parse(await readFile(join(/*turbopackIgnore: true*/ directory, ".idempotency.json"), "utf8"));
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw as IdempotencyMap : {};
  } catch {
    return {};
  }
}

/** Local file-mode publish used when `MELINDAOS_DIRECTOR_STORE=file` (no Supabase). */
export async function submitDailyDocumentFile(kind: DailyDocumentKind, input: { producerId: string; key: string; date: string; payload: unknown }, directory = documentDirectory(kind)): Promise<DailyDocumentReceipt> {
  if (!validReportDate(input.date)) throw new DirectorStoreError(400, "invalid_date");
  const payloadHash = canonicalHash(input.payload);
  const root = resolve(/*turbopackIgnore: true*/ directory);
  await mkdir(root, { recursive: true });
  const keys = await readIdempotencyMap(root);
  const slot = `${input.producerId}:${input.key}`;
  const prior = keys[slot];
  if (prior) {
    if (prior.payloadHash !== payloadHash || prior.date !== input.date) throw new DirectorStoreError(409, "conflict");
    invalidateDailyDocumentRead(kind);
    return { replayed: true, id: prior.id, kind, date: prior.date, payloadHash: prior.payloadHash, receivedAt: prior.receivedAt };
  }
  const receivedAt = new Date().toISOString();
  const id = `file:${kind}:${input.date}:${payloadHash.slice(0, 12)}`;
  const target = join(/*turbopackIgnore: true*/ root, `${input.date}.json`);
  const temp = join(/*turbopackIgnore: true*/ root, `.${input.date}.${payloadHash.slice(0, 8)}.tmp`);
  const body = `${JSON.stringify(input.payload, null, 2)}\n`;
  if (Buffer.byteLength(body, "utf8") > DAILY_DOCUMENT_MAX_BYTES) throw new DirectorStoreError(413, "too_large");
  await writeFile(temp, body, "utf8");
  await rename(temp, target);
  keys[slot] = { date: input.date, payloadHash, id, receivedAt };
  await writeFile(join(/*turbopackIgnore: true*/ root, ".idempotency.json"), `${JSON.stringify(keys, null, 2)}\n`, "utf8");
  invalidateDailyDocumentRead(kind);
  return { replayed: false, id, kind, date: input.date, payloadHash, receivedAt };
}

export async function submitDailyDocument(config: DirectorAuthConfiguration, kind: DailyDocumentKind, input: { producerId: string; key: string; date: string; payload: unknown }): Promise<DailyDocumentReceipt> {
  const receipt = await storeDailyDocument(config, kind, input);
  // One line per arrival (no payload, no key) so the runtime logs show when each kind was last published.
  console.info(JSON.stringify({ level: "info", code: "daily_document_stored", kind, date: input.date, producer: input.producerId, replayed: receipt.replayed }));
  return receipt;
}

async function storeDailyDocument(config: DirectorAuthConfiguration, kind: DailyDocumentKind, input: { producerId: string; key: string; date: string; payload: unknown }): Promise<DailyDocumentReceipt> {
  if (!protectedDirectorMode()) return submitDailyDocumentFile(kind, input);
  const payloadHash = canonicalHash(input.payload);
  const receipt = await config.store.call<DailyDocumentReceipt>("submit", { kind, producerId: input.producerId, key: input.key, date: input.date, payloadHash, payload: input.payload }, RPC);
  invalidateDailyDocumentRead(kind);
  return receipt;
}

export async function latestDailyDocument(config: DirectorAuthConfiguration, kind: DailyDocumentKind): Promise<Omit<StoredDailyDocument, "payload"> | null> {
  if (!protectedDirectorMode()) {
    const directory = documentDirectory(kind);
    let names: string[] = [];
    try { names = (await readdir(/*turbopackIgnore: true*/ directory)).filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort().reverse(); } catch { return null; }
    for (const name of names) {
      const document = await readDocumentFile(kind, directory, name.slice(0, 10));
      if (document) {
        const { payload: _payload, ...meta } = document;
        return meta;
      }
    }
    return null;
  }
  const { document } = await config.store.call<{ document: Omit<StoredDailyDocument, "payload"> | null }>("latest", { kind }, RPC);
  return document;
}
