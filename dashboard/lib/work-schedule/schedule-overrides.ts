import type { DirectorAuthConfiguration } from "../director/director-auth";
import { validReportDate } from "../director/director-data";
import { DirectorStoreError } from "../director/director-store";
import { logError } from "../log";
import { STRUCTURAL_ROLES, type BaselineScheduleSlot, type StructuralRoleId } from "./baseline-schedule";

/**
 * A change to one day of one structural role's schedule. The baseline stays a template; a change is stored as an
 * override and applied on every read and on every sync, so the Sync button cannot undo it.
 */
export type ScheduleChangeKind = "add" | "move" | "cancel";
export type ScheduleChange = {
  date: string; role: StructuralRoleId; kind: ScheduleChangeKind;
  /** The slot a move or cancel targets: a baseline slot id or `ovr-<id>` of an added one. */
  slotId: string | null;
  start: string | null; end: string | null; title: string | null; place: string | null; note: string;
};
export type ScheduleOverride = ScheduleChange & { id: string; createdAt: string };

const RPC = "melinda_schedule_overrides";
const HHMM = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const KINDS: Record<string, ScheduleChangeKind> = { tambah: "add", pindah: "move", batal: "cancel", add: "add", move: "move", cancel: "cancel" };

export class ScheduleChangeError extends Error { override readonly name = "ScheduleChangeError"; }
const reject = (message: string): never => { throw new ScheduleChangeError(message); };

function optionalText(value: unknown, max: number, label: string): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.trim().length > max || /[\u0000-\u001f\u007f]/.test(value)) return reject(`${label} tidak valid.`);
  return value.trim() || null;
}
function clock(value: unknown, label: string): string | null {
  if (value == null || value === "") return null;
  return typeof value === "string" && HHMM.test(value.trim()) ? value.trim() : reject(`${label} harus berbentuk HH:MM.`);
}

/** Model input (Indonesian keys) to a checked change. */
export function parseScheduleChange(input: Record<string, unknown>, today: string): ScheduleChange {
  const kind = (typeof input.jenis === "string" ? KINDS[input.jenis] : undefined) ?? reject("Jenis perubahan harus tambah, pindah, atau batal.");
  const role = input.jabatan == null ? "direktur" : STRUCTURAL_ROLES.find((item) => item.id === input.jabatan)?.id ?? reject("Jabatan tidak dikenal.");
  const date = typeof input.tanggal === "string" && input.tanggal ? input.tanggal : today;
  if (!validReportDate(date)) reject("Tanggal tidak valid.");
  const slotId = optionalText(input.slot_id, 80, "Slot");
  const start = clock(input.mulai, "Jam mulai");
  const end = clock(input.selesai, "Jam selesai");
  const title = optionalText(input.judul, 200, "Judul");
  const place = optionalText(input.tempat, 120, "Tempat");
  const note = optionalText(input.catatan, 200, "Catatan") ?? "";
  if (kind !== "add" && !slotId) reject("Sebutkan slot_id rapat yang diubah (baca jadwalnya dulu).");
  if (kind === "add" && (!start || !title)) reject("Rapat baru butuh jam mulai dan judul.");
  if (kind === "move" && !start) reject("Pindah jadwal butuh jam mulai baru.");
  if (start && end && end <= start) reject("Jam selesai harus setelah jam mulai.");
  return { date, role, kind, slotId: kind === "add" ? null : slotId, start, end, title, place, note };
}

const range = (start: string, end: string) => `${start} - ${end}`;
const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
const clockOf = (total: number) => { const capped = Math.min(total, 23 * 60 + 59); return `${String(Math.floor(capped / 60)).padStart(2, "0")}:${String(capped % 60).padStart(2, "0")}`; };
/** An added meeting without an end time is booked for 30 minutes. */
const endOf = (change: Pick<ScheduleChange, "start" | "end">, length = 30) => change.end ?? clockOf(minutes(change.start ?? "00:00") + length);

