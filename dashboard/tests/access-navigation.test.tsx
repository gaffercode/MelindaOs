// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DirectorShell } from "@/components/director/director-shell";
import { KredensialView } from "@/components/kredensial/kredensial-view";
import { DirectorSession } from "@/components/director/director-session";
import type { KredensialDocument } from "@/lib/kredensial/kredensial-data";
import { directorCsrfHeaders, sessionResponse } from "@/lib/client-api";
import { allowedPages, ROLE_LABELS, type Role } from "@/lib/access/access-control";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/" }));

const PRINCIPAL_BASE = { kind: "account", mustChange: false } as const;
const shell = (role: Role, displayName = "Dewi Sari", extra: { authenticated?: boolean } = {}) => render(
  <DirectorShell date="2026-11-12" pending={null} authenticated={extra.authenticated ?? true} principal={{ ...PRINCIPAL_BASE, role, displayName }} allowedPages={allowedPages({ role, mustChange: false })}>
    <p>isi halaman</p>
  </DirectorShell>
);
const sidebarHrefs = () => within(screen.getAllByRole("navigation", { name: "Navigasi utama" })[0]).queryAllByRole("link").map((link) => link.getAttribute("href"));

beforeEach(() => {
  // jsdom has no layout engine; the sidebar rail only measures rows.
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("role-aware navigation", () => {
  it("hides Director-only entries from the vice director and shows the role label", () => {
    shell("VICE_DIRECTOR");
    const hrefs = sidebarHrefs();
    for (const hidden of ["/studio", "/melinda", "/arahan", "/pengguna"]) expect(hrefs).not.toContain(hidden);
    expect(hrefs).toContain("/hrd");
    expect(screen.getAllByText(ROLE_LABELS.VICE_DIRECTOR).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Dewi Sari").length).toBeGreaterThan(0);
    expect(screen.getByText("Review laporan")).not.toBeNull();
  });

  it("hides the instruction button from the vice director, and the review link from HR", () => {
    shell("VICE_DIRECTOR");
    expect(screen.queryByRole("button", { name: "Arahan" })).toBeNull();
    cleanup();
    shell("STAFF_HR");
    expect(screen.queryByText("Review laporan")).toBeNull();
  });

  it("lists only the HR page and the workspace for HR staff", () => {
    shell("STAFF_HR");
    expect(sidebarHrefs().sort()).toEqual(["/hrd", "/ruang-kerja"]);
    expect(screen.queryByText("Direktur")).toBeNull();
  });

  it("tells every signed-in user that this is a beta build, with its version", () => {
    shell("STAFF_HR");
    expect(screen.getAllByText(/Versi beta \d+\.\d+\.\d+ · masih dalam uji coba/).length).toBeGreaterThan(0);
  });

  it("gives the Director a Pengguna link", () => {
    render(<DirectorShell date="2026-11-12" pending={null} authenticated principal={{ kind: "director", role: "DIRECTOR", displayName: "Direktur", mustChange: false }} allowedPages={allowedPages({ role: "DIRECTOR", mustChange: false })}><p>isi</p></DirectorShell>);
    expect(screen.getAllByRole("link", { name: /Pengguna$/ })[0].getAttribute("href")).toBe("/pengguna");
    expect(sidebarHrefs()).toContain("/arahan");
    expect(screen.getByRole("button", { name: "Arahan" })).not.toBeNull();
  });

  it("gives the Director an Isian dokumen link, and no one else", () => {
    render(<DirectorShell date="2026-11-12" pending={null} authenticated principal={{ kind: "director", role: "DIRECTOR", displayName: "Direktur", mustChange: false }} allowedPages={allowedPages({ role: "DIRECTOR", mustChange: false })}><p>isi</p></DirectorShell>);
    expect(screen.getAllByRole("link", { name: /Isian dokumen$/ })[0].getAttribute("href")).toBe("/isian-dokumen");
    cleanup();
    shell("VICE_DIRECTOR");
    expect(sidebarHrefs()).not.toContain("/isian-dokumen");
  });

  it("renders the bell only for roles that may open the instruction page", () => {
    shell("VICE_DIRECTOR");
    expect(screen.queryByRole("link", { name: /Papan tugas Direktur|menunggu keputusan Direktur/ })).toBeNull();
    cleanup();
    shell("STAFF_HR");
    expect(screen.queryByRole("link", { name: /Papan tugas Direktur|menunggu keputusan Direktur/ })).toBeNull();
    cleanup();
    render(<DirectorShell date="2026-11-12" pending={null} authenticated principal={{ kind: "director", role: "DIRECTOR", displayName: "Direktur", mustChange: false }} allowedPages={allowedPages({ role: "DIRECTOR", mustChange: false })}><p>isi</p></DirectorShell>);
    expect(screen.getByRole("link", { name: /Papan tugas Direktur|menunggu keputusan Direktur/ })).not.toBeNull();
  });

  it("keeps staff without executive access off the dashboard, search and refresh controls", () => {
    shell("STAFF_HR");
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.queryByLabelText("Cari knowledge canonical")).toBeNull();
    expect(screen.queryByRole("button", { name: "Perbarui laporan harian" })).toBeNull();
    expect(within(screen.getByRole("navigation", { name: "Breadcrumb" })).queryAllByRole("link")).toHaveLength(0);
    cleanup();
    shell("VICE_DIRECTOR");
    expect(screen.getByLabelText("Cari knowledge canonical")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Perbarui laporan harian" })).not.toBeNull();
    expect(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByRole("link", { name: "Dashboard" })).not.toBeNull();
  });

  it("keeps today's navigation when allowedPages is not passed", () => {
    render(<DirectorShell date="2026-11-12" pending={null} authenticated><p>isi</p></DirectorShell>);
    const hrefs = sidebarHrefs();
    for (const shown of ["/studio", "/melinda", "/arahan", "/hrd"]) expect(hrefs).toContain(shown);
    expect(hrefs).not.toContain("/pengguna");
    expect(screen.getByText("dr. Ferdi Andriska, S.H., M.Kn., CMDC")).not.toBeNull();
    expect(screen.queryByText("Review laporan")).not.toBeNull();
  });

  it("hides the kredensial instruction button without the arahan page", () => {
    const doc: KredensialDocument = { id: "DOC-A", filename: "a.pdf", rel_path: "01/a.pdf", url: "/kredensial/a.pdf", cat_id: "01", cat_name: "Persyaratan Mutlak", subfolder: "", subfolder_label: "", title: "Surat izin uji", doc_num: "A", pic: "Direktur", badge: "01", ext: "pdf", size_kb: 1 };
    const props = { authenticated: true, categories: [{ id: "ALL", name: "Semua Dokumen", badge: "1", count: 1 }], documents: [doc] };
    render(<KredensialView {...props} allowedPages={allowedPages({ role: "VICE_DIRECTOR", mustChange: false })} />);
    expect(screen.queryByRole("button", { name: "Arahan" })).toBeNull();
    cleanup();
    render(<KredensialView {...props} allowedPages={allowedPages({ role: "DIRECTOR", mustChange: false })} />);
    expect(screen.getByRole("button", { name: "Arahan" })).not.toBeNull();
  });
});

describe("session response for the CSRF token", () => {
  const reply = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });
  it("uses the Director session when it answers, without a second call", async () => {
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () => reply(200, { csrfToken: "director-token" }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await sessionResponse();
    expect((await response.json() as { csrfToken: string }).csrfToken).toBe("director-token");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/director/session");
  });
  it("falls back to the access session on a 401 and returns the account token", async () => {
    const fetchMock = vi.fn(async (url: string) => url === "/api/director/session" ? reply(401) : reply(200, { csrfToken: "account-token" }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await sessionResponse();
    expect((await response.json() as { csrfToken: string }).csrfToken).toBe("account-token");
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["/api/director/session", "/api/access/session"]);
  });
  it("returns the 401 when neither session answers, so callers treat it as signed out", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(401)));
    expect((await sessionResponse()).status).toBe(401);
  });
  it("does not fall back on other failures", async () => {
    const fetchMock = vi.fn(async () => reply(503));
    vi.stubGlobal("fetch", fetchMock);
    expect((await sessionResponse()).status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("gives CSRF headers for an account through the fallback", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url === "/api/director/session" ? reply(401) : reply(200, { csrfToken: "account-token" })));
    expect(await directorCsrfHeaders()).toEqual({ "X-CSRF-Token": "account-token" });
  });
});

