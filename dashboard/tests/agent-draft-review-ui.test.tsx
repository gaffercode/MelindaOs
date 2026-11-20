// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, fireEvent, render as mount, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentDraftPanel, AgentDraftReview, type AgentDraftPanelProps } from "@/components/agents/agent-draft-review";
import type { AgentDraft, AgentDraftSummary } from "@/lib/agent/agent-draft-review-api";

const summary = (id: string, title: string, producer: string, category: "A" | "B" | "C", status: AgentDraftSummary["status"] = "submitted"): AgentDraftSummary => ({
  id, producer, title, category, docId: null, domain: null, department: null, note: null, source: null, status,
  receivedAt: "2026-11-10T03:15:00.000Z", reviewedAt: null, reviewNote: null,
});
const first = summary("11111111-1111-4111-8111-111111111111", "SOP cuci tangan", "Agent Klinis", "A");
const second = summary("22222222-2222-4222-8222-222222222222", "Skema formularium", "Agent Farmasi", "C");
const base: AgentDraftPanelProps = {
  pending: [first, second], accepted: [], selected: null, reason: "", busy: false, loading: false, error: "", message: "",
  onSelect: vi.fn(), onReason: vi.fn(), onDecide: vi.fn(), onReload: vi.fn(),
};
const render = (overrides: Partial<AgentDraftPanelProps> = {}) => renderToStaticMarkup(AgentDraftPanel({ ...base, ...overrides }));
const draft = (content: string): AgentDraft => ({ ...first, content });

