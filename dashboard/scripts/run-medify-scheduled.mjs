#!/usr/bin/env node
/** Private scheduler entrypoint. It never prints credentials or Medify response bodies. */
import { open, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { assertPublisherClient, prepareMedifyRunStatus, publisherFromEnv, submitMedifyRunStatus } from "./daily-publisher-client.mjs";

const STALE_LOCK_MS = 2 * 60 * 60 * 1000;
function wibDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}-${parts.find((part) => part.type === "day")?.value}`;
}
async function reportLockDenied(slot) {
  try {
    const publisher = publisherFromEnv(process.env);
    assertPublisherClient(publisher);
    const now = new Date().toISOString();
    const body = { schemaVersion: 1, date: wibDate(), slot, runId: randomUUID(), status: "failed", startedAt: now, completedAt: now, unavailableSections: [{ section: null, reason: "overlap_denied" }], snapshotRevisionId: null, snapshotReceivedAt: null };
    await submitMedifyRunStatus(prepareMedifyRunStatus(JSON.stringify(body), `medify-run-${body.runId}`), publisher);
  } catch {
    // The scheduler must never expose publisher credentials or server responses.
  }
}

const slot = process.argv[2];
if (!(["morning", "evening"].includes(slot)) || process.argv.length !== 3) {
  process.stderr.write("Usage: node scripts/run-medify-scheduled.mjs <morning|evening>\n");
  process.exitCode = 2;
} else {
  const lockPath = join(process.env.MELINDAOS_MEDIFY_LOCK_DIR || tmpdir(), "melindaos-medify-scheduled.lock");
  let lock;
  try {
    lock = await open(lockPath, "wx");
    await lock.writeFile(JSON.stringify({ startedAt: new Date().toISOString(), pid: process.pid }));
    const script = fileURLToPath(new URL("./medify-pull.mjs", import.meta.url));
    const scheduledEnv = { ...process.env };
    delete scheduledEnv.MEDIFY_DUMP_RAW_DIR;
    const child = spawn(process.execPath, [script, "--slot", slot], { stdio: "inherit", env: scheduledEnv });
    const code = await new Promise((resolve) => child.once("exit", (value) => resolve(value ?? 1)));
    process.exitCode = Number(code);
  } catch (error) {
    const locked = error && typeof error === "object" && "code" in error && error.code === "EEXIST";
    if (locked) {
      let stale = false;
      try { stale = Date.now() - (await stat(lockPath)).mtimeMs > STALE_LOCK_MS; } catch { /* no lock metadata available */ }
      await reportLockDenied(slot);
      process.stderr.write(stale ? "Kunci tarikan Medify lama terdeteksi; verifikasi proses aktif sebelum menghapus kunci.\n" : "Tarikan Medify terjadwal masih berjalan.\n");
    } else process.stderr.write("Tarikan Medify terjadwal tidak dapat dimulai.\n");
    process.exitCode = 1;
  } finally {
    await lock?.close();
    if (lock) await unlink(lockPath).catch(() => undefined);
  }
}
