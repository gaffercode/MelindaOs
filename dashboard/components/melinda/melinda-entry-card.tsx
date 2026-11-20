"use client";

import { ArrowUp, Square } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import type { MelindaBriefing } from "@/lib/melinda/briefing";
import { sendMelinda } from "@/lib/melinda/client";
import { MELINDA_GREETING, MELINDA_MAX_MESSAGE } from "@/lib/melinda/limits";
import type { TurnEvent } from "@/lib/melinda/turn";
import { MELINDA_QUICK_ASKS } from "./melinda-briefing";
import { MelindaMarkdown } from "./melinda-markdown";
import MatrixOrb from "@/components/ui/matrix-orb";
import "./melinda.css";

export const MELINDA_OPEN_KEY = "melinda:open";

export function takeOpenConversation(storage: Pick<Storage, "getItem" | "removeItem">): string | null {
  const id = storage.getItem(MELINDA_OPEN_KEY);
  if (id !== null) storage.removeItem(MELINDA_OPEN_KEY);
  return id;
}

type Turn = { id: string; question: string; answer: string; error: string | null };

/** Row 1 of the home page: Melinda answers right here, and the full page picks up the same conversation. */
export function MelindaEntryCard({ briefing }: { briefing: MelindaBriefing | null }) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const [composing, setComposing] = useState(false);
  const waiting = briefing?.tasks.state === "ok" ? briefing.tasks.waiting : 0;

  useEffect(() => () => abortRef.current?.abort(), []);

  // The log scrolls inside the card, so a streaming answer never moves the page.
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [turns, status]);

  const updateLast = (change: (turn: Turn) => Turn) => setTurns((current) => current.map((turn, index) => (index === current.length - 1 ? change(turn) : turn)));

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setDraft("");
    setTurns((current) => [...current, { id: crypto.randomUUID(), question: message, answer: "", error: null }]);
    setBusy(true);

    const onEvent = (event: TurnEvent) => {
      if (event.type === "conversation") setConversationId(event.id);
      else if (event.type === "status") setStatus(event.label);
      else if (event.type === "text") { setStatus(null); updateLast((turn) => ({ ...turn, answer: turn.answer + event.delta })); }
      else if (event.type === "error") updateLast((turn) => ({ ...turn, error: event.message }));
    };

    await sendMelinda({ conversationId, message, onEvent, signal: controller.signal });
    if (controller.signal.aborted) return;
    setBusy(false);
    setStatus(null);
  }

  function stop() {
    abortRef.current?.abort();
    setBusy(false);
    setStatus(null);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void send(draft);
  }

  function continueOnPage() {
    if (conversationId) try { window.sessionStorage.setItem(MELINDA_OPEN_KEY, conversationId); } catch { /* Without storage the page still opens, with the conversation in its history. */ }
    router.push("/melinda");
  }

  return <div className="melinda-entry" data-busy={busy ? "" : undefined} data-talking={turns.length ? "" : undefined}>
    <div className="melinda-entry-head">
      <div className="melinda-orb" aria-hidden="true">
        <MatrixOrb size={72} state={busy ? "thinking" : composing ? "listening" : "idle"} />
      </div>
      <div className="melinda-entry-intro">
        <p className="melinda-entry-hello">{briefing?.greeting ?? MELINDA_GREETING}</p>
        {waiting > 0 && <p className="melinda-line">{waiting} tugas menunggu</p>}
      </div>
    </div>

    {turns.length === 0
      ? <div className="melinda-asks">{MELINDA_QUICK_ASKS.map((text) => <button key={text} type="button" onClick={() => void send(text)}>{text}</button>)}</div>
      : <div ref={logRef} className="melinda-entry-log">
        {turns.map((turn, index) => <div key={turn.id} className="melinda-entry-turn">
          <p className="melinda-bubble">{turn.question}</p>
          <div className="melinda-answer-body">
            {turn.answer && <MelindaMarkdown text={turn.answer} />}
            {busy && index === turns.length - 1 && <p role="status" className="melinda-status"><span className="melinda-dots" aria-hidden="true"><i /><i /><i /></span>{status ?? "Melinda sedang membaca"}</p>}
            {turn.error && <p role="alert" className="text-[var(--warn)]">{turn.error}</p>}
          </div>
        </div>)}
      </div>}

    <form className="melinda-composer" onSubmit={submit}>
      <textarea onFocus={() => setComposing(true)} onBlur={() => setComposing(false)} rows={1} value={draft} maxLength={MELINDA_MAX_MESSAGE} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) submit(event); }} placeholder="Tulis pesan untuk Melinda" aria-label="Pesan untuk Melinda" />
      {busy
        ? <button type="button" onClick={stop} aria-label="Hentikan jawaban"><Square className="size-4" fill="currentColor" aria-hidden="true" /></button>
        : <button type="submit" disabled={!draft.trim()} aria-label="Kirim pertanyaan"><ArrowUp className="size-5" aria-hidden="true" /></button>}
    </form>
    {conversationId && !busy && <button type="button" className="melinda-entry-open" onClick={continueOnPage}>Lanjutkan di halaman Melinda</button>}
  </div>;
}
