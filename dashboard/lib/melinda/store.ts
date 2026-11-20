import { DirectorApiError } from "../director/director-api";
import type { DirectorAuthConfiguration } from "../director/director-auth";
import { DirectorStoreError } from "../director/director-store";
import { logError } from "../log";

export type MelindaRole = "user" | "assistant" | "tool";
export type MelindaSource = { label: string; href: string };
export type MelindaMessage = { id: string; role: MelindaRole; content: string; sources: MelindaSource[]; complete: boolean; createdAt: string };
export type MelindaConversation = { id: string; title: string; updatedAt: string };

const rpc = "melinda_agent";

/** One call to the agent RPC. `not_found` covers a malformed id and another owner's conversation alike. */
async function call<T>(config: DirectorAuthConfiguration, command: string, args: Record<string, unknown>): Promise<T> {
  try {
    return await config.store.call<T>(command, args, rpc);
  } catch (error) {
    if (!(error instanceof DirectorStoreError)) throw error;
    if (error.code === "not_found") throw new DirectorApiError(404, "Percakapan tidak ditemukan.");
    logError(`melinda_store_${/^[a-z_]{1,40}$/.test(error.code) ? error.code : "unknown"}`, error);
    throw new DirectorApiError(503, "Melinda sedang tidak tersedia.");
  }
}

export async function createConversation(config: DirectorAuthConfiguration, owner: string, title: string): Promise<MelindaConversation> {
  return (await call<{ conversation: MelindaConversation }>(config, "create", { owner, title })).conversation;
}

export async function listConversations(config: DirectorAuthConfiguration, owner: string): Promise<MelindaConversation[]> {
  return (await call<{ conversations: MelindaConversation[] }>(config, "list", { owner })).conversations;
}

export function readConversation(config: DirectorAuthConfiguration, owner: string, id: string): Promise<{ conversation: MelindaConversation; messages: MelindaMessage[] }> {
  return call(config, "read", { owner, id });
}

export async function deleteConversation(config: DirectorAuthConfiguration, owner: string, id: string): Promise<void> {
  await call(config, "delete", { owner, id });
}

export async function appendMessage(config: DirectorAuthConfiguration, owner: string, input: { conversationId: string; role: MelindaRole; content: string; toolCalls?: unknown; sources?: MelindaSource[]; tokens?: number; complete?: boolean }): Promise<void> {
  const { conversationId, role, content, toolCalls = null, sources = [], tokens = 0, complete = true } = input;
  await call(config, "append", { owner, conversationId, role, content, toolCalls, sources, tokens, complete });
}

export async function recentHistory(config: DirectorAuthConfiguration, owner: string, conversationId: string, limit: number): Promise<{ role: "user" | "assistant"; content: string }[]> {
  return (await call<{ messages: { role: "user" | "assistant"; content: string }[] }>(config, "history", { owner, conversationId, limit })).messages;
}

export async function usageToday(config: DirectorAuthConfiguration, owner: string, day: string): Promise<number> {
  return (await call<{ tokens: number }>(config, "usage_today", { owner, day })).tokens;
}
