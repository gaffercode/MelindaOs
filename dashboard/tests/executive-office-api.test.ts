import { scryptSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as planRoute } from "@/app/api/director/executive/plan/route";

const salt = "00112233445566778899aabbccddeeff";
const passcodeHash = `scrypt$${salt}$${scryptSync("synthetic-test-passcode", salt, 64).toString("hex")}`;
const origin = "https://synthetic.example";
const calls: { rpc: string; command: string; args: Record<string, unknown> }[] = [];
beforeEach(() => {
  calls.length = 0;
  vi.stubEnv("MELINDAOS_DIRECTOR_STORE", "supabase");
  vi.stubEnv("MELINDAOS_APP_ORIGIN", origin);
  vi.stubEnv("MELINDAOS_SUPABASE_URL", "https://synthetic.supabase.co");
  vi.stubEnv("MELINDAOS_SUPABASE_SECRET_KEY", "sb_secret_synthetic");
  vi.stubEnv("MELINDAOS_REVIEWER_PASSCODE_HASH", passcodeHash);
  vi.stubEnv("MELINDAOS_REVIEWER_ID", "synthetic-director");
  vi.stubGlobal("fetch", async (url: string, options: RequestInit) => {
    const { command, args } = JSON.parse(options.body as string) as { command: string; args: Record<string, unknown> };
    const rpc = url.split("/").pop() ?? "";
    calls.push({ rpc, command, args });
    if (command === "rate_limit") return Response.json({ allowed: true });
    if (command === "plan") return Response.json({ date: args.date, events: [], readiness: [], archives: [], outbox: [] });
    return Response.json({ errorCode: "invalid_command" });
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("Secure Executive Office API", () => {
  it("keeps the Director preparation plan behind Director login", async () => {
    const response = await planRoute(new Request(origin + "/api/director/executive/plan?date=2099-01-11"));
    expect(response.status).toBe(401);
    expect(calls.some((c) => c.command === "plan")).toBe(false);
  });
});
