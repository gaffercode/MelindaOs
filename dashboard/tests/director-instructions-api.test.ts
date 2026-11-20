import { scryptSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as login } from "@/app/api/director/session/route";
import { GET as list, POST as create } from "@/app/api/director/instructions/route";
import { POST as polish } from "@/app/api/director/instructions/polish/route";
import { canAdvance, type Instruction, type InstructionStatus } from "@/lib/director/director-instructions";

const origin = "https://synthetic.example";
const salt = "00112233445566778899aabbccddeeff";
const passcodeHash = `scrypt$${salt}$${scryptSync("synthetic-test-passcode", salt, 64).toString("hex")}`;
const input = { reportDate: "2026-10-07", section: "priorities", itemId: "p1", itemTitle: "Tagih status item RM", urgent: true, action: "request_update", deadline: "2026-10-07T16:00", pic: [], note: "" };
let session: { reviewerId: string } | null;
let rows: Map<string, Instruction & { key: string; hash: string }>;
const gatewayUrl = "https://api.anthropic.com/v1/messages";
let gatewayReply: string;
let gatewayBodies: Record<string, unknown>[];
let officials: string[] | null;

beforeEach(() => {
  session = null; rows = new Map(); gatewayReply = ""; gatewayBodies = []; officials = ["Wadir Operasional – dr. Novia Dwi Anggraini"];
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubEnv("MELINDAOS_DIRECTOR_STORE", "supabase");
  vi.stubEnv("MELINDAOS_APP_ORIGIN", origin);
  vi.stubEnv("MELINDAOS_SUPABASE_URL", "https://synthetic.supabase.co");
  vi.stubEnv("MELINDAOS_SUPABASE_SECRET_KEY", "sb_secret_synthetic");
  vi.stubEnv("MELINDAOS_REVIEWER_PASSCODE_HASH", passcodeHash);
  vi.stubEnv("MELINDAOS_REVIEWER_ID", "director-test");
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (url === gatewayUrl) { gatewayBodies.push(JSON.parse(init.body as string)); return Response.json({ content: [{ type: "text", text: gatewayReply }], stop_reason: "end_turn" }); }
    if (url.endsWith("/rpc/melinda_director_officials")) return officials ? Response.json({ officials }) : Response.json({ message: "function not found" }, { status: 404 });
    const { command, args } = JSON.parse(init.body as string) as { command: string; args: Record<string, string> };
    if (command === "rate_limit") return Response.json({ allowed: true });
    if (command === "rate_reset") return Response.json({ ok: true });
    if (command === "session_create") { session = { reviewerId: "director-test" }; return Response.json({ ok: true }); }
    if (command === "session_read") return Response.json({ session });
    if (command === "create") {
      const existing = [...rows.values()].find((row) => row.key === args.key);
      if (existing) return existing.hash === args.requestHash ? Response.json({ instruction: existing, replayed: true }) : Response.json({ errorCode: "conflict" });
      const id = `IOC-${String(rows.size + 1).padStart(4, "0")}`;
      const row = { ...(args as unknown as Instruction), id, status: "dibuat" as const, history: [], createdAt: "2026-10-07T09:00:00+07:00", key: args.key, hash: args.requestHash };
      rows.set(id, row);
      return Response.json({ instruction: row, replayed: false });
    }
    const row = rows.get(args.id);
    if (command === "list") return Response.json({ instructions: [...rows.values()].filter((item) => item.reportDate === args.date) });
    if (!row) return Response.json({ errorCode: "not_found" });
    if (command === "read") return Response.json({ instruction: row, replayed: false });
    if (command === "advance") {
      const note = typeof args.note === "string" ? args.note : undefined;
      const previous = row.history.at(-1)?.note;
      if (!canAdvance(row.status, args.status as InstructionStatus, note, previous, row.history)) return Response.json({ errorCode: "conflict" });
      row.status = args.status as Instruction["status"];
      row.history = [...row.history, { status: row.status, at: "2026-10-07T10:00:00Z", actor: "bot", ...(note ? { note } : {}) }]; // the RPC appends every hop
      return Response.json({ instruction: row, replayed: false });
    }
    return Response.json({ errorCode: "invalid_command" });
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function request(path: string, method: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`${origin}${path}`, { method, headers: { "Content-Type": "application/json", Origin: origin, ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function humanSession() {
  const response = await login(request("/api/director/session", "POST", { passcode: "synthetic-test-passcode", returnTo: "/" }));
  const body = await response.json() as { csrfToken: string };
  return { Cookie: response.headers.get("set-cookie")!.split(";")[0], "X-CSRF-Token": body.csrfToken };
}

describe("director instruction routes", () => {
  it("requires session and CSRF, stores the instruction as dibuat and replays idempotently", async () => {
    expect((await create(request("/api/director/instructions", "POST", input, { "Idempotency-Key": "instruction-key-2" }))).status).toBe(401);
    const credentials = await humanSession();
    expect((await create(request("/api/director/instructions", "POST", input, { Cookie: credentials.Cookie, "Idempotency-Key": "instruction-key-2" }))).status).toBe(403);
    const saved = await create(request("/api/director/instructions", "POST", input, { ...credentials, "Idempotency-Key": "instruction-key-2" }));
    expect(saved.status).toBe(201);
    expect((await saved.json()).instruction).toMatchObject({ id: "IOC-0001", status: "dibuat" });
    const replay = await create(request("/api/director/instructions", "POST", input, { ...credentials, "Idempotency-Key": "instruction-key-2" }));
    expect(replay.status).toBe(200);
    expect((await replay.json()).instruction.status).toBe("dibuat");
    const listed = await list(request("/api/director/instructions?tanggal=2026-10-07", "GET", undefined, credentials));
    expect(await listed.json()).toEqual({ configured: false, instructions: [expect.objectContaining({ id: "IOC-0001", status: "dibuat" })], officials: ["Wadir Operasional – dr. Novia Dwi Anggraini"] });
    officials = null;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fallback = await list(request("/api/director/instructions?tanggal=2026-10-07", "GET", undefined, credentials));
    expect(await fallback.json()).toEqual({ configured: false, instructions: [expect.objectContaining({ id: "IOC-0001", status: "dibuat" })], officials: [] });
  });
  it("adds instructions linked by id from other dates to the Director's list", async () => {
    const credentials = await humanSession();
    await create(request("/api/director/instructions", "POST", input, { ...credentials, "Idempotency-Key": "instruction-key-11" }));
    const plain = await list(request("/api/director/instructions?tanggal=2026-10-08", "GET", undefined, credentials));
    expect((await plain.json()).instructions).toEqual([]);
    const linked = await list(request("/api/director/instructions?tanggal=2026-10-08&id=IOC-0001&id=IOC-0001&id=IOC-9999", "GET", undefined, credentials));
    expect((await linked.json()).instructions.map((item: Instruction) => item.id)).toEqual(["IOC-0001"]);
    const same = await list(request("/api/director/instructions?tanggal=2026-10-07&id=IOC-0001", "GET", undefined, credentials));
    expect((await same.json()).instructions.map((item: Instruction) => item.id)).toEqual(["IOC-0001"]);
    expect((await list(request("/api/director/instructions?tanggal=2026-10-08&id=D-1", "GET", undefined, credentials))).status).toBe(400);
  });
  it("closes the linked instruction when the Director marks a carried item done, including one that was never delivered", async () => {
    const credentials = await humanSession();
    await create(request("/api/director/instructions", "POST", input, { ...credentials, "Idempotency-Key": "instruction-key-12" }));
    rows.get("IOC-0001")!.status = "diterima_pic";
    const done = { ...input, reportDate: "2026-10-08", section: "followUps", itemId: "FU-1", itemTitle: "IOC-0001 · Tagih status item RM", action: "done", deadline: null, linkedId: "IOC-0001" };
    const response = await create(request("/api/director/instructions", "POST", done, { ...credentials, "Idempotency-Key": "instruction-key-13" }));
    expect(response.status).toBe(201);
    expect(rows.get("IOC-0001")!.status).toBe("selesai");
    const replay = await create(request("/api/director/instructions", "POST", done, { ...credentials, "Idempotency-Key": "instruction-key-13" }));
    expect(replay.status).toBe(200);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await create(request("/api/director/instructions", "POST", input, { ...credentials, "Idempotency-Key": "instruction-key-14" }));
    rows.get("IOC-0003")!.status = "gagal";
    const undelivered = await create(request("/api/director/instructions", "POST", { ...done, itemId: "FU-2", linkedId: "IOC-0003" }, { ...credentials, "Idempotency-Key": "instruction-key-15" }));
    expect(undelivered.status).toBe(201);
    expect(rows.get("IOC-0003")!.status).toBe("selesai");
    const missing = await create(request("/api/director/instructions", "POST", { ...done, itemId: "FU-3", linkedId: "IOC-9999" }, { ...credentials, "Idempotency-Key": "instruction-key-17" }));
    expect(missing.status).toBe(201);
    expect(log.mock.calls.map((call) => JSON.parse(String(call[0])).code)).toContain("linked_close_skipped");
    expect((await create(request("/api/director/instructions", "POST", { ...done, linkedId: "D-1" }, { ...credentials, "Idempotency-Key": "instruction-key-16" }))).status).toBe(400);
  });
  it("rejects invalid instructions without storing them", async () => {
    const credentials = { ...await humanSession(), "Idempotency-Key": "instruction-key-3" };
    expect((await create(request("/api/director/instructions", "POST", { ...input, note: "x".repeat(281) }, credentials))).status).toBe(400);
    expect(rows.size).toBe(0);
  });
  it("polishes a note through the Claude API for an authenticated Director only", async () => {
    const note = { note: "tolong cek  status rm hr ini" };
    expect((await polish(request("/api/director/instructions/polish", "POST", note))).status).toBe(401);
    const credentials = await humanSession();
    expect((await polish(request("/api/director/instructions/polish", "POST", note, { Cookie: credentials.Cookie }))).status).toBe(403);
    expect((await polish(request("/api/director/instructions/polish", "POST", note, credentials))).status).toBe(503);
    vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-anthropic-key");
    expect((await polish(request("/api/director/instructions/polish", "POST", { note: "  " }, credentials))).status).toBe(400);
    gatewayReply = "  \"Mohon cek status rekam medis hari ini.\"  ";
    const response = await polish(request("/api/director/instructions/polish", "POST", note, credentials));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ note: "Mohon cek status rekam medis hari ini." });
    expect(gatewayBodies[0]).toMatchObject({ model: "claude-haiku-5-5", messages: [{ role: "user", content: "tolong cek  status rm hr ini" }] });
    expect(gatewayBodies[0]).not.toHaveProperty("output_config");
    gatewayReply = "";
    expect((await polish(request("/api/director/instructions/polish", "POST", note, credentials))).status).toBe(502);
  });
  it("blocks patient identifiers before calling the Claude API and never logs the note", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-anthropic-key");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const credentials = await humanSession();
    const response = await polish(request("/api/director/instructions/polish", "POST", { note: "Cek kamar Ny. Sari hari ini" }, credentials));
    expect(response.status).toBe(422);
    expect((await response.json()).error).toContain("nama pasien");
    expect(gatewayBodies).toHaveLength(0);
    expect(log.mock.calls.map((call) => JSON.parse(String(call[0])).code)).toContain("phi_blocked");
    expect(JSON.stringify(log.mock.calls)).not.toContain("Sari");
  });
  it("logs an unreachable AI gateway without the note", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-anthropic-key");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const credentials = await humanSession();
    const original = globalThis.fetch;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => { if (url === gatewayUrl) throw new TypeError("fetch failed"); return original(url, init); });
    expect((await polish(request("/api/director/instructions/polish", "POST", { note: "cek status klaim" }, credentials))).status).toBe(502);
    expect(log.mock.calls.map((call) => JSON.parse(String(call[0])).code)).toContain("ai_polish_unreachable");
  });
  it("accepts free-text recipients on any action, even without the officials list", async () => {
    const credentials = await humanSession();
    const assign = { ...input, action: "assign", deadline: null };
    expect((await create(request("/api/director/instructions", "POST", { ...assign, pic: ["Tim Akreditasi", "Kanit Rawat Inap"] }, { ...credentials, "Idempotency-Key": "instruction-key-7" }))).status).toBe(201);
    expect((await create(request("/api/director/instructions", "POST", { ...input, pic: ["Kanit Rawat Inap"] }, { ...credentials, "Idempotency-Key": "instruction-key-8" }))).status).toBe(201);
    officials = null;
    expect((await create(request("/api/director/instructions", "POST", { ...assign, pic: ["Kepala Ruang Aster"] }, { ...credentials, "Idempotency-Key": "instruction-key-9" }))).status).toBe(201);
    const nine = Array.from({ length: 9 }, (_, index) => `Tujuan ${index + 1}`);
    expect((await create(request("/api/director/instructions", "POST", { ...assign, pic: nine }, { ...credentials, "Idempotency-Key": "instruction-key-10" }))).status).toBe(400);
    expect((await create(request("/api/director/instructions", "POST", { ...assign, pic: ["x".repeat(61)] }, { ...credentials, "Idempotency-Key": "instruction-key-11" }))).status).toBe(400);
    expect(rows.size).toBe(3);
  });
});
