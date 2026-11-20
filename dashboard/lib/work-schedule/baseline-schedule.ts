import content from "@/data/content/baseline-schedule.json";
import { ContentFileError, arrayOf, fill, isObject, isString, isStringArray, oneOf, requireFields } from "@/lib/content/content-file";
export type StructuralRoleId =
  | "direktur"
  | "wadir_ops"
  | "wadir_keu_sdm"
  | "kabag_pelayanan"
  | "kabag_umum"
  | "kabag_penunjang"
  | "kepala_sdm"
  | "kepala_keuangan";

export type ForumId =
  | "forum_a_klinis"
  | "forum_b_ops"
  | "forum_c_keuangan"
  | "forum_c_sdm"
  | "pre_brief_wadir"
  | "baca_pre_brief"
  | "lead_brief"
  | "visite_prioritas"
  | "decision_log"
  | "blok_pembayaran"
  | "eksekusi_fokus_pagi"
  | "istirahat_siang"
  | "pleno_senin"
  | "sync_layanan_klaim"
  | "forum_d_ops"
  | "forum_e_keu_sdm"
  | "eksternal_ops_jumat"
  | "jeda_dilindungi"
  | "tertutup_pelayanan"
  | "tertutup_penunjang"
  | "tertutup_umum"
  | "tertutup_keuangan_sdm"
  | "laporan_kepala_fungsi"
  | "update_sore_wadir"
  | "eksternal_direksi"
  | "tertutup_direksi_jumat"
  | "blok_fokus_sore"
  | "monitoring_akhir_pekan";

export interface StructuralRoleProfile {
  readonly id: StructuralRoleId;
  readonly title: string;
  readonly officialName: string;
  readonly shortName: string;
  readonly workHoursWib: string;
  readonly lineReportTo: string;
  readonly scopeSummary: string;
}

export interface LeadBriefRotationInfo {
  readonly weekIndex: 1 | 2 | 3;
  readonly leaderName: string;
  readonly leaderRole: StructuralRoleId;
  readonly dayNameId: string;
}

export interface BaselineScheduleSlot {
  readonly id: string;
  readonly timeRange: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly title: string;
  readonly category: "Preparation" | "Meeting" | "Clinical" | "Focus" | "External" | "Break";
  readonly forumId: ForumId;
  readonly participants: readonly string[];
  readonly roleIds: readonly StructuralRoleId[];
  readonly leadName: string;
  readonly baselineAgenda: string;
  readonly domains: readonly string[];
}


const FILE = "baseline-schedule.json";
const ROLE_IDS: readonly StructuralRoleId[] = [
  "direktur",
  "wadir_ops",
  "wadir_keu_sdm",
  "kabag_pelayanan",
  "kabag_umum",
  "kabag_penunjang",
  "kepala_sdm",
  "kepala_keuangan",
];
const CATEGORIES: readonly BaselineScheduleSlot["category"][] = ["Preparation", "Meeting", "Clinical", "Focus", "External", "Break"];

/** A slot in the content file: the date-dependent id is built here, and the lead brief may use {weekIndex} and {leaderName}. */
type SlotTemplate = Omit<BaselineScheduleSlot, "id" | "roleIds"> & { readonly idSuffix: string; readonly roleIds?: readonly StructuralRoleId[] };

interface ScheduleContent {
  readonly roles: readonly StructuralRoleProfile[];
  readonly weekdays: Readonly<Record<string, readonly SlotTemplate[]>>;
  readonly weekend: readonly SlotTemplate[];
}

function checkSlot(where: string, slot: unknown, needsRoles: boolean): void {
  requireFields(
    FILE,
    where,
    slot,
    {
      idSuffix: (v) => typeof v === "string" && /^[a-z0-9-]+$/.test(v),
      timeRange: isString,
      startTime: isString,
      endTime: isString,
      title: isString,
      category: oneOf(CATEGORIES),
      forumId: isString,
      participants: isStringArray,
      leadName: isString,
      baselineAgenda: isString,
      domains: isStringArray,
      ...(needsRoles ? { roleIds: arrayOf(oneOf(ROLE_IDS)) } : {}),
    },
  );
}

function parseScheduleContent(raw: unknown): ScheduleContent {
  requireFields(FILE, "root", raw, { roles: Array.isArray, weekdays: isObject, weekend: Array.isArray });
  const value = raw as { roles: unknown[]; weekdays: Record<string, unknown>; weekend: unknown[] };
  value.roles.forEach((role, i) =>
    requireFields(FILE, `roles[${i}]`, role, {
      id: oneOf(ROLE_IDS),
      title: isString,
      officialName: isString,
      shortName: isString,
      workHoursWib: isString,
      lineReportTo: isString,
      scopeSummary: isString,
    }),
  );
  for (const id of ROLE_IDS) {
    if (!value.roles.some((role) => (role as { id: string }).id === id)) throw new ContentFileError(FILE, `role ${id} is missing.`);
  }
  for (const day of ["1", "2", "3", "4", "5"]) {
    const slots = value.weekdays[day];
    if (!Array.isArray(slots)) throw new ContentFileError(FILE, `weekdays.${day} is missing.`);
    slots.forEach((slot, i) => checkSlot(`weekdays.${day}[${i}]`, slot, true));
  }
  value.weekend.forEach((slot, i) => checkSlot(`weekend[${i}]`, slot, false));
  return raw as ScheduleContent;
}

