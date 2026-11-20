import { createAccount, listAccounts } from "@/lib/access/access-api";
import { apiBoundary } from "@/lib/director/director-api";
import { guard } from "@/lib/access/guard";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const GET = guard(async (request: Request) => { return apiBoundary(() => listAccounts(request)); });
export const POST = guard(async (request: Request) => { return apiBoundary(() => createAccount(request)); });
