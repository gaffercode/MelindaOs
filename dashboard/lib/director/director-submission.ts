import { parseDirectorDay, validReportDate, wibDate, wibTime, type DirectorDay } from "./director-data";
import schemaDocument from "../../schemas/director-submission-v2.schema.json";

export type ProvenanceGroup = "schedule" | "agenda" | "priorities" | "decisions" | "followUps" | "dailyReport" | "inpatient" | "outpatient" | "emergency" | "systems" | "notes";
export type SourceProvenance = { sourceObservedAt: string; periodStart: string; periodEnd: string; cutoff: string | null; source: { label: string; reference: string }; metricDefinitions: Record<string, string> };
export type DirectorSubmission = { brief: DirectorDay; provenance: Partial<Record<ProvenanceGroup, SourceProvenance>> };
export class SubmissionValidationError extends Error {
  constructor(public readonly paths: string[]) { super(`Format submission tidak valid: ${paths.join(", ")}`); this.name = "SubmissionValidationError"; }
}
type Schema = { $ref?: string; const?: unknown; enum?: unknown[]; type?: string; anyOf?: Schema[]; properties?: Record<string, Schema>; required?: string[]; additionalProperties?: boolean | Schema; propertyNames?: Schema; maxProperties?: number; items?: Schema; minItems?: number; maxItems?: number; minimum?: number; maximum?: number; pattern?: string; maxLength?: number };
const schema = schemaDocument as Schema & { $defs: Record<string, Schema> };
const groups: ProvenanceGroup[] = ["schedule", "agenda", "priorities", "decisions", "followUps", "dailyReport", "inpatient", "outpatient", "emergency", "systems", "notes"];
function invalid(path: string): never { throw new SubmissionValidationError([path]); }
function childPath(path: string, key: string): string { return `${path}.${/^[a-zA-Z0-9_-]{1,80}$/.test(key) ? key : "[unknown]"}`; }
function matches(value: unknown, rule: Schema, path: string): void {
  if (rule.$ref) return matches(value, schema.$defs[rule.$ref.split("/").at(-1)!], path);
  if (rule.anyOf) { for (const candidate of rule.anyOf) { try { matches(value, candidate, path); return; } catch (error) { if (!(error instanceof SubmissionValidationError)) throw error; } } return invalid(path); }
  if (("const" in rule && value !== rule.const) || (rule.enum && !rule.enum.includes(value))) return invalid(path);
  if (rule.type === "null") { if (value !== null) return invalid(path); return; }
  if (rule.type === "boolean" && typeof value !== "boolean") return invalid(path);
  if (rule.type === "integer" && (typeof value !== "number" || !Number.isSafeInteger(value) || value < (rule.minimum ?? -Infinity) || value > (rule.maximum ?? Infinity))) return invalid(path);
  if (rule.type === "string" && (typeof value !== "string" || value.length > (rule.maxLength ?? Infinity) || (rule.pattern && !new RegExp(rule.pattern).test(value)) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))) return invalid(path);
  if (rule.type === "array") {
    if (!Array.isArray(value) || value.length < (rule.minItems ?? 0) || value.length > (rule.maxItems ?? Infinity)) return invalid(path);
    if (rule.items) value.forEach((item, index) => matches(item, rule.items!, `${path}[${index}]`));
  }
  if (rule.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return invalid(path);
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length > (rule.maxProperties ?? Infinity)) return invalid(path);
    for (const key of rule.required ?? []) if (!Object.hasOwn(record, key)) return invalid(childPath(path, key));
    for (const [key, item] of Object.entries(record)) {
      if (rule.propertyNames) matches(key, rule.propertyNames, childPath(path, key));
      const property = rule.properties && Object.hasOwn(rule.properties, key) ? rule.properties[key] : undefined;
      if (property) matches(item, property, childPath(path, key));
      else if (rule.additionalProperties === false) return invalid(childPath(path, key));
      else if (typeof rule.additionalProperties === "object") matches(item, rule.additionalProperties, childPath(path, key));
    }
  }
}
function byteLength(value: unknown, path: string): number {
  try { return new TextEncoder().encode(JSON.stringify(value)).byteLength; } catch { return invalid(path); }
}
function numericDefinitions(value: unknown, prefix = ""): string[] {
  if (typeof value === "number") return [prefix];
  if (Array.isArray(value)) return [...new Set(value.flatMap((item) => numericDefinitions(item, prefix)))];
  if (value && typeof value === "object") return Object.entries(value).flatMap(([key, item]) => numericDefinitions(item, prefix ? `${prefix}.${key}` : key));
  return [];
}
export function parseDirectorSubmission(value: unknown): DirectorSubmission {
  if (byteLength(value, "submission") > 320_000) return invalid("submission.size");
  matches(value, schema, "submission");
  const envelope = value as { brief: Record<string, unknown>; provenance: DirectorSubmission["provenance"] };
  if (byteLength(envelope.brief, "submission.brief") > 256_000) return invalid("submission.brief.size");
  let brief: DirectorDay;
  try { brief = parseDirectorDay(envelope.brief, envelope.brief.date as string); } catch { return invalid("submission.brief"); }
  const executive = brief.brief;
  const values: Record<ProvenanceGroup, unknown> = {
    schedule: brief.schedule.items, agenda: brief.agenda.items, priorities: brief.priorities.items,
    decisions: brief.decisions.items, followUps: brief.followUps.items,
    dailyReport: [brief.dailyReport.visits, brief.dailyReport.bpjsSubmitted, brief.dailyReport.bpjsPending, brief.dailyReport.revenue, brief.dailyReport.expenses].some((n) => n !== null) ? brief.dailyReport : null,
    inpatient: executive?.inpatient, outpatient: executive?.outpatient, emergency: executive?.emergency,
    systems: executive?.systems, notes: [...(executive?.positiveNotes ?? []), ...(executive?.validationNotes ?? [])],
  };
  for (const group of groups) {
    const content = values[group];
    const populated = Array.isArray(content) ? content.length > 0 : content !== null && content !== undefined;
    const source = envelope.provenance[group];
    const path = `submission.provenance.${group}`;
    if (populated !== Boolean(source)) return invalid(path);
    if (!source) continue;
    if (!validReportDate(source.periodStart) || !validReportDate(source.periodEnd) || source.periodStart > source.periodEnd || source.periodEnd > brief.date) return invalid(`${path}.period`);
    if (!validReportDate(source.sourceObservedAt.slice(0, 10)) || !Number.isFinite(Date.parse(source.sourceObservedAt))) return invalid(`${path}.sourceObservedAt`);
    const observedDate = wibDate(new Date(source.sourceObservedAt));
    if (source.periodEnd > observedDate) return invalid(`${path}.sourceObservedAt`);
    const section = group === "schedule" ? brief.schedule : group === "agenda" ? brief.agenda : group === "priorities" ? brief.priorities : group === "decisions" ? brief.decisions : group === "followUps" ? brief.followUps : group === "dailyReport" ? brief.dailyReport : executive;
    if (section?.updatedAt && Date.parse(section.updatedAt) > Date.parse(source.sourceObservedAt)) return invalid(`${path}.sourceObservedAt`);
    if (group === "followUps" && brief.followUps.items.some((item) => Date.parse(item.updatedAt) > Date.parse(source.sourceObservedAt))) return invalid(`${path}.sourceObservedAt`);
    if (source.cutoff !== null && source.periodEnd === observedDate && source.cutoff > wibTime(source.sourceObservedAt).slice(0, 5)) return invalid(`${path}.cutoff`);
    if (["schedule", "agenda", "dailyReport", "inpatient"].includes(group) && (source.periodStart !== brief.date || source.periodEnd !== brief.date)) return invalid(`${path}.period`);
    const dated = group === "outpatient" ? executive?.outpatient?.days : group === "emergency" ? executive?.emergency?.days : undefined;
    if (dated?.some((day) => day.date < source.periodStart || day.date > source.periodEnd)) return invalid(`${path}.period`);
    if (group === "emergency" && executive?.emergency?.days.some((day) => day.date === source.periodEnd && day.cutoff !== null && (source.cutoff === null || day.cutoff > source.cutoff))) return invalid(`${path}.cutoff`);
    for (const metric of numericDefinitions(content)) if (!Object.hasOwn(source.metricDefinitions, metric)) return invalid(`${path}.metricDefinitions`);
  }
  return { brief, provenance: JSON.parse(JSON.stringify(envelope.provenance)) as DirectorSubmission["provenance"] };
}
export function assertPublishableSubmission(submission: DirectorSubmission, now = new Date()): void {
  const validated = parseDirectorSubmission(submission);
  if (!Number.isFinite(now.getTime())) return invalid("publication.clock");
  if (validated.brief.brief?.example) return invalid("submission.brief.brief.example");
  for (const [group, source] of Object.entries(validated.provenance)) if (Date.parse(source.sourceObservedAt) > now.getTime() + 300_000) return invalid(`submission.provenance.${group}.sourceObservedAt`);
  const timestamps = [validated.brief.brief?.updatedAt, validated.brief.schedule.updatedAt, validated.brief.agenda.updatedAt, validated.brief.priorities.updatedAt, validated.brief.decisions.updatedAt, validated.brief.followUps.updatedAt, validated.brief.dailyReport.updatedAt, ...validated.brief.followUps.items.map((item) => item.updatedAt)];
  if (timestamps.some((value) => value && Date.parse(value) > now.getTime() + 300_000)) return invalid("submission.brief.updatedAt");
}
