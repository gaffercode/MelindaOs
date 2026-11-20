import { describe, expect, it } from "vitest";
import { displayCase, displayCaseDeep } from "@/lib/display-case";

describe("displayCase", () => {
  it("turns all-caps phrases into sentence case and keeps acronyms, codes and proper nouns", () => {
    expect(displayCase("MANAGEMENT MORNING BRIEF")).toBe("Management morning brief");
    expect(displayCase("RSIA MELINDA DHAI")).toBe("RSIA Melinda DHAI");
    expect(displayCase("RINGKASAN LAYANAN 5 NOV")).toBe("Ringkasan layanan 5 Nov");
    expect(displayCase("WIB / JUMAT · MULAI 10.00")).toBe("WIB / Jumat · mulai 10.00");
    expect(displayCase("MENUNGGU DIREKTUR")).toBe("Menunggu Direktur");
    expect(displayCase("KEPEGAWAIAN")).toBe("Kepegawaian");
    expect(displayCase("REMARK (CATATAN HASIL)")).toBe("Remark (catatan hasil)");
  });

  it("capitalizes capitals-only words inside mixed text, such as names and status words", () => {
    expect(displayCase("dr. DIBYA ARFIANDA, Sp.OG, M.Ked.Klin.")).toBe("dr. Dibya Arfianda, Sp.OG, M.Ked.Klin.");
    expect(displayCase("dr. Lily Diah Farida, Sp.A.")).toBe("dr. Lily Diah Farida, Sp.A.");
    expect(displayCase("FINAL v1 (GDP002 pagi)")).toBe("Final v1 (GDP002 pagi)");
    expect(displayCase("tanpa angka = HOLD dari berkas kirim")).toBe("tanpa angka = Hold dari berkas kirim");
    expect(displayCase("Penawaran belum lengkap; ACC/HOLD pagi ini")).toBe("Penawaran belum lengkap; Acc/Hold pagi ini");
    expect(displayCase("payor baru AMANCBN, FWDIIS, BKRT")).toBe("payor baru Amancbn, Fwdiis, Bkrt");
    expect(displayCase("SATUSEHAT di Medify")).toBe("SatuSehat di Medify");
  });

  it("converts short drug names and units, and keeps acronyms, letter-digit codes and Roman numerals", () => {
    expect(displayCase("INFUS D10 500ML")).toBe("Infus D10 500ml");
    expect(displayCase("ACYCLOVIR 400 MG TAB")).toBe("Acyclovir 400 mg tab");
    expect(displayCase("CALCIUM D-MEGA")).toBe("Calcium D-mega");
    expect(displayCase("INFUS KA-EN 3B")).toBe("Infus ka-en 3B");
    expect(displayCase("FE")).toBe("Fe");
    expect(displayCase("CAL 95")).toBe("Cal 95");
    expect(displayCase("BPJS KC 6907/VII-04/1026 klaim FKRTL")).toBe("BPJS KC 6907/VII-04/1026 klaim FKRTL");
    expect(displayCase("Depo ICU dan Formularium RS")).toBe("Depo ICU dan Formularium RS");
    expect(displayCase("2026-11-08T07:00:00Z")).toBe("2026-11-08T07:00:00Z");
    // The [ISI] gap marker is matched literally by the brief's fill-in button.
    expect(displayCase("Slot rapat [ISI] belum ada")).toBe("Slot rapat [ISI] belum ada");
  });

  it("never rewrites identifier keys", () => {
    const data = { kode: "D-01 HOLD BERKAS", kategori: "KAMAR BERSALIN", statusBadge: "PERHATIAN", label: "TIDAK BERKATEGORI" };
    expect(displayCaseDeep(data)).toEqual({ kode: "D-01 HOLD BERKAS", kategori: "KAMAR BERSALIN", statusBadge: "PERHATIAN", label: "Tidak berkategori" });
  });
});
