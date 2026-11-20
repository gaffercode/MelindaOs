import { apiBoundary } from "@/lib/director/director-api";
import { exchangeUnitReportCapability, resumeUnitReportCapability } from "@/lib/unit-report-api";
import { guard } from "@/lib/access/guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const GET = guard(async (request: Request) => { return apiBoundary(() => resumeUnitReportCapability(request)); });
export const POST = guard(async (request: Request) => { return apiBoundary(() => exchangeUnitReportCapability(request)); });
