import { apiBoundary } from "@/lib/director/director-api";
import { downloadAgentDraft } from "@/lib/agent/agent-draft-review-api";
import { guard } from "@/lib/access/guard";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const GET = guard(async (request: Request, { params }: { params: Promise<{ id: string }> }) => { return apiBoundary(async () => downloadAgentDraft(request, (await params).id)); });
