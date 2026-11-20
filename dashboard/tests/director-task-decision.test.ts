import { scryptSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as login } from "@/app/api/director/session/route";
import { POST as decide } from "@/app/api/director/tasks/[id]/decision/route";
import { csrfForSession, hashSecret } from "@/lib/director/director-auth";
import { parseDecision } from "@/lib/tasks/decision";
import { ContractError } from "@/lib/tasks/contract";
import { wibDate } from "@/lib/director/director-data";

const origin = "https://synthetic.example";
const salt = "00112233445566778899aabbccddeeff";
const passcodeHash = `scrypt$${salt}$${scryptSync("synthetic-test-passcode", salt, 64).toString("hex")}`;

type Call = { rpc: string; command: string; args: Record<string, unknown> };
let calls: Call[];
let created: Map<string, Record<string, unknown>>;
let session: boolean;
let noPic: boolean;
let limited: boolean;
/** Raw `melinda_user` token of a signed-in Vice Director, or null. */
let viceToken: string | null;
const VICE = { userId: "00000000-0000-4000-8000-000000000001", email: "vicedirector@melinda.test", role: "VICE_DIRECTOR", displayName: "Wakil Direktur Uji", credentialVersion: "c".repeat(32), mustChange: false };
const original = { id: "IOC-0007", reportDate: "2026-11-01", section: "priorities", itemId: "p9", itemTitle: "Rekap klaim BPJS", urgent: true, action: "request_update", deadline: null, pic: ["Bu Ani", "Pak Budi"], note: "", decisionOptionId: null, decisionLabel: null, status: "terkendala", history: [], createdAt: "2026-11-01T01:00:00Z" };

beforeEach(() => {
  calls = []; created = new Map(); session = false; noPic = false; limited = false; viceToken = null;
  vi.stubEnv("MELINDAOS_DIRECTOR_STORE", "supabase");
  vi.stubEnv("MELINDAOS_APP_ORIGIN", origin);
  vi.stubEnv("MELINDAOS_SUPABASE_URL", "https://synthetic.supabase.co");
  vi.stubEnv("MELINDAOS_SUPABASE_SECRET_KEY", "sb_secret_synthetic");
  vi.stubEnv("MELINDAOS_REVIEWER_PASSCODE_HASH", passcodeHash);
  vi.stubEnv("MELINDAOS_REVIEWER_ID", "director-test");
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const { command, args } = JSON.parse(init.body as string) as { command: string; args: Record<string, unknown> };
    const rpc = url.split("/").pop() as string;
    calls.push({ rpc, command, args });
    if (rpc === "melinda_access" && command === "session_read") return Response.json({ session: viceToken && args.tokenHash === hashSecret(viceToken) ? VICE : null });
    if (command === "rate_limit") return Response.json({ allowed: !(limited && String(args.bucket).startsWith("decision:")) });
    if (command === "rate_reset") return Response.json({ ok: true });
    if (command === "session_create") { session = true; return Response.json({ ok: true }); }
    if (command === "session_read") return Response.json({ session: session ? { reviewerId: "director-test" } : null });
    if (rpc === "melinda_director_instructions") {
      if (command === "read") return args.id === original.id ? Response.json({ instruction: noPic ? { ...original, pic: [] } : original, replayed: false }) : Response.json({ errorCode: "not_found" });
      if (command === "create") {
        const existing = created.get(args.key as string);
        if (existing) return Response.json({ instruction: existing, replayed: true });
        const row = { ...args, id: `IOC-${String(created.size + 20).padStart(4, "0")}`, status: "dibuat", history: [], createdAt: "2026-11-08T01:00:00Z" };
        created.set(args.key as string, row);
        return Response.json({ instruction: row, replayed: false });
      }
    }
    if (rpc === "melinda_director_tasks" && command === "director_status") return args.id === original.id ? Response.json({ instruction: { id: args.id, status: args.status } }) : Response.json({ errorCode: "not_found" });
    return Response.json({ errorCode: "invalid_command" });
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function request(body?: unknown, headers: Record<string, string> = {}, id = "IOC-0007") {
  return [new Request(`${origin}/api/director/tasks/${id}/decision`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), { params: Promise.resolve({ id }) }] as const;
}
async function credentials() {
  const response = await login(new Request(`${origin}/api/director/session`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ passcode: "synthetic-test-passcode", returnTo: "/" }) }));
  const body = await response.json() as { csrfToken: string };
  return { Cookie: response.headers.get("set-cookie")!.split(";")[0], "X-CSRF-Token": body.csrfToken };
}
const decision = async (body: unknown, id = "IOC-0007") => decide(...request(body, await credentials(), id));
const writes = () => calls.filter((call) => call.command === "create" || call.command === "director_status");

