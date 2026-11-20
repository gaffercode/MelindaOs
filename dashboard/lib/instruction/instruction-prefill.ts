import type { InstructionAction } from "../director/director-instructions";
import type { InstructionDraft } from "./instruction-draft";

/**
 * "Teruskan ke staf": rows the Director works on (agenda, [ISI] gaps, STARKES chapters) open the same
 * Arahan panel with a pre-filled card. The Director still previews and sends; Katt relays the text unchanged.
 */
export const ARAHAN_EVENT = "melinda:arahan";
export type ArahanRequest = { context: string; draft: InstructionDraft };
export type ScheduleStatus = "selesai" | "berjalan" | "menunggu" | "tunda";

const TITLE_LIMIT = 300, NOTE_LIMIT = 280, PIC_LIMIT = 8, PIC_TEXT_LIMIT = 60;
const oneLine = (value: string) => value.replace(/\s+/g, " ").trim();
const cut = (value: string, limit: number) => oneLine(value).slice(0, limit).trim();
const SELF = /^(direktur|direktur utama|dr\.?\s*ferdi\b.*|gaffer)$/i;

export function scheduleAction(status: ScheduleStatus): InstructionAction {
  return status === "tunda" ? "defer" : status === "selesai" ? "done" : "request_update";
}

/** "Direktur / dr. Novia / Bu Oriza" → ["dr. Novia", "Bu Oriza"]. Katt resolves the names against its contacts. */
export function recipientsFromSiapa(siapa: string): string[] {
  const names = siapa.split("/").map((name) => cut(name, PIC_TEXT_LIMIT)).filter((name) => name && name !== "-" && !SELF.test(name));
  return [...new Set(names)].slice(0, PIC_LIMIT);
}

export function fromSchedule(row: { waktu: string; kegiatan: string; siapa: string }, status: ScheduleStatus, remark: string): InstructionDraft {
  return { title: cut(`${row.waktu} · ${row.kegiatan}`, TITLE_LIMIT), action: scheduleAction(status), pic: recipientsFromSiapa(row.siapa), deadline: null, note: cut(remark, NOTE_LIMIT), urgent: false };
}

export function fromGap(request: { id?: string; title: string; pic: string; context: string }, directorNote: string): InstructionDraft {
  const pic = cut(request.pic, PIC_TEXT_LIMIT);
  const note = oneLine(directorNote) ? cut(directorNote, NOTE_LIMIT) : cut(`Mohon lengkapi data laporan: ${request.context}`, NOTE_LIMIT);
  return { title: cut(`Lengkapi data: ${request.title}`, TITLE_LIMIT), action: "request_update", pic: pic && pic !== "-" ? [pic] : [], deadline: null, note, urgent: false };
}

export function fromStarkesChapter(chapter: { code: string; name: string }, lead: string | null): InstructionDraft {
  return { title: cut(`STARKES ${chapter.code} · ${chapter.name}`, TITLE_LIMIT), action: "assign", pic: lead ? [cut(lead, PIC_TEXT_LIMIT)] : [], deadline: null, note: "", urgent: false };
}

/** A document line the Director cannot answer himself: the note names what is missing, or quotes the line when nothing names it. */
export function fromDocumentLine(item: { docTitle: string; text: string }, details: string[]): InstructionDraft {
  return { title: cut(`Lengkapi dokumen: ${item.docTitle}`, TITLE_LIMIT), action: "request_update", pic: [], deadline: null, note: cut(details.filter(Boolean).join("; ") || item.text, NOTE_LIMIT), urgent: false };
}

/** Asks the Arahan panel in the page header to open with this card. False when no signed-in panel is listening. */
export function openArahan(request: ArahanRequest): boolean {
  if (typeof window === "undefined") return false;
  const event = new CustomEvent<ArahanRequest & { handled: boolean }>(ARAHAN_EVENT, { detail: { ...request, handled: false } });
  window.dispatchEvent(event);
  return event.detail.handled;
}