/** Applies a day's overrides, oldest first, and returns the slots in time order. */
export function applyOverrides(slots: readonly BaselineScheduleSlot[], overrides: readonly ScheduleOverride[]): BaselineScheduleSlot[] {
  let result = [...slots];
  for (const change of [...overrides].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (change.kind === "cancel") result = result.filter((slot) => slot.id !== change.slotId);
    else if (change.kind === "move") {
      result = result.map((slot) => {
        if (slot.id !== change.slotId || !change.start) return slot;
        const endTime = endOf(change, Math.max(minutes(slot.endTime) - minutes(slot.startTime), 15));
        return { ...slot, startTime: change.start, endTime, timeRange: range(change.start, endTime), title: change.title ?? slot.title };
      });
    } else if (change.start && change.title) {
      const endTime = endOf(change);
      result.push({
        id: `ovr-${change.id}`, timeRange: range(change.start, endTime), startTime: change.start, endTime, title: change.title,
        category: "Meeting", forumId: "eksternal_direksi", participants: [], roleIds: [change.role], leadName: "",
        baselineAgenda: [change.place, change.note].filter(Boolean).join(". ") || "Agenda tambahan dari Direktur.", domains: [],
      });
    }
  }
  return result.sort((a, b) => a.startTime.localeCompare(b.startTime));
}

/** Slots of the changed day that overlap the new time, so the Director sees a clash before confirming. */
export function clashes(change: ScheduleChange, slots: readonly BaselineScheduleSlot[]): BaselineScheduleSlot[] {
  const start = change.start;
  if (!start) return [];
  const target = slots.find((slot) => slot.id === change.slotId);
  const end = endOf(change, target ? Math.max(minutes(target.endTime) - minutes(target.startTime), 15) : 30);
  return slots.filter((slot) => slot.id !== change.slotId && slot.category !== "Break" && slot.startTime < end && slot.endTime > start);
}

export function scheduleChangeSummary(change: ScheduleChange, slots: readonly BaselineScheduleSlot[]): string {
  const who = STRUCTURAL_ROLES.find((role) => role.id === change.role);
  const owner = who ? `${who.title} (${who.officialName})` : change.role;
  const target = change.slotId ? slots.find((slot) => slot.id === change.slotId) : undefined;
  if (change.kind !== "add" && !target) reject(`Slot ${change.slotId} tidak ada di jadwal ${change.date}.`);
  const when = change.start ? `${change.start}${change.end ? `-${change.end}` : ""}` : "";
  const text = change.kind === "add" ? `Tambah rapat "${change.title}" ${when} di jadwal ${owner}, ${change.date}${change.place ? `, ${change.place}` : ""}.`
    : change.kind === "move" ? `Pindah "${target?.title}" dari ${target?.timeRange} ke ${when} di jadwal ${owner}, ${change.date}${change.title ? `, judul baru "${change.title}"` : ""}${change.place ? `, tempat ${change.place}` : ""}.`
    : `Batalkan "${target?.title}" ${target?.timeRange} di jadwal ${owner}, ${change.date}.`;
  const overlap = clashes(change, slots);
  const note = change.note ? ` Catatan: "${change.note}".` : "";
  return `${text}${note}${overlap.length ? ` Bentrok dengan: ${overlap.map((slot) => `${slot.title} (${slot.timeRange})`).join("; ")}.` : ""}`.slice(0, 600);
}

/** Overrides of one day; an empty list while the migration is not applied yet, so reads never break. */
export async function readScheduleOverrides(config: DirectorAuthConfiguration | null, date: string, role?: StructuralRoleId): Promise<ScheduleOverride[]> {
  if (!config) return [];
  try {
    return (await config.store.call<{ overrides: ScheduleOverride[] }>("list", { date, ...(role ? { role } : {}) }, RPC)).overrides;
  } catch (error) {
    if (!(error instanceof DirectorStoreError && error.code === "missing_function")) logError("schedule_overrides_read", error);
    return [];
  }
}

export async function storeScheduleOverride(config: DirectorAuthConfiguration, { change, key, producer }: { change: ScheduleChange; key: string; producer: string }): Promise<ScheduleOverride> {
  return (await config.store.call<{ override: ScheduleOverride }>("add", { ...change, key, producer }, RPC)).override;
}
