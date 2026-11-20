import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchDashboard, fetchSearch } from "@/lib/client-api";

afterEach(() => vi.unstubAllGlobals());

describe("same-origin dashboard client", () => {
  it("accepts a valid repository snapshot", async () => {
    const data = { validation: { status: "available", scannedAt: "2026-10-03T00:00:00Z", counts: [{ category: "A", passed: 2, total: 2 }], passed: 2, total: 2, limitation: "Format only" }, providers: [], documentCount: 2 };
    const fetch = vi.fn().mockResolvedValue(Response.json(data));
    vi.stubGlobal("fetch", fetch);
    expect(await fetchDashboard()).toEqual(data);
    expect(fetch.mock.calls[0][0]).toBe("/api/dashboard");
  });
  it.each([Response.json({ error: "internal path" }, { status: 500 }), Response.json({ agents: null }), new Response("not JSON")])(
    "rejects failed or malformed snapshots", async (response) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
      await expect(fetchDashboard()).rejects.toThrow();
    },
  );
  it("encodes query text and passes the cancellation signal", async () => {
    const controller = new AbortController();
    const fetch = vi.fn().mockResolvedValue(Response.json({ results: [] }));
    vi.stubGlobal("fetch", fetch);
    expect(await fetchSearch("BPJS & klaim", controller.signal)).toEqual([]);
    expect(fetch.mock.calls[0][0]).toBe("/api/search?q=BPJS+%26+klaim");
    expect(fetch.mock.calls[0][1].signal).toBe(controller.signal);
  });
  it("rejects invalid search results rather than rendering them", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ results: [null] })));
    await expect(fetchSearch("BPJS")).rejects.toThrow();
  });
  it("accepts a result labelled full or partial and rejects one without the label", async () => {
    const result = { path: "knowledge/04_BPJS/kb.md", category: "A", title: "Klaim", docId: "KB", domain: "Finansial", department: "Casemix", lastReviewed: "2026-09-28", tags: ["bpjs"], snippet: "klaim" };
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json({ results: [{ ...result, match: "partial" }] })));
    expect(await fetchSearch("klaim")).toEqual([{ ...result, match: "partial" }]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ results: [result] })));
    await expect(fetchSearch("klaim")).rejects.toThrow("Format hasil pencarian tidak valid.");
  });
  it("does not hide cancellation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("Aborted", "AbortError")));
    await expect(fetchSearch("BPJS")).rejects.toMatchObject({ name: "AbortError" });
  });
});
