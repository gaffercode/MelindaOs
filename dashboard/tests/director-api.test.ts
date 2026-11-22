import { scryptSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as sessionGet, POST as login, DELETE as logout } from "@/app/api/director/session/route";
import { GET as reviews } from "@/app/api/director/reviews/route";
import { POST as review } from "@/app/api/director/reviews/[id]/route";
import { hashSecret } from "@/lib/director/director-auth";
import { canonicalHash } from "@/lib/director/director-store";
import { GET as knowledgeSearch } from "@/app/api/search/route";
import { GET as knowledgeDashboard } from "@/app/api/dashboard/route";
import template from "@/data/director/templates/day-v2.json";
import type { Revision } from "@/lib/director/director-api";

const origin = "https://synthetic.example";
const salt = "00112233445566778899aabbccddeeff";
const passcodeHash = `scrypt$${salt}$${scryptSync("synthetic-test-passcode", salt, 64).toString("hex")}`;
const id = "00000000-0000-4000-8000-000000000001";
let session: { reviewerId: string } | null;
let allowed: boolean;
let calls: { command: string; args: Record<string, unknown> }[];
let published: Revision | null;

beforeEach(() => {
  session = null; allowed = true; calls = []; published = null;
  vi.stubEnv("MELINDAOS_DIRECTOR_STORE", "supabase");
  vi.stubEnv("MELINDAOS_APP_ORIGIN", origin);
  vi.stubEnv("MELINDAOS_SUPABASE_URL", "https://synthetic.supabase.co");
  vi.stubEnv("MELINDAOS_SUPABASE_SECRET_KEY", "sb_secret_synthetic");
  vi.stubEnv("MELINDAOS_REVIEWER_PASSCODE_HASH", passcodeHash);
  vi.stubEnv("MELINDAOS_REVIEWER_ID", "director-test");
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const input = JSON.parse(init.body as string) as { command: string; args: Record<string, unknown> };
    calls.push(input);
    if (input.command === "rate_limit") return Response.json({ allowed });
    if (input.command === "session_create") { session = { reviewerId: "director-test" }; return Response.json({ ok: true }); }
    if (input.command === "session_read") return Response.json({ session });
    if (input.command === "session_revoke") { session = null; return Response.json({ ok: true }); }
    if (input.command === "review_list") return Response.json({ pending: [], publishedRevisionId: null, published: null });
    if (input.command === "published") return Response.json({ published });
    if (input.command === "revision_read") return Response.json({ revision: { id, report_date: "2026-10-03", producer: "test-producer", payload_hash: canonicalHash(template), payload: template, status: "pending", received_at: "2026-10-03T10:30:00+07:00" } });
    if (input.command === "review") return Response.json({ revisionId: id, status: "published" });
    return Response.json({ ok: true });
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function request(path: string, method: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`${origin}${path}`, { method, headers: { "Content-Type": "application/json", Origin: origin, ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function humanSession() {
  const response = await login(request("/api/director/session", "POST", { passcode: "synthetic-test-passcode", returnTo: "/director-review" }));
  const cookie = response.headers.get("set-cookie")!.split(";")[0];
  const body = await response.json() as { csrfToken: string };
  return { Cookie: cookie, "X-CSRF-Token": body.csrfToken };
}

describe("director is the only login role", () => {
  const mutuHash = `scrypt$${salt}$${scryptSync("synthetic-mutu-passcode", salt, 64).toString("hex")}`;
  it("logs a stale mutu login request in as Director and keeps the STARKES return path", async () => {
    const response = await login(request("/api/director/session", "POST", { passcode: "synthetic-test-passcode", role: "mutu", returnTo: "/starkes" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ role: "director", returnTo: "/starkes" });
    expect(calls.find((call) => call.command === "session_create")?.args.reviewerId).toBe("director-test");
  });
  it("ignores the old mutu env vars and rejects the mutu passcode", async () => {
    vi.stubEnv("MELINDAOS_MUTU_PASSCODE_HASH", mutuHash);
    vi.stubEnv("MELINDAOS_MUTU_REVIEWER_ID", "mutu-test");
    const response = await login(request("/api/director/session", "POST", { passcode: "synthetic-mutu-passcode", returnTo: "/starkes" }));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "Passcode tidak sesuai." });
  });
  it("reads the session with the Director credential only", async () => {
    vi.stubEnv("MELINDAOS_MUTU_PASSCODE_HASH", mutuHash);
    vi.stubEnv("MELINDAOS_MUTU_REVIEWER_ID", "mutu-test");
    const credentials = await humanSession();
    session = { reviewerId: "mutu-test" };
    calls = [];
    expect((await sessionGet(request("/api/director/session", "GET", undefined, credentials))).status).toBe(401);
    expect(calls.filter((call) => call.command === "session_read")).toHaveLength(1);
    expect(calls[0].args.credentialVersion).toBe(hashSecret(passcodeHash));
  });
});

describe("real director route handlers", () => {
  it("creates an opaque HttpOnly session, binds CSRF and revokes access on logout", async () => {
    const credentials = await humanSession();
    expect(credentials.Cookie).toMatch(/^melinda_director=[a-f0-9]{64}$/);
    expect((await sessionGet(request("/api/director/session", "GET", undefined, credentials))).status).toBe(200);
    expect((await reviews(request("/api/director/reviews?tanggal=2026-10-03", "GET", undefined, credentials))).status).toBe(200);
    expect((await logout(request("/api/director/session", "DELETE", undefined, credentials))).status).toBe(200);
    expect((await sessionGet(request("/api/director/session", "GET", undefined, credentials))).status).toBe(401);
    expect(calls.find((call) => call.command === "session_create")?.args.tokenHash).not.toBe(credentials.Cookie.slice(16));
  });
  it("rejects incorrect passcode, rate-limited attempts and cross-origin login", async () => {
    expect((await login(request("/api/director/session", "POST", { passcode: "wrong" }))).status).toBe(401);
    expect(calls.filter((call) => call.command === "rate_limit")).toHaveLength(2);
    allowed = false;
    expect((await login(request("/api/director/session", "POST", { passcode: "synthetic-test-passcode" }))).status).toBe(429);
    expect((await login(request("/api/director/session", "POST", { passcode: "synthetic-test-passcode" }, { Origin: "https://other.example" }))).status).toBe(403);
  });
  it("throttles wrong passcodes per client address before verifying them", async () => {
    allowed = false;
    const response = await login(request("/api/director/session", "POST", { passcode: "wrong" }, { "X-Forwarded-For": "203.0.113.9, 10.0.0.1" }));
    expect(response.status).toBe(429);
    expect(calls.map((call) => call.command)).toEqual(["rate_limit"]);
    expect(calls[0].args.bucket).toBe("login-ip:203.0.113.9");
  });
  it("throttles wrong passcodes for the Director account across addresses before verifying them", async () => {
    const original = globalThis.fetch;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      const input = JSON.parse(init.body as string) as { command: string; args: Record<string, unknown> };
      if (input.command === "rate_limit" && input.args.bucket === "login-global:director-test") { calls.push(input); return Response.json({ allowed: false }); }
      return original(url, init);
    });
    const response = await login(request("/api/director/session", "POST", { passcode: "synthetic-test-passcode" }, { "X-Forwarded-For": "198.51.100.7" }));
    expect(response.status).toBe(429);
    expect(calls.map((call) => call.args.bucket).filter(Boolean)).toEqual(["login-ip:198.51.100.7", "login-global:director-test"]);
    expect(calls.some((call) => call.command === "session_create")).toBe(false);
    // The lock is marked for the home page alert.
    expect(calls.find((call) => call.command === "heartbeat")?.args).toEqual({ producer: "alert:login-global-locked" });
  });
  it("refuses a bearer token on the human review and knowledge routes", async () => {
    const headers = { Authorization: "Bearer synthetic-bot-token", "Idempotency-Key": "synthetic-delivery-1" };
    expect((await reviews(request("/api/director/reviews?tanggal=2026-10-03", "GET", undefined, headers))).status).toBe(401);
    expect((await knowledgeSearch(request("/api/search?q=BPJS", "GET", undefined, headers))).status).toBe(401);
    expect((await knowledgeDashboard(request("/api/dashboard", "GET", undefined, headers))).status).toBe(401);
    expect((await review(request(`/api/director/reviews/${id}`, "POST", {}, headers), { params: Promise.resolve({ id }) })).status).toBe(401);
  });
  it("requires CSRF for review and fails closed when configuration or storage is unavailable", async () => {
    const credentials = await humanSession();
    expect((await review(request(`/api/director/reviews/${id}`, "POST", {}, { Cookie: credentials.Cookie }), { params: Promise.resolve({ id }) })).status).toBe(403);
    vi.stubGlobal("fetch", async () => { throw new Error("private connection credential"); });
    const failed = await sessionGet(request("/api/director/session", "GET", undefined, credentials));
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain("credential");
    vi.stubEnv("MELINDAOS_REVIEWER_PASSCODE_HASH", "");
    expect((await login(request("/api/director/session", "POST", { passcode: "synthetic-test-passcode" }))).status).toBe(503);
  });
  it("binds human publication to the reviewed hash and expected previous revision", async () => {
    const credentials = await humanSession();
    const headers = { ...credentials, "Idempotency-Key": "synthetic-review-1" };
    const body = { action: "approve-and-publish", payloadHash: canonicalHash(template), expectedPublishedRevisionId: null };
    expect((await review(request(`/api/director/reviews/${id}`, "POST", { ...body, expectedPublishedRevisionId: "-".repeat(36) }, headers), { params: Promise.resolve({ id }) })).status).toBe(400);
    expect((await review(request(`/api/director/reviews/${id}`, "POST", body, headers), { params: Promise.resolve({ id }) })).status).toBe(200);
    expect(calls.find((call) => call.command === "review")?.args).toMatchObject({ reviewerId: "director-test", id, expectedPublishedRevisionId: null, payloadHash: body.payloadHash });
    expect((await review(request(`/api/director/reviews/${id}`, "POST", { ...body, payloadHash: "1".repeat(64) }, headers), { params: Promise.resolve({ id }) })).status).toBe(409);
    expect((await review(request(`/api/director/reviews/${id}`, "POST", { ...body, action: "reject", reason: " " }, headers), { params: Promise.resolve({ id }) })).status).toBe(400);
  });
  it("prevents checking an older pending report from superseding a newer checked report", async () => {
    const credentials = await humanSession();
    for (const receivedAt of ["2026-10-03T10:45:00+07:00", "2026-10-03T10:30:00+07:00"]) {
      published = { id: "00000000-0000-4000-8000-000000000002", report_date: "2026-10-03", producer: "test-producer", payload_hash: canonicalHash(template), payload: template as Revision["payload"], status: "published", received_at: receivedAt };
      const response = await review(request(`/api/director/reviews/${id}`, "POST", { action: "approve-and-publish", payloadHash: canonicalHash(template), expectedPublishedRevisionId: published.id }, { ...credentials, "Idempotency-Key": `synthetic-check-${receivedAt.slice(11, 16).replace(":", "")}` }), { params: Promise.resolve({ id }) });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: expect.stringContaining("lebih baru") });
      expect(calls.some(call => call.command === "review")).toBe(false);
    }
  });
});
