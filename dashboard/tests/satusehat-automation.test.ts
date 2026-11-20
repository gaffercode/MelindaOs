import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, scryptSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as publishSatusehat } from "@/app/api/director/satusehat-snapshot/route";
import { POST as syncSatusehat } from "@/app/api/director/satusehat/sync/route";
import { GET as cronGet } from "@/app/api/cron/satusehat/route";
import { syncTodayAllPages } from "@/lib/work-schedule/sync-and-feedback";
import { CLAUDE_ENDPOINT } from "@/lib/claude-client";
import { composeBrief } from "@/lib/composer/compose";
import { detectFacts } from "@/lib/composer/facts";
import { allowedNumbers, isGrounded } from "@/lib/composer/grounding";
import { composeAndStoreBrief } from "@/lib/composer/run";
import { clearDailyDocumentCache } from "@/lib/daily/daily-documents";
import { requireConfiguration } from "@/lib/director/director-api";
import { csrfForSession } from "@/lib/director/director-auth";
import { parseMelindaBrief } from "@/lib/melinda/melinda-brief-contract";
import {
  pullSatusehatOAuth,
  SATUSEHAT_ENDPOINTS,
  SATUSEHAT_FHIR_RESOURCE_NAMES,
} from "@/lib/satusehat/satusehat-oauth-client";
import {
  parseSatusehatSnapshot,
  type SatusehatSnapshot,
} from "@/lib/satusehat/satusehat-snapshot-contract";
import { readSatusehatSnapshot } from "@/lib/satusehat/satusehat-snapshot-store";
import {
  prepareSatusehatSnapshot,
  submitSatusehatSnapshot,
} from "../scripts/daily-publisher-client.mjs";
import { snapshot as medifyFixture } from "./fixtures/medify-snapshot";
import { ACCESS_FIXTURES, DIRECTOR_FIXTURE_PASSCODE } from "./fixtures/access-accounts";
import { createAccessFakeFetch } from "./helpers/access-fake-store";

const ORIGIN = "https://synthetic.example";
const SALT = "00112233445566778899aabbccddeeff";
const PASSCODE_HASH = `scrypt$${SALT}$${scryptSync(DIRECTOR_FIXTURE_PASSCODE, SALT, 64).toString("hex")}`;
const PUBLISHER_TOKEN = "synthetic-satusehat-publisher-token-32chars";
const PUBLISHER_TOKEN_HASH = createHash("sha256").update(PUBLISHER_TOKEN).digest("hex");

function sampleSatusehatSnapshot(overrides: Partial<SatusehatSnapshot> = {}): SatusehatSnapshot {
  const counts: Record<string, number> = {
    Encounter: 810,
    Condition: 1205,
    Observation: 3920,
    Procedure: 185,
    Composition: 520,
    Medication: 6900,
    MedicationRequest: 6200,
    MedicationDispense: 4950,
    AllergyIntolerance: 35,
    ImagingStudy: 0,
    ServiceRequest: 490,
    ClinicalImpression: 19,
    Immunization: 4,
    QuestionnaireResponse: 112,
    MedicationStatement: 410,
    CarePlan: 145,
    Specimen: 140,
    DiagnosticReport: 28,
    EpisodeOfCare: 6,
  };
  return {
    schemaVersion: 1,
    date: "2099-01-15",
    environment: "production",
    organizationId: "100027810",
    facilityCode: "3571148",
    facilityName: "RS Ibu dan Anak Melinda",
    observedAt: "2099-01-15T02:15:00.000Z",
    periodStart: "2098-12-17",
    periodEnd: "2099-01-15",
    periodLabel: "2098-12-17 s.d. 2099-01-15 (30 hari)",
    source: "oauth2_fhir_api",
    logSummary: null,
    resources: SATUSEHAT_FHIR_RESOURCE_NAMES.map((name) => ({
      name,
      count: counts[name] ?? 0,
      status: "ok",
      periodMode: "rolling_30d",
    })),
    unavailableResources: [],
    provenance: {
      producer: "biznet-satusehat",
      sourceObservedAt: "2099-01-15T02:15:00.000Z",
      periodStart: "2098-12-17",
      periodEnd: "2099-01-15",
      cutoff: null,
      sources: [
        {
          name: "API SATUSEHAT Kemenkes",
          url: "https://api-satusehat.kemkes.go.id",
          note: "Penarikan agregat _summary=count resmi Kemenkes tanpa data pasien.",
        },
      ],
      notes: "",
    },
    ...overrides,
  };
}

