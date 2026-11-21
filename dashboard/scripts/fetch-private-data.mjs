#!/usr/bin/env node
// Puts the hospital's private files (knowledge 01-07 and the archive, operational data under dashboard/data) into the
// checkout before the production build. They live in the private Supabase bucket `build-data`, never in Git, so the
// public repository holds code only. Runs as the first step of `npm run build`:
//   MELINDAOS_PRIVATE_DATA unset  -> skipped (public CI, local work, preview deployments): the build uses what is on disk.
//                                      A Vercel production build with no private files on disk stops instead.
//   MELINDAOS_PRIVATE_DATA=required -> every file in the current release is downloaded and checked against its SHA-256;
//                                      any failure stops the build, so production never ships with half the data.
// Secrets come from the environment and are never printed. Fetch only, no dependency.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const BUCKET = "build-data";

// Files whose repository copy is a fictional or empty stand-in: the hospital's own wording behind the management tasks,
// forum schedule, document presets and brief/news copy (dashboard/data/content), and the readiness outputs quoted from
// the private hospital documents. A release without them would let production quietly ship the stand-ins, so the
// build stops instead.
export const REQUIRED_FILES = [
  "dashboard/data/content/baseline-schedule.json",
  "dashboard/data/content/brief-copy.json",
  "dashboard/data/content/news-edition.json",
  "dashboard/data/content/studio-presets.json",
  "dashboard/data/content/task-vault.json",
  "knowledge/12_GOVERNANCE/knowledge/readiness-director-queue.json",
  "knowledge/12_GOVERNANCE/knowledge/readiness-provenance.jsonl",
  "knowledge/12_GOVERNANCE/knowledge/readiness-residuals.json",
];
const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

/** A bundle path is safe when it is relative, stays inside the checkout and only touches the private data folders. */
export function safePath(path) {
  if (typeof path !== "string" || !path || posix.isAbsolute(path) || path.includes("\\") || /^[A-Za-z]:/.test(path)) return false;
  if (posix.normalize(path) !== path || path.split("/").includes("..")) return false;
  return path.startsWith("knowledge/") || path.startsWith("dashboard/data/") || path === "dashboard/scripts/trace-manifest.json";
}

// Knowledge folders that stay on the owner's machine by design and never go into a release (see the capsule .gitignore).
const LOCAL_ONLY_KNOWLEDGE = ["knowledge/07_LEGAL_REGULATORY/kredensial/berkas_2026/bukti_foto/"];

/** From a list of files Git ignores and does not track: the knowledge files a release built from Git's listing would miss. */
export function untrackedKnowledge(ignored) {
  return ignored.filter((file) => file.startsWith("knowledge/") && !LOCAL_ONLY_KNOWLEDGE.some((entry) => file.startsWith(entry)));
}

export function parseManifest(value) {
  if (!value || typeof value !== "object" || typeof value.release !== "string" || !Array.isArray(value.files)) return null;
  for (const file of value.files) {
    if (!safePath(file?.path) || typeof file.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(file.sha256) || !Number.isInteger(file.bytes)) return null;
  }
  return value;
}

const headers = (secret) => ({ apikey: secret, Authorization: `Bearer ${secret}` });
const encodePath = (path) => path.split("/").map(encodeURIComponent).join("/");

async function download(origin, secret, object, transport) {
  const response = await transport(`${origin}/storage/v1/object/${BUCKET}/${encodePath(object)}`, { headers: headers(secret), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(60_000) });
  if (response.status !== 200) throw new Error(`HTTP ${response.status} for ${object}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function fetchPrivateData({ env = process.env, transport = fetch, root = ROOT, concurrency = 8, log = console.log, required = REQUIRED_FILES } = {}) {
  if (env.MELINDAOS_PRIVATE_DATA !== "required") {
    // Without the flag and without the files, a production build would ship a site with no hospital data and say nothing.
    if (env.VERCEL_ENV === "production" && !existsSync(join(root, "knowledge", "01_HOSPITAL"))) {
      throw new Error("this production build has no private data on disk; set MELINDAOS_PRIVATE_DATA=required and the Supabase variables on Vercel.");
    }
    log("fetch-private-data: skipped (MELINDAOS_PRIVATE_DATA is not 'required').");
    return { skipped: true, files: 0 };
  }
  const origin = (env.MELINDAOS_SUPABASE_URL ?? "").replace(/\/+$/, "");
  const secret = env.MELINDAOS_SUPABASE_SECRET_KEY ?? "";
  if (!/^https:\/\//.test(origin) || !secret) throw new Error("MELINDAOS_SUPABASE_URL (https) and MELINDAOS_SUPABASE_SECRET_KEY are required.");
  const current = JSON.parse((await download(origin, secret, "current.json", transport)).toString("utf8"));
  if (typeof current?.release !== "string" || !/^[0-9A-Za-z-]+$/.test(current.release)) throw new Error("current.json names no valid release.");
  const manifest = parseManifest(JSON.parse((await download(origin, secret, `releases/${current.release}/manifest.json`, transport)).toString("utf8")));
  if (!manifest || manifest.release !== current.release) throw new Error("The release manifest is missing or malformed.");
  const missing = required.filter((path) => !manifest.files.some((file) => file.path === path));
  if (missing.length) throw new Error(`release ${manifest.release} lacks ${missing.join(", ")}; publish them before building production.`);
  const queue = [...manifest.files];
  let bytes = 0;
  const worker = async () => {
    for (let file = queue.shift(); file; file = queue.shift()) {
      const body = await download(origin, secret, `releases/${manifest.release}/files/${file.path}`, transport);
      const digest = createHash("sha256").update(body).digest("hex");
      if (digest !== file.sha256 || body.length !== file.bytes) throw new Error(`${file.path} does not match the manifest.`);
      const target = join(root, ...file.path.split("/"));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, body);
      bytes += body.length;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  log(`fetch-private-data: release ${manifest.release}, ${manifest.files.length} file(s), ${(bytes / 1048576).toFixed(1)} MB, all checked.`);
  return { skipped: false, files: manifest.files.length, release: manifest.release };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  fetchPrivateData().catch((error) => { console.error(`fetch-private-data: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
}
