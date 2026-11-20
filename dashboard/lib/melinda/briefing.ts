import type { ReviewQueue } from "../director/director-api";
import type { DirectorAuthConfiguration } from "../director/director-auth";
import { longDate, wibDate } from "../director/director-data";
import { readExecutivePlan } from "../executive/executive-office-api";
import type { buildOfficePlan } from "../executive/executive-office";
import { MEDIFY_MAX_AGE_MS, SCHEDULE_EXPECTED_BY, SERVICE_HOURS } from "../freshness";
import { logError } from "../log";
import { readMedifySnapshot, type MedifySnapshotResult } from "../medify/medify-snapshot-store";
import { readOrderQueue, type OrderQueue } from "../pharmacy/order-obat-api";
import { forRules, isFinal, isOverdue, reminderState } from "../tasks/rules";
import { board, listSchedule, type BoardInstruction, type ScheduleRow } from "../tasks/store";
import { MELINDA_GREETING } from "./limits";

export { MELINDA_GREETING };
export const BOR_IDEAL_MAX = 85;
const URGENT_LIMIT = 3;

export type ExecutiveMeeting = ReturnType<typeof buildOfficePlan>[number];
export type BriefingSection<T> = { state: "ok"; items: T[] } | { state: "unavailable"; message: string };
export type BriefingScheduleItem = { start: string; end: string | null; title: string; place: string | null; flag: "bentrok" | "belum siap" | null; href: string };
export type BriefingTaskItem = { id: string; title: string; note: string; href: string };
export type BriefingAttention = { text: string; href: string };
export type MelindaBriefing = {
  greeting: string; dateLabel: string; timeLabel: string;
  /** `note` names a schedule source that failed while the other one was read. */
  schedule: { state: "ok"; items: BriefingScheduleItem[]; note?: string } | { state: "unavailable"; message: string };
  tasks: { state: "ok"; waiting: number; overdue: number; urgent: BriefingTaskItem[] } | { state: "unavailable"; message: string };
  attention: BriefingSection<BriefingAttention>;
};
/** `null` always means the source could not be read; an empty list means the day really is empty. */
export type BriefingInput = { schedule: ScheduleRow[] | null; meetings: ExecutiveMeeting[] | null; tasks: BoardInstruction[] | null; orders: OrderQueue | null; pendingReviews: number | null; medify: MedifySnapshotResult | null };

const clock = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const clockOf = (value: Date | string) => clock.format(new Date(value)).replace(":", ".");
const dotted = (value: string) => value.slice(0, 5).replace(":", ".");
const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
const percent = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 });

type Slot = BriefingScheduleItem & { conflict: boolean };

function schedule(rows: ScheduleRow[] | null, meetings: ExecutiveMeeting[] | null): MelindaBriefing["schedule"] {
  if (rows === null && meetings === null) return { state: "unavailable", message: "Data jadwal belum tersedia." };
  const slots = new Map<string, Slot>();
  const add = (slot: Slot) => { const key = `${slot.start}|${slot.title.trim().toLowerCase()}`; if (!slots.has(key)) slots.set(key, slot); };
  // Meetings go first: when Dash lists the same one, the office entry is kept because it knows the readiness.
  for (const item of meetings ?? []) add({ start: clockOf(item.startAt), end: clockOf(item.endAt), title: item.title, place: null, flag: item.readiness === "blocked" ? "belum siap" : null, href: "/#section-01", conflict: item.conflict });
  for (const item of rows ?? []) add({ start: dotted(item.start), end: item.end ? dotted(item.end) : null, title: item.title, place: item.place, flag: null, href: "/#section-01", conflict: false });
  const sorted = [...slots.values()].sort((a, b) => minutes(a.start) - minutes(b.start));
  const items = sorted.map(({ conflict, ...slot }) => {
    const overlaps = sorted.some((other) => other.title !== slot.title && slot.end !== null && other.end !== null && minutes(slot.start) < minutes(other.end) && minutes(other.start) < minutes(slot.end));
    return conflict || overlaps ? { ...slot, flag: "bentrok" as const } : slot;
  });
  const note = rows === null ? "Jadwal Dash belum tersedia." : meetings === null ? "Rapat kantor belum tersedia." : null;
  return note ? { state: "ok", items, note } : { state: "ok", items };
}

