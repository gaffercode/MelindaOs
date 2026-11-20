import { guard } from "@/lib/access/guard";
import { requirePermission } from "@/lib/access/access-api";
import { apiBoundary, jsonResponse } from "@/lib/director/director-api";
import { wibDate } from "@/lib/director/director-data";
import { syncTodayAllPages } from "@/lib/work-schedule/sync-and-feedback";

export const POST = guard((request: Request) =>
  apiBoundary(async () => {
    const { config } = await requirePermission(request, "executive.view", true);
    const body = (await request.json().catch(() => ({}))) as { date?: string };
    const date = typeof body?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : wibDate();
    const result = await syncTodayAllPages(config, date);
    return jsonResponse(result, 200);
  })
);
