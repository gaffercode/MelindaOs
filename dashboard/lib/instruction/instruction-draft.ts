import { deadlineActions, instructionActions, validDeadline, type InstructionAction, type InstructionInput } from "../director/director-instructions";
import { findPatientIdentifiers } from "../phi-guard";

/** Drafts the Claude API makes from a Director note, and the editable cards the Arahan panel builds from them. */
export const DRAFT_LIMIT = 8;
export const NOTE_LIMIT = 2000;
const TITLE_LIMIT = 300, CARD_NOTE_LIMIT = 280, PIC_LIMIT = 8, PIC_TEXT_LIMIT = 60;

export type DraftIssue = "needs_recipient" | "deadline_not_allowed" | "recipients_invalid";
export type InstructionDraft = { title: string; action: InstructionAction; pic: string[]; deadline: string | null; note: string; urgent: boolean };
/** `context`: the section a card came from (e.g. "Jadwal hari ini"); without it the panel's page context is used. */
export type DraftCard = InstructionDraft & { itemId: string; context?: string };

export const issueLabels: Record<DraftIssue, string> = {
  needs_recipient: "Tugaskan perlu tujuan.",
  deadline_not_allowed: "Tenggat hanya untuk Minta update atau Eskalasi.",
  recipients_invalid: "Tujuan maks. 8, tiap tujuan maks. 60 karakter.",
};

// Structured-output schema. Length limits are not supported there, so parseDrafts enforces them.
export const draftSchema = {
  type: "object",
  properties: {
    drafts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "Perihal, maks. 300 karakter" },
          action: { type: "string", enum: [...instructionActions] },
          pic: { type: "array", items: { type: "string", description: "Tujuan, maks. 60 karakter" }, description: "Maks. 8 tujuan, hanya dari kata di catatan" },
          deadline: { anyOf: [{ type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$" }, { type: "null" }] },
          note: { type: "string", description: "Catatan, maks. 280 karakter" },
          urgent: { type: "boolean" },
        },
        required: ["title", "action", "pic", "deadline", "note", "urgent"],
        additionalProperties: false,
      },
    },
  },
  required: ["drafts"],
  additionalProperties: false,
} as const;

const CONTROL = /[\u0000-\u001f\u007f]/;
const oneLine = (value: string) => value.replace(/\s+/g, " ").trim();

export function draftIssues({ action, pic, deadline }: Pick<InstructionDraft, "action" | "pic" | "deadline">): DraftIssue[] {
  return [
    ...(action === "assign" && !pic.length ? ["needs_recipient" as const] : []),
    ...(deadline && !deadlineActions.includes(action) ? ["deadline_not_allowed" as const] : []),
    ...(pic.length > PIC_LIMIT || pic.some((name) => name.length > PIC_TEXT_LIMIT) ? ["recipients_invalid" as const] : []),
  ];
}

/** Recipients stay whole labels: official names contain commas ("…, A.Md.Keb."), so they are never split on text. */
export function addRecipient(pic: readonly string[], raw: string): string[] {
  const name = oneLine(raw);
  return !name || pic.includes(name) ? [...pic] : [...pic, name];
}

export function removeRecipient(pic: readonly string[], name: string): string[] {
  return pic.filter((entry) => entry !== name);
}

function cleanPic(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > PIC_LIMIT) return null;
  const names: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || CONTROL.test(entry)) return null;
    const name = entry.trim();
    if (name.length > PIC_TEXT_LIMIT) return null;
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

function parseDraft(value: unknown): InstructionDraft | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.title !== "string" || typeof record.note !== "string" || typeof record.urgent !== "boolean") return null;
  const title = oneLine(record.title), note = oneLine(record.note);
  if (!title || title.length > TITLE_LIMIT || note.length > CARD_NOTE_LIMIT) return null;
  if (typeof record.action !== "string" || !(instructionActions as readonly string[]).includes(record.action)) return null;
  const pic = cleanPic(record.pic);
  if (!pic) return null;
  const deadline = record.deadline ?? null;
  if (deadline !== null && (typeof deadline !== "string" || !validDeadline(deadline))) return null;
  if (findPatientIdentifiers([title, note, ...pic].join("\n")).length) return null;
  return { title, action: record.action as InstructionAction, pic, deadline, note, urgent: record.urgent };
}

/** Keeps at most 8 drafts. Broken items are dropped; fixable ones are kept with their issues. */
export function parseDrafts(value: unknown): (InstructionDraft & { issues: DraftIssue[] })[] {
  const list = value && typeof value === "object" && !Array.isArray(value) ? (value as { drafts?: unknown }).drafts : null;
  if (!Array.isArray(list)) return [];
  return list.map(parseDraft).filter((draft): draft is InstructionDraft => draft !== null).slice(0, DRAFT_LIMIT)
    .map((draft) => ({ ...draft, issues: draftIssues(draft) }));
}

function randomSuffix(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(6)), (byte) => alphabet[byte % alphabet.length]).join("");
}

export function cardFromDraft(draft: InstructionDraft, today: string, context?: string): DraftCard {
  return { title: draft.title, action: draft.action, pic: [...draft.pic], deadline: draft.deadline, note: draft.note, urgent: draft.urgent, itemId: `UMUM-${today.replaceAll("-", "")}-${randomSuffix()}`, ...(context ? { context } : {}) };
}

export function emptyCard(today: string): DraftCard {
  return cardFromDraft({ title: "", action: "request_update", pic: [], deadline: null, note: "", urgent: false }, today);
}

export function toInstructionInput(card: DraftCard, today: string, context: string): InstructionInput {
  const pic = [...new Set(card.pic.map((name) => name.trim()).filter(Boolean))];
  return {
    reportDate: today, section: "umum", itemId: card.itemId, itemTitle: `${card.context ?? context} · ${oneLine(card.title)}`.slice(0, TITLE_LIMIT),
    urgent: card.urgent, action: card.action, deadline: deadlineActions.includes(card.action) && card.deadline ? card.deadline : null,
    pic, note: oneLine(card.note), decisionOptionId: null, decisionLabel: null, linkedId: null,
  };
}

/** Same value while a card is unchanged, so a resend reuses its Idempotency-Key and never makes a second IOC. */
export function cardSignature(input: InstructionInput): string {
  return JSON.stringify([input.reportDate, input.section, input.itemId, input.itemTitle, input.urgent, input.action, input.deadline, input.pic, input.note]);
}
