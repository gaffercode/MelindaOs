import { apiBoundary } from "@/lib/director/director-api";
import { getMelindaBrief } from "@/lib/daily/daily-documents-api";
import { guard } from "@/lib/access/guard";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const GET = guard(async (request: Request) => { return apiBoundary(() => getMelindaBrief(request)); });
