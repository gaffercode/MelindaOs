import { canonicalHash } from "../director/director-store";
import { validReportDate } from "../director/director-data";
import { findPatientIdentifiers } from "../phi-guard";
import { parseSimrsSnapshot, type SimrsSnapshot } from "../simrs-snapshot";

export type SourceAvailability = "received" | "no_issues" | "unavailable" | "invalid";
export type SourcePeriod = "same_day" | "previous_day";
export type SourceKind = "simrs_export" | "unit_report";

export type NumericField = { key: string; label: string; minimum: number };
export type DailySourceDefinition = {
  id: string;
  label: string;
  kind: SourceKind;
  required: boolean;
  period: SourcePeriod;
  section: "simrsPulse" | "serviceSummary" | "safetyQuality" | "claimsFinance" | "staffing" | "systemFindings" | "emailTriage";
  picRelayTarget: string | null;
  numericFields: NumericField[];
};
export type DailyPipelineRegistry = {
  timezone: "Asia/Jakarta";
  schedules: { collect: string; prepare: string; publish: string; alert: string; revisions: string[] };
  sources: DailySourceDefinition[];
};
export type SourceReportInput = {
  sourceId: string;
  reportDate: string;
  periodDate: string;
  observedAt: string;
  availability: SourceAvailability;
  issues: string;
  followUp: string;
  decisionNeeded: string;
  metrics: Record<string, number>;
  snapshot?: SimrsSnapshot & { diamatiPada?: string; sumber?: string; berkas?: string };
};
export type StoredSourceReport = SourceReportInput & { receivedAt: string; contentHash: string; revision?: number };

export class DailyPipelineValidationError extends Error {
  override readonly name = "DailyPipelineValidationError";
  constructor(public readonly path: string) { super(`Invalid daily pipeline value: ${path}`); }
}

function fail(path: string): never { throw new DailyPipelineValidationError(path); }
function closed(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail(path);
  const result = value as Record<string, unknown>;
  for (const key of Object.keys(result)) if (!keys.includes(key)) fail(`${path}.${key}`);
  return result;
}
function text(value: unknown, path: string, max: number, required = true): string {
  if (typeof value !== "string" || value.length > max || /[\u0000-\u001f\u007f]/.test(value) || (required && !value.trim())) fail(path);
  return value;
}
function clock(value: unknown, path: string): string {
  const parsed = text(value, path, 5);
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(parsed)) fail(path);
  return parsed;
}
function priorDate(date: string): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

export function parseDailyPipelineRegistry(value: unknown): DailyPipelineRegistry {
  const root = closed(value, "registry", ["timezone", "schedules", "sources"]);
  if (root.timezone !== "Asia/Jakarta") fail("registry.timezone");
  const schedule = closed(root.schedules, "registry.schedules", ["collect", "prepare", "publish", "alert", "revisions"]);
  if (!Array.isArray(schedule.revisions) || schedule.revisions.length !== 2) fail("registry.schedules.revisions");
  const schedules = {
    collect: clock(schedule.collect, "registry.schedules.collect"),
    prepare: clock(schedule.prepare, "registry.schedules.prepare"),
    publish: clock(schedule.publish, "registry.schedules.publish"),
    alert: clock(schedule.alert, "registry.schedules.alert"),
    revisions: schedule.revisions.map((entry, index) => clock(entry, `registry.schedules.revisions[${index}]`)),
  };
  if (!Array.isArray(root.sources) || root.sources.length === 0 || root.sources.length > 50) fail("registry.sources");
  const seen = new Set<string>();
  const sources = root.sources.map((entry, index): DailySourceDefinition => {
    const path = `registry.sources[${index}]`;
    const source = closed(entry, path, ["id", "label", "kind", "required", "period", "section", "picRelayTarget", "numericFields"]);
    const id = text(source.id, `${path}.id`, 40);
    if (!/^[a-z][a-z0-9_-]{1,39}$/.test(id) || seen.has(id)) fail(`${path}.id`);
    seen.add(id);
    if (source.kind !== "simrs_export" && source.kind !== "unit_report") fail(`${path}.kind`);
    if (source.period !== "same_day" && source.period !== "previous_day") fail(`${path}.period`);
    const sections = ["simrsPulse", "serviceSummary", "safetyQuality", "claimsFinance", "staffing", "systemFindings", "emailTriage"] as const;
    if (!sections.includes(source.section as typeof sections[number])) fail(`${path}.section`);
    if (typeof source.required !== "boolean") fail(`${path}.required`);
    if (source.picRelayTarget !== null && (typeof source.picRelayTarget !== "string" || source.picRelayTarget.length > 120 || !source.picRelayTarget.trim())) fail(`${path}.picRelayTarget`);
    if (!Array.isArray(source.numericFields) || source.numericFields.length > 30) fail(`${path}.numericFields`);
    const metricKeys = new Set<string>();
    const numericFields = source.numericFields.map((field, fieldIndex): NumericField => {
      const fieldPath = `${path}.numericFields[${fieldIndex}]`;
      const item = closed(field, fieldPath, ["key", "label", "minimum"]);
      const key = text(item.key, `${fieldPath}.key`, 40);
      if (!/^[a-z][a-z0-9_]{0,39}$/.test(key) || metricKeys.has(key)) fail(`${fieldPath}.key`);
      metricKeys.add(key);
      if (typeof item.minimum !== "number" || !Number.isFinite(item.minimum)) fail(`${fieldPath}.minimum`);
      return { key, label: text(item.label, `${fieldPath}.label`, 80), minimum: item.minimum };
    });
    return { id, label: text(source.label, `${path}.label`, 80), kind: source.kind, required: source.required, period: source.period, section: source.section as DailySourceDefinition["section"], picRelayTarget: source.picRelayTarget as string | null, numericFields };
  });
  return { timezone: "Asia/Jakarta", schedules, sources };
}

