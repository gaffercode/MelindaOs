/** Medify date-only values (`YYYY-MM-DD`) as an Indonesian "day short-month" label, read in UTC so the day never shifts. */
export function formatUtcDayMonth(date: string): string {
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

/** Medify month keys (`YYYY-MM`) as an Indonesian "short-month year" label, read in UTC. */
export function formatUtcMonthYear(month: string): string {
  return new Intl.DateTimeFormat("id-ID", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
}
