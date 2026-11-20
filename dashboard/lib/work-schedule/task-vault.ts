import content from "@/data/content/task-vault.json";
import { ContentFileError, isObject, isString, isStringArray, oneOf, requireFields } from "@/lib/content/content-file";
import type { Instruction } from "../director/director-instructions";
import type { BaselineScheduleSlot, ForumId, StructuralRoleId } from "./baseline-schedule";

export type VaultTaskDomain =
  | "Keuangan"
  | "Farmasi"
  | "Pelayanan"
  | "Casemix"
  | "Umum"
  | "SDM"
  | "IT"
  | "Eksternal";

export type VaultTaskStatus =
  | "selesai"
  | "berjalan"
  | "pending_pihak_ketiga"
  | "butuh_keputusan_direktur"
  | "menunggu_verifikasi_novia";

export interface VaultTask {
  readonly id: string;
  readonly sourceRegister: "ACT-2810" | "ACT-2610" | "ACT-1610" | "PHARM-2610" | "MASTER-LOG" | "HIST-DONE";
  readonly title: string;
  readonly summary: string;
  readonly domain: VaultTaskDomain;
  readonly pic: readonly string[];
  readonly roleIds: readonly StructuralRoleId[];
  readonly targetForums: readonly ForumId[];
  readonly defaultStatus: VaultTaskStatus;
  readonly priority: "P0" | "P1" | "P2";
  readonly deadlineLabel: string;
  readonly thirdPartyName?: string;
  readonly thirdPartyBlocker?: string;
  readonly directorDecisionOption?: {
    readonly code: string;
    readonly optionsLabel: string;
    readonly consequence: string;
  };
  readonly evidenceRequired: string;
}

export interface ResolvedVaultTask extends VaultTask {
  readonly status: VaultTaskStatus;
  readonly latestNote?: string;
  readonly updatedAt?: string;
  readonly updatedBy?: string;
  readonly instructionId?: string;
}

export interface EnrichedScheduleSlot extends BaselineScheduleSlot {
  readonly injectedTasks: readonly ResolvedVaultTask[];
  readonly thirdPartyBlockers: readonly ResolvedVaultTask[];
  readonly directorDecisions: readonly ResolvedVaultTask[];
  readonly combinedTopicSummary: string;
}

const FILE = "task-vault.json";
const DOMAINS: readonly VaultTaskDomain[] = ["Keuangan", "Farmasi", "Pelayanan", "Casemix", "Umum", "SDM", "IT", "Eksternal"];
const STATUSES: readonly VaultTaskStatus[] = ["selesai", "berjalan", "pending_pihak_ketiga", "butuh_keputusan_direktur", "menunggu_verifikasi_novia"];
const REGISTERS: readonly VaultTask["sourceRegister"][] = ["ACT-2810", "ACT-2610", "ACT-1610", "PHARM-2610", "MASTER-LOG", "HIST-DONE"];

function parseTasks(where: string, raw: unknown): readonly VaultTask[] {
  if (!Array.isArray(raw)) throw new ContentFileError(FILE, `${where} is not a list.`);
  const seen = new Set<string>();
  raw.forEach((task, i) => {
    requireFields(
      FILE,
      `${where}[${i}]`,
      task,
      {
        id: (v) => typeof v === "string" && /^[A-Z0-9-]{3,40}$/.test(v),
        sourceRegister: oneOf(REGISTERS),
        title: isString,
        summary: isString,
        domain: oneOf(DOMAINS),
        pic: isStringArray,
        roleIds: isStringArray,
        targetForums: isStringArray,
        defaultStatus: oneOf(STATUSES),
        priority: oneOf(["P0", "P1", "P2"]),
        deadlineLabel: isString,
        evidenceRequired: isString,
      },
      {
        thirdPartyName: isString,
        thirdPartyBlocker: isString,
        directorDecisionOption: (v) => isObject(v) && isString(v.code) && isString(v.optionsLabel) && isString(v.consequence),
      },
    );
    const id = (task as { id: string }).id;
    if (seen.has(id)) throw new ContentFileError(FILE, `${where}: task ${id} appears twice.`);
    seen.add(id);
  });
  return raw as readonly VaultTask[];
}

requireFields(FILE, "root", content, { active: Array.isArray, completed: Array.isArray });

/** Open management tasks (Action Registers and the operational master log), from dashboard/data/content/task-vault.json. */
export const VAULT_TASKS: readonly VaultTask[] = parseTasks("active", content.active);

/** Closed tasks kept for history. */
export const COMPLETED_VAULT_TASKS: readonly VaultTask[] = parseTasks("completed", content.completed);

const VALID_STATUSES: readonly VaultTaskStatus[] = [
  "selesai",
  "berjalan",
  "pending_pihak_ketiga",
  "butuh_keputusan_direktur",
  "menunggu_verifikasi_novia",
];

export function formatFeedbackNote(input: {
  status: VaultTaskStatus;
  thirdPartyName?: string;
  text: string;
}): string {
  const parts = [`[STATUS:${input.status}]`];
  if (input.thirdPartyName?.trim()) {
    parts.push(`[PIHAK3:${input.thirdPartyName.trim()}]`);
  }
  const cleanText = input.text.trim();
  if (cleanText) {
    parts.push(cleanText);
  }
  return parts.join(" ").slice(0, 280);
}

