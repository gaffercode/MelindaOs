import { ANTHROPIC_VERSION, CLAUDE_ENDPOINT, requireClaudeKey } from "../claude-client";
import { logError } from "../log";
import { MELINDA_MAX_OUTPUT_TOKENS, MELINDA_ROUND_TIMEOUT_MS, melindaModel } from "./limits";

export type ContentBlock = Record<string, unknown> & { type: string };
export type ApiMessage = { role: "user" | "assistant"; content: string | ContentBlock[] };
export type ToolDefinition = { name: string; description: string; input_schema: Record<string, unknown>; strict?: true };
export type RoundResult = { stopReason: string | null; content: ContentBlock[]; inputTokens: number; outputTokens: number };
export class MelindaModelError extends Error {
  override readonly name = "MelindaModelError";
  constructor(public readonly code: "unconfigured" | "unreachable" | "rejected" | "stream") { super(code); }
}

type Delta = { type?: string; text?: string; thinking?: string; signature?: string; partial_json?: string; stop_reason?: string | null };
type StreamEvent = { type?: string; index?: number; content_block?: ContentBlock; delta?: Delta; usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number }; message?: { usage?: { input_tokens?: number; cache_creation_input_tokens?: number } } };

/** Server-Sent Events from a byte stream; events may arrive split across chunks. */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<{ event: string; data: unknown }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, "\n");
      for (let end = buffer.indexOf("\n\n"); end !== -1; end = buffer.indexOf("\n\n")) {
        const lines = buffer.slice(0, end).split("\n");
        buffer = buffer.slice(end + 2);
        const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim() ?? "";
        const data = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
        if (!data) continue;
        try { yield { event, data: JSON.parse(data) as unknown }; } catch (error) { if (error instanceof SyntaxError) throw new MelindaModelError("stream"); throw error; }
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

const billableInput = (usage?: { input_tokens?: number; cache_creation_input_tokens?: number }) => (usage?.input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0);

/** One Messages API call, streamed: text goes to `onText` as it arrives, and the full blocks come back for replay. */
export async function streamRound({ system, tools, messages, onText, signal }: { system: string; tools: ToolDefinition[]; messages: ApiMessage[]; onText: (delta: string) => void; signal?: AbortSignal }): Promise<RoundResult> {
  let key: string;
  try { key = requireClaudeKey(); } catch { throw new MelindaModelError("unconfigured"); }
  const timeout = AbortSignal.timeout(MELINDA_ROUND_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(CLAUDE_ENDPOINT, {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": ANTHROPIC_VERSION, "anthropic-beta": "server-side-fallback-2026-07-01", "content-type": "application/json" },
      body: JSON.stringify({ model: melindaModel(), max_tokens: MELINDA_MAX_OUTPUT_TOKENS, stream: true, thinking: { type: "adaptive" }, output_config: { effort: "medium" }, cache_control: { type: "ephemeral" }, fallbacks: "default", system, tools, messages }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (error) {
    logError("melinda_model_unreachable", error);
    throw new MelindaModelError("unreachable");
  }
  if (!response.ok || !response.body) {
    logError("melinda_model_rejected", { status: response.status });
    throw new MelindaModelError("rejected");
  }

  const blocks: ContentBlock[] = [];
  const toolJson = new Map<number, string>();
  const result: RoundResult = { stopReason: null, content: [], inputTokens: 0, outputTokens: 0 };
  try {
    for await (const { data } of parseSse(response.body)) {
      const event = data as StreamEvent;
      const index = event.index ?? 0;
      if (event.type === "message_start") result.inputTokens = billableInput(event.message?.usage);
      else if (event.type === "content_block_start" && event.content_block) {
        blocks[index] = { ...event.content_block };
        if (event.content_block.type === "tool_use") toolJson.set(index, "");
      } else if (event.type === "content_block_delta" && event.delta && blocks[index]) {
        const block = blocks[index], delta = event.delta;
        if (delta.type === "text_delta" && delta.text !== undefined) { block.text = `${typeof block.text === "string" ? block.text : ""}${delta.text}`; onText(delta.text); }
        else if (delta.type === "thinking_delta" && delta.thinking !== undefined) block.thinking = `${typeof block.thinking === "string" ? block.thinking : ""}${delta.thinking}`;
        else if (delta.type === "signature_delta" && delta.signature !== undefined) block.signature = delta.signature;
        else if (delta.type === "input_json_delta") toolJson.set(index, `${toolJson.get(index) ?? ""}${delta.partial_json ?? ""}`);
      } else if (event.type === "content_block_stop" && blocks[index] && toolJson.has(index)) {
        // Only a truncated (max_tokens) call can leave bad JSON, and tools run only on stop_reason tool_use.
        try { blocks[index].input = JSON.parse(toolJson.get(index) || "{}") as unknown; } catch { blocks[index].input = {}; }
      } else if (event.type === "message_delta") {
        result.stopReason = event.delta?.stop_reason ?? result.stopReason;
        result.outputTokens = event.usage?.output_tokens ?? result.outputTokens;
        if (event.usage?.input_tokens !== undefined) result.inputTokens = billableInput(event.usage);
      } else if (event.type === "error") throw new MelindaModelError("stream");
    }
  } catch (error) {
    if (error instanceof MelindaModelError) throw error;
    logError("melinda_model_stream", error);
    throw new MelindaModelError("stream");
  }
  result.content = blocks.filter(Boolean);
  return result;
}

/** What to send back as the assistant turn: after a mid-output fallback, blocks before it that the new model cannot continue are dropped. */
export function echoableContent(content: ContentBlock[]): ContentBlock[] {
  const boundary = content.map((block) => block.type).lastIndexOf("fallback");
  if (boundary === -1) return content;
  return content.filter((block, index) => index > boundary || !["thinking", "redacted_thinking", "tool_use"].includes(block.type));
}
