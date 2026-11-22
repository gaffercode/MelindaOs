import { scryptSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearDailyDocumentCache } from "@/lib/daily/daily-documents";
import { canonicalHash } from "@/lib/director/director-store";
import { collectOpsAlerts, missedSlotsForDay } from "@/lib/ops-alerts";

const origin = "https://synthetic.example";
const salt = "00112233445566778899aabbccddeeff";
let instructions: Record<string, unknown>[];
let latest: Record<string, { report_date: string; received_at?: string } | null>;
let heartbeats: { producer: string; seenAt: string }[];
/** Latest synthetic `medify_run_status` per past date; a date that is absent has no status. Defaults to a complete evening pull every day. */
let runStatuses: Record<string, { slot: "morning" | "evening"; status: "complete" | "failed" } | "unreadable" | null>;

function runStatusDocument(date: string, slot: "morning" | "evening", status: "complete" | "failed") {
  const at = `${date}T${slot === "morning" ? "00" : "12"}:00:00.000Z`; // 07:00 or 19:00 WIB, same WIB date
  const payload = { schemaVersion: 1, date, slot, runId: `synthetic-${date}-${slot}`, status, startedAt: at, completedAt: at,
    unavailableSections: status === "failed" ? [{ section: null, reason: "overlap_denied" }] : [], snapshotRevisionId: null, snapshotReceivedAt: null };
  return { id: `run-${date}`, kind: "medify_run_status", report_date: date, producer: "biznet-medify", payload, payload_hash: canonicalHash(payload), received_at: at };
}

beforeEach(() => {
  instructions = []; latest = { simrs_snapshot: null }; runStatuses = {}; heartbeats = [];
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
    if (command === "read" && args.kind === "medify_run_status") {
      const entry = args.date in runStatuses ? runStatuses[args.date] : { slot: "evening" as const, status: "complete" as const };
      if (entry === "unreadable") return Response.json({ errorCode: "invalid_command" });
      return Response.json({ document: entry ? runStatusDocument(args.date, entry.slot, entry.status) : null });
    }
    if (command === "latest") return Response.json({ document: latest[args.kind] ? { id: "x", kind: args.kind, producer: "biznet-medify", payload_hash: "0".repeat(64), received_at: "2026-10-24T00:00:00Z", ...latest[args.kind] } : null });
    if (command === "health") return Response.json({ heartbeats });
    return Response.json({ errorCode: "invalid_command" });
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); clearDailyDocumentCache(); });

const codes = async () => (await collectOpsAlerts()).alerts.map((alert) => alert.code);

describe("operational alerts", () => {
  it("flags a global login lock from the last 24 hours only", async () => {
    latest = { simrs_snapshot: { report_date: "2026-10-24" } };
    heartbeats = [{ producer: "alert:login-global-locked", seenAt: "2026-10-24T01:15:00Z" }];
    const report = await collectOpsAlerts();
    expect(report.alerts.map((alert) => alert.code)).toEqual(["login_locked"]);
    expect(report.alerts[0].detail).toContain("08:15 WIB");
    heartbeats = [{ producer: "alert:login-global-locked", seenAt: "2026-10-23T03:00:00Z" }];
    expect(await codes()).toEqual([]);
  });
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

describe("missed scheduled Medify pulls", () => {
  it("names each slot a past day's latest status shows as missing or failed", () => {
    expect(missedSlotsForDay(null)).toEqual(["pagi", "sore"]);
    expect(missedSlotsForDay({ slot: "morning", status: "complete" })).toEqual(["sore"]);
    expect(missedSlotsForDay({ slot: "morning", status: "failed" })).toEqual(["pagi gagal", "sore"]);
    expect(missedSlotsForDay({ slot: "evening", status: "failed" })).toEqual(["sore gagal"]);
    expect(missedSlotsForDay({ slot: "evening", status: "complete" })).toEqual([]);
  });
  it("lists past days without a complete evening pull, newest first, alongside today's checks", async () => {
    latest = { medify_snapshot: { report_date: "2026-10-24", received_at: "2026-10-24T03:05:00Z" }, simrs_snapshot: null };
    runStatuses = { "2026-10-23": null, "2026-10-21": { slot: "morning", status: "complete" }, "2026-10-19": { slot: "evening", status: "failed" } };
    const report = await collectOpsAlerts();
    expect(report.alerts.map((alert) => alert.code)).toEqual(["medify_pull_missed"]);
    expect(report.alerts[0].detail).toContain("23-10 (pagi, sore); 21-10 (sore); 19-10 (sore gagal)");
    expect(report.alerts[0].detail).not.toContain("22-10");
    expect(report.alerts[0].detail).not.toContain("24-10");
  });
  it("checks exactly the seven days before today", async () => {
    latest = { medify_snapshot: { report_date: "2026-10-24", received_at: "2026-10-24T03:05:00Z" }, simrs_snapshot: null };
    runStatuses = { "2026-10-17": null, "2026-10-16": null };
    const report = await collectOpsAlerts();
    expect(report.alerts[0].detail).toContain("17-10 (pagi, sore)");
    expect(report.alerts[0].detail).not.toContain("16-10");
  });
  it("reports an unreadable day as unreadable, never as missed or fine", async () => {
    latest = { medify_snapshot: { report_date: "2026-10-24", received_at: "2026-10-24T03:05:00Z" }, simrs_snapshot: null };
    runStatuses = { "2026-10-22": "unreadable" };
    const report = await collectOpsAlerts();
    expect(report.alerts[0].detail).toContain("22-10 (status tidak terbaca)");
    expect(report.alerts[0].detail).not.toContain("pagi");
  });
  it("does not check past pulls when Medify has never published a snapshot", async () => {
    latest = { simrs_snapshot: { report_date: "2026-10-24" } };
    runStatuses = { "2026-10-23": null };
    expect(await codes()).toEqual([]);
  });
});
