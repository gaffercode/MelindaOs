import { apiBoundary } from "@/lib/director/director-api";
import { draftInstructions } from "@/lib/instruction/instruction-draft-api";
import { guard } from "@/lib/access/guard";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;
export const POST = guard(async (request: Request) => { return apiBoundary(async () => draftInstructions(request)); });
