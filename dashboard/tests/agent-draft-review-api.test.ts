import { scryptSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as listRoute } from "@/app/api/director/agent-drafts/route";
import { GET as readRoute, POST as decideRoute } from "@/app/api/director/agent-drafts/[id]/route";
import { GET as downloadRoute } from "@/app/api/director/agent-drafts/[id]/unduh/route";
import { POST as login } from "@/app/api/director/session/route";
import { draftFileName } from "@/lib/agent/agent-draft-review-api";

const origin = "https://synthetic.example";
const salt = "00112233445566778899aabbccddeeff";
const passcodeHash = `scrypt$${salt}$${scryptSync("synthetic-test-passcode", salt, 64).toString("hex")}`;
const id = "00000000-0000-4000-8000-000000000001";
const summary = { id, producer: "luna", title: "Alur klaim BPJS", category: "A", docId: null, domain: null, department: null, note: null, source: null, status: "submitted", receivedAt: "2026-11-11T08:00:00.000Z", reviewedAt: null, reviewNote: null };
const content = "# Alur klaim\n\nLangkah 1 — periksa berkas.\n";

type Call = { command: string; args: Record<string, unknown> };
let calls: Call[];
let urls: string[];
let rateAllowed: boolean;
let session: { reviewerId: string } | null;
let gateway: (call: Call) => Response;

