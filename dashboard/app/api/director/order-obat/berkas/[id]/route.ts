import { apiBoundary } from "@/lib/director/director-api";
import { openOrderFile, readOrderFile, removeOrderFile } from "@/lib/pharmacy/order-obat-api";
import { guard } from "@/lib/access/guard";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** `?buka=1` redirects to a signed Storage URL; otherwise the metadata and parsed CSV rows come back as JSON. */
export const GET = guard(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const { id } = await context.params;
  return apiBoundary(() => new URL(request.url).searchParams.get("buka") === "1" ? openOrderFile(request, id) : readOrderFile(request, id));
});
/** Removes the file (upload: object and row; built-in sheet: marked removed) together with its decision. */
export const DELETE = guard(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const { id } = await context.params;
  return apiBoundary(() => removeOrderFile(request, id));
});
