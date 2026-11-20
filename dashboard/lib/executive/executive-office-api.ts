import { requirePermission } from "../access/access-api";
import { apiBoundary, DirectorApiError, jsonResponse } from "../director/director-api";
import { DirectorStoreError } from "../director/director-store";
import { validReportDate, wibDate } from "../director/director-data";
import { buildOfficePlan, type OfficeCalendarRow, type OfficeReadinessRow } from "./executive-office";
import type { DirectorAuthConfiguration } from "../director/director-auth";
import { logError } from "../log";
import { board } from "../tasks/store";
import { buildFallbackOfficePlan } from "../work-schedule/fallbacks";

type Plan = {
  date: string; events: OfficeCalendarRow[]; readiness: OfficeReadinessRow[];
  outbox: { key: string; meetingId: string; kind: string; state: string; recordedAt: string | null }[];
  archives: { meetingId: string; archivedAt: string; minutesUrl: string | null }[];
};
const rpc = "melinda_executive_office";

/** The Director only reads these records here; nothing in MelindaOS writes them any more. */
async function call<T>(config: DirectorAuthConfiguration, command: string, args: Record<string, unknown>): Promise<T> {
  try {
    return await config.store.call<T>(command, args, rpc);
  } catch (error) {
    if (error instanceof DirectorStoreError) {
      if (error.code === "invalid_input") throw new DirectorApiError(400, "Data koordinasi tidak valid.");
      if (error.code === "not_found") throw new DirectorApiError(404, "Agenda atau pengiriman tidak ditemukan.");
      if (error.code === "conflict") throw new DirectorApiError(409, "Versi agenda sudah berubah; sinkronkan kembali.");
      logError("executive_office_store_error", error);
    }
    throw error;
  }
}

/** The day's office plan with each Director meeting's readiness worked out. */
export async function readExecutivePlan(config: DirectorAuthConfiguration, date: string) {
  const plan = await call<Plan>(config, "plan", { date });
  return { ...plan, meetings: buildOfficePlan(plan.events, plan.readiness) };
}

export const executivePlanResponse = (request: Request) => apiBoundary(async () => {
  const { config } = await requirePermission(request, "executive.view");
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some((key) => key !== "date")) throw new DirectorApiError(400, "Parameter tidak valid.");
  const date = params.get("date") ?? wibDate();
  if (!validReportDate(date)) throw new DirectorApiError(400, "Tanggal tidak valid.");
  const plan = await readExecutivePlan(config, date);
  if (plan.events.length === 0) {
    const { instructions } = await board(config, { now: new Date().toISOString() }).catch(() => ({ instructions: [] }));
    const fallback = buildFallbackOfficePlan(date, instructions);
    return jsonResponse({
      ...plan,
      events: fallback.events,
      readiness: fallback.readiness,
      meetings: buildOfficePlan(fallback.events, fallback.readiness),
    });
  }
  return jsonResponse(plan);
});
