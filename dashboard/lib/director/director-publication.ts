import { authConfiguration } from "./director-auth";
import { canonicalHash, compareReceivedRevisions } from "./director-store";
import { assertPublishableSubmission, parseDirectorSubmission } from "./director-submission";
import { emptyDirectorDay } from "./director-data";
import type { DirectorResult } from "./director-repository";
import type { ReviewQueue, Revision } from "./director-api";
import { logError } from "../log";

export async function readReceivedDirectorDay(date: string): Promise<DirectorResult> {
  const empty = emptyDirectorDay(date);
  try {
    const config = authConfiguration();
    if (!config) throw new Error("Secure configuration required");
    let offset = 0;
    let queue = await config.store.call<ReviewQueue>("review_list", { date, offset });
    if (!Array.isArray(queue.pending) || (queue.publishedRevisionId !== null && typeof queue.publishedRevisionId !== "string")) throw new Error("Invalid report queue");
    let published: Revision | undefined;
    const publishedRevisionId = queue.publishedRevisionId;
    if (queue.publishedRevisionId !== null) {
      const { revision } = await config.store.call<{ revision: Revision }>("revision_read", { id: queue.publishedRevisionId });
      published = revision;
    }
    if (!queue.pending.length && !published) return { data: empty, status: "missing", message: "Laporan untuk tanggal ini belum diterima." };
    let invalid = false;
    while (true) {
      const pending = [...queue.pending].sort(compareReceivedRevisions);
      const revisions = [...pending, ...(published ? [published] : [])].sort(compareReceivedRevisions);
      for (const revision of revisions) {
        try {
          const payload = parseDirectorSubmission(revision.payload);
          if ((revision.status !== "pending" && revision.status !== "published") || revision.report_date !== date || payload.brief.date !== date || !Number.isFinite(Date.parse(revision.received_at)) || canonicalHash(payload) !== revision.payload_hash) throw new Error("Invalid report");
          assertPublishableSubmission(payload);
          if (revision === published && pending.length === 50 && compareReceivedRevisions(pending[pending.length - 1], revision) < 0) break;
          const receipt = { revisionId: revision.id, payloadHash: revision.payload_hash, receivedAt: revision.received_at };
          return { data: payload.brief, status: "available", message: invalid ? "Kiriman terbaru belum lolos validasi. Dashboard menampilkan versi valid sebelumnya." : null, provenance: payload.provenance, submission: { ...receipt, reviewStatus: revision.status }, ...(revision.status === "published" ? { publication: receipt } : {}) };
        } catch { invalid = true; }
      }
      if (pending.length < 50) throw new Error("No valid received report");
      offset += 50;
      queue = await config.store.call<ReviewQueue>("review_list", { date, offset });
      if (!Array.isArray(queue.pending) || queue.publishedRevisionId !== publishedRevisionId) throw new Error("Report queue changed; refresh required");
    }
  } catch (error) {
    logError("director_report_read", error);
    return { data: empty, status: "invalid", message: "Laporan belum dapat dibaca atau diverifikasi. Data contoh tidak digunakan sebagai pengganti. Hubungi administrator." };
  }
}
