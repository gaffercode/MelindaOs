import type { MelindaScheduleEntry } from "./melinda/melinda-brief-data";
import type { ScheduleRow } from "./tasks/store";

/**
 * Display cap for one Dash agenda title on the home table. The Dash contract already
 * limits titles to 200 characters, so this only guards the display; the stored row
 * is never edited.
 */
export const DASH_SCHEDULE_TITLE_DISPLAY_LIMIT = 200;

/** `09:00` → `09.00` (matches the brief table and the board clock). */
export function dotClock(value: string): string {
  return value.slice(0, 5).replace(":", ".");
}

/**
 * Map Dash schedule rows (the `schedule_list` store shape) onto home-table entries.
 * Sorted by position, then start time. No history is attached: the rows carry no
 * task ids, so Director statuses and remarks start fresh per date and source.
 * The follow-up cell reads only the optional `topic` field; `place` stays on the
 * board meta and is never copied into the home-table topic column. Missing or
 * older rows without `topic` render an empty cell — details are never invented.
 */
export function dashScheduleToBriefEntries(items: ScheduleRow[]): MelindaScheduleEntry[] {
  return [...items]
    .sort((left, right) => left.position - right.position || left.start.localeCompare(right.start))
    .map((item) => ({
      waktu: item.end ? `${dotClock(item.start)}–${dotClock(item.end)}` : dotClock(item.start),
      kegiatan:
        item.title.length > DASH_SCHEDULE_TITLE_DISPLAY_LIMIT
          ? `${item.title.slice(0, DASH_SCHEDULE_TITLE_DISPLAY_LIMIT - 1)}…`
          : item.title,
      siapa: item.pic.length > 0 ? item.pic.join(" / ") : "-",
      topikTindakLanjut: item.topic ?? "",
    }));
}