function tasks(rows: BoardInstruction[] | null, now: Date): MelindaBriefing["tasks"] {
  if (rows === null) return { state: "unavailable", message: "Data tugas belum tersedia." };
  const nowWib = `${wibDate(now)}T${clockOf(now).replace(".", ":")}`;
  const open = rows.map((row) => ({ row, rules: forRules(row) })).filter(({ rules }) => !isFinal(rules));
  const rank = ({ row, rules }: (typeof open)[number]) => isOverdue(rules, nowWib) ? 0 : row.status === "terkendala" ? 1 : 2;
  const urgent = [...open]
    .filter((item) => rank(item) < 2 || item.row.deadline !== null)
    .sort((a, b) => rank(a) - rank(b) || (a.row.deadline ?? "").localeCompare(b.row.deadline ?? ""))
    .slice(0, URGENT_LIMIT)
    .map(({ row }) => ({ id: row.id, title: row.itemTitle, note: row.note.slice(0, 140), href: "/arahan" }));
  return {
    state: "ok",
    waiting: open.filter(({ row, rules }) => reminderState(rules, now) !== "none" || row.status === "terkendala").length,
    overdue: open.filter(({ rules }) => isOverdue(rules, nowWib)).length,
    urgent,
  };
}

function attention(input: BriefingInput, date: string, now: Date): MelindaBriefing["attention"] {
  if (input.orders === null && input.pendingReviews === null && input.medify === null) return { state: "unavailable", message: "Data perhatian belum tersedia." };
  const reviewHref = `/director-review?tanggal=${date}`;
  const items: BriefingAttention[] = [];
  const time = clockOf(now).replace(".", ":");
  if (input.schedule?.length === 0 && time > SCHEDULE_EXPECTED_BY) items.push({ text: "Jadwal hari ini belum ada; belum ada sumber data otomatis.", href: "/melinda" });
  if (input.orders === null) items.push({ text: "Data order obat belum tersedia.", href: "/order-obat" });
  else {
    const { orders, decisions } = input.orders;
    const undecided = orders.filter((order) => !decisions[order.key]).length;
    if (undecided > 0) items.push({ text: `${undecided} berkas order obat menunggu keputusan.`, href: "/order-obat" });
  }
  if (input.pendingReviews === null) items.push({ text: "Data tinjauan belum tersedia.", href: reviewHref });
  else if (input.pendingReviews > 0) items.push({ text: `${input.pendingReviews} pengajuan menunggu tinjauan.`, href: reviewHref });
  if (input.medify === null) items.push({ text: "Data Medify belum tersedia.", href: "/#section-00" });
  else {
    const { medify } = input;
    if (medify.status === "previous") items.push({ text: `Medify hari ini belum masuk; yang tampil data ${longDate(medify.sourceDate)}.`, href: "/#section-00" });
    else if (medify.status === "current" && time >= SERVICE_HOURS.from && time <= SERVICE_HOURS.to && now.getTime() - Date.parse(medify.receivedAt) > MEDIFY_MAX_AGE_MS) items.push({ text: `Tarikan Medify terakhir pukul ${clockOf(medify.receivedAt)} WIB; tarikan otomatis tampaknya berhenti.`, href: "/#section-00" });
    const bor = input.medify.snapshot?.inpatient?.daily.at(-1)?.bor;
    if (bor !== undefined && bor > BOR_IDEAL_MAX) items.push({ text: `BOR ${percent.format(bor)}% di atas batas ideal ${BOR_IDEAL_MAX}%.`, href: "/#section-00" });
  }
  return { state: "ok", items };
}

/** Pure: what Melinda opens with, composed from real data with no model call. */
export function buildBriefing(input: BriefingInput, now: Date): MelindaBriefing {
  const date = wibDate(now);
  return { greeting: MELINDA_GREETING, dateLabel: longDate(date), timeLabel: `${clockOf(now)} WIB`, schedule: schedule(input.schedule, input.meetings), tasks: tasks(input.tasks, now), attention: attention(input, date, now) };
}

async function readable<T>(name: string, read: () => Promise<T>): Promise<T | null> {
  try { return await read(); } catch (error) { logError(`melinda_briefing_${name}`, error); return null; }
}

/** Reads every source at once; one failing source only blanks its own part. `known` holds sources the caller already read. */
export async function readBriefing(config: DirectorAuthConfiguration, now: Date, known?: Partial<Pick<BriefingInput, "schedule" | "medify">>): Promise<MelindaBriefing> {
  const date = wibDate(now);
  const [scheduleRows, meetings, taskRows, orders, pendingReviews, medify] = await Promise.all([
    known?.schedule !== undefined ? known.schedule : readable("schedule", async () => (await listSchedule(config, { date })).items),
    readable("office", async () => (await readExecutivePlan(config, date)).meetings),
    readable("tasks", async () => (await board(config, { now: now.toISOString() })).instructions),
    readable("orders", () => readOrderQueue(config)),
    readable("reviews", async () => (await config.store.call<ReviewQueue>("review_list", { date, offset: 0 })).pending.length),
    known?.medify !== undefined ? known.medify : readable("medify", () => readMedifySnapshot(date, now)),
  ]);
  return buildBriefing({ schedule: scheduleRows, meetings, tasks: taskRows, orders, pendingReviews, medify }, now);
}
