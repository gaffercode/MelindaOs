import { validateDecision, type Decision, type DecisionPriority } from "./decision-state";

export function saveDecisionForm(form: Pick<FormData, "get">, existing: Decision | undefined, at: string, id: string, onSave: (decision: Decision) => void): string[] {
  const next: Decision = {
    id: existing?.id ?? id,
    title: String(form.get("title") ?? "").trim(),
    priority: String(form.get("priority") ?? "medium") as DecisionPriority,
    owner: String(form.get("owner") ?? "").trim(),
    dueDate: String(form.get("dueDate") ?? ""),
    recommendation: String(form.get("recommendation") ?? "").trim(),
    status: existing?.status ?? "local_draft",
    resolutionReason: existing?.resolutionReason ?? "",
    createdAt: existing?.createdAt ?? at,
    updatedAt: at,
  };
  const errors = validateDecision(next);
  if (!errors.length) onSave(next);
  return errors;
}
