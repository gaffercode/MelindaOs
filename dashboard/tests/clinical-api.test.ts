import { scryptSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as createEntry } from "@/app/api/director/klinis/route";
import { POST as updateEntry } from "@/app/api/director/klinis/[id]/route";
import { GET as sessionGet, POST as loginPost } from "@/app/api/director/session/route";

const origin = "https://synthetic.example";
const salt = "00112233445566778899aabbccddeeff";
const passcode = "clinical-api-passcode-123";
const entryId = "00000000-0000-4000-8000-000000000001";

const incident = {
  kind: "insiden", date: "2026-11-22", shift: null, unit: "Rawat inap",
  payload: { time: "14:05", place: "Aster", type: "KNC", grade: "hijau", chronology: "Obat hampir tertukar.", followUp: "", progress: "baru", reporter: "Ns. C" },
};

let commands: { command: string; args: Record<string, unknown> }[];
let staleRevision: boolean;
const sessions = new Map<string, { reviewerId: string }>();

beforeEach(() => {
  commands = []; staleRevision = false; sessions.clear();
  vi.stubEnv("MELINDAOS_DIRECTOR_STORE", "supabase");
  vi.stubEnv("MELINDAOS_APP_ORIGIN", origin);
  vi.stubEnv("MELINDAOS_SUPABASE_URL", "https://synthetic.supabase.co");
  vi.stubEnv("MELINDAOS_SUPABASE_SECRET_KEY", "sb_secret_synthetic");
  vi.stubEnv("MELINDAOS_REVIEWER_ID", "director-clinical");
  vi.stubEnv("MELINDAOS_REVIEWER_PASSCODE_HASH", `scrypt$${salt}$${scryptSync(passcode, salt, 64).toString("hex")}`);
  vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
    const { command = "", args = {} } = JSON.parse((init?.body as string) || "{}") as { command?: string; args?: Record<string, unknown> };
    commands.push({ command, args });
    if (command === "rate_limit") return Response.json({ allowed: true });
    if (command === "users_count") return Response.json({ count: 0 });
    if (command === "session_create") { sessions.set(String(args.tokenHash), { reviewerId: String(args.reviewerId) }); return Response.json({ ok: true }); }
    if (command === "session_read") return Response.json({ session: sessions.get(String(args.tokenHash)) ?? null });
    if (command === "create") return Response.json({ id: entryId, createdAt: "2026-11-22T07:00:00Z", replayed: false });
    if (command === "update") {
      if (staleRevision) return Response.json({ errorCode: "conflict" });
      return Response.json({ entry: { id: args.id, kind: args.kind, date: "2026-11-22", shift: null, unit: "Rawat inap", payload: incident.payload, status: args.status ?? "aktif", revision: 2, createdBy: "Direktur", createdAt: "2026-11-22T07:00:00Z", updatedBy: args.actor, updatedAt: "2026-11-22T08:00:00Z" } });
    }
    return Response.json({ ok: true });
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const stored = (command: string) => commands.filter((entry) => entry.command === command);
const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function credentials(): Promise<Record<string, string>> {
  const login = await loginPost(new Request(`${origin}/api/director/session`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ passcode }) }));
  const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0]!;
  const session = (await (await sessionGet(new Request(`${origin}/api/director/session`, { headers: { Cookie: cookie } }))).json()) as { csrfToken: string };
  return { Cookie: cookie, "X-CSRF-Token": session.csrfToken };
}
const create = (body: unknown, headers: Record<string, string>) =>
  createEntry(new Request(`${origin}/api/director/klinis`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, ...headers }, body: JSON.stringify(body) }));
const update = (id: string, body: unknown, headers: Record<string, string>) =>
  updateEntry(new Request(`${origin}/api/director/klinis/${id}`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, ...headers }, body: JSON.stringify(body) }), params(id));

describe("POST /api/director/klinis", () => {
  it("stores a valid entry for a signed-in Director and records who wrote it", async () => {
    const response = await create(incident, { ...(await credentials()), "Idempotency-Key": "clinical-key-0001" });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ id: entryId, replayed: false });
    const [call] = stored("create");
    expect(call.args).toMatchObject({ key: "clinical-key-0001", kind: "insiden", date: "2026-11-22", unit: "Rawat inap" });
    expect(typeof call.args.actor).toBe("string");
    expect(String(call.args.actor).length).toBeGreaterThan(0);
  });

  it("refuses a caller without a session, without the CSRF token, or without an idempotency key", async () => {
    expect((await create(incident, { "Idempotency-Key": "clinical-key-0001" })).status).toBe(401);
    const { Cookie } = await credentials();
    expect((await create(incident, { Cookie, "Idempotency-Key": "clinical-key-0001" })).status).toBe(403);
    expect((await create(incident, await credentials())).status).toBe(400);
    expect(stored("create")).toHaveLength(0);
  });

  it("answers 400 without field detail when the payload breaks the contract", async () => {
    const response = await create({ ...incident, payload: { ...incident.payload, grade: "ungu" } }, { ...(await credentials()), "Idempotency-Key": "clinical-key-0002" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Format isian klinis tidak valid." });
    expect(stored("create")).toHaveLength(0);
  });

  it("refuses a body over 20 KB", async () => {
    const response = await create({ ...incident, padding: "x".repeat(21_000) }, { ...(await credentials()), "Idempotency-Key": "clinical-key-0003" });
    expect(response.status).toBe(413);
    expect(stored("create")).toHaveLength(0);
  });
});

describe("POST /api/director/klinis/[id]", () => {
  it("cancels an entry using the revision the caller read", async () => {
    const response = await update(entryId, { kind: "insiden", revision: 1, status: "dibatalkan" }, await credentials());
    expect(response.status).toBe(200);
    expect(stored("update")[0].args).toMatchObject({ id: entryId, kind: "insiden", revision: 1, status: "dibatalkan" });
  });

  it("answers 409 when someone else changed the entry first", async () => {
    staleRevision = true;
    expect((await update(entryId, { kind: "insiden", revision: 1, status: "dibatalkan" }, await credentials())).status).toBe(409);
  });

  it("refuses a payload that does not fit the stated kind, an unknown status, a bad revision and a malformed id", async () => {
    const headers = await credentials();
    expect((await update(entryId, { kind: "roster", revision: 1, payload: incident.payload }, headers)).status).toBe(400);
    expect((await update(entryId, { kind: "insiden", revision: 1, status: "dihapus" }, headers)).status).toBe(400);
    expect((await update(entryId, { kind: "insiden", revision: 0 }, headers)).status).toBe(400);
    expect((await update("bukan-id", { kind: "insiden", revision: 1 }, headers)).status).toBe(404);
    expect(stored("update")).toHaveLength(0);
  });

  it("refuses a caller without a session or the CSRF token", async () => {
    expect((await update(entryId, { kind: "insiden", revision: 1 }, {})).status).toBe(401);
    const { Cookie } = await credentials();
    expect((await update(entryId, { kind: "insiden", revision: 1 }, { Cookie })).status).toBe(403);
    expect(stored("update")).toHaveLength(0);
  });
});
