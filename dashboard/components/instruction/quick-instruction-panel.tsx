"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { InstructionProvider, useInstructionStore } from "../director/director-instruction";
import { wibDate } from "@/lib/director/director-data";
import { actionLabels, deadlineActions, instructionActions, messageText, statusLabels, type Instruction, type InstructionAction } from "@/lib/director/director-instructions";
import type { ArahanRequest } from "@/lib/instruction/instruction-prefill";
import { NOTE_LIMIT, addRecipient, cardFromDraft, cardSignature, draftIssues, emptyCard, issueLabels, removeRecipient, toInstructionInput, type DraftCard, type InstructionDraft } from "@/lib/instruction/instruction-draft";
import { LoadingState } from "../loading-state";
import { AiActivity } from "../ai-activity";
import { toast } from "@/components/ui/toast";

type Entry = { card: DraftCard; saved?: Instruction; error?: string };

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Layanan arahan belum tersedia.");
  return body;
}

/** Loaded by QuickInstructionButton with next/dynamic on first open: the panel inside its instruction store. */
export function QuickInstructionDrawer({ context, seeds, onClose }: { context: string; seeds: (ArahanRequest & { key: number })[]; onClose: () => void }) {
  return <InstructionProvider date={wibDate()}><QuickInstructionPanel context={context} seeds={seeds} onClose={onClose} /></InstructionProvider>;
}

