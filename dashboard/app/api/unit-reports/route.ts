import { apiBoundary } from "@/lib/director/director-api";
import { submitUnitReport } from "@/lib/unit-report-api";
import { guard } from "@/lib/access/guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const POST = guard(async (request: Request) => { return apiBoundary(() => submitUnitReport(request)); });