export function parseFeedbackNote(note: string): {
  status: VaultTaskStatus | null;
  thirdPartyName?: string;
  text: string;
} {
  let working = note.trim();
  let status: VaultTaskStatus | null = null;
  let thirdPartyName: string | undefined;

  const statusMatch = working.match(/\[STATUS:([a-z0-9_]+)\]/i);
  if (statusMatch) {
    const candidate = statusMatch[1] as VaultTaskStatus;
    if (VALID_STATUSES.includes(candidate)) {
      status = candidate;
    }
    working = working.replace(statusMatch[0], "").trim();
  }

  const partyMatch = working.match(/\[PIHAK3:([^\]]+)\]/i);
  if (partyMatch) {
    thirdPartyName = partyMatch[1].trim();
    working = working.replace(partyMatch[0], "").trim();
  }

  return { status, thirdPartyName, text: working };
}

function isDirectorOrViceDirectorActor(actorName: string): boolean {
  const lower = actorName.toLowerCase();
  return (
    lower.includes("direktur") ||
    lower.includes("wadir") ||
    lower.includes("wakil direktur") ||
    lower.includes("ferdi") ||
    lower.includes("novia") ||
    lower.includes("widya")
  );
}

export function applyRule39(requestedStatus: VaultTaskStatus, actorIsExecutive: boolean): VaultTaskStatus {
  if (requestedStatus === "selesai" && !actorIsExecutive) {
    return "menunggu_verifikasi_novia";
  }
  return requestedStatus;
}

export function resolveVaultTasks(
  instructions: readonly Instruction[],
  includeCompletedArchive = false
): ResolvedVaultTask[] {
  const sourceList = includeCompletedArchive
    ? [...VAULT_TASKS, ...COMPLETED_VAULT_TASKS]
    : [...VAULT_TASKS];

  const latestByItemId = new Map<string, Instruction>();
  for (const ins of instructions) {
    const existing = latestByItemId.get(ins.itemId);
    if (!existing || ins.createdAt >= existing.createdAt) {
      latestByItemId.set(ins.itemId, ins);
    }
  }

  return sourceList.map((task) => {
    const latest = latestByItemId.get(task.id);
    if (!latest) {
      return { ...task, status: task.defaultStatus };
    }

    const parsed = parseFeedbackNote(latest.note || "");
    const lastHistory = latest.history[latest.history.length - 1];
    const actor = lastHistory?.actor ?? "Direktur";
    const executive = isDirectorOrViceDirectorActor(actor);

    let resolvedStatus: VaultTaskStatus = task.defaultStatus;
    if (parsed.status) {
      resolvedStatus = applyRule39(parsed.status, executive);
    } else if (latest.action === "done" || latest.status === "selesai") {
      resolvedStatus = applyRule39("selesai", executive);
    } else if (latest.action === "defer") {
      resolvedStatus = "pending_pihak_ketiga";
    } else if (latest.action === "escalate") {
      resolvedStatus = "butuh_keputusan_direktur";
    } else if (latest.action === "approve") {
      resolvedStatus = "berjalan";
    }

    return {
      ...task,
      status: resolvedStatus,
      thirdPartyName: parsed.thirdPartyName ?? task.thirdPartyName,
      latestNote: parsed.text || latest.note || undefined,
      updatedAt: latest.createdAt,
      updatedBy: actor,
      instructionId: latest.id,
    };
  });
}

export function injectTasksIntoSchedule(
  slots: readonly BaselineScheduleSlot[],
  tasks: readonly ResolvedVaultTask[]
): EnrichedScheduleSlot[] {
  const activeTasks = tasks.filter((t) => t.status !== "selesai");

  return slots.map((slot) => {
    const matched = activeTasks.filter((task) => {
      if (slot.category === "Break") return false;
      const forumHit = task.targetForums.includes(slot.forumId);
      const domainHit = slot.domains.some((d) => d === task.domain);
      const roleHit = task.roleIds.some((r) => slot.roleIds.includes(r));

      // Specific closed or sync meetings prioritize exact targetForums first
      if (
        slot.forumId.startsWith("tertutup_") ||
        slot.forumId === "sync_layanan_klaim" ||
        slot.forumId.startsWith("forum_")
      ) {
        return forumHit || (domainHit && roleHit && task.priority === "P0");
      }

      if (slot.forumId === "decision_log") {
        return task.status === "butuh_keputusan_direktur" || forumHit;
      }

      if (slot.forumId === "lead_brief" || slot.forumId === "pleno_senin") {
        return task.priority === "P0" || forumHit;
      }

      return forumHit;
    });

    // Sort P0 first, then butuh_keputusan_direktur, then pending_pihak_ketiga
    const priorityRank: Record<VaultTaskStatus, number> = {
      butuh_keputusan_direktur: 0,
      menunggu_verifikasi_novia: 1,
      pending_pihak_ketiga: 2,
      berjalan: 3,
      selesai: 4,
    };

    const sorted = [...matched].sort((a, b) => {
      if (a.priority !== b.priority) return a.priority.localeCompare(b.priority);
      return priorityRank[a.status] - priorityRank[b.status];
    });

    const capped = sorted.slice(0, 6);
    const thirdPartyBlockers = capped.filter((t) => t.status === "pending_pihak_ketiga");
    const directorDecisions = capped.filter((t) => t.status === "butuh_keputusan_direktur");

    const injectedNames = capped.map((t) => `${t.id}: ${t.title}`).join("; ");
    const combinedTopicSummary =
      capped.length > 0
        ? `${slot.baselineAgenda} Bahan injeksi (${capped.length}): ${injectedNames}.`
        : slot.baselineAgenda;

    return {
      ...slot,
      injectedTasks: capped,
      thirdPartyBlockers,
      directorDecisions,
      combinedTopicSummary,
    };
  });
}
