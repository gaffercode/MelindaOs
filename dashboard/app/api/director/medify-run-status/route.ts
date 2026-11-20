import { apiBoundary } from "@/lib/director/director-api";
import { submitMedifyRunStatus } from "@/lib/daily/daily-documents-api";
import { guard } from "@/lib/access/guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = guard(async (request: Request) => { return apiBoundary(() => submitMedifyRunStatus(request)); });
