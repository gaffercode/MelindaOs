import { conversationsResponse } from "@/lib/melinda/http";
import { guard } from "@/lib/access/guard";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const GET = guard((request: Request) => conversationsResponse(request));
