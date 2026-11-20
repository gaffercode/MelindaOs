import { requirePermission } from "@/lib/access/access-api";
import { apiBoundary, DirectorApiError } from "@/lib/director/director-api";
import { protectedDirectorMode } from "@/lib/director/director-auth";
import { buildStarkesKitPdf } from "@/lib/pdf/build-starkes-kit";
import { loadChapterKits } from "@/lib/starkes/kits";
import { guard } from "@/lib/access/guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export const GET = guard(async (request: Request) => {
  return apiBoundary(async () => {
    if (protectedDirectorMode()) await requirePermission(request, "starkes.use");
    const params = new URL(request.url).searchParams;
    const chapter = params.get("chapter") ?? "";
    const kits = /^[A-Z]{2,12}$/.test(chapter) ? await loadChapterKits(chapter) : null;
    if (!kits) throw new DirectorApiError(400, "Kode bab tidak valid.");
    const ep = params.get("ep");
    const selected = ep ? kits.filter((kit) => kit.epId === ep) : kits;
    if (!selected.length) throw new DirectorApiError(404, "EP tidak ditemukan di bab ini.");
    const pdf = await buildStarkesKitPdf(selected, chapter);
    const name = `kit-starkes-${chapter}${ep ? `-${ep.split(":").slice(2).join("-")}` : ""}.pdf`;
    return new Response(Buffer.from(pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "private, no-store" },
    });
  });
});
