import { conversationResponse, deleteConversationResponse } from "@/lib/melinda/http";
import { guard } from "@/lib/access/guard";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const GET = guard(async (request: Request, { params }: { params: Promise<{ id: string }> }) => { return conversationResponse(request, (await params).id); });
export const DELETE = guard(async (request: Request, { params }: { params: Promise<{ id: string }> }) => { return deleteConversationResponse(request, (await params).id); });
