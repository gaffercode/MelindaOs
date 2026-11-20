#!/usr/bin/env node
/**
 * Pull aggregate FHIR resource counts from Kemenkes SATUSEHAT OAuth2 API (`_summary=count` only)
 * and publish them as a `satusehat_snapshot` (zero CAPTCHA, zero patient identifiers).
 *
 *   node scripts/satusehat-pull.mjs                 pull and publish to the dashboard
 *   node scripts/satusehat-pull.mjs --dry-run       pull and print the payload
 *   node scripts/satusehat-pull.mjs --out <file>    pull and write the payload (file mode: data/satusehat/<date>.json)
 */
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertPublisherClient, prepareSatusehatSnapshot, publisherFromEnv, submitSatusehatSnapshot } from "./daily-publisher-client.mjs";

export const SATUSEHAT_RESOURCES = [
  "Encounter",
  "Condition",
  "Observation",
  "Procedure",
  "Composition",
  "Medication",
  "MedicationRequest",
  "MedicationDispense",
  "AllergyIntolerance",
  "ImagingStudy",
  "ServiceRequest",
  "ClinicalImpression",
  "Immunization",
  "QuestionnaireResponse",
  "MedicationStatement",
  "CarePlan",
  "Specimen",
  "DiagnosticReport",
  "EpisodeOfCare",
];
const RESOURCE_SET = new Set(SATUSEHAT_RESOURCES);

export const SATUSEHAT_ENDPOINTS = {
  production: {
    authBaseUrl: "https://api-satusehat.kemkes.go.id/oauth2/v1",
    fhirBaseUrl: "https://api-satusehat.kemkes.go.id/fhir-r4/v1",
  },
  staging: {
    authBaseUrl: "https://api-satusehat-stg.dto.kemkes.go.id/oauth2/v1",
    fhirBaseUrl: "https://api-satusehat-stg.dto.kemkes.go.id/fhir-r4/v1",
  },
};

const TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 65_536;
const DEFAULT_CONCURRENCY = 3;
const MAX_CONCURRENCY = 4;
const USAGE = "Usage: node scripts/satusehat-pull.mjs [--dry-run | --out <file>] [--slot <morning|evening>]";

export function clampConcurrency(value) {
  const number = Number(value);
  return Number.isInteger(number) ? Math.min(MAX_CONCURRENCY, Math.max(1, number)) : DEFAULT_CONCURRENCY;
}

export function wibDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(now);
}

