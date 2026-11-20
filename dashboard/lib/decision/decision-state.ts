export type DecisionPriority = "critical" | "high" | "medium" | "low";
export type DecisionStatus = "local_draft" | "locally_resolved";

export interface Decision {
  id: string;
  title: string;
  priority: DecisionPriority;
  owner: string;
  dueDate: string;
  recommendation: string;
  status: DecisionStatus;
  resolutionReason: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuditEvent {
  id: string;
  correlationId: string;
  occurredAt: string;
  actor: "human";
  action: "create" | "edit" | "resolve" | "reopen" | "purge";
  decisionId: string;
  before: Decision | null;
  after: Decision | null;
  reason: string;
}

export interface DecisionState {
  decisions: Decision[];
  audit: AuditEvent[];
}

export type DecisionAction =
  | { type: "create"; decision: Decision; eventId: string; correlationId: string }
  | { type: "edit"; decision: Decision; eventId: string; correlationId: string }
  | { type: "resolve"; id: string; reason: string; at: string; eventId: string; correlationId: string }
  | { type: "reopen"; id: string; at: string; eventId: string; correlationId: string }
  | { type: "purge"; at: string; eventId: string; correlationId: string };

export const initialDecisionState: DecisionState = { decisions: [], audit: [] };

export function validDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function event(
  action: AuditEvent["action"],
  decisionId: string,
  before: Decision | null,
  after: Decision | null,
  reason: string,
  eventId: string,
  correlationId: string,
  occurredAt: string,
): AuditEvent {
  return { id: eventId, correlationId, occurredAt, actor: "human", action, decisionId, before, after, reason };
}

export function validateDecision(decision: Decision): string[] {
  const errors: string[] = [];
  if (!decision.title.trim()) errors.push("Judul wajib diisi.");
  if (!decision.owner.trim()) errors.push("Owner wajib diisi.");
  if (!validDateOnly(decision.dueDate)) errors.push("Tanggal jatuh tempo harus valid.");
  if (!decision.recommendation.trim()) errors.push("Rekomendasi wajib diisi.");
  if (decision.title.length > 120) errors.push("Judul maksimal 120 karakter.");
  if (decision.recommendation.length > 600) errors.push("Rekomendasi maksimal 600 karakter.");
  if (decision.owner.length > 120) errors.push("Owner maksimal 120 karakter.");
  if (!["critical", "high", "medium", "low"].includes(decision.priority)) errors.push("Priority tidak valid.");
  if (!["local_draft", "locally_resolved"].includes(decision.status)) errors.push("Status tidak valid.");
  if (!decision.id.trim() || !Number.isFinite(Date.parse(decision.createdAt)) || !Number.isFinite(Date.parse(decision.updatedAt))) errors.push("Identitas atau waktu keputusan tidak valid.");
  return errors;
}

export function decisionReducer(state: DecisionState, action: DecisionAction): DecisionState {
  if (action.type === "purge") {
    return {
      decisions: [],
      audit: [event("purge", "all", null, null, "Local prototype data purged", action.eventId, action.correlationId, action.at)],
    };
  }

  if (action.type === "create") {
    if (validateDecision(action.decision).length || state.decisions.some((item) => item.id === action.decision.id)) return state;
    return {
      decisions: [action.decision, ...state.decisions],
      audit: [event("create", action.decision.id, null, action.decision, "Decision created", action.eventId, action.correlationId, action.decision.createdAt), ...state.audit],
    };
  }

  const current = state.decisions.find((item) => item.id === (action.type === "edit" ? action.decision.id : action.id));
  if (!current) return state;

  let next: Decision;
  let reason: string;
  if (action.type === "edit") {
    if (validateDecision(action.decision).length) return state;
    next = { ...action.decision, createdAt: current.createdAt, status: current.status, resolutionReason: current.resolutionReason };
    reason = "Decision edited";
  } else if (action.type === "resolve") {
    if (current.status !== "local_draft" || !action.reason.trim() || action.reason.trim().length > 400 || !Number.isFinite(Date.parse(action.at))) return state;
    next = { ...current, status: "locally_resolved", resolutionReason: action.reason.trim(), updatedAt: action.at };
    reason = action.reason.trim();
  } else {
    if (current.status !== "locally_resolved" || !Number.isFinite(Date.parse(action.at))) return state;
    next = { ...current, status: "local_draft", resolutionReason: "", updatedAt: action.at };
    reason = "Decision reopened";
  }

  const actionName = action.type;
  return {
    decisions: state.decisions.map((item) => (item.id === next.id ? next : item)),
    audit: [event(actionName, next.id, current, next, reason, action.eventId, action.correlationId, next.updatedAt), ...state.audit],
  };
}