export function parseSourceReport(value: unknown, source: DailySourceDefinition, now = new Date()): SourceReportInput {
  const report = closed(value, "report", ["sourceId", "reportDate", "periodDate", "observedAt", "availability", "issues", "followUp", "decisionNeeded", "metrics", "snapshot"]);
  if (report.sourceId !== source.id) fail("report.sourceId");
  if (typeof report.reportDate !== "string" || !validReportDate(report.reportDate)) fail("report.reportDate");
  const expectedPeriod = source.period === "same_day" ? report.reportDate : priorDate(report.reportDate);
  if (report.periodDate !== expectedPeriod) fail("report.periodDate");
  const observedAt = text(report.observedAt, "report.observedAt", 35);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(observedAt)) fail("report.observedAt");
  const observedMs = Date.parse(observedAt);
  if (!Number.isFinite(observedMs) || observedMs > now.getTime() + 5 * 60_000) fail("report.observedAt");
  const observedWibDate = new Date(observedMs + 7 * 60 * 60_000).toISOString().slice(0, 10);
  if (source.period === "same_day" && observedWibDate !== report.reportDate) fail("report.observedAt");
  if (source.period === "previous_day" && observedWibDate !== report.reportDate && observedWibDate !== expectedPeriod) fail("report.observedAt");
  const availability = report.availability;
  if (!(["received", "no_issues", "unavailable", "invalid"] as unknown[]).includes(availability)) fail("report.availability");
  const issues = text(report.issues, "report.issues", 2_000, false);
  const followUp = text(report.followUp, "report.followUp", 2_000, false);
  const decisionNeeded = text(report.decisionNeeded, "report.decisionNeeded", 2_000, false);
  const found = [issues, followUp, decisionNeeded].flatMap(findPatientIdentifiers);
  if (found.length) fail("report.patient_identifier");
  const metricInput = closed(report.metrics, "report.metrics", source.numericFields.map((field) => field.key));
  const metrics: Record<string, number> = {};
  for (const [key, metric] of Object.entries(metricInput)) {
    const definition = source.numericFields.find((field) => field.key === key);
    if (!definition || typeof metric !== "number" || !Number.isFinite(metric) || metric < definition.minimum) fail(`report.metrics.${key}`);
    metrics[key] = metric;
  }
  let snapshot: SourceReportInput["snapshot"];
  if (report.snapshot !== undefined) {
    if (source.kind !== "simrs_export" || !parseSimrsSnapshot(report.snapshot, report.reportDate)) fail("report.snapshot");
    snapshot = structuredClone(report.snapshot) as SourceReportInput["snapshot"];
  }
  return { sourceId: source.id, reportDate: report.reportDate, periodDate: expectedPeriod, observedAt, availability: availability as SourceAvailability, issues, followUp, decisionNeeded, metrics, ...(snapshot ? { snapshot } : {}) };
}

export function semanticReportHash(report: SourceReportInput | StoredSourceReport): string {
  return canonicalHash({ sourceId: report.sourceId, reportDate: report.reportDate, periodDate: report.periodDate, availability: report.availability, issues: report.issues, followUp: report.followUp, decisionNeeded: report.decisionNeeded, metrics: report.metrics, ...(report.snapshot ? { snapshot: report.snapshot } : {}) });
}

export function reportCompletesSource(report: Pick<SourceReportInput, "availability" | "periodDate" | "reportDate">, source: DailySourceDefinition): boolean {
  const expected = source.period === "same_day" ? report.reportDate : priorDate(report.reportDate);
  return report.periodDate === expected && (report.availability === "received" || report.availability === "no_issues");
}
