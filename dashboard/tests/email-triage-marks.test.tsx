// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EmailTriageTable } from "@/components/melinda-brief/email-triage-table";
import type { MelindaEmailTriageAccount } from "@/lib/melinda/melinda-brief-data";

const DATE = "2026-11-12";
const KEY = `melinda_email_handling_v1:${DATE}`;
const HAI = "hai@melinda.co.id";
const YAHOO = "Melinda.RS@yahoo.com";
const PERSONAL = "dokter.pribadi@gmail.com";
const SAVE_FAILED = "Status belum tersimpan ke server.";

const account = (akun: string): MelindaEmailTriageAccount => ({ akun, total: 10, perluTindakan: 2, fyi: 3, promoOtomatis: 5 });
const ACCOUNTS = [account(HAI), account(PERSONAL), account(YAHOO)];

type Call = { url: string; method: string; csrf: string | null; body: { scope: string; date?: string; items: { key: string; value: string }[] } | null };
type Answers = { session: () => Response | Promise<Response>; marksGet: () => Response | Promise<Response>; marksPost: () => Response | Promise<Response> };

/** Answers the session and the marks endpoints and records every call. `loaded()` resolves once the table has handled every answer given so far. */
function stubServer(answers: Partial<Answers> = {}) {
  const calls: Call[] = [];
  const sessionReads: Promise<void>[] = [];
  const reads: Promise<void>[] = [];
  const all: Answers = { session: () => Response.json({ csrfToken: "csrf-mail" }), marksGet: () => Response.json({ marks: [] }), marksPost: () => Response.json({ saved: 1 }), ...answers };
  // The component reads the body of every answer; this makes that moment visible to the test.
  const watched = (response: Response, into: Promise<void>[]): Response => {
    const read = response.json.bind(response);
    into.push(new Promise<void>((done) => { response.json = async () => { try { return await read(); } finally { done(); } }; }));
    return response;
  };
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    calls.push({ url, method, csrf: new Headers(init.headers).get("X-CSRF-Token"), body: typeof init.body === "string" ? JSON.parse(init.body) : null });
    // A 401 from the Director route is followed by the account route (sessionResponse); only the answer the component reads is watched.
    if (url === "/api/director/session") { const answer = await all.session(); return answer.status === 401 ? answer : watched(answer, sessionReads); }
    if (url === "/api/access/session") return watched(await all.session(), sessionReads);
    if (url.startsWith("/api/director/marks")) return watched(await (method === "POST" ? all.marksPost() : all.marksGet()), reads);
    return Response.json({ error: "unexpected" }, { status: 404 });
  });
  const gets = () => calls.filter((call) => call.url.startsWith("/api/director/marks") && call.method === "GET");
  const posts = () => calls.filter((call) => call.method === "POST");
  // After the last body is read only promise steps remain, so a fixed run of them is a complete drain, not a wait.
  const drain = () => act(async () => { for (let step = 0; step < 50; step += 1) await Promise.resolve(); });
  const sessionAsked = () => waitFor(() => expect(calls.some((call) => call.url === "/api/director/session")).toBe(true));
  async function sessionReady() {
    await sessionAsked();
    await Promise.all(sessionReads);
    await drain();
  }
  async function loaded() {
    await sessionAsked();
    await waitFor(() => expect(gets().length).toBeGreaterThan(0));
    await Promise.all(sessionReads);
    // An upload or a retry started by the load adds its own answer to read, so look again until nothing new appears.
    for (;;) {
      const seen = reads.length;
      await Promise.all(reads);
      await drain();
      if (reads.length === seen) break;
    }
  }
  return { calls, gets, posts, loaded, sessionReady, sessionAsked };
}

const select = (akun: string) => screen.getByLabelText<HTMLSelectElement>(`Ubah penanganan: ${akun}`);
const setBrowser = (value: Record<string, string>) => window.localStorage.setItem(KEY, JSON.stringify(value));
const stored = (): Record<string, string> | null => JSON.parse(window.localStorage.getItem(KEY) ?? "null");
const marks = (...entries: [string, string][]) => ({ marks: entries.map(([key, value]) => ({ key, value })) });

