import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DirectorAuthConfiguration } from "@/lib/director/director-auth";
import type { RoundResult } from "@/lib/melinda/model";

const streamRound = vi.fn();
const runTool = vi.fn();
const appended: Array<Record<string, unknown>> = [];
const appendMessage = vi.fn();
const usageToday = vi.fn();
const recentHistory = vi.fn();
const createConversation = vi.fn();
vi.mock("@/lib/melinda/model", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/melinda/model")>()), streamRound: (...args: unknown[]) => streamRound(...args) }));
vi.mock("@/lib/melinda/tools", () => ({ MELINDA_TOOLS: [], TOOL_STATUS: { baca_tugas: "Membaca papan tugas", baca_jadwal: "Membaca jadwal" }, runTool: (...args: unknown[]) => runTool(...args) }));
vi.mock("@/lib/melinda/store", () => ({
  appendMessage: (...args: unknown[]) => appendMessage(...args), usageToday: (...args: unknown[]) => usageToday(...args),
  recentHistory: (...args: unknown[]) => recentHistory(...args), createConversation: (...args: unknown[]) => createConversation(...args),
}));

const { MelindaModelError } = await import("@/lib/melinda/model");
const { MELINDA_DAILY_LIMIT, MELINDA_REFUSED, MELINDA_UNAVAILABLE, runTurn } = await import("@/lib/melinda/turn");

type Event = { type: string } & Record<string, unknown>;
const events: Event[] = [];
const controller = () => new AbortController();
const baseArgs = () => ({ config: {} as DirectorAuthConfiguration, owner: "dir-1", conversationId: null as string | null, message: "Apa tugas saya?", now: new Date("2026-11-09T01:00:00Z"), signal: controller().signal, emit: (event: Event) => { events.push(event); } });
const usage = { inputTokens: 10, outputTokens: 5 };
const toolRound = (...names: string[]): RoundResult => ({ ...usage, stopReason: "tool_use", content: [{ type: "thinking", thinking: "", signature: "sig" }, ...names.map((name, index) => ({ type: "tool_use", id: `t${index}`, name, input: { filter: "semua" } }))] });
type Round = { onText: (delta: string) => void };
const speak = (text: string, stopReason: string | null = "end_turn") => async ({ onText }: Round): Promise<RoundResult> => { onText(text); return { ...usage, stopReason, content: [{ type: "text", text }] }; };

beforeEach(() => {
  events.length = 0; appended.length = 0;
  for (const mock of [streamRound, runTool, appendMessage, usageToday, recentHistory, createConversation]) mock.mockReset();
  appendMessage.mockImplementation(async (_config, _owner, input: Record<string, unknown>) => { appended.push(input); });
  usageToday.mockResolvedValue(0);
  recentHistory.mockImplementation(async (_config, _owner, id: string) => id === "c1" ? [{ role: "user", content: "lama" }, { role: "assistant", content: "jawab lama" }, { role: "user", content: "Apa tugas saya?" }] : [{ role: "user", content: "Apa tugas saya?" }]);
  createConversation.mockResolvedValue({ id: "new-1", title: "x", updatedAt: "" });
  runTool.mockResolvedValue({ text: "<data_alat>x</data_alat>", sources: [{ label: "SPO", href: "/knowledge?q=a" }], isError: false });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("runTurn", () => {
  it("runs a tool round then answers, sending all results in one user message", async () => {
    streamRound.mockResolvedValueOnce(toolRound("baca_tugas", "baca_jadwal")).mockImplementationOnce(speak("Ini tugasnya"));
    await runTurn(baseArgs());
    const second = streamRound.mock.calls[1][0].messages as Array<{ content: Array<{ type: string }> }>;
    expect(second.at(-1)?.content.filter((block) => block.type === "tool_result")).toHaveLength(2);
    expect(events.map((event) => event.type)).toEqual(["conversation", "status", "status", "text", "sources", "done"]);
    expect(events.at(-1)).toEqual({ type: "done", complete: true });
  });

  it("marks a failed tool with is_error and still continues", async () => {
    runTool.mockResolvedValue({ text: "Data tugas tidak dapat dibaca.", sources: [], isError: true });
    streamRound.mockResolvedValueOnce(toolRound("baca_tugas")).mockImplementationOnce(speak("Maaf"));
    await runTurn(baseArgs());
    expect((streamRound.mock.calls[1][0].messages as Array<{ content: unknown }>).at(-1)?.content).toEqual([{ type: "tool_result", tool_use_id: "t0", content: "Data tugas tidak dapat dibaca.", is_error: true }]);
  });

  it("replays the assistant turn with thinking blocks unchanged inside a turn", async () => {
    streamRound.mockResolvedValueOnce(toolRound("baca_tugas")).mockImplementationOnce(speak("Ok"));
    await runTurn(baseArgs());
    expect((streamRound.mock.calls[1][0].messages as Array<{ content: unknown[] }>).at(-2)?.content[0]).toEqual({ type: "thinking", thinking: "", signature: "sig" });
  });

  it("sends earlier turns as plain text only, with the date on the newest turn", async () => {
    streamRound.mockImplementationOnce(speak("Ok"));
    await runTurn({ ...baseArgs(), conversationId: "c1" });
    const sent = streamRound.mock.calls[0][0].messages as Array<{ content: unknown }>;
    expect(sent.every((message) => typeof message.content === "string")).toBe(true);
    expect(sent.at(-1)?.content).toContain("08.00 WIB");
    expect(sent.at(-1)?.content).toContain("Apa tugas saya?");
    expect(sent[0].content).toBe("lama");
    expect(createConversation).not.toHaveBeenCalled();
  });

  it("stores the user's words without the injected date", async () => {
    streamRound.mockImplementationOnce(speak("Ok"));
    await runTurn(baseArgs());
    expect(appended[0]).toMatchObject({ role: "user", content: "Apa tugas saya?" });
  });

  it("stops after five tool rounds and marks the message incomplete", async () => {
    streamRound.mockResolvedValue(toolRound("baca_tugas"));
    await runTurn(baseArgs());
    expect(streamRound).toHaveBeenCalledTimes(5);
    expect(appended.at(-1)).toMatchObject({ role: "assistant", complete: false });
    expect(appended.at(-1)?.content).toContain("terlalu banyak langkah");
  });

  it("stops before the next round once the turn deadline has passed", async () => {
    const start = 1_000_000;
    const clock = vi.spyOn(Date, "now").mockReturnValue(start);
    streamRound.mockImplementationOnce(async () => { clock.mockReturnValue(start + 270_001); return toolRound("baca_tugas"); });
    await runTurn(baseArgs());
    expect(streamRound).toHaveBeenCalledTimes(1);
    expect(appended.at(-1)).toMatchObject({ role: "assistant", complete: false });
    expect(appended.at(-1)?.content).toContain("waktunya habis");
  });

  it("saves the partial answer when the client disconnects, emitting nothing after", async () => {
    const abort = controller();
    streamRound.mockImplementationOnce(async ({ onText }: Round) => { onText("Sebagi"); abort.abort(); throw new MelindaModelError("unreachable"); });
    await runTurn({ ...baseArgs(), signal: abort.signal });
    expect(appended.at(-1)).toMatchObject({ role: "assistant", content: "Sebagi", complete: false });
    expect(events.map((event) => event.type)).toEqual(["conversation", "text"]);
  });

  it("reports a model failure in words and keeps what was written", async () => {
    streamRound.mockImplementationOnce(async ({ onText }: Round) => { onText("Sebagi"); throw new MelindaModelError("stream"); });
    await runTurn(baseArgs());
    expect(events).toContainEqual({ type: "error", message: MELINDA_UNAVAILABLE });
    expect(appended.at(-1)).toMatchObject({ content: "Sebagi", complete: false });
  });

  it("surfaces a refusal in words and marks the message incomplete", async () => {
    streamRound.mockImplementationOnce(speak("Seba", "refusal"));
    await runTurn(baseArgs());
    expect(events).toContainEqual({ type: "error", message: MELINDA_REFUSED });
    expect(appended.at(-1)).toMatchObject({ complete: false });
  });

  it("marks a max_tokens stop incomplete", async () => {
    streamRound.mockImplementationOnce(speak("Panjang", "max_tokens"));
    await runTurn(baseArgs());
    expect(events.at(-1)).toEqual({ type: "done", complete: false });
  });

  it("blocks the turn at the daily token limit, without calling the model or saving", async () => {
    usageToday.mockResolvedValue(500_000);
    await runTurn(baseArgs());
    expect(streamRound).not.toHaveBeenCalled();
    expect(createConversation).not.toHaveBeenCalled();
    expect(appended).toHaveLength(0);
    expect(events).toContainEqual({ type: "error", message: MELINDA_DAILY_LIMIT });
  });

  it("still finishes when saving the answer fails", async () => {
    streamRound.mockImplementationOnce(speak("Ok"));
    appendMessage.mockImplementationOnce(async () => undefined).mockRejectedValueOnce(new Error("down"));
    await runTurn(baseArgs());
    expect(events.at(-1)).toEqual({ type: "done", complete: true });
  });

  it("records the total tokens and combined sources on the answer", async () => {
    streamRound.mockResolvedValueOnce(toolRound("baca_tugas")).mockImplementationOnce(speak("Ok"));
    await runTurn(baseArgs());
    expect(appended.at(-1)).toMatchObject({ role: "assistant", tokens: 30, sources: [{ label: "SPO", href: "/knowledge?q=a" }], complete: true });
    expect(appended.find((row) => row.role === "tool")).toMatchObject({ toolCalls: [{ name: "baca_tugas", input: { filter: "semua" } }] });
  });
});
