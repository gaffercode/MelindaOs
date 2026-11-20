import { guard } from "@/lib/access/guard";
import { apiBoundary } from "@/lib/director/director-api";
import { runSatusehatCron } from "@/lib/satusehat/satusehat-sync-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export const GET = guard(async (request: Request) => apiBoundary(() => runSatusehatCron(request)));
