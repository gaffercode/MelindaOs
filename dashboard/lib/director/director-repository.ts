import { open, realpath, stat } from "node:fs/promises";
import { join, relative, resolve, isAbsolute } from "node:path";
import { emptyDirectorDay, parseDirectorDay, validReportDate, wibDate, type DirectorDay } from "./director-data";
import { protectedDirectorMode } from "./director-auth";
import { readReceivedDirectorDay } from "./director-publication";
import type { DirectorSubmission } from "./director-submission";

export type DirectorResult = { data: DirectorDay; status: "available" | "missing" | "invalid"; message: string | null; provenance?: DirectorSubmission["provenance"]; publication?: { revisionId: string; payloadHash: string; receivedAt: string }; submission?: { revisionId: string; payloadHash: string; receivedAt: string; reviewStatus: "pending" | "published" } };
export async function readDefaultDirectorDay(date: string, read: (candidate: string) => Promise<DirectorResult> = readDirectorDay): Promise<DirectorResult> {
  const initial = await read(date);
  if (initial.status !== "missing" || !validReportDate(date)) return initial;
  const older = await Promise.all(Array.from({ length: 6 }, (_, index) => {
    const candidate = new Date(`${date}T00:00:00Z`);
    candidate.setUTCDate(candidate.getUTCDate() - index - 1);
    return read(candidate.toISOString().slice(0, 10));
  }));
  return older.find((result) => result.status !== "missing") ?? initial;
}
export async function readDirectorDay(date: string, directory = process.env.MELINDAOS_DIRECTOR_DATA_DIR || join(process.cwd(), "data", "director")): Promise<DirectorResult> {
  const data = emptyDirectorDay(validReportDate(date) ? date : wibDate());
  if (!validReportDate(date)) return { data, status: "invalid", message: "Tanggal tidak valid. Pilih tanggal kalender yang benar." };
  if (protectedDirectorMode()) return readReceivedDirectorDay(date);
  try {
    const root = await realpath(resolve(directory));
    const file = await realpath(join(root, `${date}.json`));
    const child = relative(root, file);
    if (child.startsWith("..") || isAbsolute(child)) throw new Error("Unsafe file");
    if ((await stat(file)).size > 256_000) throw new Error("Oversized report");
    const handle = await open(file, "r");
    try {
      const bytes = Buffer.alloc(256_001);
      let bytesRead = 0;
      while (bytesRead < bytes.length) {
        const chunk = await handle.read(bytes, bytesRead, bytes.length - bytesRead, bytesRead);
        if (chunk.bytesRead === 0) break;
        bytesRead += chunk.bytesRead;
      }
      if (bytesRead > 256_000) throw new Error("Oversized report");
      const parsed: unknown = JSON.parse(bytes.subarray(0, bytesRead).toString("utf8"));
      const data = parseDirectorDay(parsed, date);
      const timestamps = [data.schedule.updatedAt, data.agenda.updatedAt, data.priorities.updatedAt, data.decisions.updatedAt, data.followUps.updatedAt, data.dailyReport.updatedAt, data.brief?.updatedAt ?? null, ...data.followUps.items.map((item) => item.updatedAt)];
      const future = timestamps.some((value) => value !== null && Date.parse(value) > Date.now() + 300_000);
      return { data, status: "available", message: future ? "Waktu pembaruan sumber berada di masa depan. Periksa jam dan tanggal sumber sebelum menggunakan laporan." : null };
    } finally { await handle.close(); }
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return { data, status: "missing", message: "File harian untuk tanggal ini belum tersedia. Tidak ada data rumah sakit yang diasumsikan." };
    return { data, status: "invalid", message: "Laporan harian tidak dapat dibaca atau formatnya tidak valid. Data tidak ditampilkan; periksa sumber laporan." };
  }
}
