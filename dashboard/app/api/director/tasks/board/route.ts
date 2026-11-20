import { boardResponse } from "@/lib/director/director-tasks-api";
import { guard } from "@/lib/access/guard";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
export const GET = guard((request: Request) => boardResponse(request));
