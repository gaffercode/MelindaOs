import { requirePermission } from "@/lib/access/access-api";
import { apiBoundary, DirectorApiError, jsonResponse, objectBody, readBoundedJson } from "@/lib/director/director-api";
import { protectedDirectorMode } from "@/lib/director/director-auth";
import { decideBatch, listEvidence } from "@/lib/starkes/evidence-store";
import { guard } from "@/lib/access/guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = guard(async (request: Request) => {
  return apiBoundary(async () => {
    if (protectedDirectorMode()) await requirePermission(request, "starkes.use");
    return jsonResponse({ evidence: await listEvidence() });
  });
});

export const POST = guard(async (request: Request) => {
  return apiBoundary(async () => {
    if (protectedDirectorMode()) {
      const { principal } = await requirePermission(request, "starkes.use", true);
      if (principal.role !== "DIRECTOR") throw new DirectorApiError(403, "Hanya Direktur yang dapat menyetujui bukti.");
    }
    const body = objectBody(await readBoundedJson(request, 65_536), ["ids", "status"]);
    const ids = body.ids;
    if (!Array.isArray(ids) || !ids.length || ids.length > 500 || !ids.every((id) => typeof id === "string" && UUID.test(id))) {
      throw new DirectorApiError(400, "Daftar bukti tidak valid.");
    }
    if (body.status !== "approved" && body.status !== "rejected") throw new DirectorApiError(400, "Keputusan tidak valid.");
    await decideBatch(ids, body.status);
    return jsonResponse({ ok: true });
  });
});
