import { describe, expect, it } from "vitest";
import { prepareMedifyRunStatus, prepareMedifySnapshot, publisherFromEnv, submitMedifyRunStatus, type DailyPublisherClientOptions } from "../scripts/daily-publisher-client.mjs";

const runBody = JSON.stringify({ schemaVersion: 1, date: "2099-01-15", slot: "morning", runId: "medify-morning-20990115-a1", status: "failed", startedAt: "2099-01-15T00:00:00.000Z", completedAt: "2099-01-15T00:01:00.000Z", unavailableSections: [{ section: null, reason: "login_failed" }], snapshotRevisionId: null, snapshotReceivedAt: null });
const id = "00000000-0000-4000-8000-000000000001";
const config = { baseUrl: "https://synthetic.example", token: "synthetic-submit-only-token" };
function receipt(kind: "medify_run_status") {
  return { id, revisionId: id, kind, payloadHash: "a".repeat(64), date: "2099-01-15", status: "stored", receivedAt: "2099-01-15T00:16:00.000Z", replayed: false };
}
function transport(handler: (url: string, init: RequestInit) => Promise<Response>): typeof fetch {
  return async (input, init) => handler(String(input), init ?? {});
}

describe("publisher configuration from the environment", () => {
  it("reads MELINDAOS_PUBLISHER_TOKEN", () => {
    expect(publisherFromEnv({ MELINDAOS_DASHBOARD_URL: "https://synthetic.example", MELINDAOS_PUBLISHER_TOKEN: "new-token" })).toEqual({ baseUrl: "https://synthetic.example", token: "new-token" });
  });
  it("reads no other token name", () => {
    expect(publisherFromEnv({ MELINDAOS_DASHBOARD_URL: "https://synthetic.example", MELINDAOS_GROKBOT_TOKEN: "old-token" }).token).toBeUndefined();
  });
});

