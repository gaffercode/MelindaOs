import { describe, expect, it } from "vitest";
import { canAdvance, latestHistoryNote, messageText, parseInstructionInput, statusLabels } from "@/lib/director/director-instructions";

const base = { reportDate: "2026-10-07", section: "priorities", itemId: "p1", itemTitle: "Tagih status semua item RM & Klaim Senin", urgent: true, action: "request_update", deadline: "2026-10-07T16:00", pic: [], note: "" };

describe("director instructions", () => {
  it("parses a valid instruction and trims text", () => {
    expect(parseInstructionInput({ ...base, note: "  Kirim rekap jam 4  " })).toMatchObject({ note: "Kirim rekap jam 4", deadline: "2026-10-07T16:00", decisionOptionId: null, decisionLabel: null });
  });
  it("rejects unknown fields, long notes, invalid deadlines and misplaced options", () => {
    expect(() => parseInstructionInput({ ...base, extra: 1 })).toThrow();
    expect(() => parseInstructionInput({ ...base, note: "x".repeat(281) })).toThrow();
    expect(() => parseInstructionInput({ ...base, deadline: "2026-10-07T25:00" })).toThrow();
    expect(() => parseInstructionInput({ ...base, action: "approve" })).toThrow();
    expect(() => parseInstructionInput({ ...base, action: "assign", deadline: null })).toThrow();
    expect(() => parseInstructionInput({ ...base, decisionOptionId: "a", decisionLabel: "A" })).toThrow();
    expect(() => parseInstructionInput({ ...base, section: "decisions", action: "approve", deadline: null, decisionOptionId: "a" })).toThrow();
  });
  it("allows polling pickup, forward moves, and terkendala with a new note", () => {
    expect(canAdvance("terkirim_ke_grokbot", "diteruskan")).toBe(true);
    expect(canAdvance("diteruskan", "selesai")).toBe(true);
    expect(canAdvance("dikerjakan", "diterima_pic")).toBe(false);
    expect(canAdvance("dibuat", "diteruskan")).toBe(true);
    expect(canAdvance("gagal", "selesai")).toBe(true);
    expect(canAdvance("gagal", "terkendala")).toBe(false);
    // A failed send before delivery is reported as terkendala with a reason, and may be resent later.
    expect(canAdvance("dibuat", "terkendala")).toBe(false);
    expect(canAdvance("dibuat", "terkendala", "  ")).toBe(false);
    expect(canAdvance("dibuat", "terkendala", "WhatsApp gagal terkirim")).toBe(true);
    expect(canAdvance("gagal", "terkendala", "WhatsApp gagal terkirim")).toBe(true);
    const beforeDelivery = [{ status: "dibuat" as const, at: "2026-10-30T01:20:00Z", actor: "director" }, { status: "terkendala" as const, at: "2026-10-30T01:21:00Z", actor: "bot", note: "WhatsApp gagal terkirim" }];
    expect(canAdvance("terkendala", "diteruskan", undefined, undefined, beforeDelivery)).toBe(true);
    expect(canAdvance("terkendala", "diterima_pic", undefined, undefined, beforeDelivery)).toBe(true);
    expect(canAdvance("terkendala", "diteruskan", undefined, undefined, [...beforeDelivery, { status: "diteruskan" as const, at: "2026-10-30T01:30:00Z", actor: "bot" }])).toBe(false);
    expect(canAdvance("terkendala", "diteruskan")).toBe(false);
    expect(canAdvance("dibuat", "terkirim_ke_grokbot")).toBe(false);
    expect(canAdvance("terkirim_ke_grokbot", "terkendala")).toBe(false);
    expect(canAdvance("diteruskan", "terkendala")).toBe(true);
    expect(canAdvance("diterima_pic", "terkendala")).toBe(true);
    expect(canAdvance("dikerjakan", "terkendala")).toBe(true);
    expect(canAdvance("terkendala", "dikerjakan")).toBe(true);
    expect(canAdvance("terkendala", "selesai")).toBe(true);
    expect(canAdvance("terkendala", "diterima_pic")).toBe(false);
    expect(canAdvance("terkendala", "terkendala")).toBe(false);
    expect(canAdvance("terkendala", "terkendala", "  ")).toBe(false);
    expect(canAdvance("terkendala", "terkendala", "baris\nsatu")).toBe(false);
    expect(canAdvance("terkendala", "terkendala", "x".repeat(281))).toBe(false);
    expect(canAdvance("terkendala", "terkendala", "Menunggu berkas")).toBe(true);
    expect(canAdvance("terkendala", "terkendala", "Menunggu berkas", "Menunggu berkas")).toBe(false);
    expect(canAdvance("terkendala", "terkendala", "PIC sedang rapat", "Menunggu berkas")).toBe(true);
    expect(canAdvance("selesai", "selesai")).toBe(false);
    expect(latestHistoryNote([{ status: "diteruskan", at: "2026-10-07T09:00:00Z", actor: "bot", note: "Ada" }, { status: "terkendala", at: "2026-10-07T10:00:00Z", actor: "bot", note: "  " }])).toBe("Ada");
    expect(latestHistoryNote([])).toBeNull();
  });
  it("builds the fixed WhatsApp message", () => {
    const text = messageText(parseInstructionInput({ ...base, pic: ["Aura"], note: "Rekap per item" }), "IOC-0007");
    expect(text).toBe([
      "*Arahan Direktur · IOC-0007*",
      "Prioritas · MENDESAK: Tagih status semua item RM & Klaim Senin",
      "Arahan: Minta update",
      "Tenggat: Rabu, 7 Oktober 2026 16.00 WIB",
      "PIC: Aura",
      "Catatan: Rekap per item",
      "Balas pesan ini. Boleh angka (1 Diterima · 2 Selesai · 3 Ada kendala) atau tulis kendalanya.",
    ].join("\n"));
  });
});

describe("parseInstructionInput scheduleItemId", () => {
  const base = { reportDate: "2026-10-07", section: "umum", itemId: "x", itemTitle: "Judul", urgent: false, action: "approve", deadline: null, pic: [], note: "" };
  it("accepts a uuid and rejects anything else", () => {
    const id = "0b9f6c1e-3a52-4c7e-9f31-5d0a8e2b7c44";
    expect(parseInstructionInput({ ...base, scheduleItemId: id })).toMatchObject({ scheduleItemId: id });
    expect(parseInstructionInput(base).scheduleItemId ?? null).toBeNull();
    expect(() => parseInstructionInput({ ...base, scheduleItemId: "not-a-uuid" })).toThrow();
    expect(() => parseInstructionInput({ ...base, scheduleItemId: 5 })).toThrow();
  });
});

describe("status labels", () => {
  it("labels the Director-only final statuses so the brief never renders an empty label", () => {
    expect(statusLabels.ditunda).toBe("Ditunda");
    expect(statusLabels.dibatalkan).toBe("Dibatalkan");
  });
});
