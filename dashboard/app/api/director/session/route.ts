import { apiBoundary, getSession, loginSession, logoutSession } from "@/lib/director/director-api";
import { guard } from "@/lib/access/guard";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const GET = guard(async (request: Request) => { return apiBoundary(() => getSession(request)); });
export const POST = guard(async (request: Request) => { return apiBoundary(() => loginSession(request)); });
export const DELETE = guard(async (request: Request) => { return apiBoundary(() => logoutSession(request)); });
