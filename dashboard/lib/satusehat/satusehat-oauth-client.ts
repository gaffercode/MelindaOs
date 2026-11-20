import { wibDate } from "../director/director-data";
import type { SatusehatEnvironment, SatusehatSnapshot, SatusehatSnapshotResource } from "./satusehat-snapshot-contract";

export const SATUSEHAT_FHIR_RESOURCE_NAMES = [
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
] as const;

export const SATUSEHAT_ENDPOINTS: Record<SatusehatEnvironment, { authBaseUrl: string; fhirBaseUrl: string }> = {
  production: {
    authBaseUrl: "https://api-satusehat.kemkes.go.id/oauth2/v1",
    fhirBaseUrl: "https://api-satusehat.kemkes.go.id/fhir-r4/v1",
  },
  staging: {
    authBaseUrl: "https://api-satusehat-stg.dto.kemkes.go.id/oauth2/v1",
    fhirBaseUrl: "https://api-satusehat-stg.dto.kemkes.go.id/fhir-r4/v1",
  },
};

const RESOURCE_SET = new Set<string>(SATUSEHAT_FHIR_RESOURCE_NAMES);
const MAX_RESPONSE_BYTES = 65_536;
const TIMEOUT_MS = 15_000;
const DEFAULT_CONCURRENCY = 3;
const MAX_CONCURRENCY = 4;

export interface SatusehatOAuthConfig {
  clientId: string;
  clientSecret: string;
  organizationId: string;
  environment: SatusehatEnvironment;
  facilityCode: string;
  facilityName: string;
  authBaseUrl: string;
  fhirBaseUrl: string;
  concurrency: number;
}

export function satusehatOAuthConfig(env: NodeJS.ProcessEnv = process.env): SatusehatOAuthConfig | null {
  const clientId = env.SATUSEHAT_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.SATUSEHAT_CLIENT_SECRET?.trim() ?? "";
  const organizationId = env.SATUSEHAT_ORG_ID?.trim() ?? "";
  if (!clientId || !clientSecret || !organizationId) return null;

  const rawEnv = env.SATUSEHAT_ENV?.trim().toLowerCase();
  const environment: SatusehatEnvironment = rawEnv === "staging" ? "staging" : "production";
  const defaults = SATUSEHAT_ENDPOINTS[environment];
  const authBaseUrl = env.SATUSEHAT_AUTH_BASE_URL?.trim() || defaults.authBaseUrl;
  const fhirBaseUrl = env.SATUSEHAT_FHIR_BASE_URL?.trim() || defaults.fhirBaseUrl;

  return {
    clientId,
    clientSecret,
    organizationId,
    environment,
    facilityCode: env.SATUSEHAT_FACILITY_CODE?.trim() || "3571148",
    facilityName: env.SATUSEHAT_FACILITY_NAME?.trim() || "RS Ibu dan Anak Melinda",
    authBaseUrl,
    fhirBaseUrl,
    concurrency: clampConcurrency(env.SATUSEHAT_CONCURRENCY),
  };
}

export function satusehatOAuthConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return satusehatOAuthConfig(env) !== null;
}

export function clampConcurrency(value: unknown): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(MAX_CONCURRENCY, Math.max(1, parsed)) : DEFAULT_CONCURRENCY;
}

function assertHttpsUrl(raw: string, label: string): string {
  const parsed = new URL(raw);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error(`${label} harus menggunakan https tanpa kredensial pada URL.`);
  }
  return parsed.toString().replace(/\/+$/, "");
}

function daysBeforeIso(dateIso: string, days: number): string {
  const base = new Date(`${dateIso}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() - days);
  return base.toISOString().slice(0, 10);
}

async function readBoundedJson(response: Response): Promise<unknown> {
  if (!response.body) return {};
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("Respons SATUSEHAT melebihi batas aman 64 KB.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(text) as unknown;
}

async function settleWithLimit<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results = new Array<T>(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const idx = next++;
      results[idx] = await tasks[idx]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

async function requestOAuthToken(
  authBaseUrl: string,
  clientId: string,
  clientSecret: string,
  fetchImpl: typeof globalThis.fetch,
): Promise<string> {
  const response = await fetchImpl(`${authBaseUrl}/accesstoken?grant_type=client_credentials`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret }).toString(),
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`Autentikasi OAuth2 SATUSEHAT gagal (HTTP ${response.status}). Periksa Client ID & Client Secret.`);
  }
  const body = (await readBoundedJson(response)) as { access_token?: unknown };
  const token = typeof body?.access_token === "string" ? body.access_token.trim() : "";
  if (!token) {
    throw new Error("Token akses OAuth2 SATUSEHAT tidak ditemukan pada respons server Kemenkes.");
  }
  return token;
}

async function fetchResourceCount(
  fhirBaseUrl: string,
  token: string,
  resource: string,
  periodStart: string,
  fetchImpl: typeof globalThis.fetch,
): Promise<SatusehatSnapshotResource> {
  if (!RESOURCE_SET.has(resource)) {
    throw new Error(`Resource FHIR tidak diizinkan: ${resource}`);
  }
  const query = async (search: string) => {
    const response = await fetchImpl(`${fhirBaseUrl}/${resource}?${search}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/fhir+json, application/json",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return response;
  };

  let periodMode: "rolling_30d" | "all_time" = "rolling_30d";
  let response = await query(`_summary=count&_lastUpdated=ge${periodStart}`);
  if (response.status === 400 || response.status === 422) {
    await response.body?.cancel().catch(() => undefined);
    periodMode = "all_time";
    response = await query("_summary=count");
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return { name: resource, count: 0, status: "unavailable", periodMode };
  }
  const payload = (await readBoundedJson(response)) as { total?: unknown };
  const total = typeof payload?.total === "number" && Number.isInteger(payload.total) && payload.total >= 0 ? payload.total : null;
  if (total === null) {
    return { name: resource, count: 0, status: "unavailable", periodMode };
  }
  return { name: resource, count: total, status: "ok", periodMode };
}

