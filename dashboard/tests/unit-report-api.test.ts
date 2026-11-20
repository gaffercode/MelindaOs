import { scryptSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as resumeSession, POST as exchangeSession } from "@/app/api/unit-reports/session/route";
import { POST as submitReport } from "@/app/api/unit-reports/route";

const origin = "https://synthetic.example";
const capability = "a".repeat(43);
const salt = "00112233445566778899aabbccddeeff";
const passcodeHash = `scrypt$${salt}$${scryptSync("synthetic", salt, 64).toString("hex")}`;
const source = { id: "sdm", label: "Laporan SDM", kind: "unit_report", required: true, period: "previous_day", section: "staffing", picRelayTarget: "relay:sdm", numericFields: [] };
let submissions: { capabilityHash: string; input: Record<string, unknown>; contentHash: string }[];
let capabilityValid: boolean;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-27T03:00:00Z"));
  submissions = []; capabilityValid = true;
  vi.stubEnv("MELINDAOS_DIRECTOR_STORE", "supabase");
  vi.stubEnv("MELINDAOS_APP_ORIGIN", origin);
  vi.stubEnv("MELINDAOS_SUPABASE_URL", "https://synthetic.supabase.co");
  vi.stubEnv("MELINDAOS_SUPABASE_SECRET_KEY", "sb_secret_synthetic");
  vi.stubEnv("MELINDAOS_REVIEWER_PASSCODE_HASH", passcodeHash);
  vi.stubEnv("MELINDAOS_REVIEWER_ID", "director-test");
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const { command, args } = JSON.parse(init.body as string) as { command: string; args: Record<string, unknown> };
    if (command === "rate_limit") return Response.json({ allowed: true });
    expect(url).toContain("/rpc/melinda_daily_pipeline");
    if (command === "exchange_capability") return capabilityValid
      ? Response.json({ sourceId: "sdm", reportDate: "2026-10-27", expiresAt: "2026-10-27T17:00:00Z", source })
      : Response.json({ errorCode: "invalid_capability" });
    if (command === "submit_report") {
      submissions.push(args as typeof submissions[number]);
      return Response.json({ replayed: submissions.length > 1, revision: 1, receipt: "receipt-1" });
    }
    return Response.json({ errorCode: "invalid_command" });
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function request(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${origin}${path}`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
}

describe("limited unit report capability", () => {
  it("exchanges a URL-fragment capability for a scoped HttpOnly cookie without echoing the secret", async () => {
    const response = await exchangeSession(request("/api/unit-reports/session", { capability }));
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toMatch(/^melinda_unit_report=/);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(await response.json()).toEqual({ reportDate: "2026-10-27", source: { id: "sdm", label: "Laporan SDM", numericFields: [] } });
  });

  it("accepts no-issues without inventing numeric zero and replays a double submit", async () => {
    const cookie = `melinda_unit_report=${capability}`;
    const input = { availability: "no_issues", issues: "Tidak ada kendala", followUp: "", decisionNeeded: "", metrics: {} };
    const first = await submitReport(request("/api/unit-reports", input, { Cookie: cookie }));
    expect(first.status).toBe(201);
    expect(submissions[0].input).toMatchObject({ sourceId: "sdm", reportDate: "2026-10-27", periodDate: "2026-10-26", availability: "no_issues", metrics: {} });
    expect(Object.values((submissions[0].input.metrics ?? {}) as object)).toEqual([]);
    expect((await submitReport(request("/api/unit-reports", input, { Cookie: cookie }))).status).toBe(200);
  });

  it("resumes the scoped form from its HttpOnly cookie after reload", async () => {
    const response = await resumeSession(new Request(`${origin}/api/unit-reports/session`, { headers: { Cookie: `melinda_unit_report=${capability}` } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ reportDate: "2026-10-27", source: { id: "sdm", label: "Laporan SDM", numericFields: [] } });
  });

  it("rejects wrong origin, revoked capability, scope fields and oversized payloads", async () => {
    expect((await exchangeSession(new Request(`${origin}/api/unit-reports/session`, { method: "POST", headers: { Origin: "https://evil.example", "Content-Type": "application/json" }, body: JSON.stringify({ capability }) }))).status).toBe(403);
    capabilityValid = false;
    expect((await exchangeSession(request("/api/unit-reports/session", { capability }))).status).toBe(401);
    capabilityValid = true;
    const cookie = `melinda_unit_report=${capability}`;
    expect((await submitReport(request("/api/unit-reports", { sourceId: "other", availability: "received", issues: "", followUp: "", decisionNeeded: "", metrics: {} }, { Cookie: cookie }))).status).toBe(400);
    expect((await submitReport(request("/api/unit-reports", { availability: "received", issues: "x".repeat(9000), followUp: "", decisionNeeded: "", metrics: {} }, { Cookie: cookie }))).status).toBe(413);
  });
});
