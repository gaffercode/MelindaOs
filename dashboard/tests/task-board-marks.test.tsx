// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TaskBoard } from "@/components/tasks/task-board";
import type { BoardData, BoardTask } from "@/components/tasks/board-client";
import type { StaffReply } from "@/lib/tasks/store";

// Same key as hiddenReplies in board-client.ts. The module also keeps a memory copy that survives between tests, so every test uses its own reply ids.
const HIDDEN_KEY = "melindaos.tasks.hiddenReplies";

const reply = (id: string): StaffReply => ({
  id, instructionId: `IOC-${id}`, key: `reply:${id}`, receivedAt: "2026-11-07T03:10:00Z", fromName: "Bu Oriza",
  originalText: `Pesan ${id}`, attachments: [], summary: "Laporan", needs: null, classifiedStatus: "perlu_dibaca", confidence: 0.9, producer: "dash", createdAt: "2026-11-07T03:10:05Z",
});
const task = (id: string): BoardTask => ({
  id: `IOC-${id}`, reportDate: "2026-11-07", section: "umum", itemId: "x", itemTitle: `Tugas ${id}`, urgent: false, action: "assign", deadline: null,
  pic: ["Kepala Umum"], note: "", decisionOptionId: null, decisionLabel: null, status: "dikerjakan",
  history: [{ status: "terkirim_ke_grokbot", at: "2026-11-07T01:00:00Z", actor: "director" }],
  createdAt: "2026-11-07T01:00:00Z", linkedId: null, scheduleItemId: null, remindersSent: 0, lastReminderAt: null, latestReply: reply(id), overdue: false, reminder: "none",
});
const board = (ids: string[]): BoardData => ({ summary: { open: ids.length, overdue: 0, kendala: 0, escalated: 0 }, schedule: [], tasks: ids.map(task) });

type Call = { url: string; method: string; csrf: string | null; body: { scope: string; items: { key: string; value: string }[] } | null };
type Server = { marksGet: () => Response; marksPost: () => Response };

/** Answers the session, the board and the marks endpoints; records every call. */
function stubServer(ids: string[], server: Partial<Server> = {}) {
  const calls: Call[] = [];
  const answers: Server = { marksGet: () => Response.json({ marks: [] }), marksPost: () => Response.json({ saved: 1 }), ...server };
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    calls.push({ url, method, csrf: new Headers(init.headers).get("X-CSRF-Token"), body: typeof init.body === "string" ? JSON.parse(init.body) : null });
    if (url === "/api/director/session") return Response.json({ csrfToken: "csrf-board" });
    if (url === "/api/director/tasks/board") return Response.json(board(ids));
    if (url.startsWith("/api/director/marks")) return method === "POST" ? answers.marksPost() : answers.marksGet();
    return Response.json({ error: "unexpected" }, { status: 404 });
  });
  return { calls, posts: () => calls.filter((call) => call.method === "POST"), gets: () => calls.filter((call) => call.url.startsWith("/api/director/marks") && call.method === "GET") };
}
const hideInBrowser = (...ids: string[]) => window.localStorage.setItem(HIDDEN_KEY, JSON.stringify(ids));
const marksOf = (...ids: string[]) => ({ marks: ids.map((key) => ({ key, value: "read" })) });

