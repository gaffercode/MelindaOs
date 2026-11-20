import { apiBoundary } from "@/lib/director/director-api";
import { listOrderFiles, uploadOrderFile } from "@/lib/pharmacy/order-obat-api";
import { guard } from "@/lib/access/guard";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
export const GET = guard(async (request: Request) => { return apiBoundary(() => listOrderFiles(request)); });
export const POST = guard(async (request: Request) => { return apiBoundary(() => uploadOrderFile(request)); });
