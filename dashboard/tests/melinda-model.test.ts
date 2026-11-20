import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { echoableContent, MelindaModelError, parseSse, streamRound } from "@/lib/melinda/model";

const encode = (text: string) => new TextEncoder().encode(text);
const bodyOf = (chunks: string[]) => new ReadableStream<Uint8Array>({ start(controller) { for (const chunk of chunks) controller.enqueue(encode(chunk)); controller.close(); } });
const sse = (events: Array<Record<string, unknown> & { type: string }>) => events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
const fetchMock = vi.fn();
const args = { system: "s", tools: [], messages: [{ role: "user" as const, content: "Halo" }], onText: () => undefined };
const respondWith = (events: Array<Record<string, unknown> & { type: string }>) => fetchMock.mockResolvedValue(new Response(bodyOf([sse(events)]), { status: 200 }));
const finished = (stop_reason = "end_turn", output_tokens = 3) => [{ type: "message_delta", delta: { stop_reason }, usage: { output_tokens } }, { type: "message_stop" }];
const started = { type: "message_start", message: { usage: { input_tokens: 12 } } };
const textRun = [started, { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }, { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hal" } }, { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "o" } }, { type: "content_block_stop", index: 0 }, ...finished()];
const sentBody = () => JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string) as Record<string, unknown>;
const sentHeaders = () => (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;

beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); vi.stubEnv("ANTHROPIC_API_KEY", "test-key"); vi.spyOn(console, "error").mockImplementation(() => undefined); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("streamRound", () => {
  it("sends the exact Sonnet 5.5 request shape", async () => {
    respondWith(textRun);
    await streamRound(args);
    expect(sentBody()).toMatchObject({ model: "claude-sonnet-5-5", stream: true, max_tokens: 16000, thinking: { type: "adaptive" }, output_config: { effort: "medium" }, fallbacks: "default", cache_control: { type: "ephemeral" } });
    expect(sentBody()).not.toHaveProperty("temperature");
    expect(sentBody()).not.toHaveProperty("tool_choice");
    expect(sentHeaders()["anthropic-beta"]).toBe("server-side-fallback-2026-07-01");
    expect(sentHeaders()["anthropic-version"]).toBe("2026-10-21");
    expect(sentHeaders()["x-api-key"]).toBe("test-key");
  });

  it("honours MELINDAOS_MELINDA_MODEL", async () => {
    vi.stubEnv("MELINDAOS_MELINDA_MODEL", "claude-opus-5-5");
    respondWith(textRun);
    await streamRound(args);
    expect(sentBody().model).toBe("claude-opus-5-5");
  });

  it("streams text deltas and returns the assembled blocks with usage", async () => {
    respondWith(textRun);
    const seen: string[] = [];
    const result = await streamRound({ ...args, onText: (delta) => seen.push(delta) });
    expect(seen).toEqual(["Hal", "o"]);
    expect(result).toMatchObject({ stopReason: "end_turn", inputTokens: 12, outputTokens: 3, content: [{ type: "text", text: "Halo" }] });
  });

  it("assembles a tool_use input split across deltas", async () => {
    respondWith([started, { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t1", name: "baca_tugas", input: {} } }, { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"filter"' } }, { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: ':"semua"}' } }, { type: "content_block_stop", index: 0 }, ...finished("tool_use")]);
    expect((await streamRound(args)).content[0]).toMatchObject({ type: "tool_use", name: "baca_tugas", input: { filter: "semua" } });
  });

  it("keeps thinking blocks verbatim for replay, signature included", async () => {
    respondWith([started, { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } }, { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig-1" } }, { type: "content_block_stop", index: 0 }, ...finished("tool_use")]);
    expect((await streamRound(args)).content[0]).toEqual({ type: "thinking", thinking: "", signature: "sig-1" });
  });

  it("keeps unknown block types and ignores unknown deltas without throwing", async () => {
    respondWith([started, { type: "content_block_start", index: 0, content_block: { type: "fallback", from: { model: "a" }, to: { model: "b" } } }, { type: "content_block_delta", index: 0, delta: { type: "future_delta", x: 1 } }, { type: "content_block_stop", index: 0 }, { type: "ping" }, ...finished()]);
    expect((await streamRound(args)).content[0]).toMatchObject({ type: "fallback" });
  });

  it("reports a stream that ends early as having no stop reason", async () => {
    respondWith([started, { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }, { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Seba" } }]);
    expect(await streamRound(args)).toMatchObject({ stopReason: null, content: [{ type: "text", text: "Seba" }] });
  });

  it("throws code stream on an error event", async () => {
    respondWith([started, { type: "error", error: { type: "overloaded_error", message: "x" } }]);
    await expect(streamRound(args)).rejects.toMatchObject({ code: "stream" });
  });

  it("throws code rejected on a non-2xx", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 400 }));
    await expect(streamRound(args)).rejects.toMatchObject({ code: "rejected" });
  });

  it("throws code unreachable when fetch fails", async () => {
    fetchMock.mockRejectedValue(new TypeError("network"));
    await expect(streamRound(args)).rejects.toBeInstanceOf(MelindaModelError);
    await expect(streamRound(args)).rejects.toMatchObject({ code: "unreachable" });
  });

  it("throws code unconfigured without an API key, and never calls the API", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    await expect(streamRound(args)).rejects.toMatchObject({ code: "unconfigured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("parseSse", () => {
  it("parses events split across chunk boundaries and CRLF", async () => {
    const seen: { event: string; data: unknown }[] = [];
    for await (const item of parseSse(bodyOf(["event: a\r\nda", "ta: {\"x\":1}\r", "\n\r\nevent: b\ndata: {\"y\":2}\n\n"]))) seen.push(item);
    expect(seen).toEqual([{ event: "a", data: { x: 1 } }, { event: "b", data: { y: 2 } }]);
  });
});

describe("echoableContent", () => {
  it("strips pre-fallback thinking and tool_use on echo, keeps the text", () => {
    expect(echoableContent([{ type: "thinking", thinking: "" }, { type: "text", text: "a" }, { type: "tool_use", id: "x" }, { type: "fallback" }, { type: "text", text: "b" }]).map((block) => block.type)).toEqual(["text", "fallback", "text"]);
  });

  it("returns content without a fallback unchanged", () => {
    const content = [{ type: "thinking", thinking: "", signature: "s" }, { type: "tool_use", id: "x" }];
    expect(echoableContent(content)).toEqual(content);
  });
});
