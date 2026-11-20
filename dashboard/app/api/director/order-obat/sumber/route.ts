import { protectedDirectorMode } from "@/lib/director/director-auth";
import { requirePermission } from "@/lib/access/access-api";
import { apiBoundary } from "@/lib/director/director-api";
import { readPharmacyOrderPdf } from "@/lib/pharmacy/pharmacy-order-pdf";
import { guard } from "@/lib/access/guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Serves the November 2026 procurement PDF to a signed-in Director. Read only. */
export const GET = guard(async (request: Request) => {
  return apiBoundary(async () => {
    if (protectedDirectorMode()) await requirePermission(request, "pharmacy.view");
    const bytes = readPharmacyOrderPdf();
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "inline; filename=\"2026-11-03-pengajuan-order-obat-november.pdf\"",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
});