export interface PullSatusehatOAuthOptions {
  clientId: string;
  clientSecret: string;
  organizationId: string;
  environment?: SatusehatEnvironment;
  facilityCode?: string;
  facilityName?: string;
  authBaseUrl?: string;
  fhirBaseUrl?: string;
  concurrency?: number;
  producer?: string;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
}

/**
 * Pulls aggregate `_summary=count` totals for all 19 SATUSEHAT FHIR resources via official Kemenkes OAuth2.
 * Requires no CAPTCHA, never requests or retains patient records (`entry`), and caps concurrency to 1–4.
 */
export async function pullSatusehatOAuth(options: PullSatusehatOAuthOptions): Promise<SatusehatSnapshot> {
  const environment: SatusehatEnvironment = options.environment === "staging" ? "staging" : "production";
  const defaults = SATUSEHAT_ENDPOINTS[environment];
  const authBaseUrl = assertHttpsUrl(options.authBaseUrl || defaults.authBaseUrl, "SATUSEHAT_AUTH_BASE_URL");
  const fhirBaseUrl = assertHttpsUrl(options.fhirBaseUrl || defaults.fhirBaseUrl, "SATUSEHAT_FHIR_BASE_URL");
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const date = wibDate(now());
  const periodStart = daysBeforeIso(date, 29);
  const periodEnd = date;

  const token = await requestOAuthToken(authBaseUrl, options.clientId, options.clientSecret, fetchImpl);
  const limit = clampConcurrency(options.concurrency);
  const resources = await settleWithLimit(
    SATUSEHAT_FHIR_RESOURCE_NAMES.map((resource) => () =>
      fetchResourceCount(fhirBaseUrl, token, resource, periodStart, fetchImpl).catch(
        (): SatusehatSnapshotResource => ({ name: resource, count: 0, status: "unavailable", periodMode: "rolling_30d" }),
      ),
    ),
    limit,
  );

  const unavailableResources = resources.filter((item) => item.status === "unavailable").map((item) => item.name);
  if (unavailableResources.length === resources.length) {
    throw new Error("Seluruh 19 resource SATUSEHAT gagal ditarik; snapshot tidak disimpan.");
  }

  const observedAt = now().toISOString();
  const origin = new URL(fhirBaseUrl).origin;
  const allTimeCount = resources.filter((item) => item.status === "ok" && item.periodMode === "all_time").length;
  const noteParts: string[] = [];
  if (unavailableResources.length > 0) {
    noteParts.push(`Gagal ditarik: ${unavailableResources.join(", ")}.`);
  }
  if (allTimeCount > 0) {
    noteParts.push(`${allTimeCount} resource menggunakan hitungan kumulatif (_summary=count).`);
  }

  return {
    schemaVersion: 1,
    date,
    environment,
    organizationId: options.organizationId,
    facilityCode: options.facilityCode?.trim() || "3571148",
    facilityName: options.facilityName?.trim() || "RS Ibu dan Anak Melinda",
    observedAt,
    periodStart,
    periodEnd,
    periodLabel: `${periodStart} s.d. ${periodEnd} (30 hari)`,
    source: "oauth2_fhir_api",
    logSummary: null,
    resources,
    unavailableResources,
    provenance: {
      producer: options.producer?.trim() || "satusehat-oauth-pull",
      sourceObservedAt: observedAt,
      periodStart,
      periodEnd,
      cutoff: null,
      sources: [
        {
          name: "API SATUSEHAT Kemenkes",
          url: origin,
          note: "Penarikan agregat _summary=count melalui OAuth2 resmi Kemenkes; tanpa data pasien.",
        },
      ],
      notes: noteParts.join(" "),
    },
  };
}