describe("Director decision route", () => {
  it("putuskan creates a linked assign instruction without closing the original", async () => {
    const response = await decision({ kind: "putuskan", note: "Lanjutkan, kirim besok pagi." });
    expect(response.status).toBe(201);
    expect((await response.json()).instruction).toMatchObject({ status: "dibuat" });
    const create = calls.find((call) => call.command === "create")!;
    expect(create.rpc).toBe("melinda_director_instructions");
    expect(create.args).toMatchObject({ section: "umum", action: "assign", reportDate: wibDate(), itemId: "p9", itemTitle: "Rekap klaim BPJS", pic: ["Bu Ani", "Pak Budi"], note: "Lanjutkan, kirim besok pagi.", linkedId: "IOC-0007", reviewerId: "director-test" });
    expect(String(create.args.key)).toMatch(/^decision:IOC-0007:putuskan:/);
    expect(calls.some((call) => call.command === "advance" || call.command === "director_status")).toBe(false);
  });
  it("alihkan uses the supplied PIC", async () => {
    const response = await decision({ kind: "alihkan", pic: ["Bu Citra"], note: "Tolong ambil alih." });
    expect(response.status).toBe(201);
    expect(calls.find((call) => call.command === "create")!.args).toMatchObject({ pic: ["Bu Citra"], note: "Tolong ambil alih.", linkedId: "IOC-0007", action: "assign" });
  });
  it("hubungi_saya uses the fixed note and the original PIC", async () => {
    expect((await decision({ kind: "hubungi_saya" })).status).toBe(201);
    expect(calls.find((call) => call.command === "create")!.args).toMatchObject({ note: "Mohon segera menghubungi Direktur terkait arahan IOC-0007.", pic: ["Bu Ani", "Pak Budi"], linkedId: "IOC-0007" });
  });
  it.each([["tunda", "ditunda"], ["batal", "dibatalkan"], ["selesai", "selesai"]])("%s sets the Director status %s", async (kind, status) => {
    const response = await decision({ kind, note: "Alasan" });
    expect(response.status).toBe(200);
    expect((await response.json()).instruction).toMatchObject({ id: "IOC-0007", status });
    expect(writes()).toEqual([expect.objectContaining({ rpc: "melinda_director_tasks", command: "director_status", args: { id: "IOC-0007", status, actor: "director-test", note: "Alasan" } })]);
  });
  it("a double tap replays the same instruction and does not create it twice", async () => {
    const headers = await credentials();
    const first = await decide(...request({ kind: "putuskan", note: "Ya" }, headers));
    const second = await decide(...request({ kind: "putuskan", note: "Ya" }, headers));
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(created.size).toBe(1);
  });
  it("rejects invalid input with 400", async () => {
    for (const body of [
      { kind: "putuskan" }, { kind: "putuskan", note: "  " }, { kind: "putuskan", note: "x".repeat(281) }, { kind: "alihkan", note: "ok" }, { kind: "alihkan", pic: [] },
      { kind: "alihkan", pic: Array(9).fill("A") }, { kind: "alihkan", pic: ["x".repeat(61)] }, { kind: "tunda", pic: ["A"] }, { kind: "putuskan", note: "a", pic: ["A"] },
      { kind: "hapus" }, { note: "x" }, { kind: "tunda", extra: 1 }, [],
    ]) expect((await decision(body)).status, JSON.stringify(body)).toBe(400);
    expect((await decision({ kind: "tunda" }, "IOC-12")).status).toBe(400);
    expect(writes()).toHaveLength(0);
  });
  it("returns 404 for an unknown original", async () => {
    expect((await decision({ kind: "putuskan", note: "Ya" }, "IOC-9999")).status).toBe(404);
    expect(writes()).toHaveLength(0);
  });
  it("requires a session and CSRF", async () => {
    expect((await decide(...request({ kind: "tunda" }))).status).toBe(401);
    const { Cookie } = await credentials();
    expect((await decide(...request({ kind: "tunda" }, { Cookie }))).status).toBe(403);
    expect(writes()).toHaveLength(0);
  });
});

