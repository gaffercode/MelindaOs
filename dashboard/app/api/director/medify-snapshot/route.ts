import { apiBoundary } from "@/lib/director/director-api";
import { submitMedifySnapshot } from "@/lib/daily/daily-documents-api";
import { guard } from "@/lib/access/guard";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 180;
export const POST = guard(async (request: Request) => { return apiBoundary(() => submitMedifySnapshot(request)); });
