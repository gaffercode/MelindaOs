import { beforeEach, describe, expect, it, vi } from "vitest";
import { DirectorApiError } from "@/lib/director/director-api";
import type { TurnEvent } from "@/lib/melinda/turn";

const requireHuman = vi.fn();
const rateLimit = vi.fn();
const runTurn = vi.fn();
const readBriefing = vi.fn();
const readConversation = vi.fn();
const listConversations = vi.fn();
const deleteConversation = vi.fn();
const store = { call: vi.fn() };

vi.mock("@/lib/director/director-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/director/director-api")>()),
  requireHuman: (...args: unknown[]) => requireHuman(...args),
  rateLimit: (...args: unknown[]) => rateLimit(...args),
  requireConfiguration: () => ({ store }),
}));
vi.mock("@/lib/melinda/turn", () => ({ runTurn: (...args: unknown[]) => runTurn(...args) }));
vi.mock("@/lib/melinda/briefing", () => ({ readBriefing: (...args: unknown[]) => readBriefing(...args) }));
vi.mock("@/lib/melinda/store", () => ({
  readConversation: (...args: unknown[]) => readConversation(...args),
  listConversations: (...args: unknown[]) => listConversations(...args),
  deleteConversation: (...args: unknown[]) => deleteConversation(...args),
}));

const { POST: chat } = await import("@/app/api/melinda/chat/route");
const { GET: briefing } = await import("@/app/api/melinda/briefing/route");
const { GET: conversations } = await import("@/app/api/melinda/conversations/route");
const { GET: conversation, DELETE: removeConversation } = await import("@/app/api/melinda/conversations/[id]/route");

const post = (body: unknown) => new Request("https://director.test/api/melinda/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const eventsOf = async (response: Response) => (await response.text()).split("\n\n").filter(Boolean).map((line) => JSON.parse(line.replace(/^data: /, "")) as TurnEvent);

beforeEach(() => {
  for (const mock of [requireHuman, rateLimit, runTurn, readBriefing, readConversation, listConversations, deleteConversation]) mock.mockReset();
  requireHuman.mockResolvedValue({ config: { store }, reviewerId: "dir-1" });
  rateLimit.mockResolvedValue(undefined);
  runTurn.mockImplementation(async ({ emit }: { emit: (event: TurnEvent) => void }) => { emit({ type: "text", delta: "Halo" }); emit({ type: "done", complete: true }); });
});

describe("POST /api/melinda/chat", () => {
  it("refuses without a session and never starts a turn", async () => {
    requireHuman.mockRejectedValue(new DirectorApiError(401, "Silakan masuk sebagai Direktur."));
    expect((await chat(post({ message: "Halo" }))).status).toBe(401);
    expect(runTurn).not.toHaveBeenCalled();
  });

  it("requires a CSRF-checked session and rate-limits per Director", async () => {
    await (await chat(post({ message: "Halo" }))).text();
    expect(requireHuman.mock.calls[0][2]).toBe(true);
    expect(rateLimit).toHaveBeenCalledWith({ store }, "melinda:dir-1", 30, 600);
  });

  it("answers 429 when the rate limit is hit", async () => {
    rateLimit.mockRejectedValue(new DirectorApiError(429, "Terlalu banyak percobaan."));
    expect((await chat(post({ message: "Halo" }))).status).toBe(429);
  });

  it("rejects an empty message and one over 2000 characters", async () => {
    expect((await chat(post({ message: "   " }))).status).toBe(400);
    expect((await chat(post({ message: "x".repeat(2001) }))).status).toBe(400);
    expect(runTurn).not.toHaveBeenCalled();
  });

  it("answers a broken conversationId with a JSON 404, not a stream", async () => {
    readConversation.mockRejectedValue(new DirectorApiError(404, "Percakapan tidak ditemukan."));
    const response = await chat(post({ conversationId: "rusak", message: "Halo" }));
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(runTurn).not.toHaveBeenCalled();
  });

  it("stops a message naming a patient, without the model and without saving it", async () => {
    const response = await chat(post({ message: "Pasien NIK 3571012345678901 kenapa?" }));
    const events = await eventsOf(response);
    expect(events[0]).toMatchObject({ type: "error" });
    expect(JSON.stringify(events[0])).toContain("DPJP");
    expect(events.at(-1)).toEqual({ type: "done", complete: false });
    expect(runTurn).not.toHaveBeenCalled();
  });

  it("streams the turn as server-sent events with the trimmed message", async () => {
    const response = await chat(post({ message: "  Halo  " }));
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await eventsOf(response)).toEqual([{ type: "text", delta: "Halo" }, { type: "done", complete: true }]);
    expect(runTurn.mock.calls[0][0]).toMatchObject({ owner: "dir-1", conversationId: null, message: "Halo" });
  });

  it("cancels the turn when the browser leaves, and later events are dropped quietly", async () => {
    let signal: AbortSignal | undefined;
    let emit: ((event: TurnEvent) => void) | undefined;
    let finish: () => void = () => undefined;
    runTurn.mockImplementation((args: { signal: AbortSignal; emit: (event: TurnEvent) => void }) => { signal = args.signal; emit = args.emit; return new Promise<void>((resolve) => { finish = resolve; }); });
    const response = await chat(post({ message: "Halo" }));
    await response.body?.cancel();
    expect(signal?.aborted).toBe(true);
    expect(() => emit?.({ type: "text", delta: "terlambat" })).not.toThrow();
    finish();
  });

  it("ends the stream cleanly if the turn throws", async () => {
    runTurn.mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await eventsOf(await chat(post({ message: "Halo" })))).toEqual([{ type: "error", message: "Melinda sedang tidak tersedia." }, { type: "done", complete: false }]);
  });
});

describe("melinda read routes", () => {
  const get = (path: string) => new Request(`https://director.test${path}`);

  it("returns the briefing to a Director only", async () => {
    readBriefing.mockResolvedValue({ greeting: "Selamat datang" });
    expect(await (await briefing(get("/api/melinda/briefing"))).json()).toEqual({ greeting: "Selamat datang" });
    requireHuman.mockRejectedValue(new DirectorApiError(401, "x"));
    expect((await briefing(get("/api/melinda/briefing"))).status).toBe(401);
  });

  it("lists the owner's conversations and reads one", async () => {
    listConversations.mockResolvedValue([{ id: "c1" }]);
    readConversation.mockResolvedValue({ conversation: { id: "c1" }, messages: [] });
    expect(await (await conversations(get("/api/melinda/conversations"))).json()).toEqual({ conversations: [{ id: "c1" }] });
    await (await conversation(get("/api/melinda/conversations/c1"), params("c1"))).json();
    expect(readConversation).toHaveBeenCalledWith({ store }, "dir-1", "c1");
  });

  it("deletes only with a CSRF-checked session", async () => {
    const response = await removeConversation(new Request("https://director.test/x", { method: "DELETE" }), params("c1"));
    expect(requireHuman.mock.calls[0][2]).toBe(true);
    expect(await response.json()).toEqual({ deleted: true });
    expect(deleteConversation).toHaveBeenCalledWith({ store }, "dir-1", "c1");
  });
});
