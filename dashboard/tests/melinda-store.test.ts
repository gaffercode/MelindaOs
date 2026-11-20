import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DirectorAuthConfiguration } from "@/lib/director/director-auth";
import { DirectorStoreError } from "@/lib/director/director-store";
import { appendMessage, createConversation, deleteConversation, listConversations, readConversation, recentHistory, usageToday } from "@/lib/melinda/store";

const store = { call: vi.fn() };
const config = { store } as unknown as DirectorAuthConfiguration;

beforeEach(() => { store.call.mockReset(); vi.spyOn(console, "error").mockImplementation(() => undefined); });

describe("melinda store", () => {
  it("calls the melinda_agent rpc with the owner on every command", async () => {
    store.call.mockResolvedValue({ conversations: [] });
    await listConversations(config, "dir-1");
    expect(store.call).toHaveBeenCalledWith("list", { owner: "dir-1" }, "melinda_agent");
  });

  it("maps not_found to a 404 DirectorApiError", async () => {
    store.call.mockRejectedValue(new DirectorStoreError(404, "not_found"));
    await expect(readConversation(config, "dir-1", "rusak")).rejects.toMatchObject({ status: 404, message: "Percakapan tidak ditemukan." });
  });

  it("maps any other store failure to 503", async () => {
    store.call.mockRejectedValue(new DirectorStoreError(503, "boom"));
    await expect(listConversations(config, "dir-1")).rejects.toMatchObject({ status: 503 });
  });

  it("logs only the failure code, never the message text", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    store.call.mockRejectedValue(new DirectorStoreError(503, "boom"));
    await appendMessage(config, "dir-1", { conversationId: "c1", role: "user", content: "rahasia direktur" }).catch(() => undefined);
    expect(JSON.stringify(log.mock.calls)).not.toContain("rahasia direktur");
    expect(JSON.stringify(log.mock.calls)).toContain("melinda_store_boom");
  });

  it("returns the created conversation", async () => {
    const conversation = { id: "c1", title: "Halo", updatedAt: "2026-11-09T01:00:00Z" };
    store.call.mockResolvedValue({ conversation });
    await expect(createConversation(config, "dir-1", "Halo")).resolves.toEqual(conversation);
    expect(store.call).toHaveBeenCalledWith("create", { owner: "dir-1", title: "Halo" }, "melinda_agent");
  });

  it("sends append defaults: complete, no sources, zero tokens", async () => {
    store.call.mockResolvedValue({ ok: true });
    await appendMessage(config, "dir-1", { conversationId: "c1", role: "assistant", content: "Halo" });
    expect(store.call).toHaveBeenCalledWith("append", { owner: "dir-1", conversationId: "c1", role: "assistant", content: "Halo", toolCalls: null, sources: [], tokens: 0, complete: true }, "melinda_agent");
  });

  it("unwraps history, usage and delete", async () => {
    store.call.mockResolvedValueOnce({ messages: [{ role: "user", content: "a" }] }).mockResolvedValueOnce({ tokens: 42 }).mockResolvedValueOnce({ deleted: true });
    await expect(recentHistory(config, "dir-1", "c1", 20)).resolves.toEqual([{ role: "user", content: "a" }]);
    await expect(usageToday(config, "dir-1", "2026-11-09")).resolves.toBe(42);
    await expect(deleteConversation(config, "dir-1", "c1")).resolves.toBeUndefined();
    expect(store.call).toHaveBeenNthCalledWith(1, "history", { owner: "dir-1", conversationId: "c1", limit: 20 }, "melinda_agent");
  });
});
