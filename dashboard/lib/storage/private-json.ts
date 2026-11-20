import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { storageConfiguration, type StorageConfiguration } from "@/lib/storage/supabase-storage";

/** Private Supabase Storage bucket for people data shown on staff pages: the staff directory and the STARKES teams. */
export const PEOPLE_BUCKET = "hrd";

export type PrivateJsonSource = "supabase" | "file" | "sample";

type Options<T> = {
  /** Object name in the bucket, also the file name under data/hrd/ for local work without Supabase. */
  object: string;
  /** Fictional sample under data/synthetic/, so a public checkout still renders. */
  sample: string;
  /** Returns null when the document has the wrong shape; a partial document is never shown as complete. */
  parse: (value: unknown) => T | null;
  env?: NodeJS.ProcessEnv;
  transport?: typeof fetch;
  dataDir?: string;
};

/** The SHA-256 of the stored bytes: the version a save must name, so two people editing at once cannot overwrite each other. */
export const versionOf = (text: string) => createHash("sha256").update(text).digest("hex");

const defaultDataDir = () => join(/*turbopackIgnore: true*/ process.cwd(), "data");
const objectUrl = (storage: StorageConfiguration, object: string) => `${storage.origin}/storage/v1/object/${PEOPLE_BUCKET}/${object.split("/").map(encodeURIComponent).join("/")}`;
const headers = (storage: StorageConfiguration, extra: Record<string, string> = {}) => ({ apikey: storage.secret, Authorization: `Bearer ${storage.secret}`, ...extra });

async function readText(path: string): Promise<string | null> {
  try { return await readFile(path, "utf8"); } catch { return null; }
}

function parseText<T>(text: string | null, parse: (value: unknown) => T | null): T | null {
  if (text === null) return null;
  try { return parse(JSON.parse(text)); } catch { return null; }
}

/**
 * Server-side only. With Supabase configured (production, and local work with .env.local) the document comes only from
 * the private bucket; if that fails the answer is null, never sample data. Without Supabase it is the local file
 * data/hrd/<object> (gitignored), then the fictional sample.
 */
export async function loadPrivateJson<T>({ object, sample, parse, env = process.env, transport = fetch, dataDir = defaultDataDir() }: Options<T>): Promise<{ value: T; source: PrivateJsonSource; version: string } | null> {
  const storage = storageConfiguration(env);
  if (storage) {
    try {
      const response = await transport(objectUrl(storage, object), { headers: headers(storage), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000) });
      if (response.status !== 200) return null;
      const text = await response.text();
      const value = parseText(text, parse);
      return value ? { value, source: "supabase", version: versionOf(text) } : null;
    } catch {
      return null;
    }
  }
  const localText = await readText(join(dataDir, "hrd", object));
  const local = parseText(localText, parse);
  if (local && localText !== null) return { value: local, source: "file", version: versionOf(localText) };
  const sampleText = await readText(join(dataDir, "synthetic", sample));
  const fallback = parseText(sampleText, parse);
  return fallback && sampleText !== null ? { value: fallback, source: "sample", version: versionOf(sampleText) } : null;
}

export class PrivateJsonConflict extends Error {}

type SaveOptions = {
  object: string;
  /** The version the editor loaded; the save fails with PrivateJsonConflict when the stored document has moved on. */
  expectedVersion: string;
  /** Who saves, for the history file name. Letters, digits, dot, dash and underscore only. */
  actorId: string;
  env?: NodeJS.ProcessEnv;
  transport?: typeof fetch;
  dataDir?: string;
  now?: () => Date;
};

/**
 * Replaces a private document after keeping the current one under history/<time>-<actor>-<object>, so every edit can be
 * traced and undone. Supabase when configured; otherwise the local file data/hrd/<object> (local work only).
 */
export async function savePrivateJson(document: unknown, { object, expectedVersion, actorId, env = process.env, transport = fetch, dataDir = defaultDataDir(), now = () => new Date() }: SaveOptions): Promise<{ version: string }> {
  const text = `${JSON.stringify(document, null, 2)}\n`;
  const stamp = now().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const actor = actorId.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 64) || "unknown";
  const history = `history/${stamp}-${actor}-${object}`;
  const storage = storageConfiguration(env);
  if (storage) {
    const current = await transport(objectUrl(storage, object), { headers: headers(storage), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (current.status !== 200) throw new Error(`read ${object}: HTTP ${current.status}`);
    const currentText = await current.text();
    if (versionOf(currentText) !== expectedVersion) throw new PrivateJsonConflict();
    const keep = await transport(objectUrl(storage, history), { method: "POST", headers: headers(storage, { "Content-Type": "application/json" }), body: currentText, redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (keep.status !== 200 && keep.status !== 201) throw new Error(`keep history: HTTP ${keep.status}`);
    const write = await transport(objectUrl(storage, object), { method: "POST", headers: headers(storage, { "Content-Type": "application/json", "x-upsert": "true" }), body: text, redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (write.status !== 200 && write.status !== 201) throw new Error(`write ${object}: HTTP ${write.status}`);
    return { version: versionOf(text) };
  }
  const file = join(dataDir, "hrd", object);
  const currentText = await readText(file);
  const sampleVersion = currentText === null ? null : versionOf(currentText);
  if (currentText !== null && sampleVersion !== expectedVersion) throw new PrivateJsonConflict();
  await mkdir(join(dataDir, "hrd", "history"), { recursive: true });
  if (currentText !== null) await writeFile(join(dataDir, "hrd", history), currentText, "utf8");
  await mkdir(dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, text, "utf8");
  await rename(`${file}.tmp`, file);
  return { version: versionOf(text) };
}