function buildOAuthMockFetch(options: {
  authStatus?: number;
  allTimeResources?: string[];
  failResources?: string[];
  injectEntry?: boolean;
} = {}) {
  const calls: string[] = [];
  let tokenRequests = 0;

  const fetchMock: typeof fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(`${init?.method ?? "GET"} ${url}`);

    if (url.startsWith(SATUSEHAT_ENDPOINTS.production.authBaseUrl)) {
      tokenRequests += 1;
      if (options.authStatus && options.authStatus >= 400) {
        return Response.json({ error: "invalid_client" }, { status: options.authStatus });
      }
      return Response.json({ access_token: "example-bearer-token", expires_in: "1439" });
    }

    if (url.startsWith(SATUSEHAT_ENDPOINTS.production.fhirBaseUrl)) {
      const parsed = new URL(url);
      const resource = parsed.pathname.split("/").pop() ?? "";
      const hasLastUpdated = parsed.searchParams.has("_lastUpdated");

      if (options.failResources?.includes(resource)) {
        return Response.json({ issue: "forbidden" }, { status: 403 });
      }
      if (hasLastUpdated && options.allTimeResources?.includes(resource)) {
        return Response.json({ issue: "unsupported_param" }, { status: 400 });
      }
      const idx = SATUSEHAT_FHIR_RESOURCE_NAMES.indexOf(resource as (typeof SATUSEHAT_FHIR_RESOURCE_NAMES)[number]);
      const base = idx >= 0 ? (idx + 1) * 17 : 10;
      return Response.json({
        resourceType: "Bundle",
        type: "searchset",
        total: resource === "ImagingStudy" ? 0 : base,
        ...(options.injectEntry
          ? { entry: [{ resource: { resourceType: resource, name: "DO_NOT_RETAIN_PHI" } }] }
          : {}),
      });
    }

    throw new Error(`Unexpected URL in OAuth mock: ${url}`);
  };

  return {
    fetch: fetchMock,
    calls,
    tokenRequests: () => tokenRequests,
  };
}

let tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function setupSupabaseFake(extra?: {
  oauthMock?: ReturnType<typeof buildOAuthMockFetch>;
  claudeText?: unknown;
}) {
  const fake = createAccessFakeFetch();
  type StoredDoc = {
    id: string;
    kind: string;
    report_date: string;
    producer: string;
    request_key: string;
    payload: unknown;
    payload_hash: string;
    received_at: string;
  };
  const docs: StoredDoc[] = [];
  const oauth = extra?.oauthMock ?? buildOAuthMockFetch();

  const stubFetch: typeof fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("https://api-satusehat")) {
      return oauth.fetch(input, init);
    }
    if (url === CLAUDE_ENDPOINT && extra?.claudeText !== undefined) {
      return Response.json({
        content: [{ type: "text", text: JSON.stringify(extra.claudeText) }],
        stop_reason: "end_turn",
      });
    }
    if (typeof init?.body === "string" && url.includes("/rpc/")) {
      const parsed = JSON.parse(init.body) as { command?: string };
      if (parsed.command === "board") {
        return Response.json({ instructions: [] });
      }
    }
    if (url.includes("/rpc/melinda_daily_documents")) {
      const { command, args } = JSON.parse(String(init?.body ?? "{}")) as {
        command: string;
        args: Record<string, unknown>;
      };
      if (command === "submit") {
        const existing = docs.find(
          (row) => row.kind === args.kind && row.producer === args.producerId && row.request_key === args.key,
        );
        if (existing) {
          return existing.payload_hash === args.payloadHash
            ? Response.json({
                replayed: true,
                id: existing.id,
                kind: existing.kind,
                date: existing.report_date,
                payloadHash: existing.payload_hash,
                receivedAt: existing.received_at,
              })
            : Response.json({ errorCode: "conflict" });
        }
        const row: StoredDoc = {
          id: `00000000-0000-4000-8000-${String(docs.length + 1).padStart(12, "0")}`,
          kind: args.kind as string,
          report_date: args.date as string,
          producer: args.producerId as string,
          request_key: args.key as string,
          payload: args.payload,
          payload_hash: args.payloadHash as string,
          received_at: "2099-01-15T02:20:00.000Z",
        };
        docs.push(row);
        return Response.json({
          replayed: false,
          id: row.id,
          kind: row.kind,
          date: row.report_date,
          payloadHash: row.payload_hash,
          receivedAt: row.received_at,
        });
      }
      if (command === "read") {
        const ofKind = docs
          .filter((row) => row.kind === args.kind && row.report_date <= String(args.date))
          .sort((a, b) => b.report_date.localeCompare(a.report_date) || b.received_at.localeCompare(a.received_at));
        return Response.json({ document: ofKind[0] ?? null });
      }
      if (command === "latest") {
        const ofKind = docs.filter((row) => row.kind === args.kind).at(-1) ?? null;
        return Response.json({ document: ofKind ? { ...ofKind, payload: undefined } : null });
      }
    }
    return fake.fetch(input, init);
  };

  vi.stubGlobal("fetch", stubFetch);
  return { fake, docs, oauth };
}

