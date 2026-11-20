import { validReportDate } from "./director/director-data";
import { authConfiguration, protectedDirectorMode } from "./director/director-auth";
import { logError } from "./log";
import { listSchedule, type ScheduleRow } from "./tasks/store";

export type DashScheduleForBrief = { items: ScheduleRow[] } | null;

/**
 * Read the Dash schedule for exactly `date` for the home table. No lookback: an older
 * day's schedule is never shown as today. Returns null in file mode, when the secure
 * configuration is missing, or when the store cannot be read, so the caller falls back
 * to the published brief. Never throws and never writes.
 */
export async function readDashScheduleForBrief(date: string): Promise<DashScheduleForBrief> {
  if (!validReportDate(date) || !protectedDirectorMode()) return null;
  let config: NonNullable<ReturnType<typeof authConfiguration>>;
  try {
    const loaded = authConfiguration();
    if (!loaded) return null;
    config = loaded;
  } catch {
    return null;
  }
  try {
    const { items } = await listSchedule(config, { date });
    return { items };
  } catch (error) {
    logError("dash_schedule_brief_read", error);
    return null;
  }
}
