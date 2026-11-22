import { guard } from "@/lib/access/guard";
import { apiBoundary } from "@/lib/director/director-api";
import { createClinical } from "@/lib/clinical/clinical-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = guard(async (request: Request) => apiBoundary(() => createClinical(request)));
