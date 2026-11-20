import { requirePermission } from "@/lib/access/access-api";
import { apiBoundary, DirectorApiError, jsonResponse, rateLimit } from "@/lib/director/director-api";
import { syncDrive } from "@/lib/starkes/drive-sync";
import { guard } from "@/lib/access/guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export const POST = guard(async (request: Request) => {
  return apiBoundary(async () => {
    const { config, principal, reviewerId } = await requirePermission(request, "starkes.use", true);
    if (principal.role !== "DIRECTOR") throw new DirectorApiError(403, "Hanya Direktur yang dapat menyinkronkan Google Drive.");
    await rateLimit(config, `drive-sync:${reviewerId}`, 6, 3600);
    return jsonResponse(await syncDrive());
  });
});
