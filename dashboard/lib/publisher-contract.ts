import { validReportDate, wibDate, wibTime } from "./director/director-data";

/**
 * Closed JSON Schema check plus the date, metric, and https rules shared by
 * `news_edition` and the Medify documents. Unknown keys are rejected.
 */
export class PublisherValidationError extends Error {
  constructor(public readonly path: string) {
    super(`Format dokumen tidak valid: ${path}`);
    this.name = "PublisherValidationError";
  }
}

export type CountMetric = {
  value: number | null;
  definition: string;
  source: string;
  observedAt: string;
  periodStart: string;
  periodEnd: string;
  cutoff: string | null;
};

export type DocumentSource = { name: string; url: string | null; note: string };
export type DocumentProvenance = {
  producer: string;
  sourceObservedAt: string;
  periodStart: string;
  periodEnd: string;
  cutoff: string | null;
  sources: DocumentSource[];
  notes: string;
};

type Schema = {
  $ref?: string;
  const?: unknown;
  enum?: unknown[];
  type?: string;
  anyOf?: Schema[];
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean | Schema;
  items?: Schema;
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  maxLength?: number;
};
type SchemaDocument = Schema & { $defs?: Record<string, Schema> };

function fail(path: string): never {
  throw new PublisherValidationError(path);
}
function childPath(path: string, key: string): string {
  return `${path}.${/^[a-zA-Z0-9_-]{1,80}$/.test(key) ? key : "[unknown]"}`;
}

export function matchClosedSchema(value: unknown, document: SchemaDocument, path: string): void {
  const defs = document.$defs ?? {};
  const matches = (current: unknown, rule: Schema, at: string): void => {
    if (rule.$ref) return matches(current, defs[rule.$ref.split("/").at(-1)!], at);
    if (rule.anyOf) {
      let specific: PublisherValidationError | null = null;
      for (const candidate of rule.anyOf) {
        try { matches(current, candidate, at); return; } catch (error) {
          if (!(error instanceof PublisherValidationError)) throw error;
          if (!specific || error.path.length > specific.path.length) specific = error;
        }
      }
      return fail(specific?.path ?? at);
    }
    if (("const" in rule && current !== rule.const) || (rule.enum && !rule.enum.includes(current))) return fail(at);
    if (rule.type === "null") { if (current !== null) return fail(at); return; }
    if (rule.type === "boolean" && typeof current !== "boolean") return fail(at);
    if (rule.type === "integer" && (typeof current !== "number" || !Number.isSafeInteger(current) || current < (rule.minimum ?? -Infinity) || current > (rule.maximum ?? Infinity))) return fail(at);
    if (rule.type === "string" && (typeof current !== "string" || current.length > (rule.maxLength ?? Infinity) || (rule.pattern && !new RegExp(rule.pattern).test(current)) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(current))) return fail(at);
    if (rule.type === "array") {
      if (!Array.isArray(current) || current.length < (rule.minItems ?? 0) || current.length > (rule.maxItems ?? Infinity)) return fail(at);
      if (rule.items) current.forEach((item, index) => matches(item, rule.items!, `${at}[${index}]`));
      return;
    }
    if (rule.type === "object") {
      if (!current || typeof current !== "object" || Array.isArray(current)) return fail(at);
      const record = current as Record<string, unknown>;
      for (const key of rule.required ?? []) if (!Object.hasOwn(record, key)) return fail(childPath(at, key));
      for (const [key, item] of Object.entries(record)) {
        const property = rule.properties && Object.hasOwn(rule.properties, key) ? rule.properties[key] : undefined;
        if (property) matches(item, property, childPath(at, key));
        else if (rule.additionalProperties === false) return fail(childPath(at, key));
        else if (typeof rule.additionalProperties === "object") matches(item, rule.additionalProperties, childPath(at, key));
      }
    }
  };
  matches(value, document, path);
}

function assertPeriod(start: string, end: string, reportDate: string, path: string): void {
  if (!validReportDate(start) || !validReportDate(end) || start > end || end !== reportDate) fail(`${path}.period`);
}

