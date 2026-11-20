import { scryptSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/director/medify-snapshot/route";
import { composeAndStoreBrief } from "@/lib/composer/run";
import { hashSecret } from "@/lib/director/director-auth";
import { clearDailyDocumentCache } from "@/lib/daily/daily-documents";
import { snapshot } from "./fixtures/medify-snapshot";

const { afterCallbacks, afterFails } = vi.hoisted(() => ({ afterCallbacks: [] as (() => Promise<void>)[], afterFails: { value: false } }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (callback: () => Promise<void>) => { if (afterFails.value) throw new Error("after unavailable"); afterCallbacks.push(callback); },
}));
vi.mock("@/lib/composer/run", () => ({ composeAndStoreBrief: vi.fn(async () => "stored") }));

const origin = "https://synthetic.example";
const salt = "00112233445566778899aabbccddeeff";

type Row = { id: string; kind: string; report_date: string; producer: string; request_key: string; payload_hash: string; received_at: string };
let rows: Row[];

function snapshotRequest({ check = false, key = "composer-key-0001", date = "2099-01-15" }: { check?: boolean; key?: string; date?: string } = {}) {
  return new Request(`${origin}/api/director/medify-snapshot${check ? "?periksa=1" : ""}`, { method: "POST", headers: { Authorization: "Bearer synthetic-medify-key", "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify(snapshot()).replaceAll("2099-01-15", date) });
}

beforeEach(() => {
  rows = []; afterCallbacks.length = 0; afterFails.value = false;
  vi.clearAllMocks();
  vi.stubEnv("MELINDAOS_DIRECTOR_STORE", "supabase");
  vi.stubEnv("MELINDAOS_APP_ORIGIN", origin);
  vi.stubEnv("MELINDAOS_SUPABASE_URL", "https://synthetic.supabase.co");
  vi.stubEnv("MELINDAOS_SUPABASE_SECRET_KEY", "sb_secret_synthetic");
  vi.stubEnv("MELINDAOS_MEDIFY_PUBLISHER_TOKEN_HASH", hashSecret("synthetic-medify-key"));
  vi.stubEnv("MELINDAOS_REVIEWER_PASSCODE_HASH", `scrypt$${salt}$${scryptSync("synthetic-test-passcode", salt, 64).toString("hex")}`);
  vi.stubEnv("MELINDAOS_REVIEWER_ID", "director-test");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const { command, args } = JSON.parse(init.body as string) as { command: string; args: Record<string, unknown> };
    if (command === "rate_limit") return Response.json({ allowed: true });
    if (command !== "submit") return Response.json({ errorCode: "invalid_command" });
    const existing = rows.find((row) => row.kind === args.kind && row.producer === args.producerId && row.request_key === args.key);
    if (existing) return Response.json({ replayed: true, id: existing.id, kind: existing.kind, date: existing.report_date, payloadHash: existing.payload_hash, receivedAt: existing.received_at });
    const row: Row = { id: `00000000-0000-4000-8000-${String(rows.length + 1).padStart(12, "0")}`, kind: args.kind as string, report_date: args.date as string, producer: args.producerId as string, request_key: args.key as string, payload_hash: args.payloadHash as string, received_at: "2099-01-15T02:31:00.000Z" };
    rows.push(row);
    return Response.json({ replayed: false, id: row.id, kind: row.kind, date: row.report_date, payloadHash: row.payload_hash, receivedAt: row.received_at });
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); clearDailyDocumentCache(); });

describe("composer trigger on the Medify snapshot route", () => {
  it("schedules one composer run for a newly stored snapshot", async () => {
    const response = await POST(snapshotRequest());
    expect(response.status).toBe(201);
    const receipt = await response.json() as { payloadHash: string };
    expect(afterCallbacks).toHaveLength(1);
    await afterCallbacks[0]!();
    expect(composeAndStoreBrief).toHaveBeenCalledTimes(1);
    const [, snapshotArg, hashArg] = vi.mocked(composeAndStoreBrief).mock.calls[0]!;
    expect(snapshotArg.date).toBe("2099-01-15");
    expect(hashArg).toBe(receipt.payloadHash);
  });

  it("schedules nothing for a replayed snapshot or a check request", async () => {
    await POST(snapshotRequest());
    afterCallbacks.length = 0;
    expect((await POST(snapshotRequest())).status).toBe(200);
    await POST(snapshotRequest({ check: true }));
    expect(afterCallbacks).toHaveLength(0);
  });

  it("answers the publisher the same way when the composer throws", async () => {
    vi.mocked(composeAndStoreBrief).mockRejectedValueOnce(new Error("boom"));
    const response = await POST(snapshotRequest({ key: "second-key-0001", date: "2099-01-16" }));
    expect(response.status).toBe(201);
    await expect(afterCallbacks[0]!()).resolves.toBeUndefined();
  });

  it("answers the publisher 201 with the same body when scheduling the composer throws", async () => {
    const normal = await (await POST(snapshotRequest({ key: "normal-key-0001", date: "2099-01-17" }))).json();
    afterFails.value = true;
    const response = await POST(snapshotRequest({ key: "failing-key-0001", date: "2099-01-17" }));
    expect(response.status).toBe(201);
    const body = await response.json() as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(Object.keys(normal).sort());
    expect(body).toMatchObject({ status: "stored", replayed: false, kind: "medify_snapshot", date: "2099-01-17", payloadHash: normal.payloadHash });
    expect(composeAndStoreBrief).not.toHaveBeenCalled();
    expect(vi.mocked(console.error).mock.calls.map(([line]) => JSON.parse(String(line)).code)).toContain("brief_composer_schedule_failed");
  });
});
