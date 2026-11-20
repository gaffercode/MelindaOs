#!/usr/bin/env node
/**
 * Read-only migration doctor: compare supabase/migrations/*.sql against the migration ledger
 * (the `melinda_schema_status` RPC, command `ledger`). Prints one line per migration and exits
 * non-zero when any is missing. Never writes, never prints a secret value.
 *
 *   node scripts/migrate-doctor.mjs            print every migration and its ledger state
 *   node scripts/migrate-doctor.mjs --warn     exit 0 even when some are missing
 *   node scripts/migrate-doctor.mjs --dry-run  print nothing to the network; exit 2
 */
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const dashboardDir = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Migration file names (without `.sql`), ascending. Mirrors `lib/migration-names.ts`. */
export function migrationNames(dir = join(dashboardDir, "supabase", "migrations")) {
  return readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .map((file) => file.slice(0, -4))
    .sort();
}

/** The ledger stores 12-character version prefixes; a name is missing when its prefix is absent. */
export function report(names, versions) {
  const known = new Set(versions);
  const missing = names.filter((name) => !known.has(name.slice(0, 12)));
  return { recorded: names.filter((name) => known.has(name.slice(0, 12))), missing };
}

/** The ledger answer is untrusted: only an object whose `versions` is an array of strings is accepted. */
export function ledgerVersions(answer) {
  if (answer && typeof answer === "object" && Array.isArray(answer.versions) && answer.versions.every((v) => typeof v === "string")) {
    return answer.versions;
  }
  return null;
}

async function readLedger() {
  const url = process.env.MELINDAOS_SUPABASE_URL;
  const key = process.env.MELINDAOS_SUPABASE_SECRET_KEY;
  if (!url || !key) return null;
  const endpoint = `${new URL(url).origin}/rest/v1/rpc/melinda_schema_status`;
  const headers = { apikey: key, "Content-Type": "application/json" };
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ command: "ledger", args: {} }),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return ledgerVersions(await response.json());
}

function printRows(names, versions) {
  const { missing } = report(names, versions);
  for (const name of names) console.log(`${missing.includes(name) ? "BELUM  " : "tercatat"}  ${name}`);
  return missing;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--dry-run")) {
    console.error("migrate-doctor: konfigurasi belum tersedia (--dry-run).");
    process.exit(2);
  }
  const warnOnly = argv.includes("--warn");
  const names = migrationNames();
  let versions;
  try {
    versions = await readLedger();
  } catch (error) {
    console.error(`migrate-doctor: ledger tidak terbaca (${error instanceof Error ? error.message : error}).`);
    process.exit(warnOnly ? 0 : 1);
  }
  if (versions === null) {
    console.error("migrate-doctor: MELINDAOS_SUPABASE_URL dan MELINDAOS_SUPABASE_SECRET_KEY belum diatur; tidak dapat membaca ledger.");
    process.exit(2);
  }
  const missing = printRows(names, versions);
  process.exit(missing.length === 0 || warnOnly ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`migrate-doctor: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
}
