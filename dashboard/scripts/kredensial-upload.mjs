#!/usr/bin/env node
// Uploads the BPJS credentialing files to the private Supabase Storage bucket `kredensial`.
// Fetch only, no dependency. Secrets come from the environment and are never printed:
//   node --env-file=.env.local scripts/kredensial-upload.mjs --source public/kredensial --dry-run
//   node --env-file=.env.local scripts/kredensial-upload.mjs --source public/kredensial --create-bucket
//   node --env-file=.env.local scripts/kredensial-upload.mjs --source public/kredensial --verify
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import { pathToFileURL } from "node:url";

const BUCKET = "kredensial";
const CONTENT_TYPES = { ".pdf": "application/pdf", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };
const USAGE = "Usage: kredensial-upload.mjs --source <dir> [--dry-run] [--create-bucket] [--verify] [--concurrency 1-4]";

export function parseArgs(argv) {
  const args = { source: "", dryRun: false, createBucket: false, verify: false, concurrency: 3 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--source") args.source = argv[++index] ?? "";
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--create-bucket") args.createBucket = true;
    else if (arg === "--verify") args.verify = true;
    else if (arg === "--concurrency") args.concurrency = Math.min(4, Math.max(1, Number(argv[++index]) || 3));
    else throw new Error(`Opsi tidak dikenal: ${arg}\n${USAGE}`);
  }
  if (!args.source) throw new Error(`--source wajib diisi.\n${USAGE}`);
  return args;
}

/** Every document under `source` (recursive), as bucket-relative POSIX paths; html, json and logos are not documents. */
export function listDocuments(source) {
  const documents = [];
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const relative = prefix ? posix.join(prefix, entry.name) : entry.name;
      if (entry.isDirectory()) walk(join(dir, entry.name), relative);
      else {
        const contentType = CONTENT_TYPES[posix.extname(entry.name).toLowerCase()];
        if (contentType) documents.push({ path: relative, bytes: statSync(join(dir, entry.name)).size, contentType });
      }
    }
  };
  walk(source, "");
  return documents.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

const headers = (secret, extra = {}) => ({ apikey: secret, Authorization: `Bearer ${secret}`, ...extra });
const encodePath = (path) => path.split("/").map(encodeURIComponent).join("/");

export async function createBucket({ origin, secret, transport = fetch }) {
  const response = await transport(`${origin}/storage/v1/bucket`, { method: "POST", headers: headers(secret, { "Content-Type": "application/json" }), body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }) });
  if (response.status === 200 || response.status === 201) return "created";
  if (response.status === 409) return "exists";
  throw new Error(`Gagal membuat bucket: HTTP ${response.status}`);
}

/** Uploads with upsert, at most `concurrency` at a time; failures are collected, not thrown. */
export async function uploadAll(documents, { source, origin, secret, transport = fetch, concurrency = 3 }) {
  const queue = [...documents];
  const result = { uploaded: 0, bytes: 0, failed: [] };
  const worker = async () => {
    for (let doc = queue.shift(); doc; doc = queue.shift()) {
      const body = readFileSync(join(source, ...doc.path.split("/")));
      let status;
      try {
        const response = await transport(`${origin}/storage/v1/object/${BUCKET}/${encodePath(doc.path)}`, { method: "POST", headers: headers(secret, { "Content-Type": doc.contentType, "x-upsert": "true" }), body });
        status = response.status;
      } catch { status = 0; }
      if (status === 200 || status === 201) { result.uploaded += 1; result.bytes += doc.bytes; }
      else result.failed.push({ path: doc.path, status });
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return result;
}

/** Lists each folder in the bucket and compares object sizes with the local files. */
export async function verifyAll(documents, { origin, secret, transport = fetch }) {
  const result = { matched: 0, mismatched: [], missing: [] };
  const folders = [...new Set(documents.map((doc) => posix.dirname(doc.path)))];
  const remote = new Map();
  for (const prefix of folders) {
    const response = await transport(`${origin}/storage/v1/object/list/${BUCKET}`, { method: "POST", headers: headers(secret, { "Content-Type": "application/json" }), body: JSON.stringify({ prefix, limit: 1000 }) });
    if (response.status !== 200) throw new Error(`Gagal membaca daftar ${prefix}: HTTP ${response.status}`);
    for (const row of await response.json()) if (row?.metadata?.size !== undefined) remote.set(posix.join(prefix, row.name), Number(row.metadata.size));
  }
  for (const doc of documents) {
    const size = remote.get(doc.path);
    if (size === undefined) result.missing.push(doc.path);
    else if (size !== doc.bytes) result.mismatched.push(doc.path);
    else result.matched += 1;
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const origin = process.env.MELINDAOS_SUPABASE_URL ?? "";
  const secret = process.env.MELINDAOS_SUPABASE_SECRET_KEY ?? "";
  const documents = listDocuments(args.source);
  const total = documents.reduce((sum, doc) => sum + doc.bytes, 0);
  console.log(`${documents.length} berkas, ${(total / 1_048_576).toFixed(1)} MB di ${args.source}`);
  if (args.dryRun) { for (const doc of documents) console.log(`  ${doc.path} (${(doc.bytes / 1024).toFixed(0)} KB)`); return; }
  if (!/^https:\/\//.test(origin) || !secret) throw new Error("MELINDAOS_SUPABASE_URL (https) dan MELINDAOS_SUPABASE_SECRET_KEY wajib ada di environment.");
  if (args.createBucket) console.log(`Bucket ${BUCKET}: ${await createBucket({ origin, secret })}`);
  if (args.verify) {
    const check = await verifyAll(documents, { origin, secret });
    console.log(`Cocok ${check.matched}, beda ukuran ${check.mismatched.length}, belum ada ${check.missing.length}`);
    for (const path of [...check.mismatched, ...check.missing]) console.log(`  ${path}`);
    process.exitCode = check.mismatched.length + check.missing.length ? 1 : 0;
    return;
  }
  const result = await uploadAll(documents, { source: args.source, origin, secret, concurrency: args.concurrency });
  console.log(`Terunggah ${result.uploaded}/${documents.length} (${(result.bytes / 1_048_576).toFixed(1)} MB), gagal ${result.failed.length}`);
  for (const failure of result.failed) console.log(`  GAGAL ${failure.path} (HTTP ${failure.status})`);
  process.exitCode = result.failed.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
