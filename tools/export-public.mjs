#!/usr/bin/env node
// Builds the public MelindaOS tree from the files git tracks here, leaving out every private path
// (tools/private-data.mjs), then runs tools/leak-check.mjs on the result.
// Never writes inside the capsule and never touches git. Publishing the tree is a separate, manual step.
// Usage, from the melindaos folder: node tools/export-public.mjs <empty folder outside this folder> [--with-untracked]
// --with-untracked also takes new files git does not ignore yet, to check work before it is committed.
import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { PUBLIC_EDITS, PUBLIC_SUBSTITUTES, isPrivate } from "./private-data.mjs";
import { namesFrom, scan } from "./leak-check.mjs";

const fail = (message) => { console.error(`export-public: ${message}`); process.exit(1); };
const capsule = process.cwd();
if (!existsSync(join(capsule, "project.contract.json"))) fail("run this from the melindaos folder.");
const args = process.argv.slice(2);
const withUntracked = args.includes("--with-untracked");
const target = args.find((arg) => !arg.startsWith("--"));
if (!target) fail("give an empty output folder outside the melindaos folder.");
const out = resolve(target);
const where = relative(capsule, out);
if (!where || (!where.startsWith("..") && !isAbsolute(where))) fail("the output folder must be outside the melindaos folder.");
if (existsSync(out) && readdirSync(out).length) fail("the output folder must be empty.");

const listing = withUntracked ? ["ls-files", "-z", "--cached", "--others", "--exclude-standard"] : ["ls-files", "-z"];
const tracked = execFileSync("git", listing, { cwd: capsule, encoding: "utf8" })
  .split("\0")
  .filter((file) => file && existsSync(join(capsule, file)) && statSync(join(capsule, file)).isFile());
if (!tracked.length) fail("git lists no tracked files here.");

let copied = 0;
let left = 0;
for (const file of tracked) {
  if (isPrivate(file)) { left++; continue; }
  const destination = join(out, file);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(join(capsule, file), destination);
  copied++;
}
for (const { from, to } of PUBLIC_SUBSTITUTES) {
  if (!existsSync(join(capsule, from))) fail(`${from} is missing; the public tree needs it in place of ${to}.`);
  if (from.endsWith("/")) cpSync(join(capsule, from), join(out, to), { recursive: true });
  else { mkdirSync(dirname(join(out, to)), { recursive: true }); copyFileSync(join(capsule, from), join(out, to)); }
}
for (const { file, find, replace } of PUBLIC_EDITS) {
  const target = join(out, file);
  const text = existsSync(target) ? readFileSync(target, "utf8") : "";
  if (text.split(find).length !== 2) fail(`${file}: the text to replace must occur exactly once; update PUBLIC_EDITS in tools/private-data.mjs.`);
  writeFileSync(target, text.replace(find, replace));
}
console.log(`export-public: ${copied} file(s) copied to ${out}; ${left} private file(s) left out; ${PUBLIC_SUBSTITUTES.length} fictional substitute(s) put in place.`);

// The private staff directory, when it is on this machine, also catches staff names copied into code or tests.
const directory = join(capsule, "dashboard", "data", "hrd", "directory.json");
const names = namesFrom(directory);
console.log(names.length ? `export-public: checking ${names.length} staff name(s) from the private directory.` : "export-public: private staff directory not found; staff names are not checked.");
const findings = scan(out, { names });
for (const f of findings) console.log(`${f.kind.padEnd(12)} ${String(f.count).padStart(4)}  ${f.path}  ${f.sample}`);
console.log(findings.length ? `export-public: ${findings.length} leak-check finding(s); do not publish this tree yet.` : "export-public: leak-check clean.");
process.exitCode = findings.length ? 1 : 0;
