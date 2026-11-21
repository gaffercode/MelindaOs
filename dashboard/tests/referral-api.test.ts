import { scryptSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as updateReferral } from "@/app/api/director/referrals/[id]/route";
import { GET as sessionGet, POST as loginPost } from "@/app/api/director/session/route";
import { POST as submitReferral } from "@/app/api/rujukan/route";
import { parseReferralPayload } from "@/lib/referral/referral-contract";
import { emptyReferralDraft } from "@/lib/referral/referral-types";

const origin = "https://synthetic.example";
const salt = "00112233445566778899aabbccddeeff";
const passcode = "referral-api-passcode-123";
const referralId = "00000000-0000-4000-8000-000000000001";

function validPayload() {
  const draft = emptyReferralDraft("2026-11-16", "09:30");
  draft.patient = { name: "Pasien QA", birthDate: "1992-03-04", age: "", sex: "P", rm: "", nik: "" };
  draft.referrer = { facilityType: "Klinik", facility: "Klinik QA", city: "Kediri Kota", doctor: "dr. QA", phone: "081234567890" };
  draft.clinical = { ...draft.clinical, profileId: "hipertensi_dewasa", chiefComplaint: "nyeri_kepala", diagnosis: "Hipertensi", reason: "Kontrol" };
  draft.consent = true;
  return parseReferralPayload(draft);
}

let commands: { command: string; args: Record<string, unknown> }[];
let rateAllowed: boolean;
let replayed: boolean;
const sessions = new Map<string, { reviewerId: string }>();

beforeEach(() => {
  commands = []; rateAllowed = true; replayed = false; sessions.clear();
  vi.stubEnv("MELINDAOS_DIRECTOR_STORE", "supabase");
  vi.stubEnv("MELINDAOS_APP_ORIGIN", origin);
  vi.stubEnv("MELINDAOS_SUPABASE_URL", "https://synthetic.supabase.co");
  vi.stubEnv("MELINDAOS_SUPABASE_SECRET_KEY", "sb_secret_synthetic");
  vi.stubEnv("MELINDAOS_REVIEWER_ID", "director-referral");
  vi.stubEnv("MELINDAOS_REVIEWER_PASSCODE_HASH", `scrypt$${salt}$${scryptSync(passcode, salt, 64).toString("hex")}`);
  vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
    const { command = "", args = {} } = JSON.parse((init?.body as string) || "{}") as { command?: string; args?: Record<string, unknown> };
    commands.push({ command, args });
    if (command === "rate_limit") return Response.json({ allowed: rateAllowed });
    if (command === "users_count") return Response.json({ count: 0 });
    if (command === "session_create") { sessions.set(String(args.tokenHash), { reviewerId: String(args.reviewerId) }); return Response.json({ ok: true }); }
    if (command === "session_read") return Response.json({ session: sessions.get(String(args.tokenHash)) ?? null });
    if (command === "submit") return Response.json({ reference: "RJ-20261116-ABCDEF12", receivedAt: "2026-11-16T02:30:00Z", replayed });
    if (command === "update") return Response.json({ referral: { id: args.id, reference: "RJ-20261116-ABCDEF12", receivedAt: "2026-11-16T02:30:00Z", status: args.status, payload: validPayload(), note: args.note, handledBy: args.actor, handledAt: "2026-11-16T03:00:00Z" } });
    return Response.json({ ok: true });
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const stored = (command: string) => commands.filter((entry) => entry.command === command);

describe("POST /api/rujukan (public referral form)", () => {
  function publicRequest(body: unknown, headers: Record<string, string> = {}) {
    return new Request(`${origin}/api/rujukan`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin, "Idempotency-Key": "referral-key-0001", "X-Forwarded-For": "203.0.113.7", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  it("stores a valid referral without a session and counts it against the sender's address", async () => {
    const response = await submitReferral(publicRequest(validPayload()));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ reference: "RJ-20261116-ABCDEF12", replayed: false });
    expect(stored("submit")).toHaveLength(1);
    expect(stored("submit")[0].args.key).toBe("referral-key-0001");
    expect(stored("rate_limit").map((entry) => entry.args)).toEqual([{ bucket: "referral-ip:203.0.113.7", limit: 5, seconds: 3600 }]);
  });

  it("answers 200 for a replayed submission", async () => {
    replayed = true;
    expect((await submitReferral(publicRequest(validPayload()))).status).toBe(200);
  });

  it.each([
    ["another origin", { Origin: "https://evil.example" }, 403],
    ["a missing idempotency key", { "Idempotency-Key": "" }, 400],
  ])("refuses %s before anything is stored", async (_label, headers, status) => {
    const response = await submitReferral(publicRequest(validPayload(), headers));
    expect(response.status).toBe(status);
    expect(stored("submit")).toHaveLength(0);
  });

  it("answers 429 when the address has used its hourly allowance", async () => {
    rateAllowed = false;
    const response = await submitReferral(publicRequest(validPayload()));
    expect(response.status).toBe(429);
    expect(stored("submit")).toHaveLength(0);
  });

  it("refuses a body over 16 KB", async () => {
    const payload = validPayload();
    const response = await submitReferral(publicRequest({ ...payload, padding: "x".repeat(17_000) }));
    expect(response.status).toBe(413);
    expect(stored("submit")).toHaveLength(0);
  });

  it("answers 400 without field detail when the payload breaks the contract", async () => {
    const response = await submitReferral(publicRequest({ ...validPayload(), consent: false }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Format rujukan tidak valid." });
    expect(stored("submit")).toHaveLength(0);
  });
});

describe("POST /api/director/referrals/[id] (inbox action)", () => {
  const params = (id: string) => ({ params: Promise.resolve({ id }) });

  async function credentials(): Promise<Record<string, string>> {
    const login = await loginPost(new Request(`${origin}/api/director/session`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ passcode }) }));
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0]!;
    const session = (await (await sessionGet(new Request(`${origin}/api/director/session`, { headers: { Cookie: cookie } }))).json()) as { csrfToken: string };
    return { Cookie: cookie, "X-CSRF-Token": session.csrfToken };
  }
  function actionRequest(id: string, body: unknown, headers: Record<string, string>) {
    return updateReferral(new Request(`${origin}/api/director/referrals/${id}`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, ...headers }, body: JSON.stringify(body) }), params(id));
  }

  it("moves a referral to a new status for a signed-in Director", async () => {
    const response = await actionRequest(referralId, { status: "dihubungi", note: "Sudah ditelepon." }, await credentials());
    expect(response.status).toBe(200);
    expect(stored("update")[0].args).toEqual({ id: referralId, status: "dihubungi", note: "Sudah ditelepon.", actor: "director-referral" });
  });

  it("refuses a caller without a session, and a signed-in caller without the CSRF token", async () => {
    expect((await actionRequest(referralId, { status: "dihubungi" }, {})).status).toBe(401);
    const { Cookie } = await credentials();
    expect((await actionRequest(referralId, { status: "dihubungi" }, { Cookie })).status).toBe(403);
    expect(stored("update")).toHaveLength(0);
  });

  it("refuses an unknown status, an over-long note and a malformed id", async () => {
    const headers = await credentials();
    expect((await actionRequest(referralId, { status: "dihapus" }, headers)).status).toBe(400);
    expect((await actionRequest(referralId, { status: "selesai", note: "x".repeat(1001) }, headers)).status).toBe(400);
    expect((await actionRequest("bukan-id", { status: "selesai" }, headers)).status).toBe(404);
    expect(stored("update")).toHaveLength(0);
  });
});
