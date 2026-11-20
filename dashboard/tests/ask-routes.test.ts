import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeChunk } from "@/lib/contracts";

const requirePermission = vi.fn();
const protectedMode = vi.fn();
const callClaude = vi.fn();
const loadKnowledgeChunks = vi.fn();
const store = { call: vi.fn() };

vi.mock("@/lib/access/access-api", async (original) => ({
  ...(await original<typeof import("@/lib/access/access-api")>()),
  requirePermission: (...args: unknown[]) => requirePermission(...args),
}));
vi.mock("@/lib/director/director-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/director/director-auth")>()),
  protectedDirectorMode: () => protectedMode(),
}));
vi.mock("@/lib/claude-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/claude-client")>()),
  callClaude: (...args: unknown[]) => callClaude(...args),
}));
vi.mock("@/lib/repository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/repository")>()),
  loadKnowledgeChunks: () => loadKnowledgeChunks(),
}));

const { POST: askDirector } = await import("@/app/api/ask/route");
const { DirectorApiError } = await import("@/lib/director/director-api");

const chunks: KnowledgeChunk[] = [
  { id: "SPO-HPP#prosedur", docId: "SPO-HPP", path: "knowledge/06_CLINICAL_SAFETY/maternal_sop/kb-hpp.md", title: "SPO Penatalaksanaan HPP", headingPath: ["Prosedur"], text: "Pada HPP berikan oksitosin 10 IU intramuskular." },
];
const answered = JSON.stringify({ status: "answered", answer: "Berikan oksitosin 10 IU IM.", citations: [{ chunkId: "SPO-HPP#prosedur" }] });
const post = (body: unknown) => new Request("https://director.test/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
let allowed: boolean;

beforeEach(() => {
  allowed = true;
  protectedMode.mockReturnValue(true);
  requirePermission.mockResolvedValue({ config: { store }, reviewerId: "director-test" });
  store.call.mockImplementation(async () => ({ allowed }));
  loadKnowledgeChunks.mockResolvedValue(chunks);
  callClaude.mockResolvedValue(answered);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); });

describe.each([
  ["director", askDirector, "ask:director-test", 30],
])("POST /api/ask (%s)", (_label, route, bucket, limit) => {
  it("returns 200 with the grounded answer and rate-limits per caller", async () => {
    const response = await route(post({ question: "dosis oksitosin pada HPP" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "answered", answer: "Berikan oksitosin 10 IU IM.", sources: [{ docId: "SPO-HPP", title: "SPO Penatalaksanaan HPP", heading: "Prosedur", path: "knowledge/06_CLINICAL_SAFETY/maternal_sop/kb-hpp.md" }] });
    expect(store.call).toHaveBeenCalledWith("rate_limit", { bucket, limit, seconds: 600 });
  });

  it.each([["empty", { question: "  " }], ["too long", { question: "a".repeat(501) }], ["not a string", { question: 5 }], ["unknown field", { question: "HPP", extra: 1 }]])("returns 400 for a %s question", async (_case, body) => {
    const response = await route(post(body));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toEqual(expect.any(String));
    expect(callClaude).not.toHaveBeenCalled();
  });

  it("returns 401 without a session", async () => {
    requirePermission.mockRejectedValue(new DirectorApiError(401, "Silakan masuk sebagai Direktur atau Tim Mutu."));
    expect((await route(post({ question: "HPP" }))).status).toBe(401);
    expect(callClaude).not.toHaveBeenCalled();
  });

  it("returns 429 when the rate limit is exhausted", async () => {
    allowed = false;
    expect((await route(post({ question: "HPP" }))).status).toBe(429);
    expect(callClaude).not.toHaveBeenCalled();
  });

  it.each([
    ["model unreachable", () => callClaude.mockResolvedValue(null)],
    ["knowledge chunks missing", () => loadKnowledgeChunks.mockRejectedValue(new Error("knowledge_index_missing"))],
  ])("returns 503 when the %s", async (_case, arrange) => {
    arrange();
    const response = await route(post({ question: "dosis oksitosin pada HPP" }));
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(text).toContain("Tanya Melinda sedang tidak tersedia.");
    expect(text).not.toMatch(/knowledge_index_missing|stack|at /);
  });
});

describe("POST /api/ask fields and modes", () => {
  it("refuses any field besides the question", async () => {
    expect((await askDirector(post({ question: "dosis oksitosin pada HPP", staffName: "Bidan Sari" }))).status).toBe(400);
  });

  it("skips the session in local file mode", async () => {
    protectedMode.mockReturnValue(false);
    expect((await askDirector(post({ question: "dosis oksitosin pada HPP" }))).status).toBe(200);
    expect(requirePermission).not.toHaveBeenCalled();
  });
});
