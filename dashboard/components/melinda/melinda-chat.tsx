"use client";

import { ArrowUp, Check, Copy, History, Info, Square } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { type FormEvent, type KeyboardEvent, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { directorCsrfHeaders } from "@/lib/client-api";
import type { MelindaBriefing } from "@/lib/melinda/briefing";
import { sendMelinda } from "@/lib/melinda/client";
import { MELINDA_MAX_MESSAGE } from "@/lib/melinda/limits";
import type { MelindaConversation, MelindaMessage, MelindaSource } from "@/lib/melinda/store";
import type { TurnEvent } from "@/lib/melinda/turn";
import { MelindaBriefingView } from "./melinda-briefing";
import { takeOpenConversation } from "./melinda-entry-card";
import { MelindaHistory } from "./melinda-history";
import { MelindaMarkdown } from "./melinda-markdown";
import "./melinda.css";

type Bubble = { id: string; role: "user" | "assistant"; content: string; sources: MelindaSource[]; complete: boolean; error: string | null };

const bubbleOf = (message: MelindaMessage): Bubble => ({ id: message.id, role: message.role === "user" ? "user" : "assistant", content: message.content, sources: message.sources, complete: message.complete, error: null });
const newBubble = (role: Bubble["role"], content: string): Bubble => ({ id: crypto.randomUUID(), role, content, sources: [], complete: true, error: null });
const hasMessages = (value: unknown): value is { messages: MelindaMessage[] } => typeof value === "object" && value !== null && "messages" in value && Array.isArray(value.messages);

function CopyAnswer({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); window.setTimeout(() => setCopied(false), 1600); } catch { setCopied(false); }
  }
  return <button type="button" className="melinda-copy" onClick={() => void copy()} aria-label="Salin jawaban">
    {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}{copied ? "Tersalin" : "Salin"}
  </button>;
}