function stubProtectedEnv() {
  vi.stubEnv("MELINDAOS_DIRECTOR_STORE", "supabase");
  vi.stubEnv("MELINDAOS_APP_ORIGIN", ORIGIN);
  vi.stubEnv("MELINDAOS_SUPABASE_URL", "https://synthetic.supabase.co");
  vi.stubEnv("MELINDAOS_SUPABASE_SECRET_KEY", "sb_secret_synthetic");
  vi.stubEnv("MELINDAOS_REVIEWER_PASSCODE_HASH", PASSCODE_HASH);
  vi.stubEnv("MELINDAOS_REVIEWER_ID", "director");
  vi.stubEnv("MELINDAOS_SATUSEHAT_PUBLISHER_TOKEN_HASH", PUBLISHER_TOKEN_HASH);
  vi.stubEnv("MELINDAOS_SATUSEHAT_PUBLISHER_ID", "biznet-satusehat");
}

beforeEach(() => {
  tempDirs = [];
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearDailyDocumentCache();
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("SATUSEHAT snapshot contract", () => {
  it("accepts a valid OAuth2 snapshot and rejects unknown keys or invalid dates/percents", () => {
    const valid = sampleSatusehatSnapshot();
    expect(parseSatusehatSnapshot(valid)).toEqual(valid);

    expect(() => parseSatusehatSnapshot({ ...valid, patientName: "Anon" })).toThrow();
    expect(() =>
      parseSatusehatSnapshot({ ...valid, periodStart: "2099-02-01", periodEnd: "2099-01-15" }),
    ).toThrow(/period/);
    expect(() =>
      parseSatusehatSnapshot({
        ...valid,
        logSummary: {
          totalTransactions: 100,
          successfulTransactions: 80,
          failedTransactions: 20,
          successRatePercent: 120,
          failureRatePercent: 0,
        },
      }),
    ).toThrow(/percent/);
  });
});

describe("SATUSEHAT OAuth2 FHIR count client", () => {
  it("authenticates once, queries all 19 _summary=count resources, falls back on 400, and strips PHI", async () => {
    const mock = buildOAuthMockFetch({
      allTimeResources: ["Medication"],
      failResources: ["EpisodeOfCare"],
      injectEntry: true,
    });

    const result = await pullSatusehatOAuth({
      clientId: "synthetic-client-id",
      clientSecret: "synthetic-client-secret",
      organizationId: "100027810",
      environment: "production",
      concurrency: 3,
      fetch: mock.fetch,
      now: () => new Date("2099-01-15T02:15:00.000Z"),
    });

    expect(mock.tokenRequests()).toBe(1);
    expect(result.resources).toHaveLength(19);
    expect(result.unavailableResources).toEqual(["EpisodeOfCare"]);
    expect(result.resources.find((r) => r.name === "Medication")?.periodMode).toBe("all_time");
    expect(result.resources.find((r) => r.name === "Encounter")?.periodMode).toBe("rolling_30d");
    expect(JSON.stringify(result)).not.toContain("DO_NOT_RETAIN_PHI");
    expect(parseSatusehatSnapshot(result).date).toBe("2099-01-15");
  });

  it("fails closed when OAuth2 token exchange fails without issuing FHIR queries", async () => {
    const mock = buildOAuthMockFetch({ authStatus: 401 });
    await expect(
      pullSatusehatOAuth({
        clientId: "bad-id",
        clientSecret: "bad-secret",
        organizationId: "100027810",
        fetch: mock.fetch,
      }),
    ).rejects.toThrow(/OAuth2 SATUSEHAT gagal/);
    expect(mock.tokenRequests()).toBe(1);
    expect(mock.calls).toHaveLength(1);
  });

  it("rejects non-HTTPS auth or FHIR URLs", async () => {
    await expect(
      pullSatusehatOAuth({
        clientId: "id",
        clientSecret: "sec",
        organizationId: "100027810",
        authBaseUrl: "http://insecure.example/oauth2/v1",
      }),
    ).rejects.toThrow(/https/);
  });
});

describe("SATUSEHAT inbound publisher & sync APIs", () => {
  it("validates, blocks PHI, rejects wrong bearer tokens, and stores satusehat_snapshot", async () => {
    stubProtectedEnv();
    const { docs } = setupSupabaseFake();
    const snap = sampleSatusehatSnapshot();

    const wrongToken = await publishSatusehat(
      new Request(`${ORIGIN}/api/director/satusehat-snapshot`, {
        method: "POST",
        headers: {
          Authorization: "Bearer wrong-token",
          "Idempotency-Key": "satusehat-key-0001",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(snap),
      }),
    );
    expect(wrongToken.status).toBe(401);

    const phiLeak = sampleSatusehatSnapshot({
      provenance: {
        ...snap.provenance,
        notes: "Pasien RM-123456 dengan NIK 3571011234560001 gagal terkirim.",
      },
    });
    const blocked = await publishSatusehat(
      new Request(`${ORIGIN}/api/director/satusehat-snapshot`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${PUBLISHER_TOKEN}`,
          "Idempotency-Key": "satusehat-key-phi-1",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(phiLeak),
      }),
    );
    expect(blocked.status).toBe(422);

    const prepared = prepareSatusehatSnapshot(JSON.stringify(snap), "satusehat-key-valid-1");
    const receipt = await submitSatusehatSnapshot(prepared, {
      baseUrl: ORIGIN,
      token: PUBLISHER_TOKEN,
      fetch: async (_url: RequestInfo | URL, init?: RequestInit) =>
        publishSatusehat(
          new Request(`${ORIGIN}/api/director/satusehat-snapshot`, {
            method: "POST",
            headers: init?.headers,
            body: init?.body,
          }),
        ),
    });
    expect(receipt).toMatchObject({ status: "stored", kind: "satusehat_snapshot", replayed: false });
    expect(docs).toHaveLength(1);

    const readBack = await readSatusehatSnapshot("2099-01-15", new Date("2099-01-15T03:00:00.000Z"));
    expect(readBack.status).toBe("current");
    expect(readBack.snapshot?.organizationId).toBe("100027810");
  });

  it("protects POST /api/director/satusehat/sync with RBAC/CSRF before checking OAuth2 credentials", async () => {
    stubProtectedEnv();
    const { fake, docs } = setupSupabaseFake();

    const unauth = await syncSatusehat(
      new Request(`${ORIGIN}/api/director/satusehat/sync`, {
        method: "POST",
        headers: { Origin: ORIGIN },
      }),
    );
    expect(unauth.status).toBe(401);

    const rawDirector = fake.directorToken();
    const missingCsrf = await syncSatusehat(
      new Request(`${ORIGIN}/api/director/satusehat/sync`, {
        method: "POST",
        headers: { Origin: ORIGIN, Cookie: `melinda_director=${rawDirector}` },
      }),
    );
    expect(missingCsrf.status).toBe(403);

    const rawFinance = fake.signIn(ACCESS_FIXTURES[1].email);
    const financeCsrf = csrfForSession(
      rawFinance,
      fake.state.users.find((u) => u.email === ACCESS_FIXTURES[1].email)!.credentialVersion,
    );
    const forbidden = await syncSatusehat(
      new Request(`${ORIGIN}/api/director/satusehat/sync`, {
        method: "POST",
        headers: {
          Origin: ORIGIN,
          Cookie: `melinda_user=${rawFinance}`,
          "X-CSRF-Token": financeCsrf,
        },
      }),
    );
    expect(forbidden.status).toBe(403);

    const directorCsrf = csrfForSession(rawDirector, PASSCODE_HASH);
    const noCreds = await syncSatusehat(
      new Request(`${ORIGIN}/api/director/satusehat/sync`, {
        method: "POST",
        headers: {
          Origin: ORIGIN,
          Cookie: `melinda_director=${rawDirector}`,
          "X-CSRF-Token": directorCsrf,
        },
      }),
    );
    expect(noCreds.status).toBe(503);

    vi.stubEnv("SATUSEHAT_CLIENT_ID", "synthetic-id");
    vi.stubEnv("SATUSEHAT_CLIENT_SECRET", "synthetic-secret");
    vi.stubEnv("SATUSEHAT_ORG_ID", "100027810");
    const synced = await syncSatusehat(
      new Request(`${ORIGIN}/api/director/satusehat/sync`, {
        method: "POST",
        headers: {
          Origin: ORIGIN,
          Cookie: `melinda_director=${rawDirector}`,
          "X-CSRF-Token": directorCsrf,
        },
      }),
    );
    expect(synced.status).toBe(201);
    const body = (await synced.json()) as { snapshot: SatusehatSnapshot; receipt: { kind: string } };
    expect(body.receipt.kind).toBe("satusehat_snapshot");
    expect(body.snapshot.resources).toHaveLength(19);
    expect(docs).toHaveLength(1);
  });

  it("writes to file store on sync when MELINDAOS_DIRECTOR_STORE=file", async () => {
    const dir = createTempDir("melinda-satusehat-sync-");
    setupSupabaseFake();
    vi.stubEnv("MELINDAOS_DIRECTOR_STORE", "file");
    vi.stubEnv("MELINDAOS_SATUSEHAT_DIR", dir);
    vi.stubEnv("SATUSEHAT_CLIENT_ID", "synthetic-id");
    vi.stubEnv("SATUSEHAT_CLIENT_SECRET", "synthetic-secret");
    vi.stubEnv("SATUSEHAT_ORG_ID", "100027810");

    const response = await syncSatusehat(
      new Request("http://127.0.0.1:3000/api/director/satusehat/sync", { method: "POST" }),
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { snapshot: SatusehatSnapshot };
    const stored = await readSatusehatSnapshot(body.snapshot.date);
    expect(stored.status).toBe("current");
    expect(stored.snapshot?.organizationId).toBe("100027810");
  });
});

describe("Vercel Cron GET /api/cron/satusehat", () => {
  const CRON_SECRET = "synthetic-cron-secret-0123456789";
  const cronRequest = (authorization?: string) =>
    new Request(`${ORIGIN}/api/cron/satusehat`, {
      headers: authorization ? { Authorization: authorization } : {},
    });
  const stubOAuthEnv = () => {
    vi.stubEnv("SATUSEHAT_CLIENT_ID", "synthetic-id");
    vi.stubEnv("SATUSEHAT_CLIENT_SECRET", "synthetic-secret");
    vi.stubEnv("SATUSEHAT_ORG_ID", "100027810");
  };

  it("runs at 05:55 and 17:55 WIB, five minutes before the Medify pull", () => {
    const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")) as {
      crons: { path: string; schedule: string }[];
    };
    expect(vercel.crons).toEqual([
      { path: "/api/cron/satusehat", schedule: "55 22 * * *" },
      { path: "/api/cron/satusehat", schedule: "55 10 * * *" },
    ]);
  });

  it("fails closed with 401 when CRON_SECRET is unset, short, or the bearer does not match", async () => {
    setupSupabaseFake();
    stubOAuthEnv();
    vi.stubEnv("CRON_SECRET", "");
    expect((await cronGet(cronRequest(`Bearer ${CRON_SECRET}`))).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "short-secret");
    expect((await cronGet(cronRequest("Bearer short-secret"))).status).toBe(401);
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
    expect((await cronGet(cronRequest())).status).toBe(401);
    expect((await cronGet(cronRequest(CRON_SECRET))).status).toBe(401);
    expect((await cronGet(cronRequest(`Bearer ${CRON_SECRET}x`))).status).toBe(401);
  });

  it("pulls and stores one satusehat_snapshot with the matching bearer", async () => {
    stubProtectedEnv();
    const { docs } = setupSupabaseFake();
    stubOAuthEnv();
    vi.stubEnv("CRON_SECRET", CRON_SECRET);

    const response = await cronGet(cronRequest(`Bearer ${CRON_SECRET}`));
    expect(response.status).toBe(201);
    const body = (await response.json()) as { snapshot: SatusehatSnapshot; receipt: { kind: string } };
    expect(body.receipt.kind).toBe("satusehat_snapshot");
    expect(body.snapshot.resources).toHaveLength(19);
    expect(docs).toHaveLength(1);
    expect(docs[0].producer).toBe("vercel-cron-satusehat");
    expect(docs[0].request_key.startsWith("satusehat-cron-")).toBe(true);
  });

  it("homepage sync pulls today's missing snapshot and still composes when the pull fails", async () => {
    stubProtectedEnv();
    const { docs } = setupSupabaseFake();
    stubOAuthEnv();
    const pulled = await syncTodayAllPages(requireConfiguration());
    expect(pulled.briefComposed).toBe(true);
    const stored = docs.filter((row) => row.kind === "satusehat_snapshot");
    expect(stored).toHaveLength(1);
    expect(stored[0].producer).toBe("melinda-sync-today");

    clearDailyDocumentCache();
    const failing = setupSupabaseFake({ oauthMock: buildOAuthMockFetch({ authStatus: 401 }) });
    const result = await syncTodayAllPages(requireConfiguration());
    expect(result.briefComposed).toBe(true);
    expect(failing.docs.filter((row) => row.kind === "satusehat_snapshot")).toHaveLength(0);
  });
});

describe("AI Morning Brief Composer SATUSEHAT integration", () => {
  it("emits grounded SATUSEHAT facts and feeds them automatically into composeAndStoreBrief", async () => {
    stubProtectedEnv();
    vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-anthropic-key");

    const portalSnap = sampleSatusehatSnapshot({
      unavailableResources: ["EpisodeOfCare"],
      logSummary: {
        totalTransactions: 1000,
        successfulTransactions: 800,
        failedTransactions: 200,
        successRatePercent: 80,
        failureRatePercent: 20,
      },
    });
    const medify = medifyFixture({});
    const facts = detectFacts(medify, portalSnap);

    const ids = facts.map((f) => f.id);
    expect(ids).toContain("keadaan:satusehat_kemenkes.total");
    expect(ids).toContain("ambang:satusehat_kemenkes.error_rate");
    expect(ids).toContain("ambang:satusehat_kemenkes.lab_gap");
    expect(ids).toContain("ambang:satusehat_kemenkes.rsia_gap");
    expect(ids).toContain("data:satusehat_kemenkes.unavailable");

    const satFacts = facts.filter((f) => f.id.includes("satusehat_kemenkes"));
    for (const fact of satFacts) {
      expect(fact.metric).toBeNull();
      expect(isGrounded(fact.text, new Set(fact.values))).toBe(true);
      expect(isGrounded(fact.text, allowedNumbers([fact]))).toBe(true);
    }

    const composed = composeBrief({
      snapshot: medify,
      satusehatSnapshot: portalSnap,
      facts,
      narrative: null,
      openInstructions: [],
    });
    expect(composed.sources).toContain("Satu Sehat Kemenkes");
    expect(composed.safetyQuality.exceptions.some((item) => item.eksepsi.includes("Kemenkes"))).toBe(true);
    expect(composed.dataLimitations.items.some((item) => item.includes("EpisodeOfCare"))).toBe(true);

    const { docs } = setupSupabaseFake({
      claudeText: {
        serviceSummary: "Okupansi stabil.",
        safetyQuality: "Tingkat keberhasilan pengiriman ke Satu Sehat Kemenkes 80,0% (200 gagal dari 1.000 pengiriman).",
        pharmacy: "",
        staffing: "",
        decisions: [],
        conclusion: ["Perlu pemantauan Satu Sehat Kemenkes."],
      },
    });

    const pubRes = await publishSatusehat(
      new Request(`${ORIGIN}/api/director/satusehat-snapshot`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${PUBLISHER_TOKEN}`,
          "Idempotency-Key": "satusehat-brief-seed-1",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(portalSnap),
      }),
    );
    expect(pubRes.status).toBe(201);

    const outcome = await composeAndStoreBrief(requireConfiguration(), medify, "b".repeat(64));
    expect(outcome).toBe("stored");
    const briefRow = docs.find((d) => d.kind === "management_brief");
    expect(briefRow).toBeDefined();
    const brief = parseMelindaBrief(briefRow!.payload);
    expect(brief.sources).toContain("Satu Sehat Kemenkes");
    expect(brief.composer?.facts).toBe(facts.length);
  });
});

describe("Biznet Gio SATUSEHAT scheduler kit", () => {
  const dir = new URL("../deploy/biznet-satusehat/", import.meta.url);
  const read = (name: string) => readFileSync(new URL(name, dir), "utf8");

  it("schedules morning (05:55) and evening (17:55) Jakarta timers, five minutes before Medify", () => {
    const morning = read("melindaos-satusehat-morning.timer");
    const evening = read("melindaos-satusehat-evening.timer");
    expect(morning).toContain("OnCalendar=*-*-* 05:55:00 Asia/Jakarta");
    expect(morning).toContain("Unit=melindaos-satusehat@morning.service");
    expect(evening).toContain("OnCalendar=*-*-* 17:55:00 Asia/Jakarta");
    expect(evening).toContain("Unit=melindaos-satusehat@evening.service");
    for (const timer of [morning, evening]) expect(timer).toContain("Persistent=true");
  });

  it("installs the standalone .mjs scripts using only node: and ./ imports", () => {
    const install = read("install.sh");
    const listed = install.match(/SCRIPTS=\(([^)]*)\)/)?.[1].trim().split(/\s+/) ?? [];
    expect(listed.sort()).toEqual([
      "daily-publisher-client.mjs",
      "run-satusehat-scheduled.mjs",
      "satusehat-pull.mjs",
    ]);
    for (const script of listed) {
      expect(existsSync(new URL(`../scripts/${script}`, import.meta.url))).toBe(true);
      const source = readFileSync(new URL(`../scripts/${script}`, import.meta.url), "utf8");
      const local = [...source.matchAll(/from "\.\/([^"]+)"/g)].map((m) => m[1]);
      for (const dep of local) expect(listed).toContain(dep);
      expect(source).not.toMatch(/from "(?!node:|\.\/)/);
    }
  });

  it("keeps all secrets empty in satusehat.env.example", () => {
    const example = read("satusehat.env.example");
    for (const key of [
      "SATUSEHAT_CLIENT_ID",
      "SATUSEHAT_CLIENT_SECRET",
      "SATUSEHAT_ORG_ID",
      "MELINDAOS_PUBLISHER_TOKEN",
    ]) {
      expect(example).toMatch(new RegExp(`^${key}=$`, "m"));
    }
    expect(example).toMatch(/^MELINDAOS_DASHBOARD_URL=https:\/\/melindaos\.app$/m);
  });
});
