import { validateDecision, type Decision, type DecisionState } from "./decision-state";

export const STORAGE_KEY = "melindaos.command-pulse.v1";

interface StorageResult {
  state: DecisionState;
  writable: boolean;
  error: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decision(value: unknown): value is Decision {
  if (!record(value)) return false;
  const fields = ["id", "title", "owner", "priority", "dueDate", "recommendation", "status", "resolutionReason", "createdAt", "updatedAt"];
  if (!fields.every((key) => typeof value[key] === "string")) return false;
  return validateDecision(value as unknown as Decision).length === 0;
}

export function isDecisionState(value: unknown): value is DecisionState {
  if (!record(value) || !Array.isArray(value.decisions) || !Array.isArray(value.audit)) return false;
  if (!value.decisions.every(decision) || new Set(value.decisions.map((item) => item.id)).size !== value.decisions.length) return false;
  return value.audit.every((item: unknown) => {
    if (!record(item)) return false;
    return ["id", "correlationId", "occurredAt", "decisionId", "reason"].every((key) => typeof item[key] === "string")
      && Number.isFinite(Date.parse(String(item.occurredAt)))
      && item.actor === "human"
      && ["create", "edit", "resolve", "reopen", "purge"].includes(String(item.action))
      && (item.before === null || decision(item.before))
      && (item.after === null || decision(item.after));
  });
}

export function readDecisionState(storage: Pick<Storage, "getItem">, fallback: DecisionState): StorageResult {
  try {
    const saved = storage.getItem(STORAGE_KEY);
    if (saved === null) return { state: fallback, writable: true, error: "" };
    const parsed: unknown = JSON.parse(saved);
    if (!isDecisionState(parsed)) throw new Error("Invalid local state");
    return { state: parsed, writable: true, error: "" };
  } catch {
    return {
      state: fallback, writable: false,
      error: "Data browser tidak dapat dibaca. Data asli tidak ditimpa; perubahan hanya berlaku pada sesi ini. Audit → Purge dapat meresetnya setelah konfirmasi.",
    };
  }
}
