import { guard } from "@/lib/access/guard";
import { requirePermission } from "@/lib/access/access-api";
import { apiBoundary, jsonResponse, rateLimit, readBoundedJson } from "@/lib/director/director-api";
import { wibDate } from "@/lib/director/director-data";
import { syncTodayAllPages } from "@/lib/work-schedule/sync-and-feedback";

export const POST = guard((request: Request) =>
  apiBoundary(async () => {
    const { config, reviewerId } = await requirePermission(request, "executive.view", true);
    const body = (await readBoundedJson(request, 1024)) as { date?: unknown } | null;
    const date = typeof body?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : wibDate();
    // Each call republishes today's brief and news edition, so it is limited per account.
    await rateLimit(config, `sync-today:${reviewerId}`, 12, 3600);
    const result = await syncTodayAllPages(config, date);
    return jsonResponse(result, 200);
  })
);