function daysBeforeIso(dateIso, days) {
  const base = new Date(`${dateIso}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() - days);
  return base.toISOString().slice(0, 10);
}

function assertHttps(raw, label) {
  const parsed = new URL(raw);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error(`${label} harus menggunakan https tanpa kredensial pada URL`);
  }
  return parsed.toString().replace(/\/+$/, "");
}

async function readBoundedJson(response) {
  if (!response.body) return {};
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("Respons SATUSEHAT melebihi batas aman 64 KB");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function settleWithLimit(tasks, limit) {
  const results = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const index = next++;
      results[index] = await tasks[index]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

async function requestOAuthToken(authBaseUrl, clientId, clientSecret, fetchImpl) {
  const response = await fetchImpl(`${authBaseUrl}/accesstoken?grant_type=client_credentials`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret }).toString(),
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`Autentikasi OAuth2 SATUSEHAT gagal (HTTP ${response.status}); tidak dicoba ulang`);
  }
  const body = await readBoundedJson(response);
  const token = typeof body?.access_token === "string" ? body.access_token.trim() : "";
  if (!token) throw new Error("Token OAuth2 SATUSEHAT tidak ditemukan");
  return token;
}

async function fetchResourceCount(fhirBaseUrl, token, resource, periodStart, fetchImpl) {
  if (!RESOURCE_SET.has(resource)) throw new Error(`Resource tidak diizinkan: ${resource}`);
  const get = (search) => fetchImpl(`${fhirBaseUrl}/${resource}?${search}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/fhir+json, application/json" },
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  let periodMode = "rolling_30d";
  let response = await get(`_summary=count&_lastUpdated=ge${periodStart}`);
  if (response.status === 400 || response.status === 422) {
    await response.body?.cancel().catch(() => undefined);
    periodMode = "all_time";
    response = await get("_summary=count");
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return { name: resource, count: 0, status: "unavailable", periodMode };
  }
  const payload = await readBoundedJson(response);
  const total = typeof payload?.total === "number" && Number.isInteger(payload.total) && payload.total >= 0 ? payload.total : null;
  if (total === null) return { name: resource, count: 0, status: "unavailable", periodMode };
  return { name: resource, count: total, status: "ok", periodMode };
}

export async function pullSatusehat({
  clientId,
  clientSecret,
  organizationId,
  environment = "production",
  facilityCode = "3571148",
  facilityName = "RS Ibu dan Anak Melinda",
  authBaseUrl,
  fhirBaseUrl,
  concurrency,
  fetch: fetchImpl = globalThis.fetch,
  now = () => new Date(),
}) {
  const env = environment === "staging" ? "staging" : "production";
  const defaults = SATUSEHAT_ENDPOINTS[env];
  const authOrigin = assertHttps(authBaseUrl || defaults.authBaseUrl, "SATUSEHAT_AUTH_BASE_URL");
  const fhirOrigin = assertHttps(fhirBaseUrl || defaults.fhirBaseUrl, "SATUSEHAT_FHIR_BASE_URL");
  const date = wibDate(now());
  const periodStart = daysBeforeIso(date, 29);
  const periodEnd = date;

  const token = await requestOAuthToken(authOrigin, clientId, clientSecret, fetchImpl);
  const limit = clampConcurrency(concurrency);
  const resources = await settleWithLimit(
    SATUSEHAT_RESOURCES.map((resource) => () =>
      fetchResourceCount(fhirOrigin, token, resource, periodStart, fetchImpl).catch(() => ({
        name: resource, count: 0, status: "unavailable", periodMode: "rolling_30d",
      })),
    ),
    limit,
  );
  const unavailableResources = resources.filter((item) => item.status === "unavailable").map((item) => item.name);
  if (unavailableResources.length === resources.length) {
    throw new Error("Seluruh resource SATUSEHAT gagal ditarik");
  }

  const observedAt = now().toISOString();
  const allTimeCount = resources.filter((item) => item.status === "ok" && item.periodMode === "all_time").length;
  const noteParts = [];
  if (unavailableResources.length) noteParts.push(`Gagal ditarik: ${unavailableResources.join(", ")}.`);
  if (allTimeCount) noteParts.push(`${allTimeCount} resource menggunakan hitungan kumulatif (_summary=count).`);

  return {
    schemaVersion: 1,
    date,
    environment: env,
    organizationId,
    facilityCode,
    facilityName,
    observedAt,
    periodStart,
    periodEnd,
    periodLabel: `${periodStart} s.d. ${periodEnd} (30 hari)`,
    source: "oauth2_fhir_api",
    logSummary: null,
    resources,
    unavailableResources,
    provenance: {
      producer: "satusehat-pull",
      sourceObservedAt: observedAt,
      periodStart,
      periodEnd,
      cutoff: null,
      sources: [{
        name: "API SATUSEHAT Kemenkes",
        url: new URL(fhirOrigin).origin,
        note: "Penarikan agregat _summary=count melalui OAuth2 resmi Kemenkes; tanpa data pasien.",
      }],
      notes: noteParts.join(" "),
    },
  };
}

export function parseArgs(argv) {
  const options = { dryRun: false, out: null, slot: null };
  const args = [...argv];
  while (args.length) {
    const arg = args.shift();
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--out" && args.length) options.out = args.shift();
    else if (arg === "--slot" && args.length && ["morning", "evening"].includes(args[0])) options.slot = args.shift();
    else throw new Error(USAGE);
  }
  if (options.dryRun && options.out) throw new Error(USAGE);
  return options;
}

async function main() {
  const { dryRun, out, slot } = parseArgs(process.argv.slice(2));
  const clientId = process.env.SATUSEHAT_CLIENT_ID?.trim();
  const clientSecret = process.env.SATUSEHAT_CLIENT_SECRET?.trim();
  const organizationId = process.env.SATUSEHAT_ORG_ID?.trim();
  if (!clientId || !clientSecret || !organizationId) {
    throw new Error("Isi SATUSEHAT_CLIENT_ID, SATUSEHAT_CLIENT_SECRET, dan SATUSEHAT_ORG_ID");
  }
  const publisher = publisherFromEnv(process.env);
  if (!dryRun && !out) assertPublisherClient(publisher);

  const snapshot = await pullSatusehat({
    clientId,
    clientSecret,
    organizationId,
    environment: process.env.SATUSEHAT_ENV === "staging" ? "staging" : "production",
    facilityCode: process.env.SATUSEHAT_FACILITY_CODE || "3571148",
    facilityName: process.env.SATUSEHAT_FACILITY_NAME || "RS Ibu dan Anak Melinda",
    authBaseUrl: process.env.SATUSEHAT_AUTH_BASE_URL || undefined,
    fhirBaseUrl: process.env.SATUSEHAT_FHIR_BASE_URL || undefined,
    concurrency: process.env.SATUSEHAT_CONCURRENCY,
  });

  const pretty = `${JSON.stringify(snapshot, null, 2)}\n`;
  if (dryRun) process.stdout.write(pretty);
  else if (out) await writeFile(out, pretty, "utf8");
  else {
    const key = slot ? `satusehat-${snapshot.date}-${slot}-${randomUUID().slice(0, 8)}` : undefined;
    const receipt = await submitSatusehatSnapshot(prepareSatusehatSnapshot(JSON.stringify(snapshot), key), publisher);
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Penarikan SATUSEHAT gagal"}\n`);
    process.exitCode = 1;
  });
}