beforeEach(() => {
  calls = []; urls = []; rateAllowed = true; session = null;
  gateway = () => Response.json({ errorCode: "invalid_command" });
  vi.stubEnv("MELINDAOS_DIRECTOR_STORE", "supabase");
  vi.stubEnv("MELINDAOS_APP_ORIGIN", origin);
  vi.stubEnv("MELINDAOS_SUPABASE_URL", "https://synthetic.supabase.co");
  vi.stubEnv("MELINDAOS_SUPABASE_SECRET_KEY", "sb_secret_synthetic");
  vi.stubEnv("MELINDAOS_REVIEWER_PASSCODE_HASH", passcodeHash);
  vi.stubEnv("MELINDAOS_REVIEWER_ID", "director-test");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const call = JSON.parse(init.body as string) as Call;
    calls.push(call); urls.push(String(url));
    if (call.command === "rate_limit") return Response.json({ allowed: rateAllowed });
    if (call.command === "rate_reset") return Response.json({ ok: true });
    if (call.command === "session_create") { session = { reviewerId: "director-test" }; return Response.json({ ok: true }); }
    if (call.command === "session_read") return Response.json({ session });
    return gateway(call);
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const sent = (command: string) => calls.filter((call) => call.command === command);
function request(path: string, method: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`${origin}${path}`, { method, headers: { "Content-Type": "application/json", Origin: origin, ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function humanSession() {
  const response = await login(request("/api/director/session", "POST", { passcode: "synthetic-test-passcode" }));
  expect(response.status).toBe(200);
  const body = await response.json() as { csrfToken: string };
  return { Cookie: response.headers.get("set-cookie")!.split(";")[0], "X-CSRF-Token": body.csrfToken };
}
const params = (value: string) => ({ params: Promise.resolve({ id: value }) });
const draftPath = (value: string, tail = "") => `/api/director/agent-drafts/${value}${tail}`;
async function decide(body: unknown, headers?: Record<string, string>) {
  return decideRoute(request(draftPath(id), "POST", body, headers ?? await humanSession()), params(id));
}
const decidedRow = (status: "accepted" | "rejected", reviewNote: string | null) => ({ ...summary, content, status, reviewedAt: "2026-11-11T09:00:00.000Z", reviewNote });

describe("agent draft review: list", () => {
  it("refuses a caller without a session", async () => {
    expect((await listRoute(request("/api/director/agent-drafts", "GET"))).status).toBe(401);
  });

  it("rejects an unknown status", async () => {
    const response = await listRoute(request("/api/director/agent-drafts?status=bogus", "GET", undefined, await humanSession()));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Status tidak dikenal." });
    expect(sent("review_list")).toEqual([]);
  });

  it("lists submitted drafts by default", async () => {
    gateway = (call) => call.command === "review_list" ? Response.json({ submissions: [summary] }) : Response.json({ errorCode: "invalid_command" });
    const response = await listRoute(request("/api/director/agent-drafts", "GET", undefined, await humanSession()));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ submissions: [summary] });
    expect(sent("review_list")).toEqual([{ command: "review_list", args: { status: "submitted" } }]);
  });

  it("sends the review commands to the melinda_agent_gateway RPC", async () => {
    gateway = () => Response.json({ submissions: [] });
    await listRoute(request("/api/director/agent-drafts", "GET", undefined, await humanSession()));
    const index = calls.findIndex((call) => call.command === "review_list");
    expect(urls[index]).toMatch(/\/rpc\/melinda_agent_gateway$/);
  });

  it("tells the Director the drafts are unavailable when the old RPC does not know the command", async () => {
    const response = await listRoute(request("/api/director/agent-drafts", "GET", undefined, await humanSession()));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Draf dari agent belum tersedia." });
  });

  it("passes an explicit status through", async () => {
    gateway = () => Response.json({ submissions: [] });
    await listRoute(request("/api/director/agent-drafts?status=rejected", "GET", undefined, await humanSession()));
    expect(sent("review_list")[0].args).toEqual({ status: "rejected" });
  });

  it("answers 503 when the store returns rows of the wrong shape", async () => {
    gateway = () => Response.json({ submissions: [{ id }] });
    expect((await listRoute(request("/api/director/agent-drafts", "GET", undefined, await humanSession()))).status).toBe(503);
  });
});

describe("agent draft review: read", () => {
  it("answers 404 for a malformed id without asking the gateway", async () => {
    const response = await readRoute(request(draftPath("not-a-uuid"), "GET", undefined, await humanSession()), params("not-a-uuid"));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Draf tidak ditemukan." });
    expect(sent("review_read")).toEqual([]);
  });

  it("answers 404 when the store does not know the draft", async () => {
    gateway = () => Response.json({ errorCode: "not_found" });
    const response = await readRoute(request(draftPath(id), "GET", undefined, await humanSession()), params(id));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Draf tidak ditemukan." });
  });

  it("tells the Director the drafts are unavailable when the old RPC does not know the command", async () => {
    const response = await readRoute(request(draftPath(id), "GET", undefined, await humanSession()), params(id));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Draf dari agent belum tersedia." });
  });

  it("uses the same message when the store answers 503", async () => {
    gateway = () => new Response("down", { status: 503 });
    const response = await readRoute(request(draftPath(id), "GET", undefined, await humanSession()), params(id));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Draf dari agent belum tersedia." });
  });

  it("returns the draft with its content", async () => {
    gateway = () => Response.json({ submission: { ...summary, content } });
    const response = await readRoute(request(draftPath(id), "GET", undefined, await humanSession()), params(id));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ submission: { ...summary, content } });
    expect(sent("review_read")).toEqual([{ command: "review_read", args: { id } }]);
  });
});

describe("agent draft review: decide", () => {
  it("refuses a decision without the CSRF token", async () => {
    const { Cookie } = await humanSession();
    expect((await decide({ decision: "accepted" }, { Cookie })).status).toBe(403);
    expect(sent("review_decide")).toEqual([]);
  });

  it.each([
    ["rejected without a note", { decision: "rejected" }],
    ["rejected with a blank note", { decision: "rejected", note: "   " }],
    ["a note over 1000 characters", { decision: "accepted", note: "a".repeat(1001) }],
    ["an unknown decision", { decision: "maybe" }],
    ["an unknown key", { decision: "accepted", extra: true }],
    ["a note that is not text", { decision: "accepted", note: 5 }],
  ])("rejects %s with 400", async (_name, body) => {
    expect((await decide(body)).status).toBe(400);
    expect(sent("review_decide")).toEqual([]);
  });

  it("uses the specific messages for a missing and a long note", async () => {
    expect(await (await decide({ decision: "rejected" })).json()).toEqual({ error: "Alasan penolakan wajib diisi." });
    expect(await (await decide({ decision: "accepted", note: "a".repeat(1001) })).json()).toEqual({ error: "Catatan maksimal 1000 karakter." });
  });

  it("accepts a note of exactly 1000 characters", async () => {
    gateway = () => Response.json({ submission: decidedRow("accepted", "a".repeat(1000)), replayed: false });
    expect((await decide({ decision: "accepted", note: "a".repeat(1000) })).status).toBe(200);
  });

  it("answers 404 for a malformed id without asking the gateway", async () => {
    const response = await decideRoute(request(draftPath("not-a-uuid"), "POST", { decision: "accepted" }, await humanSession()), params("not-a-uuid"));
    expect(response.status).toBe(404);
    expect(sent("review_decide")).toEqual([]);
  });

  it("refuses a note that holds a patient identifier", async () => {
    const response = await decide({ decision: "rejected", note: "NIK 3506012345678901" });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "Catatan memuat data pasien (NIK). Hapus lalu coba lagi." });
    expect(sent("review_decide")).toEqual([]);
  });

  it("refuses an accepting note that holds a patient identifier", async () => {
    expect((await decide({ decision: "accepted", note: "NIK 3506012345678901" })).status).toBe(422);
    expect(sent("review_decide")).toEqual([]);
  });

  it("accepts a draft and sends the reviewer from the session", async () => {
    gateway = () => Response.json({ submission: decidedRow("accepted", null), replayed: false });
    const response = await decide({ decision: "accepted" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ submission: decidedRow("accepted", null), replayed: false });
    expect(sent("review_decide")).toEqual([{ command: "review_decide", args: { id, decision: "accepted", note: "", reviewer: "director-test" } }]);
    expect(sent("rate_limit").some((call) => call.args.bucket === "agent-draft-review:director-test")).toBe(true);
  });

  it("trims the rejection note before sending it", async () => {
    gateway = () => Response.json({ submission: decidedRow("rejected", "Sumber belum jelas"), replayed: false });
    expect((await decide({ decision: "rejected", note: "  Sumber belum jelas  " })).status).toBe(200);
    expect(sent("review_decide")[0].args.note).toBe("Sumber belum jelas");
  });

  it("reports a replayed decision", async () => {
    gateway = () => Response.json({ submission: decidedRow("accepted", null), replayed: true });
    expect((await (await decide({ decision: "accepted" })).json()).replayed).toBe(true);
  });

  it("answers 409 when the draft was decided the other way", async () => {
    gateway = () => Response.json({ errorCode: "conflict" });
    const response = await decide({ decision: "accepted" });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Draf ini sudah diputuskan." });
  });

  it("refuses a decision from a foreign origin even with a valid session and CSRF token", async () => {
    const response = await decide({ decision: "accepted" }, { ...await humanSession(), Origin: "https://evil.example" });
    expect(response.status).toBe(403);
    expect(sent("review_decide")).toEqual([]);
  });

  it("rate limits decisions per reviewer: 60 per 60 seconds", async () => {
    gateway = () => Response.json({ submission: decidedRow("accepted", null), replayed: false });
    await decide({ decision: "accepted" });
    expect(sent("rate_limit").filter((call) => call.args.bucket === "agent-draft-review:director-test")).toEqual([{ command: "rate_limit", args: { bucket: "agent-draft-review:director-test", limit: 60, seconds: 60 } }]);
  });

  it("answers 429 and sends no decision when the rate limit is exhausted", async () => {
    const headers = await humanSession();
    rateAllowed = false;
    const response = await decide({ decision: "accepted" }, headers);
    expect(response.status).toBe(429);
    expect(sent("review_decide")).toEqual([]);
  });

  it("answers 404 when the draft is gone", async () => {
    gateway = () => Response.json({ errorCode: "not_found" });
    const response = await decide({ decision: "accepted" });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Draf tidak ditemukan." });
  });

  it("answers 503 when the store is down", async () => {
    gateway = () => new Response("down", { status: 503 });
    expect((await decide({ decision: "accepted" })).status).toBe(503);
  });
});