describe("agent draft review panel", () => {
  it("explains what accepting means", () => {
    const html = render();
    expect(html).toContain("Draf dari agent");
    expect(html).toContain("Diterima berarti siap diunduh untuk dimasukkan ke handbook. Dokumen baru berlaku setelah lolos pemeriksaan format.");
  });
  it("lists pending drafts with producer and category, or an empty line", () => {
    const html = render();
    for (const text of ["SOP cuci tangan", "Agent Klinis", "Kategori A", "Skema formularium", "Agent Farmasi", "Kategori C"]) expect(html).toContain(text);
    expect(render({ pending: [] })).toContain("Tidak ada draf yang menunggu.");
  });
  it("renders draft content as escaped text", () => {
    const html = render({ selected: draft("<script>alert(1)</script>\n# Judul") });
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
  it("blocks rejecting without a reason and while busy", () => {
    const tolak = (html: string) => html.match(/<button[^>]*>Tolak<\/button>/)?.[0] ?? "";
    const terima = (html: string) => html.match(/<button[^>]*>Terima<\/button>/)?.[0] ?? "";
    expect(tolak(render({ selected: draft("x"), reason: "" }))).toContain("disabled");
    expect(tolak(render({ selected: draft("x"), reason: "   " }))).toContain("disabled");
    expect(tolak(render({ selected: draft("x"), reason: "x" }))).not.toContain("disabled");
    expect(terima(render({ selected: draft("x"), reason: "x" }))).not.toContain("disabled");
    const busy = render({ selected: draft("x"), reason: "x", busy: true });
    expect(tolak(busy)).toContain("disabled");
    expect(terima(busy)).toContain("disabled");
    expect(render({ selected: draft("x") })).toContain('maxLength="1000"');
  });
  it("links accepted drafts to the download route", () => {
    const accepted = summary("33333333-3333-4333-8333-333333333333", "SOP triase", "Agent Klinis", "A", "accepted");
    expect(render({ accepted: [accepted] })).toContain('href="/api/director/agent-drafts/33333333-3333-4333-8333-333333333333/unduh"');
  });
  it("uses the spec headings for the two lists", () => {
    const html = render();
    expect(html).toContain("<h3>Menunggu tinjauan</h3>");
    expect(html).toContain("<h3>Sudah diterima</h3>");
    expect(html).not.toContain("Draf menunggu keputusan");
    expect(html).not.toContain("Draf yang sudah diterima");
  });
  it("labels the metadata of the selected draft and omits what is missing", () => {
    const full = render({ selected: { ...draft("x"), docId: "SPO-001", domain: "Keperawatan", department: "IGD" } });
    expect(full).toContain("Agent Klinis · Kategori A · Dokumen: SPO-001 · Bidang: Keperawatan · Unit: IGD");
    const partial = render({ selected: { ...draft("x"), domain: "Keperawatan" } });
    expect(partial).toContain("Agent Klinis · Kategori A · Bidang: Keperawatan<");
    expect(partial).not.toContain("Dokumen:");
    expect(partial).not.toContain("Unit:");
  });
  it("titles the selected draft with an h4 under the Isi draf heading", () => {
    const html = render({ selected: draft("x") });
    expect(html).toContain("<h4>SOP cuci tangan</h4>");
    expect(html).toContain("<h3>Isi draf</h3>");
    expect(html.match(/<h3>SOP cuci tangan<\/h3>/)).toBeNull();
  });
  it("shows a failure as an alert without losing the panel", () => {
    const html = render({ error: "Draf dari agent belum tersedia." });
    expect(html).toMatch(/role="alert"[^>]*>Draf dari agent belum tersedia\./);
    expect(html).toContain("<h2>Draf dari agent</h2>");
    expect(html).toContain("SOP cuci tangan");
  });
  it("shows only the heading, the explanation, the alert and reload when the load failed with nothing to list", () => {
    const html = render({ error: "Draf dari agent belum tersedia.", pending: [], accepted: [] });
    expect(html).toContain("<h2>Draf dari agent</h2>");
    expect(html).toContain("Diterima berarti siap diunduh");
    expect(html).toMatch(/role="alert"[^>]*>Draf dari agent belum tersedia\./);
    expect(html).toContain("Muat ulang draf");
    for (const absent of ["Menunggu tinjauan", "Sudah diterima", "Isi draf", "Tidak ada draf yang menunggu.", "Belum ada draf yang diterima."]) expect(html).not.toContain(absent);
  });
  it("keeps the lists when the failure comes with rows, and the empty lines when there is no failure", () => {
    expect(render({ error: "x", pending: [first], accepted: [] })).toContain("Menunggu tinjauan");
    expect(render({ error: "x", pending: [], accepted: [summary("33333333-3333-4333-8333-333333333333", "SOP triase", "Agent Klinis", "A", "accepted")] })).toContain("Sudah diterima");
    expect(render({ pending: [], accepted: [] })).toContain("Tidak ada draf yang menunggu.");
  });
  it("announces the message with role status", () => {
    expect(render({ message: "Draf diterima." })).toMatch(/role="status"[^>]*>Draf diterima\./);
  });
  it("shows the loading state instead of the lists", () => {
    const html = render({ loading: true });
    expect(html).toContain("Memuat draf");
    expect(html).not.toContain("SOP cuci tangan");
  });
});

describe("agent draft review screen", () => {
  type Route = (url: string, init: RequestInit | undefined) => Response | Promise<Response>;
  const draftUrl = (id: string) => `/api/director/agent-drafts/${id}`;
  const rows = [first, second];
  function serve(overrides: Record<string, Route> = {}) {
    const routes: Record<string, Route> = {
      "/api/director/session": () => Response.json({ csrfToken: "csrf" }),
      "/api/director/agent-drafts?status=submitted": () => Response.json({ submissions: rows }),
      "/api/director/agent-drafts?status=accepted": () => Response.json({ submissions: [] }),
      [draftUrl(first.id)]: (_url, init) => init?.method === "POST" ? Response.json({ submission: { ...first, content: "isi", status: "accepted" }, replayed: false }) : Response.json({ submission: { ...first, content: "isi pertama" } }),
      [draftUrl(second.id)]: () => Response.json({ submission: { ...second, content: "isi kedua" } }),
      ...overrides,
    };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const route = routes[url];
      if (!route) throw new Error(`unexpected request ${url}`);
      return route(url, init);
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  async function open(title: string) {
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(title) }));
    await screen.findByRole("button", { name: "Terima" });
  }

  it("confirms an accepted decision", async () => {
    serve();
    mount(<AgentDraftReview />);
    await open("SOP cuci tangan");
    fireEvent.click(screen.getByRole("button", { name: "Terima" }));
    expect((await screen.findByRole("status")).textContent).toBe("Draf diterima. Unduh berkasnya di daftar di bawah.");
    expect(screen.queryByRole("button", { name: "Terima" })).toBeNull();
  });

  it("says the draft was already decided when the server reports a replay, and still reloads", async () => {
    const fetchMock = serve({ [draftUrl(first.id)]: (_url, init) => init?.method === "POST" ? Response.json({ submission: { ...first, content: "isi", status: "accepted" }, replayed: true }) : Response.json({ submission: { ...first, content: "isi pertama" } }) });
    mount(<AgentDraftReview />);
    await open("SOP cuci tangan");
    fireEvent.click(screen.getByRole("button", { name: "Terima" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Draf ini sudah diputuskan."));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Terima" })).toBeNull());
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/director/agent-drafts?status=submitted")).toHaveLength(2);
  });

  it("treats a decision answer without a boolean replayed as a failure", async () => {
    serve({ [draftUrl(first.id)]: (_url, init) => init?.method === "POST" ? Response.json({ submission: { ...first, content: "isi", status: "accepted" } }) : Response.json({ submission: { ...first, content: "isi pertama" } }) });
    mount(<AgentDraftReview />);
    await open("SOP cuci tangan");
    fireEvent.click(screen.getByRole("button", { name: "Terima" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Draf dari agent belum tersedia.");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("clears the open draft as soon as another one is chosen, so its buttons cannot be used while the next loads", async () => {
    serve({ [draftUrl(second.id)]: () => new Promise<Response>(() => undefined) });
    mount(<AgentDraftReview />);
    await open("SOP cuci tangan");
    expect(screen.getByText("isi pertama")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Skema formularium/ }));
    expect(screen.queryByRole("button", { name: "Terima" })).toBeNull();
    expect(screen.queryByText("isi pertama")).toBeNull();
    expect(screen.getByText("Pilih draf untuk membaca isinya.")).toBeTruthy();
  });

  it("clears the open draft when a reload fails", async () => {
    let healthy = true;
    serve({ "/api/director/session": () => healthy ? Response.json({ csrfToken: "csrf" }) : Response.json({ error: "Draf dari agent belum tersedia." }, { status: 503 }) });
    mount(<AgentDraftReview />);
    await open("SOP cuci tangan");
    healthy = false;
    fireEvent.click(screen.getByRole("button", { name: "Muat ulang draf" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Draf dari agent belum tersedia.");
    expect(screen.queryByRole("button", { name: "Terima" })).toBeNull();
    expect(screen.queryByText("isi pertama")).toBeNull();
  });
});
