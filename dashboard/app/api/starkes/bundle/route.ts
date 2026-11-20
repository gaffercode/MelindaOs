import { NextResponse } from "next/server";
import { protectedDirectorMode } from "@/lib/director/director-auth";
import { apiBoundary, DirectorApiError, readBoundedJson } from "@/lib/director/director-api";
import { requirePermission } from "@/lib/access/access-api";
import { buildStarkesDossierPdf, type StarkesDossierData } from "@/lib/pdf/build-starkes-dossier";
import { auditByEpId, buildChapterDossierPayload } from "@/lib/starkes/build-dossier-payload";
import { listStarkesAuditScores } from "@/lib/starkes/audit-store";
import { CHAPTERS } from "@/lib/starkes/ep-status";
import { guard } from "@/lib/access/guard";

const MAX_BODY_BYTES = 256_000;
// Chapter codes are short STARKES abbreviations (TKRS, SKP, PROGNAS); they also form the download filename.
const CHAPTER_CODE = /^[A-Z]{2,12}$/;

export const runtime = "nodejs";

export const POST = guard(async (req: Request) => {
  return apiBoundary(async () => {
    if (protectedDirectorMode()) await requirePermission(req, "starkes.use", true);
    const body = await readBoundedJson(req, MAX_BODY_BYTES);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new DirectorApiError(400, "Format permintaan tidak valid.");
    const { chapterCode, data } = body as { chapterCode?: unknown; data?: unknown };

    if (!chapterCode || !data) {
      return NextResponse.json({ error: "chapterCode dan data wajib disertakan" }, { status: 400 });
    }
    if (typeof chapterCode !== "string" || !CHAPTER_CODE.test(chapterCode)) {
      return NextResponse.json({ error: "chapterCode tidak valid" }, { status: 400 });
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return NextResponse.json({ error: "data dossier tidak valid" }, { status: 400 });
    }

    // A known chapter is always built from the official register and the Director's audit scores, never the client data.
    const dossierData = Object.hasOwn(CHAPTERS, chapterCode)
      ? buildChapterDossierPayload(chapterCode, auditByEpId(await listStarkesAuditScores()))
      : (data as StarkesDossierData);

    let pdfBuffer: Uint8Array;
    try {
      pdfBuffer = await buildStarkesDossierPdf(dossierData);
    } catch (error) {
      console.error("[STARKES DOSSIER GENERATE ERROR]", error instanceof Error ? error.message : error);
      return NextResponse.json({ error: "Gagal mengompilasi berkas dossier akreditasi" }, { status: 500 });
    }

    const filename = `DOSSIER_STARKES_${chapterCode}_RSIA_Melinda.pdf`;

    return new NextResponse(Buffer.from(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  });
});
