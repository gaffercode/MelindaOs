import { apiBoundary } from "@/lib/director/director-api";
import { downloadAnswers } from "@/lib/director/director-answers-api";
import { guard } from "@/lib/access/guard";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const GET = guard(async (request: Request) => { return apiBoundary(() => downloadAnswers(request)); });
