import { scryptSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectOpsAlerts } from "@/lib/ops-alerts";

const origin = "https://synthetic.example";
const salt = "00112233445566778899aabbccddeeff";
let instructions: Record<string, unknown>[];
let latest: Record<string, { report_date: string; received_at?: string } | null>;

beforeEach(() => {
  instructions = []; latest = { simrs_snapshot: null };
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-24T03:30:00Z")); // 10:30 WIB
  vi.stubEnv("MELINDAOS_DIRECTOR_STORE", "supabase");
  vi.stubEnv("MELINDAOS_APP_ORIGIN", origin);
  vi.stubEnv("MELINDAOS_SUPABASE_URL", "https://synthetic.supabase.co");
  vi.stubEnv("MELINDAOS_SUPABASE_SECRET_KEY", "sb_secret_synthetic");
  vi.stubEnv("MELINDAOS_REVIEWER_PASSCODE_HASH", `scrypt$${salt}$${scryptSync("synthetic-test-passcode", salt, 64).toString("hex")}`);
  vi.stubEnv("MELINDAOS_REVIEWER_ID", "director-test");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const { command, args } = JSON.parse(init.body as string) as { command: string; args: Record<string, string> };
    if (command === "open") return Response.json({ instructions: instructions.filter((row) => String(row.reportDate) >= args.from && String(row.reportDate) <= args.to && row.status !== "selesai" && row.action !== "done").map((row) => ({ pic: [], ...row })) });
    if (command === "latest") return Response.json({ document: latest[args.kind] ? { id: "x", kind: args.kind, producer: "biznet-medify", payload_hash: "0".repeat(64), received_at: "2026-10-24T00:00:00Z", ...latest[args.kind] } : null });
    return Response.json({ errorCode: "invalid_command" });
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const codes = async () => (await collectOpsAlerts()).alerts.map((alert) => alert.code);

describe("operational alerts", () => {
  it("reports no alerts when today's census exists and nothing is overdue", async () => {
    latest = { simrs_snapshot: { report_date: "2026-10-24" } };
    expect(await collectOpsAlerts()).toMatchObject({ date: "2026-10-24", alerts: [], latestSnapshot: "2026-10-24" });
  });
  it("flags handed-over instructions whose deadline passed, within the open window", async () => {
    latest = { simrs_snapshot: { report_date: "2026-10-24" } };
    instructions = [
      { id: "IOC-0010", reportDate: "2026-10-15", itemTitle: "Kalibrasi", action: "request_update", deadline: "2026-10-23T16:00", status: "diterima_pic", createdAt: "2026-10-15T02:00:00Z" },
      { id: "IOC-0011", reportDate: "2026-10-24", itemTitle: "SIP", action: "escalate", deadline: "2026-10-24T10:00", status: "diteruskan", createdAt: "2026-10-24T01:00:00Z" },
      { id: "IOC-0012", reportDate: "2026-10-24", itemTitle: "Nanti", action: "request_update", deadline: "2026-10-24T12:00", status: "diteruskan", createdAt: "2026-10-24T01:00:00Z" },
      { id: "IOC-0013", reportDate: "2026-10-24", itemTitle: "Sudah", action: "request_update", deadline: "2026-10-24T09:00", status: "selesai", createdAt: "2026-10-24T01:00:00Z" },
      { id: "IOC-0014", reportDate: "2026-10-24", itemTitle: "Ditutup", action: "done", deadline: null, status: "diteruskan", createdAt: "2026-10-24T01:00:00Z" },
      { id: "IOC-0015", reportDate: "2026-10-09", itemTitle: "Terlalu lama", action: "request_update", deadline: "2026-10-10T09:00", status: "diteruskan", createdAt: "2026-10-09T01:00:00Z" },
      { id: "IOC-0016", reportDate: "2026-10-24", itemTitle: "Belum diserahkan", action: "request_update", deadline: "2026-10-24T09:00", status: "dibuat", createdAt: "2026-10-24T01:00:00Z" },
    ];
    const report = await collectOpsAlerts();
    expect(report.alerts.map((alert) => alert.code)).toEqual(["instruction_overdue", "instruction_overdue"]);
    expect(report.alerts[0].detail).toContain("IOC-0010");
    expect(report.alerts[0].detail).toContain("23-10-2026 16.00 WIB");
    expect(report.alerts[1].detail).toContain("IOC-0011");
  });
  it("does not alert on the census before the morning deadline", async () => {
    vi.setSystemTime(new Date("2026-10-23T23:30:00Z")); // 06:30 WIB, before the 07:00 snapshot deadline
    expect(await codes()).toEqual([]);
  });
  it("names the Medify pull when no snapshot of any kind exists for today", async () => {
    latest = { medify_snapshot: { report_date: "2026-10-23", received_at: "2026-10-23T13:30:00Z" }, simrs_snapshot: null };
    const report = await collectOpsAlerts();
    expect(report.alerts.map((alert) => alert.code)).toEqual(["snapshot_missing"]);
    expect(report.alerts[0].detail).toContain("tarikan Medify untuk 2026-10-24");
    expect(report.alerts[0].detail).toContain("terakhir: 2026-10-23");
    expect(report.latestSnapshot).toBe("2026-10-23");
  });
  it("accepts a fresh Medify snapshot during service hours", async () => {
    latest = { medify_snapshot: { report_date: "2026-10-24", received_at: "2026-10-24T03:05:00Z" }, simrs_snapshot: null }; // 10:05 WIB, 25 min ago
    expect(await collectOpsAlerts()).toMatchObject({ alerts: [], latestSnapshot: "2026-10-24" });
  });
  it("accepts a Medify snapshot twelve hours old during service hours", async () => {
    vi.setSystemTime(new Date("2026-10-24T13:00:00Z")); // 20:00 WIB
    latest = { medify_snapshot: { report_date: "2026-10-24", received_at: "2026-10-24T01:00:00Z" }, simrs_snapshot: null }; // 08:00 WIB, 12 h ago
    expect(await codes()).toEqual([]);
  });
  it("accepts a Medify snapshot exactly thirteen hours old during service hours", async () => {
    vi.setSystemTime(new Date("2026-10-24T13:00:00Z")); // 20:00 WIB
    latest = { medify_snapshot: { report_date: "2026-10-24", received_at: "2026-10-24T00:00:00Z" }, simrs_snapshot: null }; // 07:00 WIB, exactly 13 h
    expect(await codes()).toEqual([]);
  });
  it("flags a Medify snapshot older than thirteen hours during service hours", async () => {
    vi.setSystemTime(new Date("2026-10-24T13:00:00Z")); // 20:00 WIB
    latest = { medify_snapshot: { report_date: "2026-10-24", received_at: "2026-10-23T23:59:00Z" }, simrs_snapshot: null }; // 06:59 WIB, 13 h 1 min ago
    const report = await collectOpsAlerts();
    expect(report.alerts.map((alert) => alert.code)).toEqual(["snapshot_stale"]);
    expect(report.alerts[0].detail).toContain("06:59 WIB");
    expect(report.alerts[0].detail).toContain("13 jam");
  });
  it("does not flag an old Medify snapshot outside service hours", async () => {
    vi.setSystemTime(new Date("2026-10-24T15:00:00Z")); // 22:00 WIB
    latest = { medify_snapshot: { report_date: "2026-10-24", received_at: "2026-10-24T01:00:00Z" }, simrs_snapshot: null }; // 08:00 WIB, 14 h ago
    expect(await codes()).toEqual([]);
  });
});