const CONTENT = parseScheduleContent(content);

export const STRUCTURAL_ROLES: readonly StructuralRoleProfile[] = CONTENT.roles;

function instantiate(
  template: SlotTemplate,
  dateIso: string,
  roleIds: readonly StructuralRoleId[],
  values: Readonly<Record<string, string | number>>,
): BaselineScheduleSlot {
  const { idSuffix, ...slot } = template;
  return {
    ...slot,
    id: `${dateIso}-${idSuffix}`,
    title: fill(slot.title, values),
    leadName: fill(slot.leadName, values),
    baselineAgenda: fill(slot.baselineAgenda, values),
    participants: slot.participants.map((name) => fill(name, values)),
    roleIds,
  };
}

const DAY_NAMES_ID = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"] as const;

const ROTATION_ANCHOR_UTC = Date.UTC(2026, 8, 7); // Monday 2026-09-07

const LEAD_ROTATION_MATRIX: Record<1 | 2 | 3, Record<number, StructuralRoleId>> = {
  1: { 1: "direktur", 2: "wadir_ops", 3: "wadir_keu_sdm", 4: "direktur", 5: "wadir_ops" },
  2: { 1: "wadir_keu_sdm", 2: "direktur", 3: "wadir_ops", 4: "wadir_keu_sdm", 5: "direktur" },
  3: { 1: "wadir_ops", 2: "wadir_keu_sdm", 3: "direktur", 4: "wadir_ops", 5: "wadir_keu_sdm" },
};

function parseIsoDateUtc(dateIso: string): Date {
  const [y, m, d] = dateIso.split("-").map(Number);
  return new Date(Date.UTC(y || 2026, (m || 1) - 1, d || 1));
}

export function getDayOfWeekUtc(dateIso: string): number {
  return parseIsoDateUtc(dateIso).getUTCDay();
}

export function leadBriefRotation(dateIso: string): LeadBriefRotationInfo {
  const dt = parseIsoDateUtc(dateIso);
  const dow = dt.getUTCDay();
  const dayNameId = DAY_NAMES_ID[dow] ?? "Senin";
  const diffDays = Math.floor((dt.getTime() - ROTATION_ANCHOR_UTC) / 86_400_000);
  const weeksSinceAnchor = Math.floor(diffDays / 7);
  const mod = ((weeksSinceAnchor % 3) + 3) % 3;
  const weekIndex = (mod + 1) as 1 | 2 | 3;

  const weekday = dow >= 1 && dow <= 5 ? dow : 1;
  const leaderRole = LEAD_ROTATION_MATRIX[weekIndex][weekday] ?? "direktur";
  const profile = STRUCTURAL_ROLES.find((r) => r.id === leaderRole);
  return {
    weekIndex,
    leaderName: profile?.shortName ?? "dr. Ferdi Andriska",
    leaderRole,
    dayNameId,
  };
}



function buildWeekdayMasterSlots(dateIso: string): BaselineScheduleSlot[] {
  const rot = leadBriefRotation(dateIso);
  const values = { weekIndex: rot.weekIndex, leaderName: rot.leaderName };
  const templates = CONTENT.weekdays[String(getDayOfWeekUtc(dateIso))] ?? [];
  return templates.map((template) => instantiate(template, dateIso, template.roleIds ?? [], values));
}

function buildWeekendSlots(dateIso: string, roleId: StructuralRoleId): BaselineScheduleSlot[] {
  return CONTENT.weekend.map((template) => instantiate(template, dateIso, [roleId], {}));
}

export function buildBaselineSchedule(
  dateIso: string,
  roleId: StructuralRoleId = "direktur"
): BaselineScheduleSlot[] {
  const dow = getDayOfWeekUtc(dateIso);
  if (dow === 0 || dow === 6) {
    return buildWeekendSlots(dateIso, roleId);
  }
  const master = buildWeekdayMasterSlots(dateIso);
  // Ibu Oriza holds a unified calendar across kabag_umum & kepala_sdm
  if (roleId === "kabag_umum" || roleId === "kepala_sdm") {
    return master.filter(
      (slot) => slot.roleIds.includes("kabag_umum") || slot.roleIds.includes("kepala_sdm")
    );
  }
  return master.filter((slot) => slot.roleIds.includes(roleId));
}
