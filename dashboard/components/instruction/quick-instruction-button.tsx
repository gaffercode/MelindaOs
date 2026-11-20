"use client";

import { Suspense, lazy, useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Send, X } from "lucide-react";
import { ARAHAN_EVENT, type ArahanRequest } from "@/lib/instruction/instruction-prefill";
import { recoverableImport } from "@/lib/recoverable-import";
import { LoadingState } from "../loading-state";
import { useClosing } from "../motion";

type DrawerProps = { context: string; seeds: (ArahanRequest & { key: number })[]; onClose: () => void };

// Set just before the one automatic reload, so a chunk that is still missing after it cannot loop.
const RELOAD_KEY = "melindaos:arahan-reload";
const session = (action: (storage: Storage) => string | null | void) => { try { return action(window.sessionStorage); } catch { return null; } };

// The drawer (and the instruction store behind it) downloads on first open, not with every Director page.
// React.lazy + Suspense (what next/dynamic wraps) so the loading drawer can close; a failed chunk retries once, then reloads.
// One load shared by the hover/focus preload and the lazy component, so the chunk is fetched (and retried) once.
let loaded: ComponentType<DrawerProps> | null = null;
let loading: Promise<{ default: ComponentType<DrawerProps> }> | null = null;
const loadDrawer = () => loading ??= recoverableImport<{ default: ComponentType<DrawerProps> }>(
  () => import("./quick-instruction-panel").then((m) => { session((s) => s.removeItem(RELOAD_KEY)); loaded = m.QuickInstructionDrawer; return { default: m.QuickInstructionDrawer }; }),
  () => ({ default: ArahanReload }),
)();
const LazyDrawer = lazy(loadDrawer);

/** Starts the panel download when the Director points at or focuses the button, so the loading drawer rarely shows. */
export const preloadArahanPanel = () => loadDrawer().then(() => undefined);
/** The panel itself once preloaded (React.lazy would still suspend for one render), otherwise the lazy component. */
export const arahanDrawer = (): ComponentType<DrawerProps> => loaded ?? LazyDrawer;

/** Picks the component once per open: switching from lazy to loaded while open would remount the panel and drop its cards. */
function ArahanDrawer(props: DrawerProps) {
  const [Component] = useState(arahanDrawer);
  return <Component {...props} />;
}

/** The drawer frame without the panel: shown while the chunk loads, or while the page reloads after a failed load. */
function ArahanShell({ context, onClose, children }: { context: string; onClose: () => void; children: ReactNode }) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    closeButton.current?.focus();
    const handler = (event: KeyboardEvent) => { if (event.key === "Escape") onCloseRef.current(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  return <div className="quick-instruction-layer" role="dialog" aria-modal="true" aria-labelledby="quick-instruction-title">
    <button type="button" className="quick-instruction-scrim" aria-label="Tutup panel arahan" onClick={onClose} />
    <div className="quick-instruction-panel">
      <div className="quick-instruction-head">
        <div><h2 id="quick-instruction-title">Arahan Direktur</h2><p className="director-instruction-note">{context}</p></div>
        <button ref={closeButton} type="button" className="header-icon" aria-label="Tutup panel arahan" onClick={onClose}><X className="size-4" /></button>
      </div>
      {children}
    </div>
  </div>;
}

export function ArahanLoading({ context, onClose }: { context: string; onClose: () => void }) {
  return <ArahanShell context={context} onClose={onClose}><p className="director-instruction-note"><LoadingState label="Memuat panel arahan" /></p></ArahanShell>;
}

/** The panel chunk failed twice (usually an old tab after a deploy): reload the page once to get the new build. */
export function ArahanReload({ context, onClose }: { context: string; onClose: () => void }) {
  // Client-only component (rendered after a click), so reading sessionStorage during the first render is safe.
  const [stuck] = useState(() => !!session((s) => s.getItem(RELOAD_KEY)));
  useEffect(() => {
    if (stuck) return;
    session((s) => s.setItem(RELOAD_KEY, "1"));
    window.location.reload();
  }, [stuck]);
  return <ArahanShell context={context} onClose={onClose}>
    {stuck
      ? <><p className="director-instruction-error" role="alert">Panel arahan belum bisa dimuat. Periksa koneksi, lalu muat ulang halaman.</p>
        <div className="director-instruction-buttons"><button type="button" className="director-button" onClick={() => { session((s) => s.removeItem(RELOAD_KEY)); window.location.reload(); }}>Muat ulang halaman</button></div></>
      : <p className="director-instruction-note"><LoadingState label="Memuat ulang halaman" /></p>}
  </ArahanShell>;
}

/** Header button on every Director page. The panel and its data load only once it is opened. */
export function QuickInstructionButton({ context }: { context: string }) {
  const [open, setOpen] = useState(false);
  const [seeds, setSeeds] = useState<(ArahanRequest & { key: number })[]>([]);
  const trigger = useRef<HTMLButtonElement>(null);
  function close() { setOpen(false); setSeeds([]); window.setTimeout(() => trigger.current?.focus(), 0); }
  // The drawer leaves the way it came (CSS `[data-closing]`), then unmounts. Asked to open again while it leaves, it stays.
  const [closing, requestClose, keepOpen] = useClosing(close);
  // "Teruskan ke staf" on agenda rows, [ISI] gaps and STARKES chapters opens this panel with a pre-filled card.
  useEffect(() => {
    let next = 0;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<ArahanRequest & { handled: boolean }>).detail;
      detail.handled = true;
      next += 1;
      const key = next;
      setSeeds((current) => [...current, { key, context: detail.context, draft: detail.draft }]);
      keepOpen();
      setOpen(true);
    };
    window.addEventListener(ARAHAN_EVENT, handler);
    return () => window.removeEventListener(ARAHAN_EVENT, handler);
  }, [keepOpen]);
  return <>
    <button ref={trigger} type="button" className="quick-instruction-trigger" aria-haspopup="dialog" aria-expanded={open} onPointerEnter={preloadArahanPanel} onFocus={preloadArahanPanel} onClick={() => { keepOpen(); setOpen(true); }}><Send className="size-4" aria-hidden="true" /><span>Arahan</span></button>
    {/* Portal to <body>: the sticky header uses backdrop-filter, which would confine a fixed drawer to the header box. */}
    {/* The .quick-instruction-enter wrapper animates the drawer in once per open; it sits outside Suspense so the loading-to-panel swap does not replay it. */}
    {open && createPortal(<div className="quick-instruction-enter" data-closing={closing || undefined} inert={closing}><Suspense fallback={<ArahanLoading context={context} onClose={requestClose} />}><ArahanDrawer context={context} seeds={seeds} onClose={requestClose} /></Suspense></div>, document.body)}
  </>;
}
