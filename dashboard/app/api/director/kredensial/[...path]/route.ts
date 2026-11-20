import { protectedDirectorMode } from "@/lib/director/director-auth";
import { requirePermission } from "@/lib/access/access-api";
import { apiBoundary, DirectorApiError } from "@/lib/director/director-api";
import { documentPath, signedFileUrl, storageConfiguration } from "@/lib/kredensial/kredensial-storage";
import { guard } from "@/lib/access/guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Redirects a Director to a short-lived signed URL for one credentialing file; the bytes never pass through this function. */
export const GET = guard(async (request: Request, context: { params: Promise<{ path: string[] }> }) => {
  return apiBoundary(async () => {
    if (protectedDirectorMode()) await requirePermission(request, "credentials.view");
    const { path: segments } = await context.params;
    const path = documentPath(segments.map((segment) => { try { return decodeURIComponent(segment); } catch { return segment; } }));
    if (!path) throw new DirectorApiError(404, "Berkas tidak ditemukan.");
    const config = storageConfiguration();
    if (!config) throw new DirectorApiError(503, "Penyimpanan berkas belum diaktifkan.");
    const download = new URL(request.url).searchParams.get("unduh") === "1" ? path.slice(path.lastIndexOf("/") + 1) : undefined;
    const location = await signedFileUrl(path, { ...config, download });
    return new Response(null, { status: 302, headers: { Location: location, "Cache-Control": "no-store" } });
  });
});
