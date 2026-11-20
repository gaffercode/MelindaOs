// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HrdEditor, formatUpdatedAt } from "@/components/hrd/hrd-editor";
import { parseDirectory } from "@/lib/hrd/hrd-directory";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/client-api", () => ({ directorCsrfHeaders: async () => ({ "X-CSRF-Token": "csrf-test" }) }));

const sample = parseDirectory(JSON.parse(readFileSync(join(process.cwd(), "data", "synthetic", "hrd-directory.json"), "utf8")))!;
const VERSION = "b".repeat(64);
const director = sample.officials.find((o) => o.parent === null)!;
let requests: { url: string; init: RequestInit }[];
let reply: () => Response;

beforeEach(() => {
  requests = [];
  reply = () => Response.json({ version: "c".repeat(64), updatedAt: "2026-11-20T05:00:00.000Z", updatedBy: "Staf SDM Uji" });
  refresh.mockClear();
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => { requests.push({ url, init }); return reply(); });
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const open = () => {
  render(<HrdEditor officials={sample.officials} staff={sample.staff} version={VERSION} updatedAt="2026-11-19T03:30:00.000Z" updatedBy="Direktur" />);
  fireEvent.click(screen.getByRole("button", { name: "Ubah data SDM" }));
};
const sentBody = () => JSON.parse(String(requests[0].init.body)) as { version: string; officials: typeof sample.officials; staff: typeof sample.staff };

describe("HRD editor", () => {
  it("shows who changed the data last and opens on request", () => {
    render(<HrdEditor officials={sample.officials} staff={sample.staff} version={VERSION} updatedAt="2026-11-19T03:30:00.000Z" updatedBy="Direktur" />);
    expect(screen.getByText(/Terakhir diubah 19 November 2026.*oleh Direktur\./)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Simpan perubahan" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ubah data SDM" }));
    expect((screen.getByRole("button", { name: "Simpan perubahan" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("sends the whole edited list with the loaded version and the CSRF header, then refreshes", async () => {
    open();
    fireEvent.change(screen.getByLabelText(`Nomor HP ${director.position}`), { target: { value: "0812 0000 0099" } });
    fireEvent.click(screen.getByRole("button", { name: "Simpan perubahan" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(requests[0].url).toBe("/api/hrd/directory");
    expect(requests[0].init.method).toBe("PUT");
    expect((requests[0].init.headers as Record<string, string>)["X-CSRF-Token"]).toBe("csrf-test");
    const body = sentBody();
    expect(body.version).toBe(VERSION);
    expect(body.officials).toHaveLength(sample.officials.length);
    expect(body.staff).toHaveLength(sample.staff.length);
    expect(body.officials.find((o) => o.id === director.id)?.phone).toBe("0812 0000 0099");
    expect(Object.keys(body.staff[0]).sort()).toEqual(["name", "position", "title", "unit"]);
    expect(screen.getByRole("status").textContent).toBe("Perubahan tersimpan.");
  });

  it("adds and removes staff, and filters without losing hidden rows", async () => {
    open();
    const first = sample.staff[0];
    fireEvent.change(screen.getByLabelText("Cari di daftar pegawai"), { target: { value: first.name } });
    const terms = first.name.toLocaleLowerCase("id-ID").split(/\s+/);
    const hidden = sample.staff.find((s) => !terms.every((t) => [s.name, s.title, s.position ?? "", s.unit ?? ""].join(" ").toLocaleLowerCase("id-ID").includes(t)))!;
    expect(screen.getByLabelText(`Nama ${first.name}`)).toBeTruthy();
    expect(screen.queryByLabelText(`Nama ${hidden.name}`)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: `Hapus ${first.name}` }));
    fireEvent.click(screen.getByRole("button", { name: "Tambah pegawai" }));
    fireEvent.change(screen.getByLabelText(`Nama pegawai baris ${sample.staff.length}`), { target: { value: "Contoh Pegawai Baru" } });
    fireEvent.click(screen.getByRole("button", { name: "Simpan perubahan" }));
    await waitFor(() => expect(requests).toHaveLength(1));
    const names = sentBody().staff.map((s) => s.name);
    expect(names).toHaveLength(sample.staff.length);
    expect(names).not.toContain(first.name);
    expect(names.at(-1)).toBe("Contoh Pegawai Baru");
  });

  it("does not let an official with reports be removed", () => {
    open();
    expect((screen.getByRole("button", { name: `Hapus ${director.position}` }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps the editor open and shows the server's reason when the save is refused", async () => {
    reply = () => Response.json({ error: "Data SDM sudah diubah orang lain sejak halaman ini dibuka." }, { status: 409 });
    open();
    fireEvent.change(screen.getByLabelText(`Unit ${director.position}`), { target: { value: "Direksi" } });
    fireEvent.click(screen.getByRole("button", { name: "Simpan perubahan" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/sudah diubah orang lain/);
    expect(screen.getByRole("button", { name: "Simpan perubahan" })).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("formats the time in WIB", () => {
    expect(formatUpdatedAt("2026-11-20T05:00:00.000Z")).toMatch(/^20 November 2026.*12[.:]00 WIB$/);
    expect(formatUpdatedAt("not a date")).toBe("not a date");
  });
});
