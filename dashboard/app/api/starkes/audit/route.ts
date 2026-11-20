import { requirePermission } from "@/lib/access/access-api";
import {
  apiBoundary,
  DirectorApiError,
  objectBody,
  readBoundedJson,
  type HumanSessionRole,
} from "@/lib/director/director-api";
import { protectedDirectorMode } from "@/lib/director/director-auth";
import { DirectorStoreError } from "@/lib/director/director-store";
import { listStarkesAuditScores, starkesAuditCommand } from "@/lib/starkes/audit-store";
import { loadRequirementRegister } from "@/lib/starkes/requirements";
import type { EvidenceStatus } from "@/lib/starkes/audit-store";
import { guard } from "@/lib/access/guard";

export const runtime = "nodejs";

const EVIDENCE: EvidenceStatus[] = ["missing", "draft", "linked", "verified", "not_applicable"];
const SCORES = new Set([0, 5, 10]);
const CHAPTER_BY_EP = new Map(loadRequirementRegister().requirements.map((ep) => [ep.id, ep.chapterCode]));

function validEvidence(value: unknown): value is EvidenceStatus {
  return typeof value === "string" && EVIDENCE.includes(value as EvidenceStatus);
}

export const GET = guard(async (request: Request) => {
  return apiBoundary(async () => {
    if (protectedDirectorMode()) await requirePermission(request, "starkes.use");
    const scores = await listStarkesAuditScores();
    return Response.json({ scores }, { headers: { "Cache-Control": "private, no-store" } });
  });
});

export const POST = guard(async (request: Request) => {
  return apiBoundary(async () => {
    // Only the Director's session maps to "director", the `actorRole` that lock and unlock require (here and in the store).
    const human = protectedDirectorMode()
      ? await requirePermission(request, "starkes.use", true).then(({ principal, reviewerId }) => ({ role: principal.role === "DIRECTOR" ? "director" : principal.role, reviewerId }))
      : { role: "director" as HumanSessionRole, reviewerId: "local-dev", config: null };
    const body = objectBody(await readBoundedJson(request, 16_384), ["command"], [
      "ep_id",
      "chapter_code",
      "score",
      "note",
      "evidence_status",
      "attachment_refs",
    ]);
    const command = body.command;
    if (!["upsert_draft", "submit_chapter", "lock", "unlock"].includes(String(command))) {
      throw new DirectorApiError(400, "Perintah audit tidak dikenali.");
    }
    // Ruling R8: lock and unlock stay Director only; refuse here with 403 rather than let the store's check answer 503.
    if ((command === "lock" || command === "unlock") && human.role !== "director") throw new DirectorApiError(403, "Akses tidak sesuai peran.");

    try {
      if (command === "upsert_draft") {
        const epId = body.ep_id;
        const chapterCode = typeof epId === "string" ? CHAPTER_BY_EP.get(epId) : undefined;
        if (!chapterCode) throw new DirectorApiError(400, "EP tidak valid.");
        const score = Number(body.score);
        if (!SCORES.has(score)) throw new DirectorApiError(400, "Skor audit tidak valid.");
        if (!validEvidence(body.evidence_status)) throw new DirectorApiError(400, "Status bukti tidak valid.");
        const note = typeof body.note === "string" ? body.note : "";
        if (note.length > 500) throw new DirectorApiError(400, "Catatan terlalu panjang.");
        const attachment_refs = Array.isArray(body.attachment_refs) ? body.attachment_refs.slice(0, 20) : [];
        const result = await starkesAuditCommand("upsert_draft", {
          ep_id: epId,
          chapter_code: chapterCode,
          score,
          note,
          evidence_status: body.evidence_status,
          attachment_refs,
          updated_by: human.reviewerId,
        });
        return Response.json(result);
      }

      const chapterCode = body.chapter_code;
      if (typeof chapterCode !== "string" || !/^[A-Z]{2,12}$/.test(chapterCode)) {
        throw new DirectorApiError(400, "Kode bab tidak valid.");
      }

      const args: Record<string, unknown> = {
        chapter_code: chapterCode,
        updated_by: human.reviewerId,
        actorRole: human.role,
      };
      const result = await starkesAuditCommand(String(command), args);
      return Response.json(result);
    } catch (error) {
      if (error instanceof DirectorStoreError && error.status === 409) {
        throw new DirectorApiError(409, "Elemen sudah dikunci. Tidak dapat mengubah skor.");
      }
      throw error;
    }
  });
});
