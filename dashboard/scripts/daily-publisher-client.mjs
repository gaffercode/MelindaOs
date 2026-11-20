import { createHash } from "node:crypto";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const MAX_BYTES = 256_000;
export const publisherRoutes = {
  medify_snapshot: { path: "/api/director/medify-snapshot", prefix: "medify" },
  medify_run_status: { path: "/api/director/medify-run-status", prefix: "medify-run" },
  satusehat_snapshot: { path: "/api/director/satusehat-snapshot", prefix: "satusehat" },
};

function record(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function reportDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function exactKeys(value, keys) {
  return record(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function text(value, max = 300) { return typeof value === "string" && value.length <= max && /\S/.test(value); }
function https(value) { return typeof value === "string" && value.length <= 500 && /^https:\/\/\S+$/.test(value); }
function nullableSection(value) { return value === null || record(value); }
function provenance(value) {
  return exactKeys(value, ["producer", "sourceObservedAt", "periodStart", "periodEnd", "cutoff", "sources", "notes"])
    && text(value.producer)
    && reportDate(value.periodStart)
    && reportDate(value.periodEnd)
    && (value.cutoff === null || /^([01]\d|2[0-3]):[0-5]\d$/.test(value.cutoff))
    && Array.isArray(value.sources)
    && value.sources.length >= 1
    && value.sources.length <= 20
    && value.sources.every((source) => exactKeys(source, ["name", "url", "note"]) && text(source.name) && (source.url === null || https(source.url)) && typeof source.note === "string")
    && typeof value.notes === "string";
}
export function prepareMedifySnapshot(input, idempotencyKey) {
  if (typeof input !== "string" || Buffer.byteLength(input, "utf8") > MAX_BYTES) throw new Error("Invalid submission envelope");
  let document;
  try { document = JSON.parse(input); } catch { throw new Error("Invalid submission envelope"); }
  // Sections added after the first release are optional, matching the schema.
  const optional = ["inpatientMix", "igdMix", "diagnostics", "pharmacy", "staff", "satusehat", "patients", "run"];
  const valid = exactKeys(document, ["schemaVersion", "date", "bed", "outpatient", "igd", "inpatient", "finance", "provenance", ...optional.filter((key) => record(document) && Object.hasOwn(document, key))])
    && document.schemaVersion === 1
    && reportDate(document.date)
    && nullableSection(document.bed)
    && nullableSection(document.outpatient)
    && nullableSection(document.igd)
    && nullableSection(document.inpatient)
    && nullableSection(document.finance)
    && optional.filter((key) => key !== "run").every((key) => !Object.hasOwn(document, key) || nullableSection(document[key]))
    && (!Object.hasOwn(document, "run") || record(document.run))
    && provenance(document.provenance);
  if (!valid) throw new Error("Invalid submission envelope");
  return finish(input, document.date, "medify", idempotencyKey);
}

export function prepareMedifyRunStatus(input, idempotencyKey) {
  if (typeof input !== "string" || Buffer.byteLength(input, "utf8") > MAX_BYTES) throw new Error("Invalid submission envelope");
  let document;
  try { document = JSON.parse(input); } catch { throw new Error("Invalid submission envelope"); }
  const issue = (value) => exactKeys(value, ["section", "reason"])
    && (value.section === null || ["bed", "outpatient", "igd", "inpatient", "inpatientMix", "igdMix", "diagnostics", "pharmacy", "staff", "finance", "satusehat", "patients"].includes(value.section))
    && ["login_failed", "request_failed", "format_changed", "response_too_large", "access_denied", "validation_failed", "overlap_denied"].includes(value.reason);
  const valid = exactKeys(document, ["schemaVersion", "date", "slot", "runId", "status", "startedAt", "completedAt", "unavailableSections", "snapshotRevisionId", "snapshotReceivedAt"])
    && document.schemaVersion === 1 && reportDate(document.date)
    && ["morning", "evening"].includes(document.slot) && /^[A-Za-z0-9_-]{8,80}$/.test(document.runId)
    && ["complete", "degraded", "failed"].includes(document.status)
    && typeof document.startedAt === "string" && typeof document.completedAt === "string" && Number.isFinite(Date.parse(document.startedAt)) && Number.isFinite(Date.parse(document.completedAt))
    && Array.isArray(document.unavailableSections) && document.unavailableSections.every(issue)
    && (document.snapshotRevisionId === null || uuid.test(document.snapshotRevisionId))
    && (document.snapshotReceivedAt === null || (typeof document.snapshotReceivedAt === "string" && Number.isFinite(Date.parse(document.snapshotReceivedAt))));
  if (!valid) throw new Error("Invalid submission envelope");
  return finish(input, document.date, "medify-run", idempotencyKey);
}

function finish(input, date, prefix, idempotencyKey) {
  const key = idempotencyKey ?? `${prefix}-${createHash("sha256").update(input).digest("hex")}`;
  if (typeof key !== "string" || !/^[a-zA-Z0-9_-]{8,128}$/.test(key)) throw new Error("Invalid idempotency key");
  return { body: input, date, idempotencyKey: key };
}

export function assertPublisherClient(options) { configuration(options); }
/** Publisher origin and token from the environment (`MELINDAOS_DASHBOARD_URL`, `MELINDAOS_PUBLISHER_TOKEN`). */
export function publisherFromEnv(env = process.env) {
  return { baseUrl: env.MELINDAOS_DASHBOARD_URL, token: env.MELINDAOS_PUBLISHER_TOKEN || undefined };
}
function configuration(options) {
  let url;
  try { url = new URL(options.baseUrl); } catch { throw new Error("Invalid client configuration"); }
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash || typeof options.token !== "string" || !/^[\x21-\x7e]+$/.test(options.token) || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new Error("Invalid client configuration");
  return { origin: url.origin, token: options.token, timeoutMs, fetch: options.fetch ?? globalThis.fetch, sleep: options.sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms))) };
}

