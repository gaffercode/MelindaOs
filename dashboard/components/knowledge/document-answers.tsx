"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AnswerList } from "@/lib/director/director-answers-api";
import { CORRECTION_MAX, lineState, saveError, type DirectorQueue, type QueueItem, type SlotDecision, type SlotLock, type StoredAnswer } from "@/lib/knowledge/document-answer-rules";
import { fromDocumentLine, openArahan } from "@/lib/instruction/instruction-prefill";
import { clearAnswer, fetchAnswers, saveAnswer } from "./document-answers-client";

export type DocumentAnswersProps = { queue: DirectorQueue | null };

type Doc = { docPath: string; docTitle: string; items: QueueItem[] };
type Answers = Map<string, StoredAnswer>;

const LOCK_TEXT: Record<SlotLock, string> = {
  number: "Menunggu penomoran resmi.",
  date: "Ditetapkan saat pengesahan.",
  signature: "Diisi saat penandatanganan.",
  clinical: "Butir klinis, perlu kutipan sumber.",
  heading: "Judul, tidak diisi di sini.",
};
const SKIP: SlotDecision = { decision: "skip", text: "" };

/** One name per placeholder of a line: its table column and description, and its place on the line when two would read the same. */
function slotLabels(item: QueueItem): string[] {
  const names = item.slots.map((slot) => {
    const description = slot.detail ?? slot.placeholder;
    return slot.header ? `${slot.header} · ${description}` : description;
  });
  return names.map((name, index) => (names.indexOf(name) === names.lastIndexOf(name) ? name : `Butir ${index + 1} dari ${names.length} · ${name}`));
}
const INPUT = "h-11 w-full min-w-0 rounded-lg border border-[var(--line)] bg-transparent px-3 disabled:opacity-60";
const BUTTON = "h-11 rounded-lg border border-[var(--line)] px-4 font-medium disabled:opacity-60";
const PRIMARY = `${BUTTON} bg-[var(--accent)] text-white`;
const CARD = "rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4";
const SUBHEAD = "m-0 text-[length:var(--type-title-sm)] font-medium";
const NETWORK_ERROR = "Tidak dapat menghubungi server. Coba lagi.";

// fetch rejects with a TypeError when the server cannot be reached; every other Error carries the API's own message.
const messageOf = (caught: unknown) => (caught instanceof Error && !(caught instanceof TypeError) ? caught.message : NETWORK_ERROR);

function documentsOf(items: QueueItem[]): Doc[] {
  const byPath = new Map<string, Doc>();
  for (const item of items) {
    const doc = byPath.get(item.docPath) ?? { docPath: item.docPath, docTitle: item.docTitle, items: [] };
    doc.items.push(item);
    byPath.set(item.docPath, doc);
  }
  return [...byPath.values()];
}
const isOpen = (item: QueueItem, answers: Answers) => lineState(item, answers.get(item.id)) === "open";
const openLines = (doc: Doc, answers: Answers) => doc.items.filter((item) => isOpen(item, answers)).length;

/** The Director's queue of open document lines. `queue` is the bundled queue file, or null when the build did not bundle it. */
export function DocumentAnswers({ queue }: DocumentAnswersProps) {
  return <>
    <header>
      <h1 className="m-0 text-[length:var(--type-title)] font-medium">Isian dokumen</h1>
      <p className="m-0 mt-1 text-[var(--muted)]">Jawaban disimpan di sini. Dokumen baru berubah setelah jawaban diterapkan lewat repositori.</p>
      <p className="m-0 mt-1 text-[var(--muted)]">Jangan menulis data pasien di sini.</p>
    </header>
    {queue ? <AnswerQueue queue={queue} /> : <p role="status" className="m-0">Daftar isian belum tersedia.</p>}
  </>;
}

