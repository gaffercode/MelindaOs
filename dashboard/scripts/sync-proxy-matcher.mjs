#!/usr/bin/env node
/**
 * Regenerate the proxy matcher block in proxy.ts from PAGE_PERMISSIONS.
 * The matcher is derived: every page pattern, with `[...name]` rewritten to `:name*`
 * (a bare [id] is a regex character class in the matcher DSL, so catch-alls use :name*).
 *
 *   node scripts/sync-proxy-matcher.mjs           rewrite the block in place
 *   node scripts/sync-proxy-matcher.mjs --check   fail (exit 1) when the block is out of sync
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PAGE_PERMISSIONS } from "../lib/access/access-control.ts";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const proxyPath = join(appDir, "proxy.ts");
const START = "  // <generated:matcher>";
const END = "  // </generated:matcher>";

export function matcherEntries() {
  return PAGE_PERMISSIONS.map((rule) => rule.pattern.replace(/\[\.\.\.([^\]]+)\]/g, ":$1*"));
}

export function matcherBlock() {
  const entries = matcherEntries().map((route) => `    "${route}",`).join("\n");
  return `${START}\n  matcher: [\n${entries}\n  ],\n${END}`;
}

function replaceBlock(content, block) {
  const start = content.indexOf(START);
  const end = content.indexOf(END);
  if (start < 0 || end < 0) throw new Error(`markers ${START} / ${END} not found in proxy.ts`);
  return content.slice(0, start) + block + content.slice(end + END.length);
}

function main() {
  const content = readFileSync(proxyPath, "utf8");
  const block = matcherBlock();
  const start = content.indexOf(START);
  const end = content.indexOf(END);
  const current = start >= 0 && end >= 0 ? content.slice(start, end + END.length) : null;
  if (process.argv.includes("--check")) {
    if (current !== block) {
      console.error("proxy.ts matcher is out of sync; run node scripts/sync-proxy-matcher.mjs");
      process.exit(1);
    }
    console.log("proxy matcher in sync");
    process.exit(0);
  }
  if (current !== block) {
    writeFileSync(proxyPath, replaceBlock(content, block), "utf8");
    console.log("proxy matcher regenerated");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