describe("daily publisher submit clients", () => {
  it("prepares a run status with a stable key and does not echo rejected content", () => {
    const run = prepareMedifyRunStatus(runBody);
    expect(run.date).toBe("2099-01-15");
    expect(run.idempotencyKey).toMatch(/^medify-run-[a-f0-9]{64}$/);
    expect(prepareMedifyRunStatus(runBody).idempotencyKey).toBe(run.idempotencyKey);
    const leaked = JSON.stringify({ ...JSON.parse(runBody), patientName: "DO_NOT_ECHO" });
    expect(() => prepareMedifyRunStatus(leaked)).toThrow();
    try { prepareMedifyRunStatus(leaked); } catch (error) { expect(String(error)).not.toContain("DO_NOT_ECHO"); }
    expect(() => prepareMedifyRunStatus(runBody, "bad key")).toThrow(/Invalid idempotency key/);
  });

  it.each(["not-json", "{}", JSON.stringify({ ...JSON.parse(runBody), date: "2099-02-31" }), JSON.stringify({ ...JSON.parse(runBody), schemaVersion: 2 }), " ".repeat(256_001)])("rejects an invalid run status envelope", (input) => {
    expect(() => prepareMedifyRunStatus(input)).toThrow(/Invalid submission envelope/);
  });

  it("posts the bearer token, exact body, and stored receipt", async () => {
    const prepared = prepareMedifyRunStatus(runBody, "medify-run-test-1");
    const result = await submitMedifyRunStatus(prepared, { ...config, fetch: transport(async (url, init) => {
      expect(url).toBe("https://synthetic.example/api/director/medify-run-status");
      expect(init.method).toBe("POST");
      expect(init.redirect).toBe("manual");
      expect(new Headers(init.headers).get("Authorization")).toBe("Bearer synthetic-submit-only-token");
      expect(new Headers(init.headers).get("Idempotency-Key")).toBe("medify-run-test-1");
      expect(init.body).toBe(runBody);
      return Response.json(receipt("medify_run_status"), { status: 201 });
    }) });
    expect(result).toMatchObject({ status: "stored", revisionId: id, kind: "medify_run_status", replayed: false });
  });

  it("reuses one explicit Medify run key when a status receipt is retried", async () => {
    const prepared = prepareMedifyRunStatus(runBody, "medify-run-attempt-a1");
    const requests: string[] = [];
    const result = await submitMedifyRunStatus(prepared, { ...config, sleep: async () => {}, fetch: transport(async (_url, init) => {
      requests.push(`${init.method}:${new Headers(init.headers).get("Idempotency-Key")}:${init.body}`);
      if (requests.length === 1) throw new Error("private token connection failure");
      return Response.json({ ...receipt("medify_run_status"), replayed: true });
    }) });
    expect(result.kind).toBe("medify_run_status");
    expect(result.replayed).toBe(true);
    expect(requests).toHaveLength(2);
    expect(requests[1]).toBe(requests[0]);
    expect(requests[0].startsWith("POST:medify-run-attempt-a1:")).toBe(true);
  });

  it("accepts a scheduled Medify snapshot with its run metadata", () => {
    const body = JSON.stringify({
      schemaVersion: 1, date: "2099-01-15", bed: null, outpatient: null, igd: null, inpatient: null, finance: null,
      run: { slot: "morning", runId: "medify-morning-20990115-a1", status: "complete", startedAt: "2099-01-15T00:00:00.000Z", completedAt: "2099-01-15T00:01:00.000Z", unavailableSections: [] },
      provenance: { producer: "medify-pull", sourceObservedAt: "2099-01-15T00:01:00.000Z", periodStart: "2099-01-15", periodEnd: "2099-01-15", cutoff: null, sources: [{ name: "Medify", url: "https://simrs.melinda.co.id", note: "aggregate only" }], notes: "" },
    });
    expect(prepareMedifySnapshot(body, "medify-snapshot-a1")).toMatchObject({ date: "2099-01-15", idempotencyKey: "medify-snapshot-a1" });
  });

  it.each([400, 401, 409, 413])("does not retry HTTP %s", async (status) => {
    let requests = 0;
    await expect(submitMedifyRunStatus(prepareMedifyRunStatus(runBody), { ...config, fetch: transport(async () => { requests++; return Response.json({ error: "private" }, { status }); }) })).rejects.toThrow(`HTTP ${status}`);
    expect(requests).toBe(1);
  });

  it("fails fast and names the new origin on a redirect", async () => {
    let requests = 0;
    const redirecting = transport(async () => { requests++; return new Response(null, { status: 307, headers: { location: "https://melindaos.app/api/director/daily-documents" } }); });
    await expect(submitMedifyRunStatus(prepareMedifyRunStatus(runBody), { ...config, sleep: async () => {}, fetch: redirecting })).rejects.toThrow(new Error("Dashboard origin redirected (HTTP 307) to https://melindaos.app; set MELINDAOS_DASHBOARD_URL to that origin."));
    expect(requests).toBe(1);
  });

  it.each([null, "http://[bad"])("reports an unknown location when the redirect Location is %s", async (location) => {
    const headers = location === null ? undefined : { location };
    await expect(submitMedifyRunStatus(prepareMedifyRunStatus(runBody), { ...config, fetch: transport(async () => new Response(null, { status: 308, headers })) })).rejects.toThrow("Dashboard origin redirected (HTTP 308) to an unknown location; set MELINDAOS_DASHBOARD_URL to that origin.");
  });

  it("retries HTTP 503 three times and rejects a receipt for another date", async () => {
    let requests = 0;
    await expect(submitMedifyRunStatus(prepareMedifyRunStatus(runBody), { ...config, sleep: async () => {}, fetch: transport(async () => { requests++; return new Response(null, { status: 503 }); }) })).rejects.toThrow("HTTP 503");
    expect(requests).toBe(3);
    await expect(submitMedifyRunStatus(prepareMedifyRunStatus(runBody), { ...config, fetch: transport(async () => Response.json({ ...receipt("medify_run_status"), date: "2099-01-16" })) })).rejects.toThrow("Invalid submission receipt");
  });

  it.each(["", "http://synthetic.example", "https://token@synthetic.example", "https://synthetic.example/path"])("rejects unsafe configuration before sending", async (baseUrl) => {
    let requests = 0;
    const options: DailyPublisherClientOptions = { ...config, baseUrl, fetch: transport(async () => { requests++; return Response.json(receipt("medify_run_status")); }) };
    await expect(submitMedifyRunStatus(prepareMedifyRunStatus(runBody), options)).rejects.toThrow("Invalid client configuration");
    expect(requests).toBe(0);
  });
});
