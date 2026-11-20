import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DirectorAuthConfiguration } from "@/lib/director/director-auth";
import { DirectorApiError } from "@/lib/director/director-api";
import { DirectorStoreError, SupabaseDirectorStore } from "@/lib/director/director-store";
import { addReply, archive, board, health, heartbeat, listReplies, listSchedule, markReminderSent, replaceSchedule, setDirectorStatus } from "@/lib/tasks/store";
import type { StaffReplyInput } from "@/lib/tasks/contract";

type Call = { url: string; command: string; args: Record<string, unknown> };
let calls: Call[];
let respond: (command: string) => unknown;
let config: DirectorAuthConfiguration;

const reply: StaffReplyInput = {
  kattMessageId: "wa-123", receivedAt: "2099-01-15T03:00:00.000Z", fromName: "Bu Ani", originalText: "Sudah dikerjakan",
  attachments: [{ url: "https://synthetic.example/a.jpg", mime: "image/jpeg" }], summary: "Selesai", needs: null,
  classifiedStatus: "selesai", confidence: 0.9,
};

beforeEach(() => {
  calls = [];
  respond = () => ({ ok: true });
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const { command, args } = JSON.parse(init.body as string) as { command: string; args: Record<string, unknown> };
    calls.push({ url, command, args });
    return Response.json(respond(command));
  });
  config = { store: new SupabaseDirectorStore("https://synthetic.supabase.co", "sb_secret_synthetic") } as DirectorAuthConfiguration;
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("tasks store adapter commands", () => {
  it("replaceSchedule sends date, items and producer", async () => {
    const items = [{ start: "08:00", end: null, title: "Rapat", place: null, pic: ["Ani"], topic: null }];
    respond = () => ({ date: "2099-01-15", count: 1 });
    expect(await replaceSchedule(config, { date: "2099-01-15", items, producer: "katt" })).toEqual({ date: "2099-01-15", count: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://synthetic.supabase.co/rest/v1/rpc/melinda_director_tasks");
    expect(calls[0]).toMatchObject({ command: "schedule_replace", args: { date: "2099-01-15", items, producer: "katt" } });
  });
  it("listSchedule sends date", async () => {
    respond = () => ({ date: "2099-01-15", items: [] });
    await listSchedule(config, { date: "2099-01-15" });
    expect(calls[0]).toMatchObject({ command: "schedule_list", args: { date: "2099-01-15" } });
  });
  it("addReply builds the key and flattens the reply fields", async () => {
    respond = () => ({ reply: { id: "r1" }, replayed: false, statusApplied: true, instruction: {} });
    const result = await addReply(config, "IOC-0001", reply, "katt");
    expect(result).toEqual({ reply: { id: "r1" }, statusApplied: true, replayed: false });
    expect(calls[0].command).toBe("reply_add");
    expect(calls[0].args).toEqual({ ...reply, key: "reply:IOC-0001:wa-123", instructionId: "IOC-0001", producer: "katt" });
  });
  it("addReply reports statusApplied null on replay", async () => {
    respond = () => ({ reply: { id: "r1" }, replayed: true, statusApplied: null, instruction: {} });
    expect(await addReply(config, "IOC-0001", reply, "katt")).toEqual({ reply: { id: "r1" }, statusApplied: null, replayed: true });
  });
  it("listReplies sends instructionIds", async () => {
    respond = () => ({ replies: [] });
    await listReplies(config, { instructionIds: ["IOC-0001", "IOC-0002"] });
    expect(calls[0]).toMatchObject({ command: "replies_list", args: { instructionIds: ["IOC-0001", "IOC-0002"] } });
  });
  it("setDirectorStatus sends id, status, actor and note", async () => {
    respond = () => ({ instruction: { id: "IOC-0001" } });
    await setDirectorStatus(config, { id: "IOC-0001", status: "ditunda", actor: "director", note: "Menunggu" });
    expect(calls[0]).toMatchObject({ command: "director_status", args: { id: "IOC-0001", status: "ditunda", actor: "director", note: "Menunggu" } });
  });
  it("markReminderSent sends id and at", async () => {
    respond = () => ({ instruction: { id: "IOC-0001" } });
    await markReminderSent(config, { id: "IOC-0001", at: "2099-01-15T03:00:00.000Z" });
    expect(calls[0]).toMatchObject({ command: "reminder_sent", args: { id: "IOC-0001", at: "2099-01-15T03:00:00.000Z" } });
  });
  it("heartbeat sends producer; health sends no arguments", async () => {
    respond = () => ({ heartbeats: [] });
    await heartbeat(config, { producer: "katt" });
    await health(config);
    expect(calls[0]).toMatchObject({ command: "heartbeat", args: { producer: "katt" } });
    expect(calls[1]).toMatchObject({ command: "health", args: {} });
  });
  it("board sends now", async () => {
    respond = () => ({ instructions: [] });
    await board(config, { now: "2099-01-15T03:00:00.000Z" });
    expect(calls[0]).toMatchObject({ command: "board", args: { now: "2099-01-15T03:00:00.000Z" } });
  });
  it("archive sends now, range, filters and offset", async () => {
    respond = () => ({ instructions: [], offset: 50, pageSize: 50, hasMore: false });
    const args = { now: "2099-01-15T03:00:00.000Z", from: "2099-01-01", to: "2099-01-15", q: "rapat", pic: "Ani", status: "selesai", offset: 50 };
    await archive(config, args);
    expect(calls[0]).toMatchObject({ command: "archive", args });
    await archive(config, { now: args.now, from: args.from, to: args.to, offset: 0 });
    expect(calls[1].args).toEqual({ now: args.now, from: args.from, to: args.to, offset: 0 });
  });
});

describe("tasks store adapter error mapping", () => {
  it.each([["conflict", 409], ["not_found", 404], ["invalid_input", 400], ["invalid_status", 400], ["invalid_command", 503], ["boom", 503]])("maps errorCode %s to %i", async (errorCode, status) => {
    respond = () => ({ errorCode });
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = await listSchedule(config, { date: "2099-01-15" }).then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(status === 400 ? DirectorApiError : DirectorStoreError);
    expect((error as { status: number }).status).toBe(status);
    if (status === 503) {
      expect(spy).toHaveBeenCalledTimes(1);
      expect(JSON.parse(spy.mock.calls[0][0] as string)).toMatchObject({ level: "error", code: `tasks_store_${errorCode}` });
    } else expect(spy).not.toHaveBeenCalled();
  });
  it("maps a transport failure to 503", async () => {
    vi.stubGlobal("fetch", async () => new Response("no", { status: 500 }));
    config = { store: new SupabaseDirectorStore("https://synthetic.supabase.co", "sb_secret_synthetic") } as DirectorAuthConfiguration;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = await health(config).then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(DirectorStoreError);
    expect((error as DirectorStoreError).status).toBe(503);
  });
});
