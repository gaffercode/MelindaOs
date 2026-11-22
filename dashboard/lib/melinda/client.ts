import { directorCsrfHeaders } from "../client-api";
import { MELINDA_UNAVAILABLE } from "./limits";
import type { TurnEvent } from "./turn";

const EVENT_TYPES = new Set(["conversation", "status", "text", "sources", "proposal", "done", "error"]);
const isTurnEvent = (value: unknown): value is TurnEvent => typeof value === "object" && value !== null && "type" in value && typeof value.type === "string" && EVENT_TYPES.has(value.type);
const errorOf = (value: unknown) => (typeof value === "object" && value !== null && "error" in value && typeof value.error === "string" ? value.error : MELINDA_UNAVAILABLE);

function parseFrame(frame: string): TurnEvent | null {
  if (!frame.startsWith("data: ")) return null;
  try {
    const value: unknown = JSON.parse(frame.slice(6));
    return isTurnEvent(value) ? value : null;
  } catch { return null; }
}

/** Sends one message and reports each `TurnEvent`. Every failure arrives as an `error` then a `done`; a caller's own abort stays silent. */
export async function sendMelinda({ conversationId, message, onEvent, signal }: { conversationId: string | null; message: string; onEvent: (event: TurnEvent) => void; signal?: AbortSignal }): Promise<void> {
  let finished = false;
  const emit = (event: TurnEvent) => { if (event.type === "done") finished = true; onEvent(event); };
  const fail = (reason: string) => { emit({ type: "error", message: reason }); emit({ type: "done", complete: false }); };
  try {
    const response = await fetch("/api/melinda/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await directorCsrfHeaders()) },
      body: JSON.stringify({ ...(conversationId ? { conversationId } : {}), message }),
      signal,
    });
    if (!response.ok || !response.body) { fail(errorOf(await response.json().catch(() => null))); return; }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) { const event = parseFrame(frame); if (event) emit(event); }
      if (done) break;
    }
    if (!finished) fail(MELINDA_UNAVAILABLE);
  } catch {
    if (!signal?.aborted && !finished) fail(MELINDA_UNAVAILABLE);
  }
}