describe("DirectorSession sign out", () => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  function stubFetch() {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => init?.method === "DELETE" ? json({ ok: true }) : json({ csrfToken: "tok" }));
    vi.stubGlobal("fetch", fetchMock);
    const assign = vi.fn();
    vi.stubGlobal("location", { origin: "http://localhost", assign });
    return { fetchMock, assign };
  }

  it("signs an account out through the access session route", async () => {
    const { fetchMock, assign } = stubFetch();
    render(<DirectorSession kind="account" />);
    fireEvent.click(screen.getByRole("button", { name: "Keluar" }));
    await waitFor(() => expect(assign).toHaveBeenCalled());
    expect(fetchMock.mock.calls.map(([url, init]) => `${init?.method ?? "GET"} ${url}`)).toEqual(["GET /api/access/session", "DELETE /api/access/session"]);
    expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get("X-CSRF-Token")).toBe("tok");
  });

  it("keeps the Director on the Director session route", async () => {
    const { fetchMock, assign } = stubFetch();
    render(<DirectorSession />);
    fireEvent.click(screen.getByRole("button", { name: "Keluar" }));
    await waitFor(() => expect(assign).toHaveBeenCalled());
    expect(fetchMock.mock.calls.map(([url, init]) => `${init?.method ?? "GET"} ${url}`)).toEqual(["GET /api/director/session", "DELETE /api/director/session"]);
  });
});
