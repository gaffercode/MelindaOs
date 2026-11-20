import { afterEach, describe, expect, it, vi } from "vitest";
import { parseInstructionInput } from "@/lib/director/director-instructions";
import { cardFromDraft, toInstructionInput } from "@/lib/instruction/instruction-draft";
import { ARAHAN_EVENT, fromDocumentLine, fromGap, fromSchedule, fromStarkesChapter, openArahan, recipientsFromSiapa, scheduleAction } from "@/lib/instruction/instruction-prefill";

const today = "2026-11-05";
const row = { waktu: "10.15–10.30", kegiatan: "Kickoff kredensial: kunci PIC K1-K11", siapa: "Direktur / dr. Novia / Bu Oriza", topikTindakLanjut: "Keputusan K1-K11 sudah 4 Nov." };

afterEach(() => { vi.unstubAllGlobals(); });

describe("schedule rows", () => {
  it("maps the agenda status to an instruction action", () => {
    expect(scheduleAction("tunda")).toBe("defer");
    expect(scheduleAction("selesai")).toBe("done");
    expect(scheduleAction("berjalan")).toBe("request_update");
    expect(scheduleAction("menunggu")).toBe("request_update");
  });
  it("turns the Siapa column into recipients, without the Director himself", () => {
    expect(recipientsFromSiapa("Direktur / dr. Novia / Bu Oriza")).toEqual(["dr. Novia", "Bu Oriza"]);
    expect(recipientsFromSiapa("Seluruh struktural")).toEqual(["Seluruh struktural"]);
    expect(recipientsFromSiapa("-")).toEqual([]);
    expect(recipientsFromSiapa("  ")).toEqual([]);
    expect(recipientsFromSiapa(Array.from({ length: 10 }, (_, index) => `Staf ${index}`).join(" / "))).toHaveLength(8);
    expect(recipientsFromSiapa(`${"x".repeat(70)} / Bu Yuni`)).toEqual(["x".repeat(60), "Bu Yuni"]);
  });
  it("builds a draft from a row, its status and the Director's remark", () => {
    const draft = fromSchedule(row, "tunda", "  Geser ke Jumat\npagi ");
    expect(draft).toEqual({ title: "10.15–10.30 · Kickoff kredensial: kunci PIC K1-K11", action: "defer", pic: ["dr. Novia", "Bu Oriza"], deadline: null, note: "Geser ke Jumat pagi", urgent: false });
    const input = toInstructionInput(cardFromDraft(draft, today), today, "Jadwal hari ini");
    expect(parseInstructionInput(input)).toEqual(input);
  });
});

describe("brief [ISI] gaps", () => {
  it("asks the named PIC for the missing data, keeping the report context", () => {
    const draft = fromGap({ id: "g1", title: "Klaim pending BPJS", pic: "Kepala Keuangan", context: "Jumlah klaim pending: [ISI]" }, "");
    expect(draft).toMatchObject({ title: "Lengkapi data: Klaim pending BPJS", action: "request_update", pic: ["Kepala Keuangan"], deadline: null });
    expect(draft.note).toBe("Mohon lengkapi data laporan: Jumlah klaim pending: [ISI]");
    expect(fromGap({ id: "g2", title: "X", pic: "-", context: "y" }, "").pic).toEqual([]);
    expect(fromGap({ id: "g3", title: "X", pic: "Kabag Umum", context: "y" }, "Kirim sebelum jam 12").note).toBe("Kirim sebelum jam 12");
    expect(fromGap({ id: "g4", title: "X", pic: "A", context: "z".repeat(400) }, "").note.length).toBeLessThanOrEqual(280);
  });
});

describe("STARKES chapters", () => {
  it("assigns the chapter to its working-group lead, or leaves the recipient open", () => {
    expect(fromStarkesChapter({ code: "PMKP", name: "Peningkatan Mutu dan Keselamatan Pasien" }, "dr. Novia Dwi Anggraini")).toEqual({
      title: "STARKES PMKP · Peningkatan Mutu dan Keselamatan Pasien", action: "assign", pic: ["dr. Novia Dwi Anggraini"], deadline: null, note: "", urgent: false,
    });
    expect(fromStarkesChapter({ code: "X", name: "Y" }, null).pic).toEqual([]);
  });
});

describe("document lines", () => {
  const item = { docTitle: "SOP Pelayanan Farmasi", text: "| Jam buka | [ISI jam] s.d. [ISI jam] |" };

  it("asks staff to complete a document, naming what is missing", () => {
    expect(fromDocumentLine(item, ["Jam layanan", "", "Nama penanggung jawab"])).toEqual({
      title: "Lengkapi dokumen: SOP Pelayanan Farmasi", action: "request_update", pic: [], deadline: null, note: "Jam layanan; Nama penanggung jawab", urgent: false,
    });
  });

  it("falls back to the line text when no detail is given", () => {
    expect(fromDocumentLine(item, []).note).toBe("| Jam buka | [ISI jam] s.d. [ISI jam] |");
    expect(fromDocumentLine(item, ["", ""]).note).toBe("| Jam buka | [ISI jam] s.d. [ISI jam] |");
  });

  it("cuts the title and the note at their limits", () => {
    const draft = fromDocumentLine({ docTitle: "x".repeat(400), text: "y" }, ["z".repeat(400)]);
    expect(draft.title).toHaveLength(300);
    expect(draft.note).toHaveLength(280);
  });

  it("builds a card the instruction API accepts", () => {
    const input = toInstructionInput(cardFromDraft({ ...fromDocumentLine(item, ["Jam layanan"]), pic: ["Kepala Farmasi"] }, today), today, "Isian dokumen");
    expect(parseInstructionInput(input)).toEqual(input);
  });
});

describe("openArahan", () => {
  it("reports whether a signed-in Arahan panel picked the request up", () => {
    const listeners: ((event: Event) => void)[] = [];
    vi.stubGlobal("window", {
      addEventListener: (_: string, listener: (event: Event) => void) => listeners.push(listener),
      dispatchEvent: (event: Event) => { listeners.forEach((listener) => listener(event)); return true; },
    });
    const draft = fromSchedule(row, "selesai", "");
    expect(openArahan({ context: "Jadwal hari ini", draft })).toBe(false);
    window.addEventListener(ARAHAN_EVENT, (event) => { (event as CustomEvent<{ handled: boolean }>).detail.handled = true; });
    expect(openArahan({ context: "Jadwal hari ini", draft })).toBe(true);
  });
});
