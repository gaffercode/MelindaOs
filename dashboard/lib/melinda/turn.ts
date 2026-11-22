import type { DirectorAuthConfiguration } from "../director/director-auth";
import { wibDate } from "../director/director-data";
import { logError } from "../log";
import { MELINDA_DAILY_TOKEN_LIMIT, MELINDA_HISTORY_MESSAGES, MELINDA_MAX_TOOL_ROUNDS, MELINDA_TURN_DEADLINE_MS, MELINDA_UNAVAILABLE } from "./limits";
import { echoableContent, MelindaModelError, streamRound, type ApiMessage, type ContentBlock } from "./model";
import { MELINDA_SYSTEM_PROMPT, turnContext } from "./prompt";
import type { ActionProposal } from "./actions";
import { appendMessage, createConversation, recentHistory, usageToday, type MelindaSource } from "./store";
import { MELINDA_TOOLS, TOOL_STATUS, runTool } from "./tools";

export { MELINDA_UNAVAILABLE };
export const MELINDA_REFUSED = "Melinda tidak dapat menjawab permintaan ini.";
export const MELINDA_DAILY_LIMIT = "Batas penggunaan Melinda hari ini sudah tercapai. Coba lagi besok.";

export type TurnEvent =
  | { type: "conversation"; id: string }
  | { type: "status"; label: string }
  | { type: "text"; delta: string }
  | { type: "sources"; sources: MelindaSource[] }
  /** A change Melinda prepared; the browser shows it with Konfirmasi and Batal. Nothing is written yet. */
  | { type: "proposal"; proposal: ActionProposal }
  | { type: "done"; complete: boolean }
  | { type: "error"; message: string };

type ToolUse = ContentBlock & { id: string; name: string; input: unknown };
const isToolUse = (block: ContentBlock): block is ToolUse => block.type === "tool_use";

/**
 * One Director message, through to a saved answer. Earlier turns are replayed as plain text, so no thinking block
 * outlives its own turn; inside a turn `messages` only ever grows at the end, and `system` and `tools` never change.
 */
export async function runTurn({ config, owner, conversationId, message, now, signal, emit }: { config: DirectorAuthConfiguration; owner: string; conversationId: string | null; message: string; now: Date; signal: AbortSignal; emit: (event: TurnEvent) => void }): Promise<void> {
  const started = Date.now();
  let conversation = conversationId;
  let text = "";
  let tokens = 0;
  const sources = new Map<string, MelindaSource>();

  const saveAnswer = async (complete: boolean) => {
    if (!conversation || !text) return;
    try { await appendMessage(config, owner, { conversationId: conversation, role: "assistant", content: text, sources: [...sources.values()], tokens, complete }); }
    catch (error) { logError("melinda_turn_save", error); }
  };
  const fail = async (reason: string) => { await saveAnswer(false); emit({ type: "error", message: reason }); emit({ type: "done", complete: false }); };
  const finish = async (complete: boolean) => { await saveAnswer(complete); emit({ type: "sources", sources: [...sources.values()] }); emit({ type: "done", complete }); };
  const stopWith = async (note: string) => {
    const delta = `${text ? "\n\n" : ""}${note}`;
    text += delta;
    emit({ type: "text", delta });
    await finish(false);
  };

  try {
    if (await usageToday(config, owner, wibDate(now)) >= MELINDA_DAILY_TOKEN_LIMIT) {
      emit({ type: "error", message: MELINDA_DAILY_LIMIT });
      emit({ type: "done", complete: false });
      return;
    }
    if (!conversation) {
      conversation = (await createConversation(config, owner, message.replace(/\s+/g, " ").trim().slice(0, 60))).id;
      emit({ type: "conversation", id: conversation });
    }
    await appendMessage(config, owner, { conversationId: conversation, role: "user", content: message });
    const history = await recentHistory(config, owner, conversation, MELINDA_HISTORY_MESSAGES);
    const messages: ApiMessage[] = [...history.slice(0, -1), { role: "user", content: `${turnContext(now)}\n\n${message}` }];

    for (let round = 1; round <= MELINDA_MAX_TOOL_ROUNDS; round += 1) {
      const remaining = MELINDA_TURN_DEADLINE_MS - (Date.now() - started);
      if (remaining <= 0) { await stopWith("Saya berhenti karena waktunya habis."); return; }
      const result = await streamRound({
        system: MELINDA_SYSTEM_PROMPT, tools: MELINDA_TOOLS, messages,
        onText: (delta) => { text += delta; emit({ type: "text", delta }); },
        signal: AbortSignal.any([signal, AbortSignal.timeout(remaining)]),
      });
      tokens += result.inputTokens + result.outputTokens;

      if (result.stopReason === "refusal") { await fail(MELINDA_REFUSED); return; }
      const content = echoableContent(result.content);
      const calls = content.filter(isToolUse);
      if (result.stopReason !== "tool_use" || calls.length === 0) { await finish(result.stopReason === "end_turn"); return; }

      messages.push({ role: "assistant", content });
      for (const call of calls) emit({ type: "status", label: TOOL_STATUS[call.name] ?? "Membaca data" });
      const outputs = await Promise.all(calls.map((call) => runTool(call.name, call.input, { config, now, owner, conversationId: conversation })));
      if (signal.aborted) throw new MelindaModelError("unreachable");
      for (const output of outputs) for (const source of output.sources) sources.set(source.href, source);
      for (const output of outputs) if (output.proposal) emit({ type: "proposal", proposal: output.proposal });
      messages.push({ role: "user", content: outputs.map((output, index) => ({ type: "tool_result", tool_use_id: calls[index].id, content: output.text, ...(output.isError ? { is_error: true } : {}) })) });
      try {
        await appendMessage(config, owner, { conversationId: conversation, role: "tool", content: outputs.map((output) => output.text).join("\n"), toolCalls: calls.map((call) => ({ name: call.name, input: call.input })) });
      } catch (error) { logError("melinda_turn_save_tool", error); }
    }
    await stopWith("Saya berhenti karena terlalu banyak langkah.");
  } catch (error) {
    if (!(error instanceof MelindaModelError)) logError("melinda_turn", error);
    if (signal.aborted) { await saveAnswer(false); return; }
    await fail(MELINDA_UNAVAILABLE);
  }
}
