// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentAnswers } from "@/components/knowledge/document-answers";
import type { DirectorQueue, QueueItem, StoredAnswer } from "@/lib/knowledge/document-answer-rules";
import { ARAHAN_EVENT, type ArahanRequest } from "@/lib/instruction/instruction-prefill";

const PATH = "/api/director/document-answers";
const DOC_X = "knowledge/01_HOSPITAL/x/kb-operasional-x.md";
const DOC_Y = "knowledge/01_HOSPITAL/y/kb-operasional-y.md";
const LINE_C: QueueItem = { id: "00000000000000cc", docPath: DOC_Y, docTitle: "Dokumen Y", heading: "Kepemilikan", text: "| Unit pemilik | Farmasi [CEK] |", slots: [
  { column: 24, placeholder: "[CEK]", kind: "CEK", detail: null, lock: null, header: null },
] };
const LINE_A: QueueItem = { id: "00000000000000aa", docPath: DOC_X, docTitle: "Dokumen X", heading: "## Jadwal", text: "| Jam buka | [ISI jam] s.d. [ISI jam] |", slots: [
  { column: 13, placeholder: "[ISI jam]", kind: "ISI", detail: "Jam layanan", lock: null, header: null },
  { column: 28, placeholder: "[ISI jam]", kind: "ISI", detail: "Jam layanan", lock: null, header: null },
] };
const LINE_B: QueueItem = { id: "00000000000000bb", docPath: DOC_X, docTitle: "Dokumen X", heading: "Identitas", text: "| Nomor | [ISI nomor] | Unit [CEK] |", slots: [
  { column: 10, placeholder: "[ISI nomor]", kind: "ISI", detail: "Nomor dokumen", lock: "number", header: null },
  { column: 30, placeholder: "[CEK]", kind: "CEK", detail: "Periksa unit", lock: null, header: "Unit" },
] };
// Dokumen Y comes first in the queue file and is already answered, so the list must move it last.
const QUEUE: DirectorQueue = { valueRules: { maxLength: 200, refusePattern: "\\b(belum|menunggu)\\b" }, items: [LINE_C, LINE_A, LINE_B], drafts: ["knowledge/01_HOSPITAL/z/kb-draf.md"] };
const AT = "2026-11-12T03:00:00+00:00";
const ANSWER_C: StoredAnswer = { id: LINE_C.id, docPath: DOC_Y, lineText: LINE_C.text, answeredBy: "director-test", answeredAt: AT, slots: [{ column: 24, placeholder: "[CEK]", decision: "confirm", text: "" }] };
const ORPHAN: StoredAnswer = { id: "00000000000000dd", docPath: "knowledge/01_HOSPITAL/lama.md", lineText: "| Lama | [ISI] |", answeredBy: "director-test", answeredAt: AT, slots: [{ column: 9, placeholder: "[ISI]", decision: "value", text: "nilai lama" }] };
const COUNTS = "2 baris belum dijawab · 1 sudah dijawab · 1 butir terkunci";

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
let calls: Call[];
let answers: StoredAnswer[];
let orphaned: StoredAnswer[];
let listDown: boolean;
let saveDown: boolean;
let tick: number;

function fetchMock(url: string, init: RequestInit = {}): Promise<Response> {
  const method = init.method ?? "GET";
  const body: unknown = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
  calls.push({ url, method, headers: (init.headers ?? {}) as Record<string, string>, body });
  if (url === "/api/director/session") return Promise.resolve(Response.json({ csrfToken: "csrf-test" }));
  if (url === PATH && method === "GET") return Promise.resolve(listDown ? Response.json({ error: "API pengiriman belum diaktifkan." }, { status: 503 }) : Response.json({ answers, orphaned }));
  if (url === PATH && method === "POST") {
    if (saveDown) return Promise.resolve(Response.json({ error: "Layanan laporan belum tersedia. Coba lagi nanti." }, { status: 503 }));
    const { id, slots } = body as { id: string; slots: { decision: StoredAnswer["slots"][number]["decision"]; text: string }[] };
    const item = QUEUE.items.find((candidate) => candidate.id === id)!;
    tick += 1;
    const row: StoredAnswer = { id, docPath: item.docPath, lineText: item.text, answeredBy: "director-test", answeredAt: `2026-11-12T04:00:0${tick}+00:00`, slots: item.slots.map((slot, index) => ({ column: slot.column, placeholder: slot.placeholder, ...slots[index] })) };
    answers = [row, ...answers.filter((answer) => answer.id !== id)];
    return Promise.resolve(Response.json({ saved: 1 }));
  }
  if (url.startsWith(`${PATH}?id=`) && method === "DELETE") {
    const id = url.slice(`${PATH}?id=`.length);
    answers = answers.filter((answer) => answer.id !== id);
    orphaned = orphaned.filter((answer) => answer.id !== id);
    return Promise.resolve(Response.json({ cleared: 1 }));
  }
  return Promise.resolve(Response.json({ error: "x" }, { status: 404 }));
}

