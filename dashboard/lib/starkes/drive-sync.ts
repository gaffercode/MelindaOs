import { DriveAccessError, listChapterFiles, readMatchText, type DriveFile } from "./drive-source";
import { CHAPTERS } from "./ep-status";
import { matchFile } from "./evidence-matcher";
import { listEvidence, upsertPending, withdrawMissing, type NewEvidence } from "./evidence-store";
import { loadRequirementRegister } from "./requirements";

export type SyncResult = { scanned: number; newPending: number; withdrawn: number; errors: string[] };

/**
 * One Drive sync: list → withdraw files no longer in their chapter folder → match only new, changed or moved files →
 * store them as pending for the Director. A Drive access error stops the sync before any store write.
 */
export async function syncDrive(fetchImpl: typeof fetch = fetch): Promise<SyncResult> {
  let files: DriveFile[];
  try {
    files = await listChapterFiles(fetchImpl);
  } catch (error) {
    if (error instanceof DriveAccessError) return { scanned: 0, newPending: 0, withdrawn: 0, errors: [error.message] };
    throw error;
  }
  const live = files.filter((f) => !f.trashed);
  let withdrawn = 0;
  for (const chapter of Object.keys(CHAPTERS)) {
    withdrawn += await withdrawMissing(chapter, live.filter((f) => f.chapterCode === chapter).map((f) => f.id));
  }

  const known = new Map((await listEvidence()).filter((e) => e.source === "drive").map((e) => [e.ref, e]));
  const register = loadRequirementRegister().requirements;
  const errors: string[] = [];
  const rows: NewEvidence[] = [];
  for (const file of live) {
    const before = known.get(file.id);
    if (before && before.modified_at === file.modifiedTime && before.chapter_code === file.chapterCode && before.status !== "withdrawn") continue;
    let text = "";
    try { text = await readMatchText(file, fetchImpl); } catch { errors.push(`Isi berkas "${file.name}" tidak terbaca; dicocokkan dari namanya.`); }
    const match = await matchFile(file, text, register.filter((ep) => ep.chapterCode === file.chapterCode));
    rows.push({
      source: "drive", ref: file.id, chapter_code: file.chapterCode, kind: match?.kind ?? null, ep_ids: match?.epIds ?? [],
      name: file.name, mime: file.mimeType, web_link: file.webViewLink, modified_at: file.modifiedTime,
      matched_by: "ai", confidence: match?.confidence ?? null, phi_flag: match?.phiFlag ?? false,
    });
  }
  await upsertPending(rows);
  return { scanned: files.length, newPending: rows.length, withdrawn, errors };
}
