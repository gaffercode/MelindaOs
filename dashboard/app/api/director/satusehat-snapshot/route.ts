import { guard } from "@/lib/access/guard";
import { submitSatusehatSnapshot } from "@/lib/daily/daily-documents-api";
import { apiBoundary } from "@/lib/director/director-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = guard(async (request: Request) => apiBoundary(() => submitSatusehatSnapshot(request)));