beforeEach(() => {
  calls = []; answers = [ANSWER_C]; orphaned = [ORPHAN]; listDown = false; saveDown = false; tick = 0;
  vi.stubGlobal("fetch", vi.fn(fetchMock));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const posts = () => calls.filter((call) => call.url === PATH && call.method === "POST").map((call) => call.body);
const deletes = () => calls.filter((call) => call.method === "DELETE").map((call) => call.url);
const button = (name: string | RegExp) => screen.getByRole("button", { name });
const press = (name: string | RegExp) => fireEvent.click(button(name));
const type = (element: HTMLElement, value: string) => fireEvent.change(element, { target: { value } });
const valueOf = (element: HTMLElement) => (element as HTMLInputElement).value;
const disabled = (element: HTMLElement) => (element as HTMLButtonElement | HTMLInputElement).disabled;
async function ready() {
  render(<DocumentAnswers queue={QUEUE} />);
  expect(await screen.findByText(COUNTS)).toBeTruthy();
}
async function openX() {
  await ready();
  press(/^Dokumen X/);
  expect(await screen.findByText(LINE_A.text)).toBeTruthy();
}

describe("document answers: overview", () => {
  it("shows both notices, the counts and the download link", async () => {
    await ready();
    expect(screen.getByText("Jawaban disimpan di sini. Dokumen baru berubah setelah jawaban diterapkan lewat repositori.")).toBeTruthy();
    expect(screen.getByText("Jangan menulis data pasien di sini.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Unduh jawaban" }).getAttribute("href")).toBe(`${PATH}/unduh`);
  });

  it("lists documents with what is left, finished documents last", async () => {
    await ready();
    const rows = screen.getAllByRole("button", { name: /^Dokumen / });
    expect(rows.map((row) => row.textContent)).toEqual([expect.stringMatching(/^Dokumen X.*2 baris belum dijawab$/), expect.stringMatching(/^Dokumen Y.*Selesai dijawab$/)]);
  });

  it("lists draft-only documents and answers whose line changed", async () => {
    await ready();
    const drafts = screen.getByRole("region", { name: "Dokumen berstatus draf tanpa isian" });
    expect(within(drafts).getByText("knowledge/01_HOSPITAL/z/kb-draf.md")).toBeTruthy();
    const lost = screen.getByRole("region", { name: "Jawaban untuk baris yang sudah berubah" });
    expect(within(lost).getByText("| Lama | [ISI] |")).toBeTruthy();
    expect(within(lost).getByText(/nilai lama/)).toBeTruthy();
    fireEvent.click(within(lost).getByRole("button", { name: "Hapus" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Jawaban untuk baris yang sudah berubah" })).toBeNull());
    expect(deletes()).toEqual([`${PATH}?id=${ORPHAN.id}`]);
  });

  it("says so when the queue file is not bundled, and asks the server nothing", () => {
    render(<DocumentAnswers queue={null} />);
    expect(screen.getByText("Daftar isian belum tersedia.")).toBeTruthy();
    expect(screen.getByText("Jangan menulis data pasien di sini.")).toBeTruthy();
    expect(calls).toEqual([]);
  });
});

describe("document answers: one line", () => {
  it("opens a document on its first open line, with one control per placeholder", async () => {
    await openX();
    expect(screen.getByText("Jadwal")).toBeTruthy();
    expect(screen.getByText("Baris 1 dari 2")).toBeTruthy();
    const inputs = screen.getAllByLabelText(/Jam layanan$/);
    expect(inputs).toHaveLength(2);
    expect(new Set(inputs.map((input) => input.id)).size).toBe(2);
    // Two placeholders with the same description are told apart by their place on the line.
    expect(screen.getByLabelText("Butir 1 dari 2 · Jam layanan")).toBe(inputs[0]);
    expect(screen.getByLabelText("Butir 2 dari 2 · Jam layanan")).toBe(inputs[1]);
    expect(disabled(button("Sebelumnya"))).toBe(true);
    expect(disabled(button("Berikutnya"))).toBe(false);
    expect(screen.getByText("Balasan staf tidak masuk ke antrean ini.")).toBeTruthy();
    press("Kembali ke daftar dokumen");
    expect(screen.getAllByRole("button", { name: /^Dokumen / })).toHaveLength(2);
  });

  it("shows why a locked placeholder cannot be answered, and gives it no input", async () => {
    await openX();
    press("Berikutnya");
    expect(screen.getByText(LINE_B.text)).toBeTruthy();
    expect(screen.getByText("Nomor dokumen")).toBeTruthy();
    expect(screen.getByText("Menunggu penomoran resmi.")).toBeTruthy();
    expect(screen.queryAllByRole("textbox")).toEqual([]);
    // A placeholder in a table is named by its column.
    expect(screen.getByRole("group", { name: "Unit · Periksa unit" })).toBeTruthy();
  });

  it("shows a placeholder on a heading as locked", async () => {
    const title: QueueItem = { id: "00000000000000ee", docPath: DOC_X, docTitle: "Dokumen X", heading: "# Daftar [ISI]", text: "# Daftar [ISI]", slots: [
      { column: 9, placeholder: "[ISI]", kind: "ISI", detail: null, lock: "heading", header: null },
    ] };
    render(<DocumentAnswers queue={{ ...QUEUE, items: [LINE_A, title] }} />);
    expect(await screen.findByText(/1 butir terkunci/)).toBeTruthy();
    press(/^Dokumen X/);
    press("Berikutnya");
    expect(screen.getByText("Judul, tidak diisi di sini.")).toBeTruthy();
    expect(screen.queryAllByRole("textbox")).toEqual([]);
  });

  it("saves typed values and moves to the next open line", async () => {
    await openX();
    const inputs = screen.getAllByLabelText(/Jam layanan$/);
    type(inputs[0], " 07.00 ");
    type(inputs[1], "21.00");
    press("Simpan");
    expect(await screen.findByText(LINE_B.text)).toBeTruthy();
    expect(posts()).toEqual([{ id: LINE_A.id, slots: [{ decision: "value", text: "07.00" }, { decision: "value", text: "21.00" }] }]);
    expect(calls.find((call) => call.method === "POST" && call.url === PATH)?.headers["X-CSRF-Token"]).toBe("csrf-test");
    press("Kembali ke daftar dokumen");
    expect(button(/^Dokumen X/).textContent).toMatch(/1 baris belum dijawab$/);
    expect(screen.getByText("1 baris belum dijawab · 2 sudah dijawab · 1 butir terkunci")).toBeTruthy();
  });

  it("keeps a partly answered line open, shows what was stored and does not lose it on the next save", async () => {
    await openX();
    type(screen.getAllByLabelText(/Jam layanan$/)[0], "07.00");
    press("Simpan");
    expect(await screen.findByText(LINE_B.text)).toBeTruthy();
    expect(posts()).toEqual([{ id: LINE_A.id, slots: [{ decision: "value", text: "07.00" }, { decision: "skip", text: "" }] }]);
    press("Sebelumnya");
    const inputs = screen.getAllByLabelText(/Jam layanan$/);
    expect(inputs.map(valueOf)).toEqual(["07.00", ""]);
    expect(button("Hapus jawaban")).toBeTruthy();
    type(inputs[1], "21.00");
    press("Simpan");
    await waitFor(() => expect(posts()).toHaveLength(2));
    expect(posts()[1]).toEqual({ id: LINE_A.id, slots: [{ decision: "value", text: "07.00" }, { decision: "value", text: "21.00" }] });
  });

  it("sends confirm for Benar and skips the locked placeholder", async () => {
    await openX();
    press("Berikutnya");
    press("Benar");
    expect(button("Benar").getAttribute("aria-pressed")).toBe("true");
    press("Simpan");
    // Line B was the last one; the other open line of the document comes next.
    expect(await screen.findByText(LINE_A.text)).toBeTruthy();
    expect(posts()).toEqual([{ id: LINE_B.id, slots: [{ decision: "skip", text: "" }, { decision: "confirm", text: "" }] }]);
  });

  it("sends correction with its note for Perlu koreksi", async () => {
    await openX();
    press("Berikutnya");
    expect(screen.queryByLabelText("Catatan koreksi")).toBeNull();
    press("Perlu koreksi");
    type(screen.getByLabelText("Catatan koreksi"), "Seharusnya Logistik");
    press("Simpan");
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]).toEqual({ id: LINE_B.id, slots: [{ decision: "skip", text: "" }, { decision: "correction", text: "Seharusnya Logistik" }] });
  });

  it("returns to the document list when no open line is left", async () => {
    answers = [ANSWER_C, { id: LINE_A.id, docPath: DOC_X, lineText: LINE_A.text, answeredBy: "director-test", answeredAt: AT, slots: LINE_A.slots.map((slot) => ({ column: slot.column, placeholder: slot.placeholder, decision: "value" as const, text: "07.00" })) }];
    render(<DocumentAnswers queue={QUEUE} />);
    expect(await screen.findByText("1 baris belum dijawab · 2 sudah dijawab · 1 butir terkunci")).toBeTruthy();
    press(/^Dokumen X/);
    // The first open line of the document is the second one.
    expect(screen.getByText(LINE_B.text)).toBeTruthy();
    press("Benar");
    press("Simpan");
    await waitFor(() => expect(screen.getAllByRole("button", { name: /^Dokumen / })).toHaveLength(2));
    expect(button(/^Dokumen X/).textContent).toMatch(/Selesai dijawab$/);
  });

  it("refuses a save with nothing filled, without asking the server", async () => {
    await openX();
    press("Berikutnya");
    press("Benar");
    press("Benar");
    expect(button("Benar").getAttribute("aria-pressed")).toBe("false");
    press("Simpan");
    expect((await screen.findByRole("alert")).textContent).toBe("Jawaban belum tersimpan. Belum ada yang diisi.");
    expect(posts()).toEqual([]);
  });

  it("keeps what was typed when the save fails, and says why", async () => {
    await openX();
    saveDown = true;
    type(screen.getAllByLabelText(/Jam layanan$/)[0], "07.00");
    press("Simpan");
    expect((await screen.findByRole("alert")).textContent).toBe("Jawaban belum tersimpan. Layanan laporan belum tersedia. Coba lagi nanti.");
    expect(screen.getByText(LINE_A.text)).toBeTruthy();
    expect(valueOf(screen.getAllByLabelText(/Jam layanan$/)[0])).toBe("07.00");
  });

  it("clears a stored answer, after which the line is open again", async () => {
    await ready();
    press(/^Dokumen Y/);
    expect(screen.getByText(LINE_C.text)).toBeTruthy();
    expect(button("Benar").getAttribute("aria-pressed")).toBe("true");
    press("Hapus jawaban");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Hapus jawaban" })).toBeNull());
    expect(deletes()).toEqual([`${PATH}?id=${LINE_C.id}`]);
    expect(button("Benar").getAttribute("aria-pressed")).toBe("false");
    press("Kembali ke daftar dokumen");
    expect(button(/^Dokumen Y/).textContent).toMatch(/1 baris belum dijawab$/);
  });

  it("hands the line to the Arahan panel, and says so when no panel is listening", async () => {
    await openX();
    const seen: ArahanRequest[] = [];
    const handler = (event: Event) => {
      const { detail } = event as CustomEvent<ArahanRequest & { handled: boolean }>;
      seen.push({ context: detail.context, draft: detail.draft });
      detail.handled = true;
    };
    window.addEventListener(ARAHAN_EVENT, handler);
    press("Teruskan ke staf");
    window.removeEventListener(ARAHAN_EVENT, handler);
    expect(seen).toEqual([{ context: "Isian dokumen", draft: { title: "Lengkapi dokumen: Dokumen X", action: "request_update", pic: [], deadline: null, note: "Jam layanan", urgent: false } }]);
    expect(screen.queryByText("Panel arahan belum tersedia.")).toBeNull();
    press("Teruskan ke staf");
    expect(await screen.findByText("Panel arahan belum tersedia.")).toBeTruthy();
    expect(posts()).toEqual([]);
  });
});

describe("document answers: store not available", () => {
  it("lists the lines but disables every answer control", async () => {
    listDown = true;
    render(<DocumentAnswers queue={QUEUE} />);
    expect((await screen.findByRole("status")).textContent).toBe("Penyimpanan jawaban belum aktif.");
    expect(screen.getByText("3 baris belum dijawab · 0 sudah dijawab · 1 butir terkunci")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Unduh jawaban" })).toBeNull();
    expect(screen.getByRole("region", { name: "Dokumen berstatus draf tanpa isian" })).toBeTruthy();
    press(/^Dokumen X/);
    expect(screen.getByText(LINE_A.text)).toBeTruthy();
    for (const input of screen.getAllByLabelText(/Jam layanan$/)) expect(disabled(input)).toBe(true);
    for (const name of ["Simpan", "Teruskan ke staf"]) expect(disabled(button(name))).toBe(true);
    press("Berikutnya");
    for (const name of ["Benar", "Perlu koreksi", "Simpan"]) expect(disabled(button(name))).toBe(true);
    expect(posts()).toEqual([]);
  });
});
