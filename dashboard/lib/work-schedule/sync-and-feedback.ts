import { composeFullExecutiveBrief } from "../composer/compose";
import { detectFacts } from "../composer/facts";
import { readSatusehatSnapshot } from "../satusehat/satusehat-snapshot-store";
import { satusehatOAuthConfigured } from "../satusehat/satusehat-oauth-client";
import { pullAndStoreSatusehatSnapshot } from "../satusehat/satusehat-sync-api";
import { submitDailyDocument } from "../daily/daily-documents";
import { canonicalHash } from "../director/director-store";
import type { DirectorAuthConfiguration } from "../director/director-auth";
import { wibDate } from "../director/director-data";
import type { Instruction, InstructionAction } from "../director/director-instructions";
import { logError } from "../log";
import type { MedifySnapshot } from "../medify/medify-snapshot-contract";
import { composeNewsEdition } from "../news/news-composer";
import type { ScheduleItemInput } from "../tasks/contract";
import { board, replaceSchedule } from "../tasks/store";
import { buildEnrichedScheduleForRole } from "./fallbacks";
import {
  VAULT_TASKS,
  applyRule39,
  formatFeedbackNote,
  type VaultTaskStatus,
} from "./task-vault";

export interface VaultFeedbackRequest {
  readonly date?: string;
  readonly taskId: string;
  readonly status: VaultTaskStatus;
  readonly note?: string;
  readonly thirdPartyName?: string;
  readonly pic?: readonly string[];
  readonly actorRole: string;
  readonly actorLabel: string;
  readonly scheduleSlotId?: string | null;
}

export interface VaultFeedbackResult {
  readonly taskId: string;
  readonly requestedStatus: VaultTaskStatus;
  readonly resolvedStatus: VaultTaskStatus;
  readonly rule39Applied: boolean;
  readonly instructionId: string;
}

function isExecutiveRole(role: string): boolean {
  const upper = role.toUpperCase();
  return upper === "DIRECTOR" || upper === "VICE_DIRECTOR";
}

function actionForStatus(status: VaultTaskStatus): InstructionAction {
  switch (status) {
    case "selesai":
      return "done";
    case "pending_pihak_ketiga":
      return "defer";
    case "butuh_keputusan_direktur":
      return "escalate";
    case "menunggu_verifikasi_novia":
      return "request_update";
    case "berjalan":
    default:
      return "approve";
  }
}

export async function submitVaultTaskFeedback(
  config: DirectorAuthConfiguration,
  input: VaultFeedbackRequest
): Promise<VaultFeedbackResult> {
  const task = VAULT_TASKS.find((t) => t.id === input.taskId);
  if (!task) {
    throw new Error(`Tugas '${input.taskId}' tidak ditemukan di Task Vault.`);
  }

  const executive = isExecutiveRole(input.actorRole);
  const resolvedStatus = applyRule39(input.status, executive);
  const rule39Applied = resolvedStatus !== input.status;

  const formattedNote = formatFeedbackNote({
    status: resolvedStatus,
    thirdPartyName: input.thirdPartyName ?? task.thirdPartyName,
    text:
      input.note?.trim() ||
      (rule39Applied
        ? "Dilaporkan selesai oleh staf; menunggu verifikasi dr. Novia (Rule #39)."
        : `Status diperbarui menjadi ${resolvedStatus}.`),
  });

  const picList = input.pic && input.pic.length > 0 ? [...input.pic] : [...task.pic];
  const instructionPayload = {
    reportDate: input.date ?? wibDate(),
    section: "followUps" as const,
    itemId: task.id,
    itemTitle: task.title.slice(0, 140),
    urgent: task.priority === "P0",
    action: actionForStatus(resolvedStatus),
    deadline: null,
    pic: picList.slice(0, 8),
    note: formattedNote,
    decisionOptionId: resolvedStatus === "selesai" ? "OPT-DONE" : null,
    decisionLabel: resolvedStatus,
    scheduleItemId: input.scheduleSlotId ?? null,
  };

  const { instruction } = await config.store.call<{ instruction: Instruction }>(
    "create",
    {
      ...instructionPayload,
      reviewerId: input.actorLabel,
      key: `vault-${task.id}-${Date.now()}`,
      requestHash: canonicalHash(instructionPayload),
    },
    "melinda_director_instructions"
  );

  return {
    taskId: task.id,
    requestedStatus: input.status,
    resolvedStatus,
    rule39Applied,
    instructionId: instruction.id,
  };
}

