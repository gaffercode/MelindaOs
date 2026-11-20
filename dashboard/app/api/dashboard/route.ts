import { NextResponse } from "next/server";
import { getDashboardData } from "@/lib/repository";
import { protectedDirectorMode } from "@/lib/director/director-auth";
import { requirePermission } from "@/lib/access/access-api";
import { apiBoundary } from "@/lib/director/director-api";
import { logError } from "@/lib/log";
import { guard } from "@/lib/access/guard";

export const dynamic = "force-dynamic";

export const GET = guard(async (request?: Request) => {
  if (protectedDirectorMode()) {
    const denied = await apiBoundary(async () => { await requirePermission(request ?? new Request("https://local.invalid"), "executive.view"); return new Response(null, { status: 204 }); });
    if (denied.status !== 204) return denied;
  }
  try {
    return NextResponse.json(await getDashboardData(), { headers: { "Cache-Control": "no-store" } });
  } catch (error: unknown) {
    logError(error instanceof Error && error.message === "knowledge_index_missing" ? "knowledge_index_missing" : "dashboard_read", error);
    return NextResponse.json({ error: "Dashboard data unavailable" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
});
