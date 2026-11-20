#!/usr/bin/env node
// Uploads the private files the production build needs to the private Supabase bucket `build-data`, as one new release:
//   releases/<id>/files/<path>   every private file under knowledge/ and dashboard/data/ (tools/private-data.mjs), plus the
//                                real versions of the data files the public tree replaces with fictional substitutes
//   releases/<id>/manifest.json  path, SHA-256 and size of each file
//   current.json                 written last, so a build never sees a half-uploaded release
// dashboard/scripts/fetch-private-data.mjs downloads the current release before `next build` on production.
// Run from the melindaos folder; secrets come from the environment and are never printed:
//   node --env-file=dashboard/.env.local tools/publish-private-data.mjs --dry-run
//   node --env-file=dashboard/.env.local tools/publish-private-data.mjs
//   node --env-file=dashboard/.env.local tools/publish-private-data.mjs --verify
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { PUBLIC_SUBSTITUTES, isPrivate } from "./private-data.mjs";
import { BUCKET, parseManifest, safePath } from "../dashboard/scripts/fetch-private-data.mjs";

const fail = (message) => { console.error(`publish-private-data: ${message}`); process.exit(1); };
const capsule = process.cwd();
if (!existsSync(join(capsule, "project.contract.json"))) fail("run this from the melindaos folder.");
const args = new Set(process.argv.slice(2));

/** Private files the build reads, and the originals behind the public substitutes under dashboard/. */
export function bundleFiles(listing) {
  const wanted = listing.filter((file) => isPrivate(file) && (file.startsWith("knowledge/") || file.startsWith("dashboard/data/")));
  const originals = PUBLIC_SUBSTITUTES.map(({ to }) => to).filter((to) => !to.endsWith("/") && safePath(to));
  return [...new Set([...wanted, ...originals])].filter((file) => safePath(file) && existsSync(join(capsule, file)) && statSync(join(capsule, file)).isFile()).sort();
}

const listing = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: capsule, encoding: "utf8" }).split("\0").filter(Boolean);
const files = bundleFiles(listing).map((path) => {
  const body = readFileSync(join(capsule, path));
  return { path, bytes: body.length, sha256: createHash("sha256").update(body).digest("hex") };
});
const total = files.reduce((sum, file) => sum + file.bytes, 0);
console.log(`publish-private-data: ${files.length} file(s), ${(total / 1048576).toFixed(1)} MB.`);
if (args.has("--dry-run")) { for (const file of files) console.log(`  ${file.path}`); process.exit(0); }

const origin = (process.env.MELINDAOS_SUPABASE_URL ?? "").replace(/\/+$/, "");
const secret = process.env.MELINDAOS_SUPABASE_SECRET_KEY ?? "";
if (!/^https:\/\//.test(origin) || !secret) fail("MELINDAOS_SUPABASE_URL (https) and MELINDAOS_SUPABASE_SECRET_KEY are required.");
const headers = (extra = {}) => ({ apikey: secret, Authorization: `Bearer ${secret}`, ...extra });
const encodePath = (path) => path.split("/").map(encodeURIComponent).join("/");
const put = async (object, body, contentType) => {
  const response = await fetch(`${origin}/storage/v1/object/${BUCKET}/${encodePath(object)}`, { method: "POST", headers: headers({ "Content-Type": contentType, "x-upsert": "true" }), body });
  if (response.status !== 200 && response.status !== 201) throw new Error(`HTTP ${response.status} for ${object}`);
};
const get = async (object) => {
  const response = await fetch(`${origin}/storage/v1/object/${BUCKET}/${encodePath(object)}`, { headers: headers(), cache: "no-store" });
  if (response.status !== 200) throw new Error(`HTTP ${response.status} for ${object}`);
  return Buffer.from(await response.arrayBuffer());
};

if (args.has("--verify")) {
  const current = JSON.parse((await get("current.json")).toString("utf8"));
  const manifest = parseManifest(JSON.parse((await get(`releases/${current.release}/manifest.json`)).toString("utf8")));
  if (!manifest) fail("the current manifest is malformed.");
  const remote = new Map(manifest.files.map((file) => [file.path, file.sha256]));
  const changed = files.filter((file) => remote.get(file.path) !== file.sha256).map((file) => file.path);
  const gone = manifest.files.filter((file) => !files.some((local) => local.path === file.path)).map((file) => file.path);
  console.log(`publish-private-data: release ${manifest.release}; ${files.length - changed.length} match, ${changed.length} new or changed, ${gone.length} only in the release.`);
  for (const path of [...changed, ...gone]) console.log(`  ${path}`);
  process.exit(changed.length + gone.length ? 1 : 0);
}

const create = await fetch(`${origin}/storage/v1/bucket`, { method: "POST", headers: headers({ "Content-Type": "application/json" }), body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false, file_size_limit: 20971520 }) });
if (![200, 201, 409].includes(create.status)) fail(`could not create the bucket: HTTP ${create.status}`);
const bucket = await (await fetch(`${origin}/storage/v1/bucket/${BUCKET}`, { headers: headers() })).json();
if (bucket.public !== false) fail("the build-data bucket is not private; stop.");

const release = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const queue = [...files];
let done = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  for (let file = queue.shift(); file; file = queue.shift()) {
    await put(`releases/${release}/files/${file.path}`, readFileSync(join(capsule, file.path)), "application/octet-stream");
    done++;
  }
}));
await put(`releases/${release}/manifest.json`, JSON.stringify({ release, createdAt: new Date().toISOString(), files }), "application/json");
await put("current.json", JSON.stringify({ release }), "application/json");
console.log(`publish-private-data: release ${release} uploaded (${done} file(s)) and made current.`);
