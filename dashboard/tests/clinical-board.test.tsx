// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClinicalBoard } from "@/components/clinical/clinical-board";
import type { StoredClinicalEntry } from "@/lib/clinical/clinical-types";

const base = { status: "aktif", revision: 1, createdBy: "Direktur", createdAt: "2026-11-22T01:00:00Z", updatedBy: null, updatedAt: null } as const;
const entries: StoredClinicalEntry[] = [
  { ...base, id: "00000000-0000-4000-8000-000000000001", kind: "handover", date: "2026-11-22", shift: "malam", unit: "Rawat inap", payload: { patient: "Ny. Pasien QA", rm: "123456", room: "Aster 2", situation: "Demam 3 hari", background: "", assessment: "", recommendation: "Pantau suhu", pending: "", from: "Ns. A", to: "Ns. B" } },
  { ...base, id: "00000000-0000-4000-8000-000000000002", kind: "insiden", date: "2026-11-22", shift: null, unit: "Rawat inap", payload: { time: "14:05", place: "Aster", type: "KNC", grade: "hijau", chronology: "Obat hampir tertukar.", followUp: "", progress: "baru", reporter: "Ns. C" } },
];

let requests: { url: string; init?: RequestInit }[];

beforeEach(() => {
  requests = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    requests.push({ url, init });
    if (url === "/api/access/session") return Response.json({ csrfToken: "csrf-test" });
    if (url === "/api/director/klinis") return Response.json({ id: "00000000-0000-4000-8000-000000000009", createdAt: "2026-11-22T02:00:00Z", replayed: false }, { status: 201 });
    return Response.json({ entry: {} });
  });
  vi.stubGlobal("confirm", () => true);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("ClinicalBoard", () => {
  it("shows one kind at a time and switches with the tabs", () => {
    render(<ClinicalBoard initial={entries} today="2026-11-22" unavailable="" />);
    expect(screen.getByText(/Ny\. Pasien QA/)).toBeTruthy();
    expect(screen.queryByText(/Obat hampir tertukar/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Insiden" }));
    expect(screen.getByText(/Obat hampir tertukar/)).toBeTruthy();
    expect(screen.queryByText(/Ny\. Pasien QA/)).toBeNull();
  });

  it("explains an unavailable store and hides the add button", () => {
    render(<ClinicalBoard initial={[]} today="2026-11-22" unavailable="Data klinis belum tersedia." />);
    expect(screen.getByRole("alert").textContent).toContain("belum tersedia");
    expect(screen.queryByRole("button", { name: /Tambah/ })).toBeNull();
  });

  it("sends a new roster entry with the CSRF token and an idempotency key, and lists it", async () => {
    render(<ClinicalBoard initial={[]} today="2026-11-22" unavailable="" />);
    await waitFor(() => expect(requests.some((request) => request.url === "/api/access/session")).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Roster jaga" }));
    fireEvent.click(screen.getByRole("button", { name: /Tambah roster jaga/ }));
    fireEvent.change(screen.getByLabelText("Unit"), { target: { value: "IGD" } });
    fireEvent.change(screen.getByLabelText(/Petugas jaga/), { target: { value: "dr. Ani - DPJP\nNs. Budi" } });
    // let the session token land before saving
    await waitFor(() => expect(requests.filter((request) => request.url === "/api/access/session")).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Simpan" }));
    await waitFor(() => expect(screen.getByText("Isian tersimpan.")).toBeTruthy());
    const post = requests.find((request) => request.url === "/api/director/klinis");
    expect(post).toBeDefined();
    const headers = post?.init?.headers as Record<string, string>;
    expect(headers["X-CSRF-Token"]).toBe("csrf-test");
    expect(headers["Idempotency-Key"]).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
    expect(JSON.parse(String(post?.init?.body))).toMatchObject({
      kind: "roster", date: "2026-11-22", shift: "pagi", unit: "IGD",
      payload: { people: [{ name: "dr. Ani", role: "DPJP" }, { name: "Ns. Budi", role: "" }], notes: "" },
    });
    expect(screen.getByText(/dr\. Ani — DPJP/)).toBeTruthy();
  });

  it("cancels an entry with the revision it read and removes it from the list", async () => {
    render(<ClinicalBoard initial={entries} today="2026-11-22" unavailable="" />);
    await waitFor(() => expect(requests.some((request) => request.url === "/api/access/session")).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Batalkan" }));
    await waitFor(() => expect(screen.getByText("Isian dibatalkan.")).toBeTruthy());
    const post = requests.find((request) => request.url === `/api/director/klinis/${entries[0].id}`);
    expect(JSON.parse(String(post?.init?.body))).toEqual({ kind: "handover", revision: 1, status: "dibatalkan" });
    expect(screen.queryByText(/Ny\. Pasien QA/)).toBeNull();
  });
});