export function MelindaChat({ briefing, initialConversations }: { briefing: MelindaBriefing; initialConversations: MelindaConversation[] }) {
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [conversations, setConversations] = useState(initialConversations);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const openFromHome = useEffectEvent(() => {
    let id: string | null = null;
    try { id = takeOpenConversation(window.sessionStorage); } catch { return; }
    if (id) void open(id);
  });

  // The timer lets a development double-mount cancel the first run, so the conversation is taken and opened exactly once.
  useEffect(() => {
    const timer = window.setTimeout(openFromHome, 0);
    return () => { window.clearTimeout(timer); abortRef.current?.abort(); };
  }, []);

  // Follows the answer only while the reader is already at the end, so scrolling back is not undone by the next word.
  useLayoutEffect(() => {
    const end = endRef.current;
    if (end && end.getBoundingClientRect().top <= window.innerHeight + 160) end.scrollIntoView({ block: "end" });
  }, [bubbles, status]);

  const updateLast = (change: (bubble: Bubble) => Bubble) => setBubbles((current) => current.map((bubble, index) => (index === current.length - 1 ? change(bubble) : bubble)));

  async function send(text: string, base: Bubble[] = bubbles, conversationId: string | null = activeId) {
    const message = text.trim();
    if (!message || busy) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setNotice(null);
    setDraft("");
    setBubbles([...base, newBubble("user", message), newBubble("assistant", "")]);
    setBusy(true);

    const onEvent = (event: TurnEvent) => {
      if (event.type === "conversation") {
        setActiveId(event.id);
        setConversations((current) => [{ id: event.id, title: message.replace(/\s+/g, " ").slice(0, 60), updatedAt: new Date().toISOString() }, ...current]);
      } else if (event.type === "status") setStatus(event.label);
      else if (event.type === "text") { setStatus(null); updateLast((bubble) => ({ ...bubble, content: bubble.content + event.delta })); }
      else if (event.type === "sources") updateLast((bubble) => ({ ...bubble, sources: event.sources }));
      else if (event.type === "error") updateLast((bubble) => ({ ...bubble, error: event.message }));
      else updateLast((bubble) => ({ ...bubble, complete: event.complete }));
    };

    await sendMelinda({ conversationId, message, onEvent, signal: controller.signal });
    if (controller.signal.aborted) return;
    setBusy(false);
    setStatus(null);
  }

  /** Sends the last question again; the failed exchange leaves the screen but stays in the saved history. */
  function retry() {
    const lastUser = bubbles.findLastIndex((bubble) => bubble.role === "user");
    if (lastUser >= 0) void send(bubbles[lastUser].content, bubbles.slice(0, lastUser));
  }

  function stopCurrent() {
    abortRef.current?.abort();
    setBusy(false);
    setStatus(null);
  }

  function startNew() {
    stopCurrent();
    setBubbles([]);
    setActiveId(null);
    setNotice(null);
    setHistoryOpen(false);
  }

  async function open(id: string) {
    stopCurrent();
    setHistoryOpen(false);
    setNotice(null);
    try {
      const response = await fetch(`/api/melinda/conversations/${encodeURIComponent(id)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("unreadable");
      const body: unknown = await response.json();
      if (!hasMessages(body)) throw new Error("unreadable");
      setBubbles(body.messages.map(bubbleOf));
      setActiveId(id);
    } catch { setNotice("Percakapan ini belum bisa dibuka. Coba lagi."); }
  }

  async function remove(id: string) {
    if (!window.confirm("Hapus percakapan ini?")) return;
    setNotice(null);
    try {
      const response = await fetch(`/api/melinda/conversations/${encodeURIComponent(id)}`, { method: "DELETE", headers: await directorCsrfHeaders() });
      if (!response.ok) throw new Error("undeleted");
      setConversations((current) => current.filter((item) => item.id !== id));
      if (id === activeId) startNew();
    } catch { setNotice("Percakapan belum terhapus. Coba lagi."); }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void send(draft);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void send(draft);
  }

  const last = bubbles.at(-1);
  return <div className="melinda-page">
    <div className="melinda-main">
      <div className="melinda-topbar">
        <button type="button" className="melinda-icon-button" onClick={() => setHistoryOpen(true)} aria-label="Buka riwayat"><History className="size-5" aria-hidden="true" /></button>
      </div>

      {bubbles.length === 0 ? <MelindaBriefingView briefing={briefing} onAsk={(text) => void send(text)} />
        : <div className="melinda-log">
          {bubbles.map((bubble, index) => bubble.role === "user"
            ? <p key={bubble.id} className="melinda-bubble">{bubble.content}</p>
            : <div key={bubble.id} className="melinda-answer">
              <Image className="melinda-avatar" src="/brand/melindaos-logo.png" alt="" width={28} height={28} unoptimized />
              <div className="melinda-answer-body">
                {bubble.content && <MelindaMarkdown text={bubble.content} />}
                {busy && index === bubbles.length - 1 && <p role="status" className="melinda-status"><span className="melinda-dots" aria-hidden="true"><i /><i /><i /></span>{status ?? "Melinda sedang membaca"}</p>}
                {bubble.error && <p role="alert" className="text-[var(--warn)]">{bubble.error}</p>}
                {bubble.sources.length > 0 && <details className="melinda-sources">
                  <summary><Info className="size-4" aria-hidden="true" />Sumber ({bubble.sources.length})</summary>
                  <ul>{bubble.sources.map((source) => <li key={source.href}><Link href={source.href}>{source.label}</Link></li>)}</ul>
                </details>}
                {bubble.content && bubble.complete && !(busy && index === bubbles.length - 1) && <div className="melinda-tools"><CopyAnswer text={bubble.content} /></div>}
              </div>
            </div>)}
          {!busy && last?.role === "assistant" && !last.complete && <button type="button" className="melinda-retry" onClick={retry}>Coba lagi</button>}
        </div>}
      <div ref={endRef} />

      {notice && <p role="alert" className="melinda-line text-[var(--warn)]">{notice}</p>}
      <div className="melinda-dock">
        <form className="melinda-composer" onSubmit={onSubmit}>
          <textarea rows={2} value={draft} maxLength={MELINDA_MAX_MESSAGE} onChange={(event) => setDraft(event.target.value)} onKeyDown={onKeyDown} placeholder="Tanyakan jadwal, tugas, atau hal yang perlu diputuskan hari ini" aria-label="Pesan untuk Melinda" />
          <div className="melinda-composer-bar">
            <span className="melinda-hint"><kbd>Enter</kbd> kirim <kbd>Shift</kbd>+<kbd>Enter</kbd> baris baru</span>
            <span className="melinda-count" data-near={draft.length > MELINDA_MAX_MESSAGE * 0.9 ? "" : undefined}>{draft.length}/{MELINDA_MAX_MESSAGE}</span>
            {busy
              ? <button type="button" onClick={stopCurrent} aria-label="Hentikan jawaban"><Square className="size-4" fill="currentColor" aria-hidden="true" /></button>
              : <button type="submit" disabled={!draft.trim()} aria-label="Kirim pertanyaan"><ArrowUp className="size-5" aria-hidden="true" /></button>}
          </div>
        </form>
        <p className="melinda-disclaimer">Melinda bisa keliru. Periksa kembali hal yang penting.</p>
      </div>
    </div>

    <MelindaHistory conversations={conversations} activeId={activeId} open={historyOpen} onOpen={(id) => void open(id)} onDelete={(id) => void remove(id)} onNew={startNew} onClose={() => setHistoryOpen(false)} />
  </div>;
}
