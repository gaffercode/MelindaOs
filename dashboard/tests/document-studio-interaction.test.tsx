// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { DocumentStudioView } from "@/components/studio/document-studio-view";
import { FORM_PRESETS, SK_PRESETS, SPO_PRESETS } from "@/components/studio/document-studio-presets";

vi.mock("@/components/studio/studio-package-workspace", () => ({ StudioPackageWorkspace: () => null }));
vi.mock("@/lib/client-api", () => ({ directorCsrfHeaders: async () => ({ "x-test-csrf": "token" }) }));

const SIGNATORY = "dr. Ferdi Andriska, S.H., M.Kn., CMDC";
const spo = SPO_PRESETS[0];

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement | HTMLTextAreaElement;
const type = (label: string, value: string) => fireEvent.change(field(label), { target: { value } });
const press = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const preview = () => screen.getByRole("region", { name: "Pratinjau naskah, dapat digulir" });
const showBoth = () => press("Editor & pratinjau");
/** The top action bar is always rendered; the preview section repeats the same buttons. */
const first = (name: string | RegExp) => screen.getAllByRole("button", { name })[0];

function mockFetch(response: Partial<Response> | Error) {
  const fetchMock = vi.fn(async (...args: [RequestInfo | URL, RequestInit?]) => {
    void args;
    if (response instanceof Error) throw response;
    return response as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const pdfResponse = () => ({ ok: true, blob: async () => new Blob(["%PDF-"]) });
const sentBody = (fetchMock: ReturnType<typeof mockFetch>) => JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
async function compile() {
  await act(async () => { fireEvent.click(first("Kompilasi PDF Resmi")); });
}

beforeEach(() => {
  window.history.replaceState(null, "", "/studio");
  URL.createObjectURL = vi.fn(() => "blob:studio-test");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Studio editor: view modes", () => {
  it("opens on the SPO editor with the first template loaded and no preview", () => {
    render(<DocumentStudioView />);
    expect(field("Judul SPO").value).toBe(spo.title);
    expect(field("7. Prosedur").value).toBe(spo.prosedur);
    expect(screen.queryByRole("region", { name: "Pratinjau naskah, dapat digulir" })).toBeNull();
    expect(screen.getByRole("button", { name: "Editor naskah" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("shows only the preview, or the editor and the preview with links between them", () => {
    render(<DocumentStudioView />);
    press("Pratinjau dokumen");
    expect(screen.queryByLabelText("Judul SPO")).toBeNull();
    expect(preview().textContent).toContain(spo.title);
    expect(screen.queryByRole("link", { name: /Kembali ke Editor Naskah/ })).toBeNull();

    showBoth();
    expect(field("Judul SPO").value).toBe(spo.title);
    expect(screen.getByRole("link", { name: /Gulir ke Pratinjau Lembar Cetak/ }).getAttribute("href")).toBe("#studio-preview");
    expect(screen.getByRole("link", { name: /Kembali ke Editor Naskah/ }).getAttribute("href")).toBe("#studio-editor");
  });
});

describe("Studio editor: SPO", () => {
  const labels = [
    "Judul SPO", "Jenis dokumen", "Nomor dokumen", "Nomor revisi", "Tanggal dokumen", "Unit pemilik SPO",
    "1. Pengertian", "2. Tujuan", "3. Ruang lingkup", "4. Kebijakan", "5. Tanggung jawab", "6. Unit terkait",
    "7. Prosedur", "8. Dokumen terkait", "9. Riwayat revisi",
    "Jabatan penyusun", "Nama penyusun", "Jabatan pemeriksa", "Nama pemeriksa",
  ];

  it("carries every typed field into the preview", () => {
    render(<DocumentStudioView />);
    showBoth();
    labels.forEach((label, index) => type(label, `ISIAN-${index}-UJI`));
    labels.forEach((label, index) => {
      expect(field(label).value).toBe(`ISIAN-${index}-UJI`);
      expect(preview().textContent, label).toContain(`ISIAN-${index}-UJI`);
    });
    expect(preview().textContent).toContain(SIGNATORY);
    expect(preview().textContent).toContain("DRAF UNTUK KOREKSI");
  });

  it("reports missing basics in the status line and next to the editor", () => {
    render(<DocumentStudioView />);
    const status = () => screen.getAllByRole("status")[0].textContent;
    expect(status()).toContain("Isian dasar lengkap");
    expect(screen.getByText("Isian dasar lengkap.")).toBeTruthy();
    type("1. Pengertian", "pendek");
    expect(status()).toContain("Masih ada elemen kosong");
    expect(screen.getByText(/Lengkapi seluruh butir pengertian, tujuan, kebijakan, dan prosedur/)).toBeTruthy();
    type("1. Pengertian", "cukup panjang");
    expect(status()).toContain("Isian dasar lengkap");
  });

  it("loads a chosen template into every field and marks it selected", () => {
    render(<DocumentStudioView />);
    const chosen = SPO_PRESETS[5];
    type("Judul SPO", "akan tertimpa");
    press(new RegExp(chosen.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    expect(field("Judul SPO").value).toBe(chosen.title);
    expect(field("Nomor dokumen").value).toBe(chosen.doc_no);
    expect(field("7. Prosedur").value).toBe(chosen.prosedur);
    expect(field("Nama pemeriksa").value).toBe(chosen.diperiksa_nama);
    const pressed = screen.getAllByRole("button", { pressed: true }).map((button) => button.textContent ?? "");
    expect(pressed.some((text) => text.includes(chosen.name))).toBe(true);
    expect(pressed.some((text) => text.includes(spo.name))).toBe(false);
  });

  it("copies the SPO as category A Markdown and confirms for two seconds", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn(async (text: string) => { void text; });
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(<DocumentStudioView />);
    type("Judul SPO", "Judul Uji");
    type("Nomor dokumen", "SPO/UJI 01");
    await act(async () => { fireEvent.click(first("Salin Markdown")); });
    const markdown = writeText.mock.calls[0][0];
    expect(markdown.startsWith("---\ndoc_id: kb-spo-spo-uji-01\ntitle: Judul Uji\ndomain: Operasional\n")).toBe(true);
    expect(markdown).toContain(`department: ${spo.unit}\nversion: "${spo.rev}"\n`);
    expect(markdown).toContain("# Judul Uji\n\n## Identitas Dokumen\n");
    expect(markdown).toContain(`## 7. Prosedur\n${spo.prosedur}\n`);
    expect(markdown).toContain(`| Disusun oleh | ${spo.disusun_jabatan} | ${spo.disusun_nama} | [ISI] |`);
    expect(markdown).toContain(`| Disahkan oleh | Direktur | ${SIGNATORY} | [ISI] |\n`);
    expect(first("Disalin ke Clipboard")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(2000); });
    expect(first("Salin Markdown")).toBeTruthy();
  });
});

describe("Studio editor: SK and formulir", () => {
  it("edits an SK, previews it, and loads another SK template", () => {
    render(<DocumentStudioView />);
    showBoth();
    press(/SK Keputusan Direktur/);
    expect(screen.queryByLabelText("Judul SPO")).toBeNull();
    expect(screen.queryByRole("button", { name: "Salin Markdown" })).toBeNull();
    expect(screen.getAllByRole("status")[0].textContent).toContain("Draf untuk koreksi");
    expect(field("Nomor SK").value).toBe(SK_PRESETS[0].no_sk);
    expect(field("Menimbang").value).toBe(SK_PRESETS[0].menimbang.join("\n"));

    const labels = ["Nomor SK", "Menimbang", "Mengingat", "Diktum kesatu", "Diktum kedua", "Diktum ketiga", "Diktum keempat"];
    labels.forEach((label, index) => type(label, `SK-${index}-UJI`));
    type("Tentang keputusan", "perihal uji");
    labels.forEach((label, index) => expect(preview().textContent, label).toContain(`SK-${index}-UJI`));
    expect(preview().textContent).toContain("TENTANG PERIHAL UJI");
    expect(preview().textContent).toContain(SIGNATORY);

    press(new RegExp(SK_PRESETS[1].name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    expect(field("Nomor SK").value).toBe(SK_PRESETS[1].no_sk);
    expect(field("Diktum kesatu").value).toBe(SK_PRESETS[1].diktum[0]?.isi ?? "");
  });

  it("edits a formulir header, lists its sections, and loads another formulir template", () => {
    render(<DocumentStudioView />);
    showBoth();
    press(/Formulir Rekam Medis \(Elemen D\)/);
    const form = FORM_PRESETS[0];
    expect(field("Judul formulir").value).toBe(form.title);
    expect(screen.getByText(`${form.sections.length} bagian formulir`)).toBeTruthy();
    expect(within(preview()).getByText(form.sections[0].rows[0].item)).toBeTruthy();

    const labels = ["Judul formulir", "Kode formulir", "Referensi STARKES", "Unit pemilik formulir", "Petunjuk pengisian"];
    labels.forEach((label, index) => type(label, `FORM-${index}-UJI`));
    labels.forEach((label, index) => expect(preview().textContent, label).toContain(`FORM-${index}-UJI`));
    type("Petunjuk pengisian", "");
    expect(preview().textContent).not.toContain("Petunjuk Pengisian:");

    const next = FORM_PRESETS[1];
    press(new RegExp(next.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    expect(field("Kode formulir").value).toBe(next.form_code);
    expect(screen.getByText(`${next.sections.length} bagian formulir`)).toBeTruthy();
    expect(within(preview()).getByText(next.sections[0].rows[0].item)).toBeTruthy();
  });
});

describe("Studio editor: typing", () => {
  it("keeps the same focused field while it is being typed in", () => {
    render(<DocumentStudioView />);
    const cases: Array<[string | null, string]> = [
      [null, "7. Prosedur"],
      ["SK Keputusan Direktur", "Diktum ketiga"],
      ["Formulir Rekam Medis (Elemen D)", "Petunjuk pengisian"],
    ];
    for (const [docType, label] of cases) {
      if (docType) fireEvent.click(screen.getByRole("button", { name: new RegExp(docType.replace(/[()]/g, "\\$&")) }));
      const element = field(label);
      element.focus();
      for (const value of ["a", "ab", "abc"]) {
        type(label, value);
        expect(field(label), label).toBe(element);
        expect(document.activeElement, label).toBe(element);
        expect(element.value).toBe(value);
      }
    }
  });
});

describe("Studio editor: PDF", () => {
  it("sends the SPO fields and then shows the PDF with a download link", async () => {
    const fetchMock = mockFetch(pdfResponse());
    render(<DocumentStudioView />);
    showBoth();
    expect((screen.getByRole("button", { name: /Output PDF asli/ }) as HTMLButtonElement).disabled).toBe(true);
    type("Judul SPO", "Judul Kirim");
    await compile();

    expect(fetchMock.mock.calls[0][0]).toBe("/api/studio/generate");
    expect(fetchMock.mock.calls[0][1]?.method).toBe("POST");
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({ "Content-Type": "application/json", "x-test-csrf": "token" });
    expect(sentBody(fetchMock)).toEqual({
      docType: "spo",
      data: {
        title: "Judul Kirim", jenis: spo.jenis, doc_no: spo.doc_no, rev: spo.rev, date: spo.date, unit: spo.unit,
        disusun_jabatan: spo.disusun_jabatan, disusun_nama: spo.disusun_nama,
        diperiksa_jabatan: spo.diperiksa_jabatan, diperiksa_nama: spo.diperiksa_nama,
        sections: {
          "1. Pengertian": spo.pengertian, "2. Tujuan": spo.tujuan, "3. Ruang Lingkup": spo.ruang_lingkup,
          "4. Kebijakan": spo.kebijakan, "5. Tanggung Jawab": spo.tanggung_jawab, "6. Unit Terkait": spo.unit_terkait,
          "7. Prosedur": spo.prosedur, "8. Dokumen Terkait": spo.dokumen_terkait, "9. Riwayat Revisi": spo.riwayat_revisi,
        },
      },
    });

    expect(screen.getByTitle("Pratinjau PDF Dokumen").getAttribute("src")).toBe("blob:studio-test");
    expect(screen.queryByRole("region", { name: "Pratinjau naskah, dapat digulir" })).toBeNull();
    expect(screen.getByRole("button", { name: /Output PDF asli • Siap/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("link", { name: "Unduh PDF" }).getAttribute("download")).toBe("SPO_RSIA_Melinda.pdf");

    press("Pratinjau tata naskah");
    expect(preview().textContent).toContain("Judul Kirim");
  });

  it("drops the compiled PDF when the document type or the SPO template changes", async () => {
    mockFetch(pdfResponse());
    render(<DocumentStudioView />);
    showBoth();
    await compile();
    expect(screen.getByRole("link", { name: "Unduh PDF" })).toBeTruthy();
    press(new RegExp(SPO_PRESETS[2].name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    expect(screen.queryByRole("link", { name: "Unduh PDF" })).toBeNull();
    expect(preview()).toBeTruthy();

    await compile();
    press(/SK Keputusan Direktur/);
    expect(screen.queryByRole("link", { name: "Unduh PDF" })).toBeNull();
  });

  it("sends an SK with blank consideration lines removed, and a formulir with its sections", async () => {
    const fetchMock = mockFetch(pdfResponse());
    render(<DocumentStudioView />);
    press(/SK Keputusan Direktur/);
    type("Menimbang", "satu\n\ndua");
    await compile();
    expect(sentBody(fetchMock)).toEqual({
      docType: "sk",
      data: {
        no_sk: SK_PRESETS[0].no_sk, tentang: SK_PRESETS[0].tentang,
        menimbang: ["satu", "dua"], mengingat: [...SK_PRESETS[0].mengingat],
        diktum: ["KESATU", "KEDUA", "KETIGA", "KEEMPAT"].map((label, index) => ({ label, isi: SK_PRESETS[0].diktum[index].isi })),
      },
    });

    fetchMock.mockClear();
    press(/Formulir Rekam Medis \(Elemen D\)/);
    await compile();
    const form = FORM_PRESETS[0];
    expect(sentBody(fetchMock)).toEqual({
      docType: "form",
      data: { title: form.title, form_code: form.form_code, starkes_ref: form.starkes_ref, unit: form.unit, instructions: form.instructions, sections: form.sections },
    });
  });

  it("shows the server's reason, or a default, when compiling fails", async () => {
    mockFetch({ ok: false, json: async () => ({ detail: "Renderer mati" }) });
    render(<DocumentStudioView />);
    await compile();
    expect(screen.getByRole("alert").textContent).toBe("Renderer mati");
    expect((first("Kompilasi PDF Resmi") as HTMLButtonElement).disabled).toBe(false);

    mockFetch({ ok: false, json: async () => { throw new Error("bukan json"); } });
    await compile();
    expect(screen.getByRole("alert").textContent).toBe("Gagal mengompilasi PDF");

    mockFetch(pdfResponse());
    await compile();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps Markdown but disables compiling where the server cannot make PDFs", () => {
    render(<DocumentStudioView pdfAvailable={false} />);
    expect((first("Kompilasi PDF Resmi") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByRole("status")[0].textContent).toContain("Markdown; PDF belum tersedia");
    expect(screen.getByText(/Ekspor PDF belum tersedia di server ini/)).toBeTruthy();
    expect(first("Salin Markdown")).toBeTruthy();
  });
});

describe("Studio editor: opening from a STARKES link", () => {
  function open(search: string) {
    vi.useFakeTimers();
    window.history.replaceState(null, "", `/studio${search}`);
    render(<DocumentStudioView />);
    act(() => { vi.runAllTimers(); });
  }

  it("loads the SPO template whose STARKES code matches", () => {
    const index = SPO_PRESETS.findIndex((preset) => preset.starkesCode === "PAB 1");
    open("?starkes=PAB%201");
    expect(field("Judul SPO").value).toBe(SPO_PRESETS[index].title);
  });

  it("falls back to a formulir template when no SPO matches", () => {
    const needle = FORM_PRESETS[1].starkes_ref;
    expect(SPO_PRESETS.some((p) => p.starkesCode === needle || p.doc_no.includes(needle) || p.name.toLowerCase().includes(needle.toLowerCase()))).toBe(false);
    open(`?starkes=${encodeURIComponent(needle)}`);
    expect(field("Kode formulir").value).toBe(FORM_PRESETS[1].form_code);
  });

  it("opens the SK editor for type=sk and leaves the default for an unknown code", () => {
    open("?type=sk&starkes=TIDAK-ADA-XYZ");
    expect(field("Nomor SK").value).toBe(SK_PRESETS[0].no_sk);
  });
});
