import { guard } from "@/lib/access/guard";
import { handleMcpGet, handleMcpPost } from "@/lib/mcp/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export const GET = guard(async (request: Request) => handleMcpGet(request));
export const POST = guard(async (request: Request) => handleMcpPost(request));
