import { scryptSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as login } from "@/app/api/director/session/route";
import { POST as draft } from "@/app/api/director/instructions/draft/route";

const origin = "https://synthetic.example";
const claudeUrl = "https://api.anthropic.com/v1/messages";
const salt = "00112233445566778899aabbccddeeff";
const passcodeHash = `scrypt$${salt}$${scryptSync("synthetic-test-passcode", salt, 64).toString("hex")}`;
const twoDrafts = { drafts: [
  { title: "Ketua pokja PMKP", action: "assign", pic: ["Kepala SDM – Oriza Rahmawati, A.Md.Keb."], deadline: null, note: "Ketua Pokja PMKP: dr. Novia Dwi Anggraini.", urgent: false },
  { title: "Rekap berkas kredensial", action: "request_update", pic: [], deadline: "2026-11-06T16:00", note: "", urgent: true },
] };
let session: { reviewerId: string } | null;
let claudeBodies: Record<string, unknown>[];
let claudeReply: { content: { type: string; text: string }[]; stop_reason: string };
let draftAllowed: boolean;

beforeEach(() => {
  session = null; claudeBodies = []; draftAllowed = true;
  claudeReply = { content: [{ type: "text", text: JSON.stringify(twoDrafts) }], stop_reason: "end_turn" };
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-05T02:00:00Z"));
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-anthropic-key");
  vi.stubEnv("MELINDAOS_DIRECTOR_STORE", "supabase");
  vi.stubEnv("MELINDAOS_APP_ORIGIN", origin);
  vi.stubEnv("MELINDAOS_SUPABASE_URL", "https://synthetic.supabase.co");
  vi.stubEnv("MELINDAOS_SUPABASE_SECRET_KEY", "sb_secret_synthetic");
  vi.stubEnv("MELINDAOS_REVIEWER_PASSCODE_HASH", passcodeHash);
  vi.stubEnv("MELINDAOS_REVIEWER_ID", "director-test");
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (url === claudeUrl) { claudeBodies.push(JSON.parse(init.body as string)); return Response.json(claudeReply); }
    const { command, args } = JSON.parse(init.body as string) as { command: string; args: Record<string, string> };
    if (command === "rate_limit") return Response.json({ allowed: String(args.bucket).startsWith("draft:") ? draftAllowed : true });
    if (command === "rate_reset") return Response.json({ ok: true });
    if (command === "session_create") { session = { reviewerId: "director-test" }; return Response.json({ ok: true }); }
    if (command === "session_read") return Response.json({ session });
    return Response.json({ errorCode: "invalid_command" });
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${origin}/api/director/instructions/draft`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, ...headers }, body: JSON.stringify(body) });
}
async function humanSession() {
  const response = await login(new Request(`${origin}/api/director/session`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ passcode: "synthetic-test-passcode", returnTo: "/" }) }));
  const body = await response.json() as { csrfToken: string };
  return { Cookie: response.headers.get("set-cookie")!.split(";")[0], "X-CSRF-Token": body.csrfToken };
}
const note = { note: "PMKP dipimpin dr. Novia. Minta rekap berkas kredensial besok jam 16.", context: "STARKES Command" };

describe("POST /api/director/instructions/draft", () => {
  it("requires a Director session and CSRF", async () => {
    expect((await draft(request(note))).status).toBe(401);
    const credentials = await humanSession();
    expect((await draft(request(note, { Cookie: credentials.Cookie }))).status).toBe(403);
  });
  it("answers 503 without a Claude API key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const response = await draft(request(note, await humanSession()));
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("Asisten AI belum dikonfigurasi.");
  });
  it("rejects empty, too long, or unexpected input", async () => {
    const credentials = await humanSession();
    for (const body of [{ note: "   " }, { note: "x".repeat(2001) }, { ...note, extra: 1 }, { ...note, context: "x".repeat(61) }, { note: 5 }]) {
      expect((await draft(request(body, credentials))).status).toBe(400);
    }
    expect(claudeBodies).toHaveLength(0);
  });
  it("blocks patient identifiers before calling Claude", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await draft(request({ note: "Pindahkan Ny. Sari ke Aster" }, await humanSession()));
    expect(response.status).toBe(422);
    expect((await response.json()).error).toBe("Catatan memuat data pasien (nama pasien). Hapus lalu coba lagi.");
    expect(claudeBodies).toHaveLength(0);
    expect(JSON.stringify(log.mock.calls)).not.toContain("Sari");
  });
  it("returns drafts and sends the WIB date, context and schema to Claude", async () => {
    const response = await draft(request(note, await humanSession()));
    expect(response.status).toBe(200);
    const { drafts } = await response.json();
    expect(drafts).toEqual(twoDrafts.drafts.map((item) => ({ ...item, issues: [] })));
    const body = claudeBodies[0] as { model: string; system: string; messages: { content: string }[]; output_config: { format: { type: string; schema: unknown } } };
    expect(body.model).toBe("claude-haiku-5-5");
    expect(body.output_config.format.type).toBe("json_schema");
    expect(body.messages[0]!.content).toContain("Hari ini: 2026-11-05, Kamis (WIB). Halaman: STARKES Command.");
    expect(body.messages[0]!.content).toContain(note.note);
    expect(body.system).toContain("Jangan menambah");
  });
  it("accepts a multi-byte note near the 2,000-character limit", async () => {
    expect((await draft(request({ note: "é".repeat(1999) }, await humanSession()))).status).toBe(200);
  });
  it("answers 502 when Claude refuses, runs out of tokens, or returns unusable output", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const credentials = await humanSession();
    const replies = [
      { content: [{ type: "text", text: "{}" }], stop_reason: "refusal" },
      { content: [{ type: "text", text: "{\"drafts\":[" }], stop_reason: "max_tokens" },
      { content: [{ type: "text", text: "Maaf, saya tidak bisa." }], stop_reason: "end_turn" },
      { content: [{ type: "text", text: JSON.stringify({ drafts: [{ title: "" }] }) }], stop_reason: "end_turn" },
    ];
    for (const reply of replies) {
      claudeReply = reply;
      const response = await draft(request(note, credentials));
      expect(response.status).toBe(502);
      expect((await response.json()).error).toBe("Asisten AI belum dapat meringkas. Coba lagi.");
    }
    expect(JSON.stringify(log.mock.calls)).not.toContain("PMKP");
  });
  it("answers 429 when the draft rate limit is spent", async () => {
    const credentials = await humanSession();
    draftAllowed = false;
    expect((await draft(request(note, credentials))).status).toBe(429);
    expect(claudeBodies).toHaveLength(0);
  });
});
