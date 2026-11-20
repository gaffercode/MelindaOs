// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StaffWorkspace } from "@/components/staff-workspace";
import { allowedPages, ROLE_LABELS, type Role } from "@/lib/access/access-control";
import { fetchAsk, fetchSearch } from "@/lib/client-api";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/client-api", () => ({ fetchAsk: vi.fn(), fetchSearch: vi.fn() }));

beforeEach(() => {
  // jsdom has no layout engine; the AI status badge only measures itself.
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const open = (role: Role, displayName = "Dewi Sari") => render(
  <StaffWorkspace principal={{ kind: "account", role, displayName, mustChange: false }} allowedPages={allowedPages({ role, mustChange: false })} />
);
const hrefs = () => screen.getAllByRole("link").map((link) => link.getAttribute("href"));

describe("staff workspace", () => {
  it("greets the person with the role label", () => {
    open("STAFF_FINANCE");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Dewi Sari");
    expect(screen.getByText(ROLE_LABELS.STAFF_FINANCE)).not.toBeNull();
  });

  it("shows only the casemix card for finance staff", () => {
    open("STAFF_FINANCE");
    expect(hrefs()).toContain("/casemix");
    for (const hidden of ["/hrd", "/crm", "/order-obat", "/ruang-kerja"]) expect(hrefs()).not.toContain(hidden);
    expect(screen.getByRole("link", { name: /Casemix Simulator/ })).not.toBeNull();
  });

  it("shows pharmacy and STARKES cards for operations staff", () => {
    open("STAFF_OPS");
    for (const shown of ["/order-obat", "/formularium", "/starkes"]) expect(hrefs()).toContain(shown);
  });

  it("lists the password page only as the footer link, not as a module card", () => {
    open("STAFF_HR");
    expect(hrefs().filter((href) => href === "/ganti-password")).toHaveLength(1);
    expect(screen.getByRole("list").querySelector('a[href="/ganti-password"]')).toBeNull();
  });

  it("shows answer sources as plain text without links to the knowledge page", async () => {
    vi.mocked(fetchAsk).mockResolvedValue({ status: "answered", answer: "Cuci tangan enam langkah.", sources: [{ docId: "SPO-1", title: "SPO Cuci Tangan", heading: "Langkah", path: "a/b.md" }] });
    open("STAFF_SUPPORT");
    fireEvent.change(screen.getByLabelText("Pertanyaan untuk Tanya Melinda"), { target: { value: "cuci tangan" } });
    fireEvent.submit(screen.getByLabelText("Pertanyaan untuk Tanya Melinda").closest("form")!);
    await waitFor(() => expect(screen.getByText("SPO Cuci Tangan › Langkah")).not.toBeNull());
    expect(hrefs().some((href) => href?.startsWith("/knowledge"))).toBe(false);
  });

  it("links to the password page", () => {
    open("STAFF_HR");
    expect(screen.getByText("Ganti password").closest("a")?.getAttribute("href")).toBe("/ganti-password");
  });

  it("offers Tanya Melinda and a document search that lists results", async () => {
    vi.mocked(fetchSearch).mockResolvedValue([{ title: "SPO Cuci Tangan", snippet: "Enam langkah.", path: "a/b.md", docId: "SPO-1", category: "A", match: "full" } as never]);
    open("STAFF_SUPPORT");
    expect(screen.getByRole("heading", { name: "Tanya Melinda" })).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Kata kunci dokumen"), { target: { value: "cuci tangan" } });
    fireEvent.submit(screen.getByLabelText("Kata kunci dokumen").closest("form")!);
    await waitFor(() => expect(screen.getByText("SPO Cuci Tangan")).not.toBeNull());
    expect(fetchSearch).toHaveBeenCalledWith("cuci tangan");
  });
});
