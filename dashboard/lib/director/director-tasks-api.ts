import { requirePermission } from "../access/access-api";
import { apiBoundary, DirectorApiError, jsonResponse } from "./director-api";
import { wibDate } from "./director-data";
import { instructionStatuses, type Instruction } from "./director-instructions";
import { buildTaskRecapPdf } from "../pdf/build-task-recap";
import { boardSummary, forRules, isOverdue, reminderState } from "../tasks/rules";
import { archive, board, listReplies, listSchedule, vaultLedger } from "../tasks/store";
import { buildFallbackBoardSchedule } from "../work-schedule/fallbacks";
import { readScheduleOverrides } from "../work-schedule/schedule-overrides";
import { resolveVaultTasks } from "../work-schedule/task-vault";

const DAY = 86_400_000;
const statuses: readonly string[] = [...instructionStatuses, "ditunda", "dibatalkan"];
const bad = () => new DirectorApiError(400, "Format permintaan tidak valid.");

/** WIB wall clock as `YYYY-MM-DDTHH:mm` (the instruction deadline format). */
export function wibStamp(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export const boardResponse = (request: Request) => apiBoundary(async () => {
  const { config } = await requirePermission(request, "executive.view");
  const now = new Date();
  const todayWib = wibDate(now);
  const [boardResult, scheduleResult, ledger, overrides] = await Promise.all([
    board(config, { now: now.toISOString() }), listSchedule(config, { date: todayWib }), vaultLedger(config, { now: now.toISOString() }),
    readScheduleOverrides(config, todayWib, "direktur"),
  ]);
  const nowWib = wibStamp(now);
  const rules = boardResult.instructions.map(forRules);
  const tasks = boardResult.instructions.map((item, index) => ({ ...item, overdue: isOverdue(rules[index], nowWib), reminder: reminderState(rules[index], now) }));
  const schedule = scheduleResult.items.length > 0 ? scheduleResult.items : buildFallbackBoardSchedule(todayWib, ledger, overrides);
  const vaultTasks = resolveVaultTasks(ledger);
  return jsonResponse({
    summary: boardSummary(rules, now, nowWib),
    schedule,
    tasks,
    vaultTasks,
  });
});

const isoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

export const archiveResponse = (request: Request) => apiBoundary(async () => {
  const { config } = await requirePermission(request, "executive.view");
  const params = new URL(request.url).searchParams;
  const dari = params.get("dari"), sampai = params.get("sampai"), q = params.get("q"), pic = params.get("pic"), status = params.get("status"), semua = params.get("semua"), halamanText = params.get("halaman") ?? "1";
  if (dari !== null && !isoDate(dari)) throw bad();
  if (sampai !== null && !isoDate(sampai)) throw bad();
  if (dari && sampai && (sampai < dari || Date.parse(sampai) - Date.parse(dari) > 366 * DAY)) throw bad();
  if (q !== null && q.length > 120) throw bad();
  if (pic !== null && pic.length > 60) throw bad();
  if (status !== null && !statuses.includes(status)) throw bad();
  if (!/^\d{1,4}$/.test(halamanText) || Number(halamanText) < 1 || Number(halamanText) > 1000) throw bad();
  if (semua !== null && semua !== "1") throw bad();
  const halaman = Number(halamanText);
  const result = await archive(config, {
    now: new Date().toISOString(), ...(dari ? { from: dari } : {}), ...(sampai ? { to: sampai } : {}), ...(q ? { q } : {}), ...(pic ? { pic } : {}), ...(status ? { status } : {}), offset: (halaman - 1) * 50, ...(semua === "1" ? { all: true } : {}),
  });
  return jsonResponse({ rows: result.instructions, halaman, adaLagi: result.hasMore });
});

/** Every reply on one task, for the archive's expanded row. */
export const repliesResponse = (request: Request, id: string) => apiBoundary(async () => {
  const { config } = await requirePermission(request, "executive.view");
  if (!/^IOC-\d{4,9}$/.test(id)) throw new DirectorApiError(400, "Format id arahan tidak valid.");
  const { replies } = await listReplies(config, { instructionIds: [id] });
  return jsonResponse({ replies });
});

export const MAX_RECAP_PAGES = 20;

/** Every instruction of the month (any status), sorted by date then id; 503 rather than a truncated list past the page cap. */
export async function collectRecapItems(config: Parameters<typeof archive>[0], bulan: string, now: string): Promise<Instruction[]> {
  const from = `${bulan}-01`;
  const to = new Date(Date.UTC(Number(bulan.slice(0, 4)), Number(bulan.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const byId = new Map<string, Instruction>();
  for (let page = 0; ; page += 1) {
    if (page >= MAX_RECAP_PAGES) throw new DirectorApiError(503, "Rekap terlalu besar; hubungi admin.");
    const result = await archive(config, { now, from, to, offset: page * 50, all: true });
    for (const item of result.instructions) byId.set(item.id, item);
    if (!result.hasMore) break;
  }
  return [...byId.values()].sort((a, b) => a.reportDate.localeCompare(b.reportDate) || a.id.localeCompare(b.id));
}

export const recapResponse = (request: Request) => apiBoundary(async () => {
  const { config } = await requirePermission(request, "executive.view");
  const bulan = new URL(request.url).searchParams.get("bulan") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(bulan) || bulan > wibDate().slice(0, 7)) throw new DirectorApiError(400, "Bulan tidak valid.");
  const pdf = await buildTaskRecapPdf(bulan, await collectRecapItems(config, bulan, new Date().toISOString()));
  return new Response(Buffer.from(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="rekap-arahan-${bulan}.pdf"`, "Cache-Control": "no-store" },
  });
});
