import { scryptSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as archiveGet } from "@/app/api/director/tasks/archive/route";
import { GET as boardGet } from "@/app/api/director/tasks/board/route";
import { GET as repliesGet } from "@/app/api/director/tasks/[id]/replies/route";
import { POST as login } from "@/app/api/director/session/route";

const origin = "https://synthetic.example";
const salt = "00112233445566778899aabbccddeeff";
const passcodeHash = `scrypt$${salt}$${scryptSync("synthetic-test-passcode", salt, 64).toString("hex")}`;
type Call = { command: string; args: Record<string, unknown> };
let calls: Call[];
let session: boolean;

const inst = (id: string, over: Record<string, unknown> = {}) => ({
  id, reportDate: "2026-09-08", section: "umum", itemId: "x", itemTitle: `Arahan ${id}`, urgent: false, action: "assign", deadline: null, pic: ["Bu Ani"], note: "",
  decisionOptionId: null, decisionLabel: null, status: "dikerjakan", history: [{ status: "dibuat", at: "2026-09-08T01:00:00Z", actor: "d" }],
  createdAt: "2026-09-08T01:00:00Z", linkedId: null, scheduleItemId: null, remindersSent: 0, lastReminderAt: null, latestReply: null, ...over,
});
const archived = Array.from({ length: 51 }, (_, i) => inst(`IOC-${String(100 + i).padStart(4, "0")}`, { status: "selesai" }));

beforeEach(() => {
  calls = []; session = false;
  vi.stubEnv("MELINDAOS_DIRECTOR_STORE", "supabase");
  vi.stubEnv("MELINDAOS_APP_ORIGIN", origin);
  vi.stubEnv("MELINDAOS_SUPABASE_URL", "https://synthetic.supabase.co");
  vi.stubEnv("MELINDAOS_SUPABASE_SECRET_KEY", "sb_secret_synthetic");
  vi.stubEnv("MELINDAOS_REVIEWER_PASSCODE_HASH", passcodeHash);
  vi.stubEnv("MELINDAOS_REVIEWER_ID", "director-test");
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const { command, args } = JSON.parse(init.body as string) as Call;
    calls.push({ command, args });
    if (command === "rate_limit") return Response.json({ allowed: true });
    if (command === "rate_reset") return Response.json({ ok: true });
    if (command === "session_create") { session = true; return Response.json({ ok: true }); }
    if (command === "session_read") return Response.json({ session: session ? { reviewerId: "director-test" } : null });
    if (command === "schedule_list") return Response.json({ date: args.date, items: [{ id: "s1", date: args.date, position: 0, start: "09:00", end: null, title: "Rapat", place: null, pic: [], producer: "dash", createdAt: "x", taskIds: ["IOC-0005"] }] });
    if (command === "board") return Response.json({ instructions: [inst("IOC-0005", { createdAt: new Date(Date.now() - 60 * 86_400_000).toISOString(), history: [{ status: "dibuat", at: "2026-09-08T01:00:00Z", actor: "d" }], deadline: "2026-09-09T10:00", latestReply: { receivedAt: "2026-09-09T01:00:00Z", originalText: "ok" } })] });
    if (command === "replies_list") return Response.json({ replies: [{ id: "r1", instructionId: (args.instructionIds as string[])[0], originalText: "Sudah." }] });
    if (command === "archive") {
      const offset = Number(args.offset);
      return Response.json({ instructions: archived.slice(offset, offset + 50), offset, pageSize: 50, hasMore: offset + 50 < archived.length });
    }
    return Response.json({ errorCode: "invalid_command" });
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function cookie() {
  const response = await login(new Request(`${origin}/api/director/session`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ passcode: "synthetic-test-passcode", returnTo: "/" }) }));
  return { Cookie: response.headers.get("set-cookie")!.split(";")[0] };
}
const get = async (handler: (r: Request) => Promise<Response>, path: string, auth = true) =>
  handler(new Request(`${origin}/api/director/tasks/${path}`, { headers: auth ? await cookie() : {} }));

describe("board", () => {
  it("requires the Director session", async () => {
    expect((await get(boardGet, "board", false)).status).toBe(401);
    expect((await get(archiveGet, "archive", false)).status).toBe(401);
  });
  it("shows a 60-day-old open task with overdue flag, reply, schedule links; the archive does not", async () => {
    const body = await (await get(boardGet, "board")).json();
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0]).toMatchObject({ id: "IOC-0005", overdue: true, reminder: "none", latestReply: { originalText: "ok" } });
    expect(body.summary).toMatchObject({ open: 1, overdue: 1 });
    expect(body.schedule[0]).toMatchObject({ title: "Rapat", taskIds: ["IOC-0005"] });
    const page = await (await get(archiveGet, "archive")).json();
    expect(page.rows.some((r: { id: string }) => r.id === "IOC-0005")).toBe(false);
  });
});

describe("archive", () => {
  it("pages 50 rows at a time", async () => {
    const first = await (await get(archiveGet, "archive?halaman=1")).json();
    expect(first.rows).toHaveLength(50);
    expect(first).toMatchObject({ halaman: 1, adaLagi: true });
    const second = await (await get(archiveGet, "archive?halaman=2")).json();
    expect(second.rows).toHaveLength(1);
    expect(second.adaLagi).toBe(false);
    expect(calls.filter((c) => c.command === "archive").map((c) => c.args.offset)).toEqual([0, 50]);
  });
  it("omits unset date filters", async () => {
    await get(archiveGet, "archive");
    const args = calls.find((c) => c.command === "archive")!.args;
    expect(args).not.toHaveProperty("from");
    expect(args).not.toHaveProperty("to");
  });
  it("passes filters through", async () => {
    await get(archiveGet, "archive?dari=2026-09-01&sampai=2026-09-30&q=klaim&pic=Bu%20Ani&status=selesai");
    expect(calls.find((c) => c.command === "archive")!.args).toMatchObject({ from: "2026-09-01", to: "2026-09-30", q: "klaim", pic: "Bu Ani", status: "selesai", offset: 0 });
  });
  it("semua=1 asks the RPC for every record, default does not", async () => {
    await get(archiveGet, "archive?semua=1");
    await get(archiveGet, "archive");
    const sent = calls.filter((c) => c.command === "archive").map((c) => c.args);
    expect(sent[0]).toMatchObject({ all: true });
    expect(sent[1]).not.toHaveProperty("all");
  });
  it.each([
    "semua=0", "dari=2026-9-1", "dari=2026-09-10&sampai=2026-09-01", "dari=2024-01-01&sampai=2026-01-01", `q=${"a".repeat(121)}`, `pic=${"a".repeat(61)}`,
    "status=bebas", "halaman=0", "halaman=1001", "halaman=1.5", "dari=2026-02-31",
  ])("rejects %s with 400", async (query) => {
    expect((await get(archiveGet, `archive?${query}`)).status).toBe(400);
  });
});

describe("replies", () => {
  const replies = async (id: string, auth = true) => repliesGet(new Request(`${origin}/api/director/tasks/${id}/replies`, { headers: auth ? await cookie() : {} }), { params: Promise.resolve({ id }) });
  it("requires the Director session", async () => {
    expect((await replies("IOC-0005", false)).status).toBe(401);
  });
  it("lists every reply of one task", async () => {
    const response = await replies("IOC-0005");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ replies: [{ id: "r1", instructionId: "IOC-0005", originalText: "Sudah." }] });
    expect(calls.find((c) => c.command === "replies_list")?.args).toEqual({ instructionIds: ["IOC-0005"] });
  });
  it("rejects a malformed id", async () => {
    expect((await replies("T-1")).status).toBe(400);
  });
});
