import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as dashboard } from "@/app/api/dashboard/route";
import { GET as search } from "@/app/api/search/route";
import { getDashboardData, loadKnowledgeDocuments, searchDocuments } from "@/lib/repository";

vi.mock("@/lib/repository", async (original) => {
  const actual = await original<typeof import("@/lib/repository")>();
  return { ...actual, getDashboardData: vi.fn(), loadKnowledgeDocuments: vi.fn() };
});

const request = (q: string) => new Request(new URL(`/api/search?${new URLSearchParams({ q })}`, "https://test.invalid"));
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("repository API handlers", () => {
  it("returns a successful snapshot without caching", async () => {
    vi.mocked(getDashboardData).mockResolvedValue({ validation: { status: "unavailable", scannedAt: "2026-10-03T00:00:00Z", counts: [], passed: 0, total: 0, limitation: "Checker unavailable" }, providers: [], documentCount: 0 });
    const response = await dashboard(new Request("https://test.invalid"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
  it("does not expose filesystem details when snapshot loading fails", async () => {
    vi.mocked(getDashboardData).mockRejectedValue(new Error("Secret filesystem path"));
    const response = await dashboard(new Request("https://test.invalid"));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("Secret filesystem path");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
  it("rejects overlong search before accessing repository", async () => {
    expect((await search(request("x".repeat(121)))).status).toBe(400);
    expect(loadKnowledgeDocuments).not.toHaveBeenCalled();
  });
  it("does not cache empty results", async () => {
    const response = await search(request("  "));
    expect(await response.json()).toEqual({ query: "", results: [] });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
  it("searches real documents with the real search implementation", async () => {
    const documents = [{ path: "knowledge/01_HOSPITAL/kb.md", category: "A" as const, title: "BPJS claim", docId: "KB", domain: "Finansial", department: "CLAIM", lastReviewed: "2026-10-03", tags: ["BPJS"], searchableText: "BPJS claim policy" }];
    vi.mocked(loadKnowledgeDocuments).mockResolvedValue(documents);
    const response = await search(request(" BPJS "));
    expect(await response.json()).toEqual({ query: "BPJS", results: searchDocuments(documents, "BPJS") });
  });
  it("reports repository errors without leaking server paths", async () => {
    vi.mocked(loadKnowledgeDocuments).mockRejectedValue(new Error("Secret filesystem path"));
    const response = await search(request("BPJS"));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("Secret filesystem path");
  });
});
