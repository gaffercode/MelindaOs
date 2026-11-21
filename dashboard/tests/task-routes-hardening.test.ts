import { scryptSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as sessionGet, POST as loginPost } from "@/app/api/director/session/route";
import { POST as syncTodayPost } from "@/app/api/director/tasks/sync-today/route";
import { POST as vaultFeedbackPost } from "@/app/api/director/tasks/vault-feedback/route";
import { clearDailyDocumentCache } from "@/lib/daily/daily-documents";

const origin = "https://synthetic.example";
const salt = "00112233445566778899aabbccddeeff";
const passcode = "task-routes-passcode-123";

describe("task routes: bounded input and rate limits", () => {
  const sessions = new Map<string, { reviewerId: string }>();
  let commands: { command: string; args: Record<string, unknown> }[] = [];

  beforeEach(() => {
    sessions.clear();
    commands = [];
    clearDailyDocumentCache();
    vi.stubEnv("MELINDAOS_DIRECTOR_STORE", "supabase");
    vi.stubEnv("MELINDAOS_APP_ORIGIN", origin);
    vi.stubEnv("MELINDAOS_SUPABASE_URL", "https://synthetic.supabase.co");
    vi.stubEnv("MELINDAOS_SUPABASE_SECRET_KEY", "sb_secret_synthetic");
    vi.stubEnv("MELINDAOS_REVIEWER_ID", "director-hardening");
    vi.stubEnv("MELINDAOS_REVIEWER_PASSCODE_HASH", `scrypt$${salt}$${scryptSync(passcode, salt, 64).toString("hex")}`);
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
      const { command = "", args = {} } = JSON.parse((init?.body as string) || "{}") as { command?: string; args?: Record<string, unknown> };
      commands.push({ command, args });
      if (command === "rate_limit") return Response.json({ allowed: true });
      if (command === "users_count") return Response.json({ count: 0 });
      if (command === "session_create") { sessions.set(String(args.tokenHash), { reviewerId: String(args.reviewerId) }); return Response.json({ ok: true }); }
      if (command === "session_read") return Response.json({ session: sessions.get(String(args.tokenHash)) ?? null });
      if (command === "read") return Response.json({ document: null });
      if (command === "board") return Response.json({ instructions: [] });
      if (command === "create") return Response.json({ instruction: { id: "IOC-9100", ...args }, replayed: false });
      if (command === "submit") return Response.json({ replayed: false, id: "00000000-0000-4000-8000-000000000001", kind: args.kind, date: args.date, payloadHash: "hash", receivedAt: "2026-11-19T01:00:00.000Z" });
      return Response.json({ ok: true });
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    clearDailyDocumentCache();
  });

  async function signedIn(path: string, body: unknown): Promise<Request> {
    const login = await loginPost(new Request(`${origin}/api/director/session`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ passcode }) }));
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0]!;
    const session = (await (await sessionGet(new Request(`${origin}/api/director/session`, { headers: { Cookie: cookie } }))).json()) as { csrfToken: string };
    commands = [];
    return new Request(`${origin}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin, Cookie: cookie, "X-CSRF-Token": session.csrfToken },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  const created = () => commands.filter((entry) => entry.command === "create");
  const limited = (prefix: string) => commands.some((entry) => entry.command === "rate_limit" && String(entry.args.bucket).startsWith(prefix));

  describe("POST /api/director/tasks/sync-today", () => {
    const path = "/api/director/tasks/sync-today";

    it("looks up the stored Medify snapshot so the brief keeps its numbers, and counts the call against a limit", async () => {
      const response = await syncTodayPost(await signedIn(path, { date: "2026-11-19" }));
      expect(response.status).toBe(200);
      expect(commands.some((entry) => entry.command === "read" && entry.args.kind === "medify_snapshot")).toBe(true);
      expect(limited("sync-today:director-hardening")).toBe(true);
    });

    it("rejects a body over the size limit before anything is published", async () => {
      const response = await syncTodayPost(await signedIn(path, { date: "2026-11-19", padding: "x".repeat(2000) }));
      expect(response.status).toBe(413);
      expect(commands.some((entry) => entry.command === "submit")).toBe(false);
    });
  });

  describe("POST /api/director/tasks/vault-feedback", () => {
    const path = "/api/director/tasks/vault-feedback";
    const valid = { date: "2026-11-19", taskId: "ACT-2810-01", status: "berjalan", note: "Sedang dikerjakan" };

    it("stores valid feedback and counts it against a per-account limit", async () => {
      const response = await vaultFeedbackPost(await signedIn(path, valid));
      expect(response.status).toBe(201);
      expect(created()).toHaveLength(1);
      expect(limited("vault-feedback:director-hardening")).toBe(true);
    });

    it("rejects a body over the size limit before anything is stored", async () => {
      const response = await vaultFeedbackPost(await signedIn(path, { ...valid, note: "x".repeat(5000) }));
      expect(response.status).toBe(413);
      expect(created()).toHaveLength(0);
    });

    it.each([
      ["a malformed date", { ...valid, date: "19-11-2026" }],
      ["a note over 280 characters", { ...valid, note: "x".repeat(281) }],
      ["a third-party name over 60 characters", { ...valid, thirdPartyName: "x".repeat(61) }],
    ])("rejects %s", async (_label, body) => {
      const response = await vaultFeedbackPost(await signedIn(path, body));
      expect(response.status).toBe(400);
      expect(created()).toHaveLength(0);
    });
  });
});
