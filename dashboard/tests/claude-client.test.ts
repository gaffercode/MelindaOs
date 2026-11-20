import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLAUDE_ENDPOINT, CLAUDE_MODEL, callClaude } from "@/lib/claude-client";
import { DirectorApiError } from "@/lib/director/director-api";

let calls: { url: string; init: RequestInit }[];
let reply: () => Promise<Response>;

beforeEach(() => {
  calls = [];
  reply = async () => Response.json({ content: [{ type: "text", text: "halo" }], stop_reason: "end_turn" });
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-anthropic-key");
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => { calls.push({ url, init }); return reply(); });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const base = { event: "ai_draft" as const, system: "Aturan sintetis", user: "Catatan sintetis", maxTokens: 900 };

describe("callClaude", () => {
  it("sends model, system, user and schema to the Messages API", async () => {
    const schema = { type: "object", properties: { a: { type: "string" } }, required: ["a"], additionalProperties: false };
    expect(await callClaude({ ...base, schema })).toBe("halo");
    expect(calls[0]!.url).toBe(CLAUDE_ENDPOINT);
    expect(CLAUDE_ENDPOINT).toBe("https://api.anthropic.com/v1/messages");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("synthetic-anthropic-key");
    expect(headers["anthropic-version"]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      model: "claude-haiku-5-5", max_tokens: 900, system: "Aturan sintetis",
      messages: [{ role: "user", content: "Catatan sintetis" }],
      output_config: { format: { type: "json_schema", schema } },
    });
    expect(CLAUDE_MODEL).toBe("claude-haiku-5-5");
  });
  it("sends an overriding model when given", async () => {
    await callClaude({ ...base, model: "claude-sonnet-5-5" });
    expect(JSON.parse(calls[0]!.init.body as string).model).toBe("claude-sonnet-5-5");
  });
  it("omits output_config without a schema", async () => {
    await callClaude(base);
    expect(JSON.parse(calls[0]!.init.body as string)).not.toHaveProperty("output_config");
  });
  it("joins text blocks and skips thinking blocks", async () => {
    reply = async () => Response.json({ content: [{ type: "thinking", thinking: "rahasia" }, { type: "text", text: "satu " }, { type: "text", text: "dua" }], stop_reason: "end_turn" });
    expect(await callClaude(base)).toBe("satu dua");
  });
  it("returns null on refusal, max_tokens, 500 and network error, logging only codes", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    reply = async () => Response.json({ content: [{ type: "text", text: "x" }], stop_reason: "refusal" });
    expect(await callClaude(base)).toBeNull();
    reply = async () => Response.json({ content: [{ type: "text", text: "{\"a\":" }], stop_reason: "max_tokens" });
    expect(await callClaude(base)).toBeNull();
    reply = async () => Response.json({ error: { message: "boom" } }, { status: 500 });
    expect(await callClaude(base)).toBeNull();
    reply = async () => { throw new TypeError("fetch failed"); };
    expect(await callClaude(base)).toBeNull();
    const codes = log.mock.calls.map((call) => JSON.parse(String(call[0])).code);
    expect(codes).toEqual(["ai_draft_incomplete_refusal", "ai_draft_incomplete_max_tokens", "ai_draft_rejected", "ai_draft_unreachable"]);
    expect(JSON.stringify(log.mock.calls)).not.toContain("Catatan sintetis");
  });
  it("prefers MELINDAOS_CLAUDE_API_KEY and still accepts ANTHROPIC_API_KEY", async () => {
    await callClaude(base);
    expect(new Headers(calls[0].init.headers).get("x-api-key")).toBe("synthetic-anthropic-key");
    vi.stubEnv("MELINDAOS_CLAUDE_API_KEY", "synthetic-melindaos-key");
    await callClaude(base);
    expect(new Headers(calls[1].init.headers).get("x-api-key")).toBe("synthetic-melindaos-key");
  });
  it("uses the given timeout", async () => {
    const spy = vi.spyOn(AbortSignal, "timeout");
    await callClaude({ ...base, event: "ai_brief", timeoutMs: 120_000 });
    expect(spy).toHaveBeenCalledWith(120_000);
  });
  it("logs token counts only when asked", async () => {
    reply = async () => Response.json({ content: [{ type: "text", text: "halo" }], stop_reason: "end_turn", usage: { input_tokens: 800, output_tokens: 300 } });
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await callClaude({ ...base, event: "ai_brief" });
    expect(info).not.toHaveBeenCalled();
    await callClaude({ ...base, event: "ai_brief", logUsage: true });
    expect(JSON.parse(info.mock.calls[0]![0] as string)).toEqual({ level: "info", code: "ai_brief_usage", input_tokens: 800, output_tokens: 300 });
  });
  it("opts into server-side fallbacks only when asked", async () => {
    await callClaude({ ...base, event: "ai_brief" });
    await callClaude({ ...base, event: "ai_brief", fallbacks: "default" });
    const [plain, withFallback] = calls.map((call) => ({ headers: call.init.headers as Record<string, string>, body: JSON.parse(call.init.body as string) }));
    expect(plain!.headers["anthropic-beta"]).toBeUndefined();
    expect(plain!.body.fallbacks).toBeUndefined();
    expect(withFallback!.headers["anthropic-beta"]).toBe("server-side-fallback-2026-07-01");
    expect(withFallback!.body.fallbacks).toBe("default");
  });
  it("logs nothing for usage when the reply has no usable counts", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await callClaude({ ...base, event: "ai_brief", logUsage: true });
    reply = async () => Response.json({ content: [{ type: "text", text: "halo" }], stop_reason: "end_turn", usage: { input_tokens: "800", output_tokens: null } });
    await callClaude({ ...base, event: "ai_brief", logUsage: true });
    expect(info).not.toHaveBeenCalled();
  });
  it("throws 503 without ANTHROPIC_API_KEY", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    await expect(callClaude(base)).rejects.toMatchObject({ status: 503, message: "Asisten AI belum dikonfigurasi." });
    await expect(callClaude(base)).rejects.toBeInstanceOf(DirectorApiError);
    expect(calls).toHaveLength(0);
  });
});
