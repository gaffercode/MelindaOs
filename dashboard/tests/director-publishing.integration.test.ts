import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as login, DELETE as logout } from "@/app/api/director/session/route";
import { GET as queue } from "@/app/api/director/reviews/route";
import { POST as review } from "@/app/api/director/reviews/[id]/route";
import { GET as knowledgeSearch } from "@/app/api/search/route";
import { readDirectorDay } from "@/lib/director/director-repository";
import { canonicalHash, SupabaseDirectorStore } from "@/lib/director/director-store";
import type { ReviewQueue } from "@/lib/director/director-api";
import type { DirectorSubmission } from "@/lib/director/director-submission";
import template from "@/data/director/templates/day-v2.json";

// Opt-in only: this suite retains synthetic history in a dedicated QA database.
const enabled = process.env.MELINDAOS_RUN_DATABASE_TESTS === "1";
const origin = new URL(`https://qa-${randomUUID()}.invalid`).origin;
let databaseUrl: string;
let databaseSecret: string;
let date: string;
let producerId: string;
let human: Record<string, string>;

function request(path: string, method: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(new URL(path, origin), {
    method, headers: { "Content-Type": "application/json", Origin: origin, ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function fixture(title: string): DirectorSubmission {
  const timestamp = `${date}T10:30:00+07:00`;
  return {
    brief: {
      ...structuredClone(template.brief), schemaVersion: 2, date,
      priorities: { updatedAt: timestamp, source: "QA sintetis", items: [{ id: "qa-priority", title, note: "Bukan laporan rumah sakit", urgent: false }] },
    },
    provenance: {
      priorities: { sourceObservedAt: timestamp, periodStart: date, periodEnd: date, cutoff: null,
        source: { label: "QA sintetis", reference: `urn:qa:${randomUUID()}` }, metricDefinitions: {} },
    },
  };
}
type SubmissionReceipt = { submissionId: string; revisionId: string; payloadHash: string; status: string; replayed?: boolean };
/** Writes a pending revision straight to the store, as a producer once did through the retired submissions route. */
function store() { return new SupabaseDirectorStore(databaseUrl, databaseSecret); }
async function draft(payload: DirectorSubmission, key: string): Promise<SubmissionReceipt> {
  return await store().call<SubmissionReceipt>("submit", { producerId, key, payloadHash: canonicalHash(payload), payload });
}
async function submissionStatus(id: string) {
  return await store().call<{ status: string }>("submission_read", { producerId, id });
}
function decision(receipt: SubmissionReceipt, action: string, previous: string | null, key: string) {
  return review(request(`/api/director/reviews/${receipt.revisionId}`, "POST", {
    action, payloadHash: receipt.payloadHash, expectedPublishedRevisionId: previous,
    ...(action === "reject" ? { reason: "Koreksi QA ditolak" } : {}),
  }, { ...human, "Idempotency-Key": key }), { params: Promise.resolve({ id: receipt.revisionId }) });
}

describe.skipIf(!enabled)("real Supabase publishing integration (dedicated QA only)", () => {
  beforeEach(async () => {
    databaseUrl = process.env.MELINDAOS_TEST_SUPABASE_URL ?? "";
    databaseSecret = process.env.MELINDAOS_TEST_SUPABASE_SECRET_KEY ?? "";
    let url: URL;
    try { url = new URL(databaseUrl); } catch { throw new Error("Explicit QA Supabase URL and secret key are required; no production fallback."); }
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash || !databaseSecret) {
      throw new Error("Explicit QA Supabase URL and secret key are required; no production fallback.");
    }
    const run = randomUUID();
    const entropy = randomBytes(3);
    date = `${1900 + entropy[0] % 100}-${String(1 + entropy[1] % 12).padStart(2, "0")}-${String(1 + entropy[2] % 28).padStart(2, "0")}`;
    producerId = `qa-${run}`;
    const passcode = randomBytes(32).toString("hex"), salt = randomBytes(32).toString("hex");
    vi.stubEnv("MELINDAOS_DIRECTOR_STORE", "supabase");
    vi.stubEnv("MELINDAOS_APP_ORIGIN", origin);
    vi.stubEnv("MELINDAOS_SUPABASE_URL", databaseUrl);
    vi.stubEnv("MELINDAOS_SUPABASE_SECRET_KEY", databaseSecret);
    vi.stubEnv("MELINDAOS_REVIEWER_ID", `qa-${run}`);
    vi.stubEnv("MELINDAOS_REVIEWER_PASSCODE_HASH", `scrypt$${salt}$${scryptSync(passcode, salt, 64).toString("hex")}`);
    vi.stubEnv("MELINDAOS_ALLOW_LOCAL_HTTP", "0");
    expect((await readDirectorDay(date)).status).toBe("missing");
    const response = await login(request("/api/director/session", "POST", { passcode }));
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie")?.split(";")[0];
    if (!cookie) throw new Error("QA login did not create a session.");
    const session = await response.json() as { csrfToken: string };
    human = { Cookie: cookie, "X-CSRF-Token": session.csrfToken };
    const pending = await queue(request(`/api/director/reviews?tanggal=${date}`, "GET", undefined, human));
    expect(pending.status).toBe(200);
    expect((await pending.json() as ReviewQueue).pending).toHaveLength(0);
  }, 60_000);
  afterEach(async () => {
    try {
      if (human) await logout(request("/api/director/session", "DELETE", undefined, human));
    } finally {
      human = {};
      vi.unstubAllEnvs();
    }
  }, 15_000);

  it("displays received reports, replays delivery and records optional review", async () => {
    const payload = fixture("QA publikasi pertama");
    const receipt = await draft(payload, `qa-${randomUUID()}`);
    expect(receipt.status).toBe("pending");
    const received = await readDirectorDay(date);
    expect(received.status).toBe("available");
    expect(received.submission).toMatchObject({ revisionId: receipt.revisionId, reviewStatus: "pending" });
    expect(received.publication).toBeUndefined();
    const key = `qa-${randomUUID()}`;
    const delivery = await draft(payload, key);
    expect(await draft(payload, key)).toMatchObject({ submissionId: delivery.submissionId, revisionId: receipt.revisionId, replayed: true });
    const reviewKey = `qa-${randomUUID()}`;
    const published = await decision(receipt, "approve-and-publish", null, reviewKey);
    expect(published.status).toBe(200);
    const result = await published.json();
    expect(await (await decision(receipt, "approve-and-publish", null, reviewKey)).json()).toEqual(result);
    const day = await readDirectorDay(date);
    expect(day.status).toBe("available");
    expect(day.publication).toMatchObject({ revisionId: receipt.revisionId, payloadHash: receipt.payloadHash });
    expect(day.data.priorities.items[0].title).toBe("QA publikasi pertama");
    const correction = await draft(fixture("QA koreksi belum disetujui"), `qa-${randomUUID()}`);
    expect((await readDirectorDay(date)).data.priorities.items[0].title).toBe("QA koreksi belum disetujui");
    expect((await decision(correction, "reject", receipt.revisionId, `qa-${randomUUID()}`)).status).toBe(200);
    expect(await submissionStatus(correction.submissionId)).toMatchObject({ status: "rejected" });
    expect((await readDirectorDay(date)).data.priorities.items[0].title).toBe("QA publikasi pertama");
    expect(await store().call("published", { date })).toMatchObject({ published: { id: receipt.revisionId, payload_hash: receipt.payloadHash } });
  }, 90_000);

  it("allows only one competing publication with the same expected baseline", async () => {
    const first = await draft(fixture("QA kandidat pertama"), `qa-${randomUUID()}`);
    const second = await draft(fixture("QA kandidat kedua"), `qa-${randomUUID()}`);
    const responses = await Promise.all([decision(first, "approve-and-publish", null, `qa-${randomUUID()}`), decision(second, "approve-and-publish", null, `qa-${randomUUID()}`)]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const winner = responses[0].status === 200 ? first : second;
    const loser = responses[0].status === 200 ? second : first;
    expect(await store().call("published", { date })).toMatchObject({ published: { id: winner.revisionId } });
    const received = await readDirectorDay(date);
    expect(received.status).toBe("available");
    expect([first.revisionId, second.revisionId]).toContain(received.submission?.revisionId);
    if (received.submission?.revisionId === loser.revisionId) {
      expect(received.submission.reviewStatus).toBe("pending");
      expect(received.publication).toBeUndefined();
    } else {
      expect(received.publication?.revisionId).toBe(winner.revisionId);
    }
    expect(await submissionStatus(loser.submissionId)).toMatchObject({ status: "pending" });
  }, 60_000);

  it("denies a bearer token review and knowledge access and requires human CSRF", async () => {
    const botHeaders = { Authorization: `Bearer ${randomBytes(32).toString("hex")}` };
    expect((await queue(request(`/api/director/reviews?tanggal=${date}`, "GET", undefined, botHeaders))).status).toBe(401);
    expect((await knowledgeSearch(request("/api/search?q=QA", "GET", undefined, botHeaders))).status).toBe(401);
    const receipt = await draft(fixture("QA pemeriksaan izin"), `qa-${randomUUID()}`);
    const forged = await review(request(`/api/director/reviews/${receipt.revisionId}`, "POST", { action: "approve-and-publish", payloadHash: receipt.payloadHash, expectedPublishedRevisionId: null }, { Cookie: human.Cookie, "Idempotency-Key": `qa-${randomUUID()}` }), { params: Promise.resolve({ id: receipt.revisionId }) });
    expect(forged.status).toBe(403);
    const received = await readDirectorDay(date);
    expect(received.status).toBe("available");
    expect(received.submission?.reviewStatus).toBe("pending");
    expect(received.publication).toBeUndefined();
  }, 60_000);
});