describe("Vice Director decisions (ruling R7)", () => {
  const vice = () => {
    viceToken = "d".repeat(64);
    return { Cookie: `melinda_user=${viceToken}`, "X-CSRF-Token": csrfForSession(viceToken, VICE.credentialVersion) };
  };
  const instructionCalls = () => calls.filter((call) => call.rpc === "melinda_director_instructions" || String(call.args.bucket ?? "").startsWith("decision:"));

  it.each([{ kind: "alihkan", pic: ["Bu Citra"] }, { kind: "hubungi_saya" }, { kind: "putuskan", note: "Lanjutkan." }])("refuses $kind, which would send a new instruction, before touching the store", async (body) => {
    const response = await decide(...request(body, vice()));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Akses tidak sesuai peran." });
    expect(instructionCalls()).toEqual([]);
    expect(writes()).toHaveLength(0);
  });

  it("still closes a task with a status kind", async () => {
    const response = await decide(...request({ kind: "selesai" }, vice()));
    expect(response.status).toBe(200);
    expect(writes()).toEqual([expect.objectContaining({ command: "director_status", args: expect.objectContaining({ id: "IOC-0007", status: "selesai", actor: VICE.userId }) })]);
    expect(created.size).toBe(0);
  });
});

describe("Director decision edge cases", () => {
  it("rejects putuskan and hubungi_saya on an original without PIC, with the Alihkan hint", async () => {
    noPic = true;
    for (const body of [{ kind: "putuskan", note: "Ya" }, { kind: "hubungi_saya" }]) {
      const response = await decision(body);
      expect(response.status).toBe(400);
      expect((await response.json()).error).toContain("Alihkan");
    }
    expect((await decision({ kind: "alihkan", pic: ["Bu Citra"] })).status).toBe(201);
    expect(writes()).toHaveLength(1);
  });
  it("hubungi_saya ignores a client note", async () => {
    expect((await decision({ kind: "hubungi_saya", note: "abaikan saya" })).status).toBe(201);
    expect(calls.find((call) => call.command === "create")!.args.note).toBe("Mohon segera menghubungi Direktur terkait arahan IOC-0007.");
  });
  it("alihkan without a note uses the default note", async () => {
    expect((await decision({ kind: "alihkan", pic: ["Bu Citra"] })).status).toBe(201);
    expect(calls.find((call) => call.command === "create")!.args.note).toBe("Arahan IOC-0007 dialihkan oleh Direktur.");
  });
  it("tunda on an unknown id is 404", async () => {
    expect((await decision({ kind: "tunda" }, "IOC-9999")).status).toBe(404);
  });
  it("rate limits status and instruction kinds before touching the store", async () => {
    limited = true;
    expect((await decision({ kind: "tunda" })).status).toBe(429);
    expect((await decision({ kind: "putuskan", note: "Ya" })).status).toBe(429);
    expect(calls.some((call) => call.command === "read" || call.command === "director_status" || call.command === "create")).toBe(false);
  });
});

describe("parseDecision", () => {
  it("trims and normalizes", () => {
    expect(parseDecision({ kind: "tunda", note: "  sebentar " })).toEqual({ kind: "tunda", note: "sebentar" });
    expect(parseDecision({ kind: "alihkan", pic: ["A", "A", "B"] })).toEqual({ kind: "alihkan", pic: ["A", "B"] });
  });
  it("throws ContractError", () => {
    expect(() => parseDecision({ kind: "putuskan" })).toThrow(ContractError);
  });
});
