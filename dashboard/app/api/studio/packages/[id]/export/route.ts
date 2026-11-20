import { apiBoundary, DirectorApiError, objectBody, readBoundedJson } from "@/lib/director/director-api";
import { studioActor, expectedRevision, packageId, boundedText } from "@/lib/studio/api";
import { evaluatePackage, packageRevisionHash } from "@/lib/studio/assemble-package";
import { loadRequirementRegister } from "@/lib/starkes/requirements";
import { loadStudioSourceSnapshot } from "@/lib/studio/source-snapshot";
import { studioStore } from "@/lib/studio/store";
import { documentFilename, exportDocument } from "@/lib/studio/export-document";
import { guard } from "@/lib/access/guard";

export const runtime = "nodejs";
export const POST = guard(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  return apiBoundary(async () => {
    await studioActor(request, true); const id = packageId((await context.params).id);
    const body = objectBody(await readBoundedJson(request, 16_384), ["documentId", "mode", "format", "expectedRevision"]);
    const docId = boundedText(body.documentId, 100); const rev = expectedRevision(body.expectedRevision);
    if (!["preview", "final"].includes(String(body.mode)) || !["pdf", "markdown"].includes(String(body.format))) throw new DirectorApiError(400, "Format ekspor tidak valid.");
    const pkg = await studioStore().get(id); const source = await loadStudioSourceSnapshot();
    if (pkg.revision !== rev || (body.mode === "final" && pkg.snapshotHash !== source.hash)) throw new DirectorApiError(409, "Revisi atau sumber paket berubah.");
    if (body.mode === "final") {
      if (!["ready_for_signature", "signed"].includes(pkg.status) || pkg.finalizedHash !== packageRevisionHash(pkg)) throw new DirectorApiError(422, "Paket belum siap tanda tangan.");
      if (evaluatePackage(pkg, source, loadRequirementRegister()).some((i) => i.severity === "blocker")) throw new DirectorApiError(422, "Pemeriksaan paket belum selesai.");
    }
    const doc = pkg.documents.find((d) => d.id === docId);
    if (!doc) throw new DirectorApiError(404, "Dokumen tidak ditemukan.");
    const output = await exportDocument(doc, body.mode as "preview" | "final");
    const pdf = body.format === "pdf";
    return new Response(pdf ? Buffer.from(output.pdf) : output.markdown, { headers: {
      "Content-Type": pdf ? "application/pdf" : "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="${documentFilename(doc, pdf ? "pdf" : "markdown")}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    } });
  });
});