export { buildEnrichedScheduleForRole, buildFallbackBoardSchedule, buildFallbackOfficePlan } from "./fallbacks";

export interface SyncTodayResult {
  readonly date: string;
  readonly scheduleCount: number;
  readonly openTasksCount: number;
  readonly thirdPartyCount: number;
  readonly waitingNoviaCount: number;
  readonly briefComposed: boolean;
  readonly newsComposed: boolean;
}

export async function syncTodayAllPages(
  config: DirectorAuthConfiguration,
  date = wibDate(),
  snapshot: MedifySnapshot | null = null
): Promise<SyncTodayResult> {
  const nowIso = new Date().toISOString();
  const { instructions } = await board(config, { now: nowIso }).catch(() => ({
    instructions: [] as Instruction[],
  }));

  const { slots, tasks } = buildEnrichedScheduleForRole(date, "direktur", instructions);
  const scheduleItems: ScheduleItemInput[] = slots.map((slot) => ({
    start: slot.startTime,
    end: slot.endTime,
    title: slot.title.slice(0, 120),
    place: "RSIA Melinda DHAI",
    pic: [...slot.participants].slice(0, 8),
    topic: slot.combinedTopicSummary.slice(0, 280),
  }));

  try {
    await replaceSchedule(config, { date, items: scheduleItems, producer: "melinda-sync-today" });
  } catch (error) {
    logError("sync_today_replace_schedule", error);
  }

  const satusehatRead = await readSatusehatSnapshot(date);
  let satusehatSnapshot = satusehatRead.snapshot;
  // Best effort: when today's SATUSEHAT pull is missing, the manual sync fetches it so the brief matches the cron cycle.
  if (satusehatRead.status !== "current" && date === wibDate() && satusehatOAuthConfigured()) {
    try {
      satusehatSnapshot = (await pullAndStoreSatusehatSnapshot({ config, producerId: "melinda-sync-today", keyPrefix: "satusehat-sync" })).snapshot;
    } catch (error) {
      logError("sync_today_satusehat", error);
    }
  }
  const facts = snapshot ? detectFacts(snapshot, satusehatSnapshot) : [];
  const brief = composeFullExecutiveBrief({
    date,
    snapshot,
    satusehatSnapshot,
    facts,
    narrative: null,
    instructions,
    roleId: "direktur",
  });

  let briefComposed = false;
  try {
    await submitDailyDocument(config, "management_brief", {
      producerId: "melinda-sync-today",
      key: `sync-brief-${date}-${Date.now()}`,
      date,
      payload: brief,
    });
    briefComposed = true;
  } catch (error) {
    logError("sync_today_brief", error);
  }

  const edition = composeNewsEdition({ date, snapshot, instructions });
  let newsComposed = false;
  try {
    await submitDailyDocument(config, "news_edition", {
      producerId: "melinda-sync-today",
      key: `sync-news-${date}-${Date.now()}`,
      date,
      payload: edition,
    });
    newsComposed = true;
  } catch (error) {
    logError("sync_today_news", error);
  }

  const openTasks = tasks.filter((t) => t.status !== "selesai");
  return {
    date,
    scheduleCount: scheduleItems.length,
    openTasksCount: openTasks.length,
    thirdPartyCount: openTasks.filter((t) => t.status === "pending_pihak_ketiga").length,
    waitingNoviaCount: openTasks.filter((t) => t.status === "menunggu_verifikasi_novia").length,
    briefComposed,
    newsComposed,
  };
}
