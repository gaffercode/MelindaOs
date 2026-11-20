import { scryptSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as publish } from "@/app/api/director/medify-run-status/route";
import { hashSecret } from "@/lib/director/director-auth";
import { canonicalHash } from "@/lib/director/director-store";
import { clearDailyDocumentCache } from "@/lib/daily/daily-documents";
import { parseMedifyRunStatus } from "@/lib/medify/medify-run-status-contract";

const origin = "https://synthetic.example";
const salt = "00112233445566778899aabbccddeeff";
const passcodeHash = `scrypt$${salt}$${scryptSync("synthetic-test-passcode", salt, 64).toString("hex")}`;
const status = {
  schemaVersion: 1,
  date: "2099-01-15",
  slot: "evening",
  runId: "medify-evening-20990115-a1",
  status: "degraded",
  startedAt: "2099-01-15T11:00:00.000Z",
  completedAt: "2099-01-15T11:02:00.000Z",
  unavailableSections: [{ section: "pharmacy", reason: "request_failed" }],
  snapshotRevisionId: null,
  snapshotReceivedAt: null,
};

type Row = { id: string; kind: string; report_date: string; producer: string; request_key: string; payload: unknown; payload_hash: string; received_at: string };
let rows: Row[];

function request(body: unknown, token = "synthetic-medify-key", key = "medify-run-status-1") {
  return new Request(`${origin}/api/director/medify-run-status`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify(body) });
}

describe("Medify scheduled run status", () => {
  beforeEach(() => {
    rows = [];
    vi.stubEnv("MELINDAOS_DIRECTOR_STORE", "supabase");
    vi.stubEnv("MELINDAOS_APP_ORIGIN", origin);
    vi.stubEnv("MELINDAOS_SUPABASE_URL", "https://synthetic.supabase.co");
    vi.stubEnv("MELINDAOS_SUPABASE_SECRET_KEY", "sb_secret_synthetic");
    vi.stubEnv("MELINDAOS_MEDIFY_PUBLISHER_TOKEN_HASH", hashSecret("synthetic-medify-key"));
    vi.stubEnv("MELINDAOS_REVIEWER_PASSCODE_HASH", passcodeHash);
    vi.stubEnv("MELINDAOS_REVIEWER_ID", "director-test");
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const { command, args } = JSON.parse(init.body as string) as { command: string; args: Record<string, unknown> };
      if (command === "rate_limit") return Response.json({ allowed: true });
      if (command !== "submit") return Response.json({ errorCode: "invalid_command" });
      const existing = rows.find((row) => row.kind === args.kind && row.producer === args.producerId && row.request_key === args.key);
      if (existing) return Response.json({ replayed: true, id: existing.id, kind: existing.kind, date: existing.report_date, payloadHash: existing.payload_hash, receivedAt: existing.received_at });
      const row: Row = { id: "00000000-0000-4000-8000-000000000001", kind: args.kind as string, report_date: args.date as string, producer: args.producerId as string, request_key: args.key as string, payload: args.payload, payload_hash: args.payloadHash as string, received_at: "2099-01-15T11:02:00.000Z" };
      rows.push(row);
      return Response.json({ replayed: false, id: row.id, kind: row.kind, date: row.report_date, payloadHash: row.payload_hash, receivedAt: row.received_at });
    });
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); clearDailyDocumentCache(); });

  it("accepts complete, degraded, and failed safe run outcomes", () => {
    expect(parseMedifyRunStatus(status)).toMatchObject({ status: "degraded", slot: "evening" });
    expect(parseMedifyRunStatus({ ...status, status: "complete", unavailableSections: [] }).status).toBe("complete");
    expect(parseMedifyRunStatus({ ...status, status: "failed", unavailableSections: [{ section: null, reason: "login_failed" }] }).status).toBe("failed");
  });

  it("rejects unknown fields, invalid timing, and unsafe identifier-shaped content", () => {
    expect(() => parseMedifyRunStatus({ ...status, patientName: "Ny. Siti" })).toThrow(/document\.patientName/);
    expect(() => parseMedifyRunStatus({ ...status, completedAt: "2099-01-15T10:59:00.000Z" })).toThrow(/completedAt/);
    expect(() => parseMedifyRunStatus({ ...status, unavailableSections: [{ section: "RM 123456", reason: "request_failed" }] })).toThrow(/section/);
  });

  it("requires the Medify publisher key and stores a validated run status", async () => {
    expect((await publish(request(status, "wrong-token"))).status).toBe(401);
    const response = await publish(request(status));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ kind: "medify_run_status", date: status.date, payloadHash: canonicalHash(status), replayed: false });
    expect(rows).toHaveLength(1);
  });
  it("records the Medify publisher key as its own producer", async () => {
    const response = await publish(request(status, "synthetic-medify-key"));
    expect(response.status).toBe(201);
    expect(rows[0].producer).toBe("biznet-medify");
  });

  it("uses MELINDAOS_MEDIFY_PUBLISHER_ID when set", async () => {
    vi.stubEnv("MELINDAOS_MEDIFY_PUBLISHER_ID", "medify-scheduler");
    expect((await publish(request(status, "synthetic-medify-key"))).status).toBe(201);
    expect(rows[0].producer).toBe("medify-scheduler");
  });

  it("rejects the Medify key when no dedicated hash is configured or the hash is malformed", async () => {
    vi.stubEnv("MELINDAOS_MEDIFY_PUBLISHER_TOKEN_HASH", "");
    expect((await publish(request(status, "synthetic-medify-key"))).status).toBe(401);
    vi.stubEnv("MELINDAOS_MEDIFY_PUBLISHER_TOKEN_HASH", "not-a-hash");
    expect((await publish(request(status, "synthetic-medify-key"))).status).toBe(401);
  });
});
