import { NextResponse } from "next/server";
import { loadKnowledgeDocuments, searchDocuments } from "@/lib/repository";
import { protectedDirectorMode } from "@/lib/director/director-auth";
import { requirePermission } from "@/lib/access/access-api";
import { apiBoundary } from "@/lib/director/director-api";
import { logError } from "@/lib/log";
import { guard } from "@/lib/access/guard";

export const dynamic = "force-dynamic";

export const GET = guard(async (request: Request) => {
  if (protectedDirectorMode()) {
    const denied = await apiBoundary(async () => { await requirePermission(request, "knowledge.ask"); return new Response(null, { status: 204 }); });
    if (denied.status !== 204) return denied;
  }
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length > 120) return NextResponse.json({ error: "Query terlalu panjang." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  if (!query) return NextResponse.json({ query, results: [] }, { headers: { "Cache-Control": "no-store" } });
  try {
    const results = searchDocuments(await loadKnowledgeDocuments(), query);
    return NextResponse.json({ query, results }, { headers: { "Cache-Control": "no-store" } });
  } catch (error: unknown) {
    logError(error instanceof Error && error.message === "knowledge_index_missing" ? "knowledge_index_missing" : "knowledge_search", error);
    return NextResponse.json({ error: "Search unavailable" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
});