beforeEach(() => window.localStorage.clear());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Email handling status kept on the server", () => {
  it("shows the server value for a mailbox even when the browser says something else, and caches it", async () => {
    setBrowser({ [HAI]: "eskalasi" });
    const server = stubServer({ marksGet: () => Response.json(marks([HAI, "destri"])) });
    render(<EmailTriageTable date={DATE} accounts={ACCOUNTS} />);
    await waitFor(() => expect(select(HAI).value).toBe("destri"));
    expect(select(YAHOO).value).toBe("belum");
    expect(server.gets()[0].url).toBe(`/api/director/marks?scope=email_handling&date=${DATE}`);
    expect(server.posts()).toHaveLength(0);
    expect(stored()).toMatchObject({ [HAI]: "destri" });
  });

  it("shows browser-only values and uploads them in one request, hospital mailboxes only", async () => {
    setBrowser({ [HAI]: "eskalasi", [YAHOO]: "belum", [PERSONAL]: "destri" });
    const server = stubServer();
    render(<EmailTriageTable date={DATE} accounts={ACCOUNTS} />);
    await waitFor(() => expect(select(HAI).value).toBe("eskalasi"));
    await server.loaded();
    expect(screen.queryByLabelText(`Ubah penanganan: ${PERSONAL}`)).toBeNull();
    expect(server.posts()).toHaveLength(1);
    const [post] = server.posts();
    expect(post.url).toBe("/api/director/marks");
    expect(post.csrf).toBe("csrf-mail");
    expect(post.body).toEqual({ scope: "email_handling", date: DATE, items: [{ key: HAI, value: "eskalasi" }, { key: YAHOO, value: "belum" }] });
    expect(screen.queryByText(SAVE_FAILED)).toBeNull();
  });

  it("sends one request with the mailbox and the value when the status changes, and writes the browser copy", async () => {
    const server = stubServer();
    render(<EmailTriageTable date={DATE} accounts={ACCOUNTS} />);
    await server.loaded();
    fireEvent.change(select(YAHOO), { target: { value: "destri" } });
    expect(select(YAHOO).value).toBe("destri");
    expect(stored()).toMatchObject({ [YAHOO]: "destri" });
    await waitFor(() => expect(server.posts()).toHaveLength(1));
    const [post] = server.posts();
    expect(post.method).toBe("POST");
    expect(post.csrf).toBe("csrf-mail");
    expect(post.body).toEqual({ scope: "email_handling", date: DATE, items: [{ key: YAHOO, value: "destri" }] });
    expect(screen.queryByText(SAVE_FAILED)).toBeNull();
  });

  it("shows the unsaved line when a save answers 503 and removes it after the next successful save", async () => {
    let failing = true;
    const server = stubServer({ marksPost: () => (failing ? Response.json({ error: "Layanan belum tersedia." }, { status: 503 }) : Response.json({ saved: 1 })) });
    render(<EmailTriageTable date={DATE} accounts={ACCOUNTS} />);
    await server.loaded();
    fireEvent.change(select(HAI), { target: { value: "eskalasi" } });
    const line = await screen.findByRole("status");
    expect(line.textContent).toBe(SAVE_FAILED);
    expect(select(HAI).value).toBe("eskalasi");
    failing = false;
    fireEvent.change(select(HAI), { target: { value: "destri" } });
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(server.posts()).toHaveLength(2);
  });

  it("keeps working from the browser copy and uploads nothing when the marks read answers 503", async () => {
    setBrowser({ [HAI]: "destri" });
    const server = stubServer({ marksGet: () => Response.json({ error: "Layanan belum tersedia." }, { status: 503 }) });
    render(<EmailTriageTable date={DATE} accounts={ACCOUNTS} />);
    await server.loaded();
    expect(select(HAI).value).toBe("destri");
    expect(screen.queryByRole("status")).toBeNull();
    expect(server.posts()).toHaveLength(0);
    fireEvent.change(select(YAHOO), { target: { value: "eskalasi" } });
    await waitFor(() => expect(server.posts()).toHaveLength(1));
    expect(server.posts()[0].body?.items).toEqual([{ key: YAHOO, value: "eskalasi" }]);
  });

  it("ignores server marks for mailboxes that are not shown and values outside the three", async () => {
    setBrowser({ [YAHOO]: "eskalasi" });
    const server = stubServer({ marksGet: () => Response.json(marks([HAI, "destri"], [PERSONAL, "destri"], ["melinda.lain@x.id", "eskalasi"], [YAHOO, "selesai"])) });
    render(<EmailTriageTable date={DATE} accounts={ACCOUNTS} />);
    await waitFor(() => expect(select(HAI).value).toBe("destri"));
    expect(select(YAHOO).value).toBe("eskalasi");
    expect(screen.queryByLabelText(`Ubah penanganan: ${PERSONAL}`)).toBeNull();
    expect(server.posts()).toHaveLength(0);
    expect(Object.keys(stored() ?? {}).sort()).toEqual([HAI, YAHOO].sort());
    expect(JSON.stringify(stored())).not.toContain("selesai");
  });

  it("keeps a change made while the marks read is still pending", async () => {
    let release: (response: Response) => void = () => {};
    const server = stubServer({ marksGet: () => new Promise<Response>((resolve) => { release = resolve; }) });
    render(<EmailTriageTable date={DATE} accounts={ACCOUNTS} />);
    await waitFor(() => expect(server.gets()).toHaveLength(1));
    await server.sessionReady();
    fireEvent.change(select(HAI), { target: { value: "eskalasi" } });
    await waitFor(() => expect(server.posts()).toHaveLength(1));
    release(Response.json(marks([HAI, "belum"], [YAHOO, "destri"])));
    await waitFor(() => expect(select(YAHOO).value).toBe("destri"));
    expect(select(HAI).value).toBe("eskalasi");
  });

  it("treats a save as failed and uploads nothing when the session cannot be read", async () => {
    setBrowser({ [HAI]: "destri" });
    const server = stubServer({ session: () => Response.json({ error: "Sesi berakhir." }, { status: 401 }) });
    render(<EmailTriageTable date={DATE} accounts={ACCOUNTS} />);
    await server.loaded();
    expect(select(HAI).value).toBe("destri");
    expect(server.posts()).toHaveLength(0);
    fireEvent.change(select(YAHOO), { target: { value: "destri" } });
    expect((await screen.findByRole("status")).textContent).toBe(SAVE_FAILED);
    expect(server.posts()).toHaveLength(0);
  });

  it("caches no default: with nothing in the browser or on the server nothing is stored or uploaded, on the first or the next load", async () => {
    const first = stubServer();
    const view = render(<EmailTriageTable date={DATE} accounts={ACCOUNTS} />);
    await first.loaded();
    expect(select(HAI).value).toBe("belum");
    expect(Object.keys(stored() ?? {})).toEqual([]);
    expect(first.posts()).toHaveLength(0);
    view.unmount();

    const second = stubServer();
    render(<EmailTriageTable date={DATE} accounts={ACCOUNTS} />);
    await second.loaded();
    expect(second.gets()).toHaveLength(1);
    expect(second.posts()).toHaveLength(0);
  });

  it("does not let a mailbox the server would refuse block the upload of the others", async () => {
    const tooLong = `melinda${"x".repeat(123)}`;
    expect(tooLong).toHaveLength(130);
    setBrowser({ [HAI]: "destri", [tooLong]: "eskalasi" });
    const server = stubServer();
    render(<EmailTriageTable date={DATE} accounts={[account(HAI), account(tooLong)]} />);
    await server.loaded();
    expect(server.posts()).toHaveLength(1);
    expect(server.posts()[0].body).toEqual({ scope: "email_handling", date: DATE, items: [{ key: HAI, value: "destri" }] });
    expect(select(tooLong).value).toBe("eskalasi");
  });

  it("shows no line when the upload on load answers 503", async () => {
    setBrowser({ [HAI]: "destri" });
    const server = stubServer({ marksPost: () => Response.json({ error: "Layanan belum tersedia." }, { status: 503 }) });
    render(<EmailTriageTable date={DATE} accounts={ACCOUNTS} />);
    await server.loaded();
    expect(server.posts()).toHaveLength(1);
    expect(screen.queryByRole("status")).toBeNull();
    expect(select(HAI).value).toBe("destri");
  });

  it("clears the unsaved line and the changed mailboxes when the date changes", async () => {
    const server = stubServer({ marksGet: () => Response.json(marks([HAI, "destri"])), marksPost: () => Response.json({ error: "Layanan belum tersedia." }, { status: 503 }) });
    const view = render(<EmailTriageTable date={DATE} accounts={ACCOUNTS} />);
    await server.loaded();
    fireEvent.change(select(HAI), { target: { value: "eskalasi" } });
    expect((await screen.findByRole("status")).textContent).toBe(SAVE_FAILED);
    view.rerender(<EmailTriageTable date="2026-11-13" accounts={ACCOUNTS} />);
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    await waitFor(() => expect(select(HAI).value).toBe("destri"));
    expect(server.gets().map((call) => call.url)).toEqual([`/api/director/marks?scope=email_handling&date=${DATE}`, "/api/director/marks?scope=email_handling&date=2026-11-13"]);
  });

  it("lets only the latest save decide the unsaved line, and ignores a save from an earlier date", async () => {
    let held: (response: Response) => void = () => {};
    let posted = 0;
    const server = stubServer({
      marksPost: () => {
        posted += 1;
        return posted === 1 ? new Promise<Response>((resolve) => { held = resolve; }) : Response.json({ saved: 1 });
      },
    });
    const view = render(<EmailTriageTable date={DATE} accounts={ACCOUNTS} />);
    await server.loaded();
    fireEvent.change(select(HAI), { target: { value: "destri" } });
    await waitFor(() => expect(server.posts()).toHaveLength(1));
    fireEvent.change(select(YAHOO), { target: { value: "eskalasi" } });
    await waitFor(() => expect(server.posts()).toHaveLength(2));
    await act(async () => { for (let step = 0; step < 50; step += 1) await Promise.resolve(); });
    held(Response.json({ error: "Layanan belum tersedia." }, { status: 503 }));
    await act(async () => { for (let step = 0; step < 50; step += 1) await Promise.resolve(); });
    await waitFor(() => expect(posted).toBe(2));
    expect(screen.queryByRole("status")).toBeNull();

    // A save issued for one date does not set the line once the table shows another date.
    let late: (response: Response) => void = () => {};
    const other = stubServer({ marksPost: () => new Promise<Response>((resolve) => { late = resolve; }) });
    view.rerender(<EmailTriageTable date="2026-11-13" accounts={ACCOUNTS} />);
    await other.sessionReady();
    fireEvent.change(select(HAI), { target: { value: "eskalasi" } });
    await waitFor(() => expect(other.posts()).toHaveLength(1));
    view.rerender(<EmailTriageTable date="2026-11-14" accounts={ACCOUNTS} />);
    late(Response.json({ error: "Layanan belum tersedia." }, { status: 503 }));
    await act(async () => { for (let step = 0; step < 50; step += 1) await Promise.resolve(); });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("sends a change made before the session answer once the token arrives, with no unsaved line", async () => {
    let release: (response: Response) => void = () => {};
    const server = stubServer({ session: () => new Promise<Response>((resolve) => { release = resolve; }) });
    render(<EmailTriageTable date={DATE} accounts={ACCOUNTS} />);
    await server.sessionAsked();
    fireEvent.change(select(YAHOO), { target: { value: "destri" } });
    expect(select(YAHOO).value).toBe("destri");
    expect(stored()).toMatchObject({ [YAHOO]: "destri" });
    expect(server.posts()).toHaveLength(0);
    expect(screen.queryByRole("status")).toBeNull();
    release(Response.json({ csrfToken: "csrf-late" }));
    await waitFor(() => expect(server.posts()).toHaveLength(1));
    await server.loaded();
    expect(server.posts()).toHaveLength(1);
    expect(server.posts()[0].csrf).toBe("csrf-late");
    expect(server.posts()[0].body).toEqual({ scope: "email_handling", date: DATE, items: [{ key: YAHOO, value: "destri" }] });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("does not let a change waiting for the session set the line on the next date", async () => {
    let release: (response: Response) => void = () => {};
    let asked = 0;
    const server = stubServer({
      session: () => { asked += 1; return asked === 1 ? new Promise<Response>((resolve) => { release = resolve; }) : Response.json({ csrfToken: "csrf-next" }); },
      marksPost: () => Response.json({ error: "Layanan belum tersedia." }, { status: 503 }),
    });
    const view = render(<EmailTriageTable date={DATE} accounts={ACCOUNTS} />);
    await server.sessionAsked();
    fireEvent.change(select(HAI), { target: { value: "eskalasi" } });
    view.rerender(<EmailTriageTable date="2026-11-13" accounts={ACCOUNTS} />);
    await waitFor(() => expect(asked).toBe(2));
    await server.sessionReady();
    release(Response.json({ csrfToken: "csrf-old" }));
    await waitFor(() => expect(server.posts()).toHaveLength(1));
    await server.loaded();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows the empty sentence and makes no request when there is no hospital mailbox", async () => {
    vi.useFakeTimers();
    try {
      const server = stubServer();
      render(<EmailTriageTable date={DATE} accounts={[account(PERSONAL)]} />);
      expect(screen.getByText("Tidak ada kotak surat rumah sakit dalam brief ini.")).toBeTruthy();
      await vi.runAllTimersAsync();
      expect(server.calls).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