function assertObserved(observedAt: string, periodEnd: string, cutoff: string | null, path: string): void {
  if (!validReportDate(observedAt.slice(0, 10)) || !Number.isFinite(Date.parse(observedAt))) fail(`${path}.observedAt`);
  const observedDate = wibDate(new Date(observedAt));
  if (periodEnd > observedDate) fail(`${path}.observedAt`);
  if (cutoff !== null && periodEnd === observedDate && cutoff > wibTime(observedAt).slice(0, 5)) fail(`${path}.cutoff`);
}

function isMetric(value: unknown): value is CountMetric {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return ["value", "definition", "source", "observedAt", "periodStart", "periodEnd", "cutoff"].every((key) => key in record);
}

function assertMetric(metric: CountMetric, path: string, reportDate: string): void {
  if (metric.value !== null && (!Number.isSafeInteger(metric.value) || metric.value < 0)) fail(`${path}.value`);
  assertPeriod(metric.periodStart, metric.periodEnd, reportDate, path);
  assertObserved(metric.observedAt, metric.periodEnd, metric.cutoff, path);
}

function walkMetrics(value: unknown, path: string, reportDate: string): void {
  if (isMetric(value)) { assertMetric(value, path, reportDate); return; }
  if (Array.isArray(value)) value.forEach((item, index) => walkMetrics(item, `${path}[${index}]`, reportDate));
  else if (value && typeof value === "object") Object.entries(value).forEach(([key, item]) => walkMetrics(item, childPath(path, key), reportDate));
}

function assertHttps(value: string | null, path: string, required: boolean): void {
  if (value === null) { if (required) fail(path); return; }
  let url: URL;
  try { url = new URL(value); } catch { fail(path); }
  if (url.protocol !== "https:" || url.username || url.password || url.href.length > 500) fail(path);
}

function walkUrls(value: unknown, path: string): void {
  if (Array.isArray(value)) { value.forEach((item, index) => walkUrls(item, `${path}[${index}]`)); return; }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const at = childPath(path, key);
    if (key === "sourceUrl" || key === "pdfUrl" || key === "image" || key === "url") {
      if (item !== null && typeof item !== "string") fail(at);
      assertHttps(item as string | null, at, key === "sourceUrl");
    } else walkUrls(item, at);
  }
}

function walkImages(value: unknown, path: string): void {
  if (Array.isArray(value)) { value.forEach((item, index) => walkImages(item, `${path}[${index}]`)); return; }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if ("image" in record && "imageAlt" in record) {
    if (record.image === null) { if (record.imageAlt !== null) fail(`${path}.imageAlt`); }
    else if (typeof record.imageAlt !== "string" || !record.imageAlt.trim()) fail(`${path}.imageAlt`);
  }
  for (const [key, item] of Object.entries(record)) if (item && typeof item === "object") walkImages(item, childPath(path, key));
}

function walkObserved(value: unknown, path: string, reportDate: string): void {
  if (isMetric(value) || !value || typeof value !== "object") return;
  if (Array.isArray(value)) { value.forEach((item, index) => walkObserved(item, `${path}[${index}]`, reportDate)); return; }
  const record = value as Record<string, unknown>;
  if (typeof record.observedAt === "string") {
    const cutoff = record.cutoff === null || typeof record.cutoff === "string" ? record.cutoff : null;
    assertObserved(record.observedAt, reportDate, cutoff, path);
  }
  Object.entries(record).forEach(([key, item]) => walkObserved(item, childPath(path, key), reportDate));
}

export function assertPublication(value: { date: string; provenance: DocumentProvenance }, path: string): void {
  if (!validReportDate(value.date)) fail(`${path}.date`);
  const provenance = value.provenance;
  assertPeriod(provenance.periodStart, provenance.periodEnd, value.date, `${path}.provenance`);
  assertObserved(provenance.sourceObservedAt, provenance.periodEnd, provenance.cutoff, `${path}.provenance`);
  if (new Set(provenance.sources.map((source) => source.name)).size !== provenance.sources.length) fail(`${path}.provenance.sources`);
  walkMetrics(value, path, value.date);
  walkObserved(value, path, value.date);
  walkUrls(value, path);
  walkImages(value, path);
}

export function jsonByteLength(value: unknown, path: string): number {
  try { return new TextEncoder().encode(JSON.stringify(value)).byteLength; } catch { return fail(path); }
}
