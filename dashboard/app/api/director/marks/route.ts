import { apiBoundary } from "@/lib/director/director-api";
import { listMarks, saveMarks } from "@/lib/director/director-marks-api";
import { guard } from "@/lib/access/guard";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const GET = guard(async (request: Request) => { return apiBoundary(() => listMarks(request)); });
export const POST = guard(async (request: Request) => { return apiBoundary(() => saveMarks(request)); });
