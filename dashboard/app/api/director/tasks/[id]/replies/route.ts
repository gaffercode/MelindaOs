import { repliesResponse } from "@/lib/director/director-tasks-api";
import { guard } from "@/lib/access/guard";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const GET = guard(async (request: Request, { params }: { params: Promise<{ id: string }> }) => { return repliesResponse(request, (await params).id); });
