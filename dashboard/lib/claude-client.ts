import { DirectorApiError } from "./director/director-api";
import { logError } from "./log";

/** The one Claude API route for the dashboard (Polish and instruction drafts). Never logs prompt or reply text. */
export const CLAUDE_ENDPOINT = "https://api.anthropic.com/v1/messages";
export const CLAUDE_MODEL = "claude-haiku-5-5";
// Version from the Messages API examples in the official docs (structured outputs page, read 2026-11-05).
export const ANTHROPIC_VERSION = "2026-10-21";
const TIMEOUT_MS = 20_000;
// Beta header for `fallbacks: "default"` (claude-api skill, shared/model-migration.md).
const FALLBACKS_BETA = "server-side-fallback-2026-07-01";

export type ClaudeEvent = "ai_polish" | "ai_draft" | "ai_starkes_match" | "ai_ask" | "ai_brief";
export type ClaudeOptions = {
  event: ClaudeEvent; system: string; user: string; maxTokens: number; schema?: Record<string, unknown>; model?: string;
  /** Request timeout in ms (default 20,000). */ timeoutMs?: number;
  /** Log the reply's token counts (numbers only, never text). */ logUsage?: boolean;
  /** Re-run a declined request server-side on Anthropic's recommended fallback model. */ fallbacks?: "default";
};
type ClaudeReply = { content?: { type?: unknown; text?: unknown }[]; stop_reason?: unknown; usage?: { input_tokens?: unknown; output_tokens?: unknown } };

export function requireClaudeKey(): string {
  const key = process.env.MELINDAOS_CLAUDE_API_KEY?.trim() || process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) throw new DirectorApiError(503, "Asisten AI belum dikonfigurasi.");
  return key;
}

/** Returns the reply text, or null when Claude is unreachable, rejects the call, refuses, or runs out of tokens. */
export async function callClaude({ event, system, user, maxTokens, schema, model = CLAUDE_MODEL, timeoutMs = TIMEOUT_MS, logUsage, fallbacks }: ClaudeOptions): Promise<string | null> {
  const key = requireClaudeKey();
  const body = {
    model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }],
    ...(schema ? { output_config: { format: { type: "json_schema", schema } } } : {}),
    ...(fallbacks ? { fallbacks } : {}),
  };
  let response: Response;
  try {
    response = await fetch(CLAUDE_ENDPOINT, {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json", ...(fallbacks ? { "anthropic-beta": FALLBACKS_BETA } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    logError(`${event}_unreachable`, error);
    return null;
  }
  if (!response.ok) { logError(`${event}_rejected`, { status: response.status }); return null; }
  const reply = await response.json().catch(() => null) as ClaudeReply | null;
  const usage = reply?.usage;
  if (logUsage && typeof usage?.input_tokens === "number" && typeof usage.output_tokens === "number") {
    console.info(JSON.stringify({ level: "info", code: `${event}_usage`, input_tokens: usage.input_tokens, output_tokens: usage.output_tokens }));
  }
  if (!reply || reply.stop_reason === "refusal" || reply.stop_reason === "max_tokens") {
    // The suffix is a closed set ("refusal" | "max_tokens" | "unparsed"), so the log stays code-only.
    logError(`${event}_incomplete_${reply ? String(reply.stop_reason) : "unparsed"}`, { status: response.status });
    return null;
  }
  return (reply.content ?? []).filter((block) => block.type === "text" && typeof block.text === "string").map((block) => block.text as string).join("");
}
