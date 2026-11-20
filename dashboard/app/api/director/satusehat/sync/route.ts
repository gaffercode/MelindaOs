import { guard } from "@/lib/access/guard";
import { apiBoundary } from "@/lib/director/director-api";
import { syncSatusehatLive } from "@/lib/satusehat/satusehat-sync-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = guard(async (request: Request) => apiBoundary(() => syncSatusehatLive(request)));
