import { NextResponse } from "next/server";
import { protectedDirectorMode } from "@/lib/director/director-auth";
import { apiBoundary, DirectorApiError, readBoundedJson, requireConfiguration, requireHuman } from "@/lib/director/director-api";
import { buildStudioPdf, type StudioDocType } from "@/lib/pdf/build-studio-pdf";
import { guard } from "@/lib/access/guard";

const MAX_BODY_BYTES = 256_000;

export const runtime = "nodejs";

export const POST = guard(async (req: Request) => {
  return apiBoundary(async () => {
    if (protectedDirectorMode()) await requireHuman(req, requireConfiguration(), true);
    const body = await readBoundedJson(req, MAX_BODY_BYTES);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new DirectorApiError(400, "Format permintaan tidak valid.");
    const { docType, data } = body as { docType?: unknown; data?: { title?: unknown; tentang?: unknown } };

    if (typeof docType !== "string" || !["spo", "sk", "form"].includes(docType)) {
      return NextResponse.json({ error: "docType harus 'spo', 'sk', atau 'form'" }, { status: 400 });
    }

    let pdfBuffer: Uint8Array;
    try {
      pdfBuffer = await buildStudioPdf(docType as StudioDocType, { ...(data ?? {}), status: "DRAF UNTUK KOREKSI" });
    } catch (error) {
      console.error("[STUDIO GENERATE ERROR]", error instanceof Error ? error.message : error);
      return NextResponse.json({ error: "Gagal mengompilasi dokumen PDF" }, { status: 500 });
    }

    const filename = `${docType.toUpperCase()}_${data?.title || data?.tentang || "RSIA_Melinda"}`.replace(
      /[^a-zA-Z0-9_-]/g,
      "_"
    ) + ".pdf";

    return new NextResponse(Buffer.from(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "no-store",
        "X-Melinda-Document-Mode": "preview",
      },
    });
  });
});
