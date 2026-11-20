import { chatResponse } from "@/lib/melinda/chat-http";
import { guard } from "@/lib/access/guard";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;
export const POST = guard((request: Request) => chatResponse(request));
