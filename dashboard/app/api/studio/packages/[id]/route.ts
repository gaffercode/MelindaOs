import { apiBoundary, DirectorApiError, objectBody, readBoundedJson } from "@/lib/director/director-api";
import { studioActor, boundedText, editedDocuments, expectedRevision, packageId } from "@/lib/studio/api";
import { evaluatePackage, packageRevisionHash } from "@/lib/studio/assemble-package";
import { loadRequirementRegister } from "@/lib/starkes/requirements";
import { loadStudioSourceSnapshot } from "@/lib/studio/source-snapshot";
import { studioStore } from "@/lib/studio/store";
import { guard } from "@/lib/access/guard";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export const GET = guard(async (request: Request, context: Context) => {
  return apiBoundary(async () => {
    await studioActor(request); const id = packageId((await context.params).id);
    const pkg = await studioStore().get(id);
    pkg.issues = evaluatePackage(pkg, await loadStudioSourceSnapshot(), loadRequirementRegister());
    return Response.json({ package: pkg }, { headers: { "Cache-Control": "private, no-store" } });
  });
});
export const POST = guard(async (request: Request, context: Context) => {
  return apiBoundary(async () => {
    const actor = await studioActor(request, true); const id = packageId((await context.params).id);
    const raw = objectBody(await readBoundedJson(request, 512_000), ["command", "expectedRevision"], ["documents", "requestId", "issueDate", "evidenceRef", "signedAt"]);
    const rev = expectedRevision(raw.expectedRevision);
    const allowed: Record<string, string[]> = { save: ["documents"], review: [], finalize: ["requestId", "issueDate"], confirm_signed: ["evidenceRef", "signedAt"] };
    if (typeof raw.command !== "string" || !Object.hasOwn(allowed, raw.command)) throw new DirectorApiError(400, "Perintah Studio tidak valid.");
    objectBody(raw, ["command", "expectedRevision", ...allowed[raw.command]]);
    if (raw.command !== "save" && new TextEncoder().encode(JSON.stringify(raw)).length > 16_384) throw new DirectorApiError(413, "Ukuran perintah melebihi batas.");
    const store = studioStore();
    let pkg;
    if (raw.command === "finalize") pkg = await store.finalize(id, rev, boundedText(raw.requestId, 128), boundedText(raw.issueDate, 10), actor);
    else if (raw.command === "confirm_signed") pkg = await store.confirmSigned(id, rev, boundedText(raw.evidenceRef, 1000), boundedText(raw.signedAt, 40), actor);
    else {
      const current = await store.get(id);
      if (raw.command === "save") pkg = await store.save({ ...current, documents: editedDocuments(raw.documents, current.documents) }, rev, actor);
      else pkg = await store.review(id, rev, packageRevisionHash(current), actor);
    }
    pkg.issues = evaluatePackage(pkg, await loadStudioSourceSnapshot(), loadRequirementRegister());
    return Response.json({ package: pkg }, { headers: { "Cache-Control": "no-store" } });
  });
});