beforeEach(() => window.localStorage.clear());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Task board read marks", () => {
  it("hides a reply the server marks as read, and uploads nothing", async () => {
    const server = stubServer(["srv-a", "srv-b"], { marksGet: () => Response.json(marksOf("srv-a")) });
    render(<TaskBoard filter={null} />);
    await screen.findByText("Pesan srv-b");
    expect(screen.queryByText("Pesan srv-a")).toBeNull();
    expect(server.gets()[0].url).toBe("/api/director/marks?scope=task_reply_read");
    expect(server.posts()).toHaveLength(0);
  });

  it("hides a reply known only to the browser and uploads exactly that id once", async () => {
    hideInBrowser("loc-a");
    const server = stubServer(["loc-a", "loc-b"]);
    render(<TaskBoard filter={null} />);
    await screen.findByText("Pesan loc-b");
    expect(screen.queryByText("Pesan loc-a")).toBeNull();
    await waitFor(() => expect(server.posts()).toHaveLength(1));
    const [post] = server.posts();
    expect(post.url).toBe("/api/director/marks");
    expect(post.csrf).toBe("csrf-board");
    expect(post.body).toEqual({ scope: "task_reply_read", items: [{ key: "loc-a", value: "read" }] });
    expect(server.posts()).toHaveLength(1);
  });

  it("sends no second upload on a later render once the server returns the id", async () => {
    hideInBrowser("again-a");
    const first = stubServer(["again-a", "again-b"]);
    const view = render(<TaskBoard filter={null} />);
    await screen.findByText("Pesan again-b");
    await waitFor(() => expect(first.posts()).toHaveLength(1));
    view.unmount();

    const second = stubServer(["again-a", "again-b"], { marksGet: () => Response.json(marksOf("again-a")) });
    render(<TaskBoard filter={null} />);
    await screen.findByText("Pesan again-b");
    expect(screen.queryByText("Pesan again-a")).toBeNull();
    expect(second.gets()).toHaveLength(1);
    expect(second.posts()).toHaveLength(0);
  });

  it("hides the card at once on Sudah dibaca and saves that id with the value read", async () => {
    const server = stubServer(["tap-a", "tap-b"]);
    render(<TaskBoard filter={null} />);
    await screen.findByText("Pesan tap-a");
    expect(server.posts()).toHaveLength(0);
    fireEvent.click(screen.getAllByRole("button", { name: "Sudah dibaca" })[0]);
    expect(screen.queryByText("Pesan tap-a")).toBeNull();
    expect(screen.getByText("Pesan tap-b")).toBeTruthy();
    await waitFor(() => expect(server.posts()).toHaveLength(1));
    const [post] = server.posts();
    expect(post.csrf).toBe("csrf-board");
    expect(post.body).toEqual({ scope: "task_reply_read", items: [{ key: "tap-a", value: "read" }] });
  });

  it("still renders the board and the browser set when the marks read answers 503, and sends no POST", async () => {
    hideInBrowser("down-a");
    const server = stubServer(["down-a", "down-b"], { marksGet: () => Response.json({ error: "Layanan belum tersedia." }, { status: 503 }) });
    render(<TaskBoard filter={null} />);
    await screen.findByText("Pesan down-b");
    expect(screen.queryByText("Pesan down-a")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    await waitFor(() => expect(server.gets()).toHaveLength(1));
    expect(server.posts()).toHaveLength(0);
  });

  it("keeps the card hidden and shows no error when the save answers 503", async () => {
    hideInBrowser("fail-a");
    const server = stubServer(["fail-a", "fail-b"], { marksPost: () => Response.json({ error: "Layanan belum tersedia." }, { status: 503 }) });
    render(<TaskBoard filter={null} />);
    await screen.findByText("Pesan fail-b");
    await waitFor(() => expect(server.posts()).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Sudah dibaca" }));
    await waitFor(() => expect(server.posts()).toHaveLength(2));
    expect(screen.queryByText("Pesan fail-a")).toBeNull();
    expect(screen.queryByText("Pesan fail-b")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/Layanan belum tersedia/)).toBeNull();
  });

  it("does not wait for the marks read to show a board error", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.startsWith("/api/director/marks")) return new Promise<Response>(() => {});
      if (url === "/api/director/session") return Response.json({ csrfToken: "c" });
      return Response.json({ error: "Papan rusak." }, { status: 500 });
    });
    render(<TaskBoard filter={null} />);
    expect(await screen.findByText(/Papan rusak\./)).toBeTruthy();
  });
});
