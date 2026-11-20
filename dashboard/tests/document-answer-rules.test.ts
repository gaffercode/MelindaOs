import { describe, expect, it } from "vitest";
import {
  CORRECTION_MAX,
  isDirectorQueue,
  lineState,
  saveError,
  type DirectorQueue,
  type QueueItem,
  type QueueSlot,
  type SlotDecision,
  type StoredAnswer,
} from "@/lib/knowledge/document-answer-rules";

const rules = { maxLength: 200, refusePattern: "\\b(belum|menunggu)\\b" };
const isi = (lock: QueueSlot["lock"] = null): QueueSlot => ({ column: 13, placeholder: "[ISI jam]", kind: "ISI", detail: "Perlu data RS", lock, header: null });
const cek = (lock: QueueSlot["lock"] = null): QueueSlot => ({ column: 30, placeholder: "[CEK]", kind: "CEK", detail: null, lock, header: null });
const line = (...slots: QueueSlot[]): QueueItem => ({
  id: "00000000000000aa", docPath: "knowledge/01_HOSPITAL/x/kb-operasional-x.md", docTitle: "Dokumen X", heading: "Jadwal",
  text: "| Jam buka | [ISI jam] s.d. 21.00 [CEK] |", slots,
});
const value = (text: string): SlotDecision => ({ decision: "value", text });
const correction = (text: string): SlotDecision => ({ decision: "correction", text });
const confirm: SlotDecision = { decision: "confirm", text: "" };
const skip: SlotDecision = { decision: "skip", text: "" };
const stored = (item: QueueItem, slots: SlotDecision[]): StoredAnswer => ({
  id: item.id, docPath: item.docPath, lineText: item.text, answeredBy: "director-test", answeredAt: "2026-11-12T03:00:00.000Z",
  slots: slots.map((slot, index) => ({ ...slot, column: item.slots[index].column, placeholder: item.slots[index].placeholder })),
});
const queue: DirectorQueue = { valueRules: rules, items: [line(isi(), cek("date"))], drafts: ["knowledge/01_HOSPITAL/x/kb-operasional-y.md"] };