function receipt(value, expectedDate, expectedKind) {
  if (!record(value) || typeof value.id !== "string" || !uuid.test(value.id) || value.revisionId !== value.id || value.kind !== expectedKind || typeof value.payloadHash !== "string" || !/^[a-f0-9]{64}$/.test(value.payloadHash) || value.date !== expectedDate || value.status !== "stored" || typeof value.receivedAt !== "string" || !Number.isFinite(Date.parse(value.receivedAt)) || typeof value.replayed !== "boolean") throw new Error("Invalid submission receipt");
  return { id: value.id, revisionId: value.revisionId, kind: value.kind, payloadHash: value.payloadHash, date: value.date, status: "stored", receivedAt: value.receivedAt, replayed: value.replayed };
}

async function responseReceipt(response, expectedDate, expectedKind) {
  if (!response.body) throw new Error("Invalid submission receipt");
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 8192) { await reader.cancel(); throw new Error("Invalid submission receipt"); }
      chunks.push(value);
    }
    let value;
    try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new Error("Invalid submission receipt"); }
    return receipt(value, expectedDate, expectedKind);
  } finally { reader.releaseLock(); }
}

function redirectOrigin(location) {
  try {
    const origin = new URL(location ?? "").origin;
    return origin === "null" ? "an unknown location" : origin;
  } catch { return "an unknown location"; }
}

async function requestReceipt(path, init, config, expectedDate, expectedKind) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    let timer;
    let retry = false;
    let failure;
    try {
      const result = await Promise.race([
        (async () => {
          let response;
          try { response = await config.fetch(`${config.origin}${path}`, { ...init, redirect: "manual", signal: controller.signal, headers: { ...init.headers, Authorization: `Bearer ${config.token}` } }); }
          catch { return { retry: true, error: new Error("Network request failed; retry the same input and key") }; }
          if (response.status >= 300 && response.status < 400) {
            await response.body?.cancel().catch(() => {});
            return { retry: false, error: new Error(`Dashboard origin redirected (HTTP ${response.status}) to ${redirectOrigin(response.headers.get("location"))}; set MELINDAOS_DASHBOARD_URL to that origin.`) };
          }
          if (!response.ok) {
            await response.body?.cancel().catch(() => {});
            if (response.status === 429) {
              const retryAfter = response.headers.get("Retry-After") ?? "";
              const delay = /^\d{1,6}$/.test(retryAfter) ? `after ${Number(retryAfter)} seconds` : "later";
              return { retry: false, error: new Error(`Submission request failed (HTTP 429; retry ${delay} using the same input and key)`) };
            }
            return { retry: response.status === 503, error: new Error(`Submission request failed (HTTP ${response.status})`) };
          }
          try { return { value: await responseReceipt(response, expectedDate, expectedKind) }; }
          catch (error) {
            if (error instanceof Error && error.message === "Invalid submission receipt") throw new Error("Invalid submission receipt");
            return { retry: true, error: new Error("Network request failed; retry the same input and key") };
          }
        })(),
        new Promise((done) => { timer = setTimeout(() => { controller.abort(); done({ retry: true, error: new Error("Network request failed; retry the same input and key") }); }, config.timeoutMs); }),
      ]);
      if (result.value) return result.value;
      retry = result.retry;
      failure = result.error;
    } finally { clearTimeout(timer); controller.abort(); }
    if (!retry || attempt === 2) throw failure;
    await config.sleep(500 * (2 ** attempt));
  }
  throw new Error("Submission request failed");
}

async function submit(kind, submission, options) {
  const route = publisherRoutes[kind];
  const config = configuration(options);
  return requestReceipt(route.path, { method: "POST", body: submission.body, headers: { "Content-Type": "application/json", "Idempotency-Key": submission.idempotencyKey } }, config, submission.date, kind);
}

export function prepareSatusehatSnapshot(input, idempotencyKey) {
  if (typeof input !== "string" || Buffer.byteLength(input, "utf8") > MAX_BYTES) throw new Error("Invalid submission envelope");
  let document;
  try { document = JSON.parse(input); } catch { throw new Error("Invalid submission envelope"); }
  const required = [
    "schemaVersion", "date", "environment", "organizationId", "facilityCode", "facilityName",
    "observedAt", "periodStart", "periodEnd", "periodLabel", "source", "logSummary",
    "resources", "unavailableResources", "provenance",
  ];
  const valid = exactKeys(document, required)
    && document.schemaVersion === 1
    && reportDate(document.date)
    && ["production", "staging"].includes(document.environment)
    && text(document.organizationId)
    && text(document.facilityCode)
    && text(document.facilityName)
    && typeof document.observedAt === "string"
    && Number.isFinite(Date.parse(document.observedAt))
    && reportDate(document.periodStart)
    && reportDate(document.periodEnd)
    && text(document.periodLabel)
    && ["oauth2_fhir_api", "portal_export"].includes(document.source)
    && (document.logSummary === null || record(document.logSummary))
    && Array.isArray(document.resources) && document.resources.length >= 1 && document.resources.length <= 19
    && Array.isArray(document.unavailableResources)
    && provenance(document.provenance);
  if (!valid) throw new Error("Invalid submission envelope");
  return finish(input, document.date, "satusehat", idempotencyKey);
}

export function submitMedifySnapshot(submission, options) { return submit("medify_snapshot", submission, options); }
export function submitMedifyRunStatus(submission, options) { return submit("medify_run_status", submission, options); }
export function submitSatusehatSnapshot(submission, options) { return submit("satusehat_snapshot", submission, options); }
