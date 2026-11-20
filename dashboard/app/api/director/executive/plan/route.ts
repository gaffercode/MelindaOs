import { executivePlanResponse } from "@/lib/executive/executive-office-api";
import { guard } from "@/lib/access/guard";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const GET = guard((request: Request) => executivePlanResponse(request));
