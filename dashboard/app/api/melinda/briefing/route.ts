import { briefingResponse } from "@/lib/melinda/http";
import { guard } from "@/lib/access/guard";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
export const GET = guard((request: Request) => briefingResponse(request));
