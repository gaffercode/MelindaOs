import { scryptSync } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as login } from "@/app/api/director/session/route";
import { GET } from "@/app/api/director/tasks/recap/route";
import { collectRecapItems } from "@/lib/director/director-tasks-api";
import { buildTaskRecapPdf, daysToFinish, recapRows } from "@/lib/pdf/build-task-recap";

const origin = "https://synthetic.example";
const salt = "00112233445566778899aabbccddeeff";
const passcodeHash = `scrypt$${salt}$${scryptSync("synthetic-test-passcode", salt, 64).toString("hex")}`;
const inst = (id: string, over: Record<string, unknown> = {}) => ({
  id, reportDate: "2026-10-05", itemTitle: `Arahan ${id}`, pic: ["Bu Ani", "Pak Budi"], status: "selesai", createdAt: "2026-10-05T01:00:00Z",
  history: [{ status: "dibuat", at: "2026-10-05T01:00:00Z", actor: "d" }, { status: "selesai", at: "2026-10-08T03:00:00Z", actor: "d" }], ...over,
});
let archiveCalls: Record<string, unknown>[];
let session: boolean;
let dataset: ReturnType<typeof inst>[];

beforeEach(() => {
  archiveCalls = []; session = false;
  dataset = [inst("IOC-0003", { status: "dikerjakan", history: [] }), inst("IOC-0001"), inst("IOC-0002", { status: "ditunda" })];
  vi.stubEnv("MELINDAOS_DIRECTOR_STORE", "supabase");
  vi.stubEnv("MELINDAOS_APP_ORIGIN", origin);
  vi.stubEnv("MELINDAOS_SUPABASE_URL", "https://synthetic.supabase.co");
  vi.stubEnv("MELINDAOS_SUPABASE_SECRET_KEY", "sb_secret_synthetic");
  vi.stubEnv("MELINDAOS_REVIEWER_PASSCODE_HASH", passcodeHash);
  vi.stubEnv("MELINDAOS_REVIEWER_ID", "director-test");
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const { command, args } = JSON.parse(init.body as string) as { command: string; args: Record<string, unknown> };
    if (command === "rate_limit") return Response.json({ allowed: true });
    if (command === "rate_reset") return Response.json({ ok: true });
    if (command === "session_create") { session = true; return Response.json({ ok: true }); }
    if (command === "session_read") return Response.json({ session: session ? { reviewerId: "director-test" } : null });
    if (command === "archive") {
      archiveCalls.push(args);
      const offset = Number(args.offset);
      const rows = dataset.slice(offset, offset + 50);
      return Response.json({ instructions: rows, offset, pageSize: 50, hasMore: offset + 50 < dataset.length });
    }
    return Response.json({ errorCode: "invalid_command" });
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function recap(query: string, auth = true) {
  let headers: Record<string, string> = {};
  if (auth) {
    const response = await login(new Request(`${origin}/api/director/session`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ passcode: "synthetic-test-passcode", returnTo: "/" }) }));
    headers = { Cookie: response.headers.get("set-cookie")!.split(";")[0] };
  }
  return GET(new Request(`${origin}/api/director/tasks/recap${query}`, { headers }));
}

describe("recap rows", () => {
  it("counts whole days to the selesai entry, or a dash", () => {
    expect(daysToFinish(inst("a") as never)).toBe("3");
    expect(daysToFinish(inst("b", { status: "dikerjakan", history: [] }) as never)).toBe("–");
  });
  it("uses the last selesai entry after a reopen", () => {
    const history = [{ status: "selesai", at: "2026-10-06T01:00:00Z", actor: "d" }, { status: "dikerjakan", at: "2026-10-07T01:00:00Z", actor: "d" }, { status: "selesai", at: "2026-10-15T01:00:00Z", actor: "d" }];
    expect(daysToFinish(inst("c", { history }) as never)).toBe("10");
  });
  it("makes one row per instruction", () => {
    const rows = recapRows([inst("IOC-0001"), inst("IOC-0002"), inst("IOC-0003", { status: "dikerjakan", history: [] })] as never);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ code: "IOC-0001", date: "05-10-2026", title: "Arahan IOC-0001", pic: "Bu Ani, Pak Budi", status: "Selesai", days: "3" });
  });
});

describe("recap route", () => {
  it("returns a PDF with archived and open instructions of the month", async () => {
    const response = await recap("?bulan=2026-10");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="rekap-arahan-2026-10.pdf"');
    expect(response.headers.get("cache-control")).toBe("no-store");
    const doc = await PDFDocument.load(new Uint8Array(await response.arrayBuffer()));
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(archiveCalls[0]).toMatchObject({ from: "2026-10-01", to: "2026-10-31", offset: 0, all: true });
  });
  it("collects exactly the month's instructions, sorted", async () => {
    const config = (await import("@/lib/director/director-api")).requireConfiguration();
    expect((await collectRecapItems(config, "2026-10", new Date().toISOString())).map((i) => i.id)).toEqual(["IOC-0001", "IOC-0002", "IOC-0003"]);
  });
  it("pages through more than 50 rows", async () => {
    dataset = Array.from({ length: 60 }, (_, i) => inst(`IOC-${String(i + 1).padStart(4, "0")}`));
    const config = (await import("@/lib/director/director-api")).requireConfiguration();
    expect(await collectRecapItems(config, "2026-10", new Date().toISOString())).toHaveLength(60);
    expect(archiveCalls.map((c) => c.offset)).toEqual([0, 50]);
  });
  it("answers 503 instead of a truncated PDF past 20 pages", async () => {
    dataset = Array.from({ length: 1001 }, (_, i) => inst(`IOC-${String(i + 1).padStart(4, "0")}`));
    const response = await recap("?bulan=2026-10");
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("Rekap terlalu besar; hubungi admin.");
    expect(archiveCalls).toHaveLength(20);
  });
  it("builds a parseable document", async () => {
    const bytes = await buildTaskRecapPdf("2026-10", [inst("IOC-0001"), inst("IOC-0002"), inst("IOC-0003")] as never);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
  it.each(["", "?bulan=2026-13", "?bulan=2026-1", "?bulan=2099-01", "?bulan=abc"])("rejects %s with 400", async (query) => {
    expect((await recap(query)).status).toBe(400);
  });
  it("requires the session", async () => {
    expect((await recap("?bulan=2026-10", false)).status).toBe(401);
  });
});