describe("saveError", () => {
  it("accepts a valid save for a mixed line", () => {
    expect(saveError(line(isi(), cek(), cek("date")), [value("07.00"), correction("Seharusnya 22.00"), skip], rules)).toBeNull();
    expect(saveError(line(isi(), cek()), [skip, confirm], rules)).toBeNull();
  });

  it("refuses a save whose slot count differs from the line", () => {
    expect(saveError(line(isi(), cek()), [value("07.00")], rules)).toBe("Jumlah isian tidak sesuai baris.");
    expect(saveError(line(isi()), [value("07.00"), confirm], rules)).toBe("Jumlah isian tidak sesuai baris.");
  });

  it("refuses any decision but skip on a locked slot", () => {
    expect(saveError(line(isi("number"), cek()), [value("001/SK"), confirm], rules)).toBe("Butir ini terkunci.");
    expect(saveError(line(isi(), cek("clinical")), [value("07.00"), confirm], rules)).toBe("Butir ini terkunci.");
    expect(saveError(line(isi(), cek("signature")), [value("07.00"), correction("x")], rules)).toBe("Butir ini terkunci.");
  });

  it("refuses confirm or correction on an ISI and value on a CEK", () => {
    expect(saveError(line(isi()), [confirm], rules)).toBe("Pilihan tidak berlaku untuk butir ini.");
    expect(saveError(line(isi()), [correction("salah")], rules)).toBe("Pilihan tidak berlaku untuk butir ini.");
    expect(saveError(line(cek()), [value("21.00")], rules)).toBe("Pilihan tidak berlaku untuk butir ini.");
  });

  it("refuses an empty value", () => {
    expect(saveError(line(isi()), [value("")], rules)).toBe("Isian tidak valid.");
    expect(saveError(line(isi()), [value("   ")], rules)).toBe("Isian tidak valid.");
  });

  it("accepts a 200-character value and refuses a 201-character one", () => {
    expect(saveError(line(isi()), [value("a".repeat(200))], rules)).toBeNull();
    expect(saveError(line(isi()), [value(` ${"a".repeat(200)} `)], rules)).toBeNull();
    expect(saveError(line(isi()), [value("a".repeat(201))], rules)).toBe("Isian tidak valid.");
  });

  it("refuses a value with a line break", () => {
    expect(saveError(line(isi()), [value("07.00\n21.00")], rules)).toBe("Isian tidak valid.");
    expect(saveError(line(isi()), [value("07.00\r21.00")], rules)).toBe("Isian tidak valid.");
    expect(saveError(line(isi()), [value(`07.00${String.fromCharCode(0x2028)}21.00`)], rules)).toBe("Isian tidak valid.");
  });

  it("refuses a value with a backtick", () => {
    expect(saveError(line(isi()), [value("`07.00")], rules)).toBe("Isian tidak valid.");
  });

  it("refuses a value with a tab", () => {
    expect(saveError(line(isi()), [value("07.00\t21.00")], rules)).toBe("Isian tidak valid.");
  });

  it("refuses a value with a bell character", () => {
    expect(saveError(line(isi()), [value(`07.00${String.fromCharCode(7)}`)], rules)).toBe("Isian tidak valid.");
  });

  it("refuses a value with a pipe or placeholder syntax", () => {
    expect(saveError(line(isi()), [value("07.00 | 21.00")], rules)).toBe("Isian tidak valid.");
    expect(saveError(line(isi()), [value("[ISI jam]")], rules)).toBe("Isian tidak valid.");
    expect(saveError(line(isi()), [value("07.00 [CEK]")], rules)).toBe("Isian tidak valid.");
  });

  it("refuses a value that describes instead of answering, by the pattern in the queue file", () => {
    expect(saveError(line(isi()), [value("Belum ada")], rules)).toBe("Isi dengan nilainya, bukan keterangan.");
    expect(saveError(line(isi()), [value("Sabtu")], rules)).toBeNull();
  });

  it("refuses an empty correction", () => {
    expect(saveError(line(cek()), [correction("  ")], rules)).toBe("Catatan koreksi tidak valid.");
  });

  it("accepts a 280-character correction and refuses a 281-character one", () => {
    expect(CORRECTION_MAX).toBe(280);
    expect(saveError(line(cek()), [correction("a".repeat(280))], rules)).toBeNull();
    expect(saveError(line(cek()), [correction("a".repeat(281))], rules)).toBe("Catatan koreksi tidak valid.");
  });

  it("refuses a correction with a line break or another control character", () => {
    expect(saveError(line(cek()), [correction("baris satu\nbaris dua")], rules)).toBe("Catatan koreksi tidak valid.");
    expect(saveError(line(cek()), [correction("kolom\tdua")], rules)).toBe("Catatan koreksi tidak valid.");
  });

  it("lets a correction describe, and carry a pipe or a backtick", () => {
    expect(saveError(line(cek()), [correction("Belum benar: `22.00` | cek ulang")], rules)).toBeNull();
  });

  it("refuses confirm or skip that carries text", () => {
    expect(saveError(line(cek()), [{ decision: "confirm", text: "ya" }], rules)).toBe("Isian tidak valid.");
    expect(saveError(line(isi(), cek()), [{ decision: "skip", text: "nanti" }, confirm], rules)).toBe("Isian tidak valid.");
  });

  it("refuses a save where every slot is skipped", () => {
    expect(saveError(line(isi(), cek()), [skip, skip], rules)).toBe("Belum ada yang diisi.");
    expect(saveError(line(isi("number")), [skip], rules)).toBe("Belum ada yang diisi.");
  });

  it("reports the earlier rule first when two are broken", () => {
    expect(saveError(line(isi(), cek("date")), [value(""), confirm], rules)).toBe("Butir ini terkunci.");
    expect(saveError(line(isi(), cek()), [value(""), value("x")], rules)).toBe("Pilihan tidak berlaku untuk butir ini.");
  });
});