/** The drawer itself. Closing is blocked while cards are being sent, so no send is lost halfway. */
export function QuickInstructionPanel({ context, seeds = [], onClose }: { context: string; seeds?: (ArahanRequest & { key: number })[]; onClose: () => void }) {
  const store = useInstructionStore();
  const [today] = useState(() => wibDate());
  const [note, setNote] = useState(""), [entries, setEntries] = useState<Entry[]>([]), [message, setMessage] = useState("");
  const [drafting, setDrafting] = useState(false), [sending, setSending] = useState(false), [preview, setPreview] = useState(false);
  const [aiRun, setAiRun] = useState<"idle" | "writing" | "done" | "error">("idle");
  const keys = useRef(new Map<string, { signature: string; key: string }>());
  const closeButton = useRef<HTMLButtonElement>(null);
  const taken = useRef(new Set<number>());
  useEffect(() => {
    // Mark a seed as taken only when its card is added, so a cancelled run (Strict Mode, fast re-render) cannot drop it.
    const timer = setTimeout(() => {
      const fresh = seeds.filter((seed) => !taken.current.has(seed.key));
      if (!fresh.length) return;
      fresh.forEach((seed) => taken.current.add(seed.key));
      setEntries((current) => [...current, ...fresh.map((seed) => ({ card: cardFromDraft(seed.draft, today, seed.context) }))]);
      setPreview(false);
    }, 0);
    return () => clearTimeout(timer);
  }, [seeds, today]);
  const sendingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    closeButton.current?.focus();
    const handler = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape" && !sendingRef.current) onCloseRef.current(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  const pending = entries.filter((entry) => !entry.saved);
  const ready = pending.length > 0 && pending.every(({ card }) => card.title.trim() && !draftIssues(card).length);

  async function summarize() {
    setDrafting(true); setAiRun("writing"); setMessage("");
    try {
      const { drafts } = await readJson<{ drafts: InstructionDraft[] }>(await fetch("/api/director/instructions/draft", { method: "POST", headers: { "X-CSRF-Token": store.csrf, "Content-Type": "application/json" }, body: JSON.stringify({ note, context }) }));
      setEntries((current) => [...current.filter((entry) => entry.saved), ...drafts.map((draft) => ({ card: cardFromDraft(draft, today) }))]);
      setPreview(false); setAiRun("done");
    } catch (cause) {
      setAiRun("error");
      setMessage(`${(cause as Error).message} Arahan tetap bisa ditulis manual di bawah.`);
      setEntries((current) => current.some((entry) => !entry.saved) ? current : [...current, { card: emptyCard(today) }]);
    } finally { setDrafting(false); }
  }

  async function sendAll() {
    if (sendingRef.current) return;
    sendingRef.current = true; setSending(true); setMessage("");
    let sent = 0;
    for (const entry of pending) {
      const input = toInstructionInput(entry.card, today, context);
      const signature = cardSignature(input);
      const known = keys.current.get(entry.card.itemId);
      const key = known?.signature === signature ? known.key : crypto.randomUUID();
      keys.current.set(entry.card.itemId, { signature, key });
      try {
        const { instruction } = await readJson<{ instruction: Instruction }>(await fetch("/api/director/instructions", { method: "POST", headers: { "X-CSRF-Token": store.csrf, "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify(input) }));
        setEntries((current) => current.map((item) => item.card.itemId === entry.card.itemId ? { card: item.card, saved: instruction } : item));
        sent += 1;
      } catch (cause) {
        setEntries((current) => current.map((item) => item.card.itemId === entry.card.itemId ? { ...item, error: (cause as Error).message } : item));
      }
    }
    if (sent > 0) toast.success(sent === 1 ? "Satu arahan tercatat" : `${sent} arahan tercatat`, { description: "Tersimpan di buku besar arahan." });
    sendingRef.current = false; setSending(false);
  }

  const update = (itemId: string, card: DraftCard) => setEntries((current) => current.map((entry) => entry.card.itemId === itemId ? { card } : entry));
  const remove = (itemId: string) => setEntries((current) => current.filter((entry) => entry.card.itemId !== itemId));

  return <div className="quick-instruction-layer" role="dialog" aria-modal="true" aria-labelledby="quick-instruction-title">
    <button type="button" className="quick-instruction-scrim" aria-label="Tutup panel arahan" disabled={sending} onClick={onClose} />
    <div className="quick-instruction-panel">
    <div className="quick-instruction-head">
      <div><h2 id="quick-instruction-title">Arahan Direktur</h2><p className="director-instruction-note">{context}</p></div>
      <button ref={closeButton} type="button" className="header-icon" aria-label="Tutup panel arahan" disabled={sending} onClick={onClose}><X className="size-4" /></button>
    </div>
    {store.state !== "ready" ? <p className="director-instruction-note" role="status">{store.state === "loading" ? <LoadingState /> : store.message}</p> : <>
      <label className="director-instruction-field quick-instruction-note">Catatan Direktur
        <textarea value={note} maxLength={NOTE_LIMIT} rows={6} placeholder="Tulis atau dikte keputusan dan arahan. Jangan tulis data pasien." disabled={drafting} onChange={(event) => setNote(event.target.value)} />
      </label>
      <div className="director-instruction-buttons">
        <button type="button" className="ai-polish-button" data-busy={drafting || undefined} disabled={drafting || sending || !note.trim()} onClick={() => void summarize()}>{drafting ? "Meringkas…" : "Ringkas"}</button>
        <button type="button" className="director-instruction-link" disabled={drafting || sending} onClick={() => setEntries((current) => [...current, { card: emptyCard(today) }])}>Tambah arahan</button>
      </div>
      {aiRun !== "idle" && <AiActivity state={aiRun} label={aiRun === "writing" ? "Meringkas catatan" : undefined} />}
      {message && <p className="director-instruction-error" role="alert">{message}</p>}
      {entries.map((entry, index) => <QuickInstructionCard key={entry.card.itemId} card={entry.card} index={index} today={today} context={context} preview={preview} officials={store.officials} saved={entry.saved} error={entry.error} disabled={sending}
        onChange={(card) => update(entry.card.itemId, card)} onRemove={() => remove(entry.card.itemId)} />)}
      {pending.length > 0 && <div className="quick-instruction-footer">
        {!ready && <p className="director-instruction-error">Lengkapi perihal dan perbaiki tanda merah sebelum mengirim.</p>}
        <div className="director-instruction-buttons">
        {preview
          ? <button type="button" className="director-button" disabled={sending || !ready} onClick={() => void sendAll()}>{sending ? "Mengirim…" : "Simpan semua"}</button>
          : <button type="button" className="director-button" disabled={!ready} onClick={() => setPreview(true)}>Lihat pratinjau</button>}
        {preview && <button type="button" className="director-instruction-link" disabled={sending} onClick={() => setPreview(false)}>Ubah</button>}
        </div>
      </div>}
    </>}
    </div>
  </div>;
}

/** One instruction card: editable, preview (exact WhatsApp text), or saved (read-only with ledger status). */
export function QuickInstructionCard({ card, index, today, context, preview, officials, saved, error, disabled = false, onChange, onRemove }: {
  card: DraftCard; index: number; today: string; context: string; preview: boolean; officials: string[]; saved?: Instruction; error?: string; disabled?: boolean;
  onChange: (card: DraftCard) => void; onRemove: () => void;
}) {
  const [draftRecipient, setDraftRecipient] = useState("");
  const label = `Arahan ${index + 1}`;
  if (saved) return <section className="quick-instruction-card" aria-label={label}>
    <p className="director-instruction-status" data-state={saved.status} role="status">{saved.id} · {statusLabels[saved.status]}</p>
    <p className="quick-instruction-title">{card.title}</p>
    {error && <p className="director-instruction-error" role="alert">{error}</p>}
  </section>;
  const input = toInstructionInput(card, today, context);
  if (preview) return <section className="quick-instruction-card" aria-label={label}><pre className="director-instruction-preview">{messageText(input, "IOC-…")}</pre>{error && <p className="director-instruction-error" role="alert">{error}</p>}</section>;
  const add = (name: string) => onChange({ ...card, pic: addRecipient(card.pic, name) });
  const typed = () => { add(draftRecipient); setDraftRecipient(""); };
  const onRecipientKey = (event: KeyboardEvent<HTMLInputElement>) => { if (event.key === "Enter") { event.preventDefault(); typed(); } };
  const issues = draftIssues(card);
  const available = officials.filter((name) => !card.pic.includes(name));
  return <section className="quick-instruction-card" aria-label={label}>
    {card.context && <p className="director-instruction-note">Dari: {card.context}</p>}
    <div className="quick-instruction-head"><p className="quick-instruction-title">{label}</p><button type="button" className="director-instruction-link" disabled={disabled} onClick={onRemove}>Hapus</button></div>
    <label className="director-instruction-field">Perihal<input value={card.title} maxLength={300} disabled={disabled} onChange={(event) => onChange({ ...card, title: event.target.value })} /></label>
    <label className="director-instruction-field">Jenis
      <select value={card.action} disabled={disabled} onChange={(event) => onChange({ ...card, action: event.target.value as InstructionAction })}>
        {instructionActions.map((value) => <option key={value} value={value}>{actionLabels[value]}</option>)}
      </select>
    </label>
    <div className="director-instruction-field">Tujuan
      {card.pic.length > 0 && <ul className="quick-instruction-recipients">{card.pic.map((name) => <li key={name}><span>{name}</span><button type="button" className="director-instruction-link" disabled={disabled} aria-label={`Hapus tujuan ${name}`} onClick={() => onChange({ ...card, pic: removeRecipient(card.pic, name) })}>Hapus</button></li>)}</ul>}
      <div className="quick-instruction-add">
        <input value={draftRecipient} maxLength={60} disabled={disabled || card.pic.length >= 8} aria-label="Tambah tujuan" placeholder="Contoh: Kanit Rawat Inap" onChange={(event) => setDraftRecipient(event.target.value)} onKeyDown={onRecipientKey} />
        <button type="button" className="director-instruction-link" disabled={disabled || !draftRecipient.trim() || card.pic.length >= 8} onClick={typed}>Tambah</button>
      </div>
    </div>
    {available.length > 0 && <select className="quick-instruction-pick" value="" aria-label="Pilih cepat pejabat" disabled={disabled || card.pic.length >= 8} onChange={(event) => { if (event.target.value) add(event.target.value); }}>
      <option value="">Pilih pejabat…</option>
      {available.map((name) => <option key={name} value={name}>{name}</option>)}
    </select>}
    {(deadlineActions.includes(card.action) || card.deadline) && <label className="director-instruction-field">Tenggat (opsional)<input type="datetime-local" value={card.deadline ?? ""} disabled={disabled} onChange={(event) => onChange({ ...card, deadline: event.target.value || null })} /></label>}
    <label className="director-instruction-field">Catatan<textarea value={card.note} maxLength={280} rows={3} disabled={disabled} onChange={(event) => onChange({ ...card, note: event.target.value })} /></label>
    <label className="quick-instruction-urgent"><input type="checkbox" checked={card.urgent} disabled={disabled} onChange={(event) => onChange({ ...card, urgent: event.target.checked })} />Mendesak</label>
    {issues.map((issue) => <p key={issue} className="director-instruction-error">{issueLabels[issue]}{issue === "deadline_not_allowed" && <> <button type="button" className="director-instruction-link" onClick={() => onChange({ ...card, deadline: null })}>Hapus tenggat</button></>}</p>)}
    {error && <p className="director-instruction-error" role="alert">{error}</p>}
  </section>;
}
