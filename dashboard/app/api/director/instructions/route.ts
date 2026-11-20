import { apiBoundary } from "@/lib/director/director-api";
import { createInstruction, listInstructions } from "@/lib/director/director-instructions-api";
import { guard } from "@/lib/access/guard";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
export const GET = guard(async (request: Request) => { return apiBoundary(() => listInstructions(request)); });
export const POST = guard(async (request: Request) => { return apiBoundary(() => createInstruction(request)); });