describe("lineState", () => {
  it("is locked when every slot is locked", () => {
    const item = line(isi("number"), cek("date"));
    expect(lineState(item, undefined)).toBe("locked");
    expect(lineState(item, stored(item, [skip, skip]))).toBe("locked");
  });

  it("is open when nothing is stored", () => {
    expect(lineState(line(isi(), cek()), undefined)).toBe("open");
  });

  it("stays open when one unlocked slot was skipped", () => {
    const item = line(isi(), cek());
    expect(lineState(item, stored(item, [value("07.00"), skip]))).toBe("open");
  });

  it("is answered when every slot has a decision", () => {
    const item = line(isi(), cek());
    expect(lineState(item, stored(item, [value("07.00"), confirm]))).toBe("answered");
  });

  it("is answered when the only unlocked slot has a decision", () => {
    const item = line(isi(), cek("date"));
    expect(lineState(item, stored(item, [value("07.00"), skip]))).toBe("answered");
  });

  it("is open when the stored answer has fewer slots than the line", () => {
    const item = line(isi(), cek());
    expect(lineState(item, stored(line(isi()), [value("07.00")]))).toBe("open");
  });
});

describe("isDirectorQueue", () => {
  it("accepts a queue file", () => {
    expect(isDirectorQueue(queue)).toBe(true);
    expect(isDirectorQueue({ valueRules: rules, items: [], drafts: [] })).toBe(true);
  });

  it("refuses a value that is not an object", () => {
    expect(isDirectorQueue(null)).toBe(false);
    expect(isDirectorQueue([])).toBe(false);
    expect(isDirectorQueue("queue")).toBe(false);
  });

  it("refuses missing or malformed value rules", () => {
    expect(isDirectorQueue({ items: [], drafts: [] })).toBe(false);
    expect(isDirectorQueue({ valueRules: { maxLength: "200", refusePattern: "x" }, items: [], drafts: [] })).toBe(false);
    expect(isDirectorQueue({ valueRules: { maxLength: 0, refusePattern: "x" }, items: [], drafts: [] })).toBe(false);
    expect(isDirectorQueue({ valueRules: { maxLength: 200 }, items: [], drafts: [] })).toBe(false);
  });

  it("refuses a refuse pattern that is not a regular expression", () => {
    expect(isDirectorQueue({ valueRules: { maxLength: 200, refusePattern: "(" }, items: [], drafts: [] })).toBe(false);
  });

  it("refuses a slot with an unknown lock or kind", () => {
    expect(isDirectorQueue({ ...queue, items: [{ ...line(), slots: [{ ...isi(), lock: "secret" }] }] })).toBe(false);
    expect(isDirectorQueue({ ...queue, items: [{ ...line(), slots: [{ ...isi(), kind: "TODO" }] }] })).toBe(false);
    expect(isDirectorQueue({ ...queue, items: [{ ...line(), slots: [{ ...isi(), column: "13" }] }] })).toBe(false);
    expect(isDirectorQueue({ ...queue, items: [{ ...line(), slots: [null] }] })).toBe(false);
  });

  it("accepts a heading lock and a column header", () => {
    expect(isDirectorQueue({ ...queue, items: [{ ...line(), slots: [{ ...isi("heading"), header: "Pagi" }] }] })).toBe(true);
  });

  it("refuses a slot whose column header is missing or not text", () => {
    expect(isDirectorQueue({ ...queue, items: [{ ...line(), slots: [{ ...isi(), header: 3 }] }] })).toBe(false);
    expect(isDirectorQueue({ ...queue, items: [{ ...line(), slots: [{ column: 13, placeholder: "[ISI jam]", kind: "ISI", detail: null, lock: null }] }] })).toBe(false);
  });

  it("refuses an item with a missing field or no slot", () => {
    expect(isDirectorQueue({ ...queue, items: [line()] })).toBe(false);
    expect(isDirectorQueue({ ...queue, items: [{ ...line(isi()), id: 7 }] })).toBe(false);
    expect(isDirectorQueue({ ...queue, items: [{ ...line(isi()), heading: 7 }] })).toBe(false);
    expect(isDirectorQueue({ ...queue, items: [null] })).toBe(false);
    expect(isDirectorQueue({ ...queue, items: {} })).toBe(false);
  });

  it("refuses drafts that are not a list of paths", () => {
    expect(isDirectorQueue({ ...queue, drafts: "knowledge/01_HOSPITAL/x.md" })).toBe(false);
    expect(isDirectorQueue({ ...queue, drafts: [7] })).toBe(false);
  });
});