function AnswerQueue({ queue }: { queue: DirectorQueue }) {
  const [answers, setAnswers] = useState<Answers>(new Map());
  const [orphaned, setOrphaned] = useState<StoredAnswer[]>([]);
  const [load, setLoad] = useState<"loading" | "ready" | "down">("loading");
  const [position, setPosition] = useState<{ docPath: string; index: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const apply = useCallback((list: AnswerList): Answers => {
    const next: Answers = new Map(list.answers.map((answer) => [answer.id, answer]));
    setAnswers(next); setOrphaned(list.orphaned); setLoad("ready");
    return next;
  }, []);
  const reload = async () => apply(await fetchAnswers());

  useEffect(() => {
    const controller = new AbortController();
    fetchAnswers(controller.signal).then(apply).catch(() => { if (!controller.signal.aborted) setLoad("down"); });
    return () => controller.abort();
  }, [apply]);

  const documents = useMemo(() => documentsOf(queue.items), [queue.items]);
  const ready = load === "ready";
  const locked = !ready || busy;
  const openCount = queue.items.filter((item) => isOpen(item, answers)).length;
  const answeredCount = queue.items.filter((item) => lineState(item, answers.get(item.id)) === "answered").length;
  const lockedSlots = queue.items.reduce((total, item) => total + item.slots.filter((slot) => slot.lock !== null).length, 0);
  // Documents with nothing left to answer go last; inside each group the queue order stays.
  const listed = [...documents.filter((doc) => openLines(doc, answers) > 0), ...documents.filter((doc) => openLines(doc, answers) === 0)];
  const doc = position ? documents.find((candidate) => candidate.docPath === position.docPath) : undefined;
  const item = doc && position ? doc.items[position.index] : undefined;

  function open(target: Doc) {
    setError("");
    setPosition({ docPath: target.docPath, index: Math.max(target.items.findIndex((line) => isOpen(line, answers)), 0) });
  }
  function move(index: number) {
    if (!position) return;
    setError("");
    setPosition({ docPath: position.docPath, index });
  }
  async function save(target: Doc, index: number, slots: SlotDecision[]) {
    const line = target.items[index];
    const problem = saveError(line, slots, queue.valueRules);
    if (problem) { setError(`Jawaban belum tersimpan. ${problem}`); return; }
    setBusy(true); setError("");
    try {
      await saveAnswer(line.id, slots);
    } catch (caught: unknown) {
      setError(`Jawaban belum tersimpan. ${messageOf(caught)}`); setBusy(false);
      return;
    }
    try {
      const stored = await reload();
      // The next open line of this document: the ones after this line first, then the ones before it.
      const others = [...target.items.keys()].filter((candidate) => candidate !== index);
      const next = [...others.filter((candidate) => candidate > index), ...others.filter((candidate) => candidate < index)].find((candidate) => isOpen(target.items[candidate], stored));
      setPosition(next === undefined ? null : { docPath: target.docPath, index: next });
    } catch {
      setLoad("down");
    } finally {
      setBusy(false);
    }
  }
  async function clear(id: string) {
    setBusy(true); setError("");
    try {
      await clearAnswer(id);
      await reload();
    } catch (caught: unknown) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }
  function forward(line: QueueItem) {
    const details = [...new Set(line.slots.filter((slot) => slot.lock === null).map((slot) => slot.detail ?? ""))];
    setError(openArahan({ context: "Isian dokumen", draft: fromDocumentLine(line, details) }) ? "" : "Panel arahan belum tersedia.");
  }

  return <>
    <section aria-label="Ringkasan" className="flex flex-wrap items-center justify-between gap-3">
      <p className="m-0">{openCount} baris belum dijawab · {answeredCount} sudah dijawab · {lockedSlots} butir terkunci</p>
      {ready && <a href="/api/director/document-answers/unduh" download className="font-medium underline">Unduh jawaban</a>}
    </section>
    {load === "down" && <p role="status" className="m-0 text-[var(--orange-ink)]">Penyimpanan jawaban belum aktif.</p>}
    {error && <p role="alert" className="m-0 text-[var(--orange-ink)]">{error}</p>}

    {doc && item && position
      ? <section aria-label={doc.docTitle} className={`${CARD} grid gap-4`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" className={BUTTON} onClick={() => { setError(""); setPosition(null); }}>Kembali ke daftar dokumen</button>
          <p className="m-0 text-[var(--muted)]">Baris {position.index + 1} dari {doc.items.length}</p>
        </div>
        <h2 className={SUBHEAD}>{doc.docTitle}</h2>
        <LineEditor
          key={`${item.id}:${answers.get(item.id)?.answeredAt ?? ""}`}
          item={item} answer={answers.get(item.id)} maxLength={queue.valueRules.maxLength} disabled={locked}
          onSave={(slots) => void save(doc, position.index, slots)} onClear={() => void clear(item.id)} onForward={() => forward(item)}
        />
        <div className="flex flex-wrap gap-2">
          <button type="button" className={BUTTON} disabled={position.index === 0} onClick={() => move(position.index - 1)}>Sebelumnya</button>
          <button type="button" className={BUTTON} disabled={position.index === doc.items.length - 1} onClick={() => move(position.index + 1)}>Berikutnya</button>
        </div>
      </section>
      : <ul className="m-0 grid list-none gap-2 p-0">
        {listed.map((entry) => {
          const left = openLines(entry, answers);
          return <li key={entry.docPath}>
            <button type="button" className="flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 text-left" onClick={() => open(entry)}>
              <span className="font-medium">{entry.docTitle}</span>
              <span className="text-[var(--muted)]">{left > 0 ? `${left} baris belum dijawab` : "Selesai dijawab"}</span>
            </button>
          </li>;
        })}
      </ul>}

    {queue.drafts.length > 0 && <section aria-labelledby="answers-drafts-title">
      <h2 id="answers-drafts-title" className={`${SUBHEAD} mb-3`}>Dokumen berstatus draf tanpa isian</h2>
      <ul className="m-0 grid list-none gap-2 p-0">
        {queue.drafts.map((path) => <li key={path} className="rounded-xl border border-[var(--line)] p-3">{path}</li>)}
      </ul>
    </section>}

    {orphaned.length > 0 && <section aria-labelledby="answers-orphaned-title">
      <h2 id="answers-orphaned-title" className={`${SUBHEAD} mb-3`}>Jawaban untuk baris yang sudah berubah</h2>
      <ul className="m-0 grid list-none gap-2 p-0">
        {orphaned.map((answer) => <li key={answer.id} className="grid gap-2 rounded-xl border border-[var(--line)] p-3">
          <p className="m-0 text-[var(--muted)]">{answer.docPath}</p>
          <p className="m-0 whitespace-pre-wrap font-mono">{answer.lineText}</p>
          <p className="m-0">{answer.slots.filter((slot) => slot.decision !== "skip").map((slot) => slot.decision === "confirm" ? "Benar" : slot.text).join(" · ")}</p>
          <div><button type="button" className={BUTTON} disabled={locked} onClick={() => void clear(answer.id)}>Hapus</button></div>
        </li>)}
      </ul>
    </section>}
  </>;
}

/** One document line. Remounted (by key) when the line or its stored answer changes, so typed text never carries over. */
function LineEditor({ item, answer, maxLength, disabled, onSave, onClear, onForward }: {
  item: QueueItem; answer: StoredAnswer | undefined; maxLength: number; disabled: boolean;
  onSave: (slots: SlotDecision[]) => void; onClear: () => void; onForward: () => void;
}) {
  // A stored answer seeds the controls even when the line is still open, so a second save keeps what was saved before.
  const [draft, setDraft] = useState<SlotDecision[]>(() => item.slots.map((_, index) => {
    const stored = answer?.slots[index];
    return stored ? { decision: stored.decision, text: stored.text } : SKIP;
  }));
  const set = (index: number, next: SlotDecision) => setDraft((current) => current.map((slot, at) => (at === index ? next : slot)));
  const answerable = item.slots.some((slot) => slot.lock === null);
  const labels = slotLabels(item);
  const slots = () => draft.map((slot, index): SlotDecision => {
    if (item.slots[index].lock !== null) return SKIP;
    return slot.decision === "value" || slot.decision === "correction" ? { decision: slot.decision, text: slot.text.trim() } : { decision: slot.decision, text: "" };
  });

  return <>
    {item.heading && <p className="m-0 text-[var(--muted)]">{item.heading.replace(/^#+\s*/, "")}</p>}
    <p className="m-0 whitespace-pre-wrap rounded-lg border border-[var(--line)] p-3 font-mono">{item.text}</p>
    <div className="grid gap-4">
      {item.slots.map((slot, index) => {
        const id = `answer-${item.id}-${index}`;
        const label = labels[index];
        const { decision, text } = draft[index];
        if (slot.lock !== null) return <div key={id} className="grid gap-1">
          <p className="m-0 font-medium">{label}</p>
          <p className="m-0 text-[var(--muted)]">{LOCK_TEXT[slot.lock]}</p>
        </div>;
        if (slot.kind === "ISI") return <div key={id} className="grid gap-1">
          <label htmlFor={id} className="font-medium">{label}</label>
          <input id={id} type="text" autoComplete="off" maxLength={maxLength} disabled={disabled} value={text} className={INPUT}
            onChange={(event) => set(index, { decision: event.target.value.trim() ? "value" : "skip", text: event.target.value })} />
        </div>;
        return <fieldset key={id} className="m-0 grid min-w-0 gap-2 border-0 p-0">
          <legend className="p-0 font-medium">{label}</legend>
          <div className="flex flex-wrap gap-2">
            <button type="button" aria-pressed={decision === "confirm"} disabled={disabled} className={decision === "confirm" ? PRIMARY : BUTTON}
              onClick={() => set(index, decision === "confirm" ? SKIP : { decision: "confirm", text: "" })}>Benar</button>
            <button type="button" aria-pressed={decision === "correction"} disabled={disabled} className={decision === "correction" ? PRIMARY : BUTTON}
              onClick={() => set(index, decision === "correction" ? SKIP : { decision: "correction", text: "" })}>Perlu koreksi</button>
          </div>
          {decision === "correction" && <div className="grid gap-1">
            <label htmlFor={`${id}-note`}>Catatan koreksi</label>
            <input id={`${id}-note`} type="text" autoComplete="off" maxLength={CORRECTION_MAX} disabled={disabled} value={text} className={INPUT}
              onChange={(event) => set(index, { decision: "correction", text: event.target.value })} />
          </div>}
        </fieldset>;
      })}
    </div>
    <div className="flex flex-wrap gap-2">
      <button type="button" className={PRIMARY} disabled={disabled || !answerable} onClick={() => onSave(slots())}>Simpan</button>
      <button type="button" className={BUTTON} disabled={disabled} onClick={onForward}>Teruskan ke staf</button>
      {answer && <button type="button" className={BUTTON} disabled={disabled} onClick={onClear}>Hapus jawaban</button>}
    </div>
    <p className="m-0 text-[var(--muted)]">Balasan staf tidak masuk ke antrean ini.</p>
  </>;
}
