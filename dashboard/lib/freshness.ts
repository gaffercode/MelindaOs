/** Scheduled Medify pulls are 06:00 and 18:00 WIB. Thirteen hours covers that 12-hour gap plus slack, so a check between pulls does not order an extra one. */
export const MEDIFY_MAX_AGE_MS = 13 * 60 * 60_000;
/** WIB window in which a Medify pull is expected to keep arriving. */
export const SERVICE_HOURS = { from: "07:00", to: "21:00" };
/** WIB time after which the Director's schedule for today should have arrived. */
export const SCHEDULE_EXPECTED_BY = "08:00";
