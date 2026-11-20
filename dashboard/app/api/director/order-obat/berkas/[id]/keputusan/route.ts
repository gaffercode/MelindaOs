import { apiBoundary } from "@/lib/director/director-api";
import { decideOrderFile } from "@/lib/pharmacy/order-obat-api";
import { guard } from "@/lib/access/guard";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** Body `{ keputusan: "diterima" | "ditolak" | null, catatan? }`: the Director's decision on one submission file. */
export const POST = guard(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const { id } = await context.params;
  return apiBoundary(() => decideOrderFile(request, id));
});
