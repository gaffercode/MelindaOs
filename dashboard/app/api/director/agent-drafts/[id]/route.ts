import { apiBoundary } from "@/lib/director/director-api";
import { decideAgentDraft, readAgentDraft } from "@/lib/agent/agent-draft-review-api";
import { guard } from "@/lib/access/guard";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const GET = guard(async (request: Request, { params }: { params: Promise<{ id: string }> }) => { return apiBoundary(async () => readAgentDraft(request, (await params).id)); });
export const POST = guard(async (request: Request, { params }: { params: Promise<{ id: string }> }) => { return apiBoundary(async () => decideAgentDraft(request, (await params).id)); });
