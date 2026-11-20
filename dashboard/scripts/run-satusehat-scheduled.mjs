#!/usr/bin/env node
/** Private scheduled SATUSEHAT runner. Never prints credentials or raw responses. */
import { open, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const STALE_LOCK_MS = 2 * 60 * 60 * 1000;
const slot = process.argv[2];

if (!(["morning", "evening"].includes(slot)) || process.argv.length !== 3) {
  process.stderr.write("Usage: node scripts/run-satusehat-scheduled.mjs <morning|evening>\n");
  process.exitCode = 2;
} else {
  const lockPath = join(process.env.MELINDAOS_SATUSEHAT_LOCK_DIR || tmpdir(), "melindaos-satusehat-scheduled.lock");
  let lock;
  try {
    lock = await open(lockPath, "wx");
    await lock.writeFile(JSON.stringify({ startedAt: new Date().toISOString(), pid: process.pid }));
    const script = fileURLToPath(new URL("./satusehat-pull.mjs", import.meta.url));
    const child = spawn(process.execPath, [script, "--slot", slot], { stdio: "inherit", env: { ...process.env } });
    const code = await new Promise((resolve) => child.once("exit", (value) => resolve(value ?? 1)));
    process.exitCode = Number(code);
  } catch (error) {
    const locked = error && typeof error === "object" && "code" in error && error.code === "EEXIST";
    if (locked) {
      let stale = false;
      try { stale = Date.now() - (await stat(lockPath)).mtimeMs > STALE_LOCK_MS; } catch { /* ignore */ }
      process.stderr.write(stale ? "Kunci tarikan SATUSEHAT lama terdeteksi; periksa proses aktif sebelum menghapus kunci.\n" : "Tarikan SATUSEHAT terjadwal masih berjalan.\n");
    } else {
      process.stderr.write("Tarikan SATUSEHAT terjadwal tidak dapat dimulai.\n");
    }
    process.exitCode = 1;
  } finally {
    await lock?.close();
    if (lock) await unlink(lockPath).catch(() => undefined);
  }
}
