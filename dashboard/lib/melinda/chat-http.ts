import { ASK_ESCALATE_PHI } from "../ask/answer";
import { apiBoundary, DirectorApiError, objectBody, rateLimit, readBoundedJson, requireConfiguration, requireHuman } from "../director/director-api";
import { logError } from "../log";
import { findPatientIdentifiers } from "../phi-guard";
import { MELINDA_MAX_MESSAGE, MELINDA_RATE_LIMIT, MELINDA_RATE_WINDOW_SECONDS, MELINDA_UNAVAILABLE } from "./limits";
import { readConversation } from "./store";
import { runTurn, type TurnEvent } from "./turn";

const MAX_BODY = 16_384;

type Emit = (event: TurnEvent) => void;

/** A stream of `TurnEvent`s. After the browser leaves, `signal` aborts and further events are dropped. */
function eventStream(request: Request, run: (emit: Emit, signal: AbortSignal) => Promise<void>): Response {
  const encoder = new TextEncoder();
  const abort = new AbortController();
  let open = true;
  request.signal.addEventListener("abort", () => abort.abort(), { once: true });
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit: Emit = (event) => {
        if (!open) return;
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); } catch { open = false; }
      };
      void run(emit, abort.signal)
        .catch((error: unknown) => {
          logError("melinda_stream", error);
          emit({ type: "error", message: MELINDA_UNAVAILABLE });
          emit({ type: "done", complete: false });
        })
        .finally(() => {
          if (!open) return;
          open = false;
          controller.close();
        });
    },
    cancel() {
      open = false;
      abort.abort();
    },
  });
  return new Response(body, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store" } });
}

/** Everything that can be refused is refused here, as plain JSON, before the stream opens. Kept apart from the read routes so only this route carries the knowledge index. */
export const chatResponse = (request: Request) => apiBoundary(async () => {
  const { config, reviewerId } = await requireHuman(request, requireConfiguration(), true);
  await rateLimit(config, `melinda:${reviewerId}`, MELINDA_RATE_LIMIT, MELINDA_RATE_WINDOW_SECONDS);
  const body = objectBody(await readBoundedJson(request, MAX_BODY), ["message"], ["conversationId"]);
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) throw new DirectorApiError(400, "Pertanyaan masih kosong.");
  if (message.length > MELINDA_MAX_MESSAGE) throw new DirectorApiError(400, `Pertanyaan terlalu panjang (maksimal ${MELINDA_MAX_MESSAGE} karakter).`);
  if (body.conversationId !== undefined && typeof body.conversationId !== "string") throw new DirectorApiError(404, "Percakapan tidak ditemukan.");
  const conversationId = body.conversationId ?? null;
  if (conversationId) await readConversation(config, reviewerId, conversationId);
  // Identifiers stop here: not sent to the model and not stored.
  if (findPatientIdentifiers(message).length) {
    return eventStream(request, async (emit) => {
      emit({ type: "error", message: ASK_ESCALATE_PHI });
      emit({ type: "done", complete: false });
    });
  }
  return eventStream(request, (emit, signal) => runTurn({ config, owner: reviewerId, conversationId, message, now: new Date(), signal, emit }));
});