describe("agent draft review: download", () => {
  const download = async (value = id) => downloadRoute(request(draftPath(value, "/unduh"), "GET", undefined, await humanSession()), params(value));

  it("refuses a caller without a session", async () => {
    expect((await downloadRoute(request(draftPath(id, "/unduh"), "GET"), params(id))).status).toBe(401);
  });

  it("answers 404 for a malformed id without asking the gateway", async () => {
    expect((await download("not-a-uuid")).status).toBe(404);
    expect(sent("review_read")).toEqual([]);
  });

  it("refuses to download a draft that is not accepted", async () => {
    for (const status of ["submitted", "rejected"]) {
      gateway = () => Response.json({ submission: { ...summary, content, status } });
      const response = await download();
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: "Draf belum diterima, jadi belum bisa diunduh." });
    }
  });

  it("sends an accepted draft as an attachment, byte for byte", async () => {
    gateway = () => Response.json({ submission: decidedRow("accepted", null) });
    const response = await download();
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer()).equals(Buffer.from(content, "utf8"))).toBe(true);
    expect(response.headers.get("Content-Type")).toBe("text/markdown; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="draf-00000000-alur-klaim-bpjs.md"');
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("sends a category B draft as markdown with a .prompt.md name", async () => {
    gateway = () => Response.json({ submission: { ...decidedRow("accepted", null), category: "B" } });
    const response = await download();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/markdown; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toMatch(/\.prompt\.md"$/);
  });

  it("sends a category C draft as JSON with a .json name, whatever the content", async () => {
    const raw = "not json {";
    gateway = () => Response.json({ submission: { ...decidedRow("accepted", null), category: "C", content: raw } });
    const response = await download();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toMatch(/\.json"$/);
    expect(Buffer.from(await response.arrayBuffer()).equals(Buffer.from(raw, "utf8"))).toBe(true);
  });
});

describe("draftFileName", () => {
  const name = (title: string, category: "A" | "B" | "C") => draftFileName({ id, title, category });

  it("picks the extension from the category", () => {
    expect(name("Alur klaim BPJS", "A")).toBe("draf-00000000-alur-klaim-bpjs.md");
    expect(name("Alur klaim BPJS", "B")).toBe("draf-00000000-alur-klaim-bpjs.prompt.md");
    expect(name("Alur klaim BPJS", "C")).toBe("draf-00000000-alur-klaim-bpjs.json");
  });

  it("falls back to dokumen when no letters or digits remain", () => {
    expect(name("!!! ???", "A")).toBe("draf-00000000-dokumen.md");
  });

  it("cuts a long title to 60 characters without a trailing dash", () => {
    const slug = name(`${"a".repeat(59)} bbbbbbbbbb`, "A").replace(/^draf-00000000-/, "").replace(/\.md$/, "");
    expect(slug).toBe("a".repeat(59));
    expect(name("x".repeat(200), "A").replace(/^draf-00000000-/, "").replace(/\.md$/, "")).toHaveLength(60);
  });

  it("drops accents instead of splitting words on them", () => {
    expect(name("Naïve café", "A")).toBe("draf-00000000-naive-cafe.md");
  });
});
