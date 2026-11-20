import { describe, expect, it } from "vitest";
import { parseInstructionInput } from "@/lib/director/director-instructions";
import { DRAFT_LIMIT, NOTE_LIMIT, addRecipient, cardFromDraft, removeRecipient, cardSignature, draftIssues, draftSchema, emptyCard, issueLabels, parseDrafts, toInstructionInput, type InstructionDraft } from "@/lib/instruction/instruction-draft";

const today = "2026-11-05";
const valid: InstructionDraft = { title: "Ketua pokja PMKP", action: "assign", pic: ["Kepala SDM – Oriza Rahmawati, A.Md.Keb."], deadline: null, note: "Ketua Pokja PMKP: dr. Novia Dwi Anggraini.", urgent: false };
const wrap = (drafts: unknown[]) => ({ drafts });

describe("parseDrafts", () => {
  it("keeps valid drafts and caps them at 8", () => {
    expect(DRAFT_LIMIT).toBe(8);
    expect(NOTE_LIMIT).toBe(2000);
    const parsed = parseDrafts(wrap(Array.from({ length: 10 }, (_, index) => ({ ...valid, title: `Arahan ${index + 1}` }))));
    expect(parsed).toHaveLength(8);
    expect(parsed[0]).toEqual({ ...valid, title: "Arahan 1", issues: [] });
  });
  it("drops structurally broken drafts", () => {
    const broken = [
      "teks", null, { ...valid, title: "  " }, { ...valid, title: "x".repeat(301) }, { ...valid, action: "hapus" },
      { ...valid, note: "x".repeat(281) }, { ...valid, pic: Array.from({ length: 9 }, (_, index) => `T${index}`) },
      { ...valid, pic: ["x".repeat(61)] }, { ...valid, action: "request_update", deadline: "besok" }, { ...valid, urgent: "ya" },
    ];
    expect(parseDrafts(wrap([...broken, valid]))).toEqual([{ ...valid, issues: [] }]);
    expect(parseDrafts("bukan objek")).toEqual([]);
    expect(parseDrafts({ drafts: "x" })).toEqual([]);
  });
  it("keeps and flags drafts the Director can fix", () => {
    const parsed = parseDrafts(wrap([{ ...valid, pic: [] }, { ...valid, deadline: "2026-11-06T16:00" }]));
    expect(parsed.map((draft) => draft.issues)).toEqual([["needs_recipient"], ["deadline_not_allowed"]]);
    expect(issueLabels.needs_recipient).toBe("Tugaskan perlu tujuan.");
    expect(issueLabels.deadline_not_allowed).toBe("Tenggat hanya untuk Minta update atau Eskalasi.");
    expect(draftIssues({ action: "request_update", pic: [], deadline: "2026-11-06T16:00" })).toEqual([]);
  });
  it("drops a draft that carries a patient identifier anywhere", () => {
    const leaks = [{ ...valid, title: "Kamar Ny. Sari" }, { ...valid, note: "Cek Ny. Sari" }, { ...valid, pic: ["Keluarga Ny. Sari"] }];
    expect(parseDrafts(wrap([...leaks, valid]))).toHaveLength(1);
  });
  it("trims and deduplicates recipients", () => {
    expect(parseDrafts(wrap([{ ...valid, pic: [" Tim Akreditasi ", "Tim Akreditasi", ""] }]))[0]!.pic).toEqual(["Tim Akreditasi"]);
  });
});

