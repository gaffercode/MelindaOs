import { apiBoundary } from "@/lib/director/director-api";
import { listAgentDrafts } from "@/lib/agent/agent-draft-review-api";
import { guard } from "@/lib/access/guard";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const GET = guard(async (request: Request) => { return apiBoundary(() => listAgentDrafts(request)); });
