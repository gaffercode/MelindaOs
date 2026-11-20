import { NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
import { protectedDirectorMode } from "@/lib/director/director-auth";
import { apiBoundary, DirectorApiError, readBoundedJson } from "@/lib/director/director-api";
import { requirePermission } from "@/lib/access/access-api";
import { auditByEpId, buildChapterDossierPayload } from "@/lib/starkes/build-dossier-payload";
import { listStarkesAuditScores } from "@/lib/starkes/audit-store";
import { CHAPTERS } from "@/lib/starkes/ep-status";
import { buildStarkesDossierPdf } from "@/lib/pdf/build-starkes-dossier";
import { guard } from "@/lib/access/guard";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 512_000;

export const POST = guard(async (req: Request) => {
  return apiBoundary(async () => {
    if (protectedDirectorMode()) await requirePermission(req, "starkes.use", true);
    await readBoundedJson(req, MAX_BODY_BYTES); // body is no longer used: scores come from the Director's audit

    const auditMap = auditByEpId(await listStarkesAuditScores());
    const merged = await PDFDocument.create();

    for (const chapterCode of Object.keys(CHAPTERS)) {
      const payload = buildChapterDossierPayload(chapterCode, auditMap);
      const chapterPdf = await buildStarkesDossierPdf(payload);
      const loaded = await PDFDocument.load(chapterPdf);
      const pages = await merged.copyPages(loaded, loaded.getPageIndices());
      pages.forEach((page) => merged.addPage(page));
    }

    if (merged.getPageCount() === 0) throw new DirectorApiError(500, "Gagal mengompilasi binder STARKES.");
    const pdfBuffer = await merged.save();

    return new NextResponse(Buffer.from(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'inline; filename="DOSSIER_STARKES_SEMUA_BAB_RSIA_Melinda.pdf"',
        "Cache-Control": "no-store",
      },
    });
  });
});