describe("cards", () => {
  it("builds an instruction input that the create endpoint accepts", () => {
    const card = cardFromDraft(valid, today);
    expect(card.itemId).toMatch(/^UMUM-20261105-[a-z0-9]{6}$/);
    const input = toInstructionInput(card, today, "STARKES Command");
    expect(input.itemTitle).toBe("STARKES Command · Ketua pokja PMKP");
    expect(input).toMatchObject({ section: "umum", reportDate: today, decisionOptionId: null, decisionLabel: null, linkedId: null });
    expect(parseInstructionInput(input)).toEqual(input);
  });
  it("keeps a deadline only for actions that take one, and cuts long titles at 300", () => {
    const card = { ...cardFromDraft({ ...valid, title: "y".repeat(300), deadline: "2026-11-06T16:00" }, today) };
    const input = toInstructionInput(card, today, "Arahan Direktur");
    expect(input.deadline).toBeNull();
    expect(input.itemTitle).toHaveLength(300);
    expect(toInstructionInput({ ...card, action: "escalate" }, today, "X").deadline).toBe("2026-11-06T16:00");
  });
  it("gives the same signature only while a card is unchanged", () => {
    const card = cardFromDraft(valid, today);
    const signature = cardSignature(toInstructionInput(card, today, "STARKES Command"));
    expect(cardSignature(toInstructionInput({ ...card }, today, "STARKES Command"))).toBe(signature);
    for (const change of [{ title: "Lain" }, { note: "Lain" }, { pic: ["Lain"] }, { urgent: true }, { action: "approve" as const }]) {
      expect(cardSignature(toInstructionInput({ ...card, ...change }, today, "STARKES Command"))).not.toBe(signature);
    }
  });
  it("starts an empty card as a request for an update", () => {
    expect(emptyCard(today)).toMatchObject({ title: "", action: "request_update", pic: [], deadline: null, note: "", urgent: false });
  });
  it("describes the drafts shape for structured output", () => {
    const item = draftSchema.properties.drafts.items;
    expect(item.required).toEqual(["title", "action", "pic", "deadline", "note", "urgent"]);
    expect(item.additionalProperties).toBe(false);
    expect(JSON.stringify(draftSchema)).not.toMatch(/maxLength|minLength|maximum|minimum/);
  });
});

describe("review fixes", () => {
  it("keeps recipient labels with commas intact and ignores duplicates and blanks", () => {
    const oriza = "Kepala SDM – Oriza Rahmawati, A.Md.Keb.";
    expect(addRecipient(["Tim Akreditasi"], `  ${oriza} `)).toEqual(["Tim Akreditasi", oriza]);
    expect(addRecipient([oriza], oriza)).toEqual([oriza]);
    expect(addRecipient([oriza], "   ")).toEqual([oriza]);
    expect(removeRecipient(["Tim Akreditasi", oriza], oriza)).toEqual(["Tim Akreditasi"]);
  });
  it("joins typed line breaks in a card note so the create endpoint accepts it", () => {
    const input = toInstructionInput({ ...cardFromDraft(valid, today), note: "baris satu\nbaris dua" }, today, "Arahan Direktur");
    expect(input.note).toBe("baris satu baris dua");
    expect(parseInstructionInput(input)).toEqual(input);
  });
  it("flags too many or too long recipients before sending", () => {
    expect(draftIssues({ action: "request_update", pic: Array.from({ length: 9 }, (_, index) => `T${index}`), deadline: null })).toEqual(["recipients_invalid"]);
    expect(draftIssues({ action: "request_update", pic: ["x".repeat(61)], deadline: null })).toEqual(["recipients_invalid"]);
    expect(issueLabels.recipients_invalid).toBe("Tujuan maks. 8, tiap tujuan maks. 60 karakter.");
  });
});

describe("card context", () => {
  it("prefers the card's own context over the panel's", () => {
    const card = cardFromDraft(valid, today, "Jadwal hari ini");
    expect(card.context).toBe("Jadwal hari ini");
    expect(toInstructionInput(card, today, "RSIA Melinda DHAI").itemTitle).toBe("Jadwal hari ini · Ketua pokja PMKP");
    expect(toInstructionInput(cardFromDraft(valid, today), today, "RSIA Melinda DHAI").itemTitle).toBe("RSIA Melinda DHAI · Ketua pokja PMKP");
  });
});
