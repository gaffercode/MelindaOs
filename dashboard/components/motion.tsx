"use client";
import { MotionConfig } from "motion/react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ENTRANCE_KEY } from "@/lib/entrance-flag";

const EASE = [0.2, 0, 0, 1] as const;
const EASE_OUT = [0.16, 1, 0.3, 1] as const;
const EASE_IN = "cubic-bezier(0.4, 0, 1, 1)";
/** Seconds. Mirrors the CSS tokens (sentra-tokens.css and the motion block in globals.css); change both together. */
export const MOTION = { fast: 0.09, micro: 0.15, normal: 0.16, exit: 0.18, layout: 0.36, count: 0.5, highlight: 1.2, ease: EASE, easeOut: EASE_OUT } as const;

/** True under `prefers-reduced-motion: reduce`, and wherever the question cannot be asked (jsdom, old browsers): then nothing moves. */
export function reducedMotion(): boolean {
  return typeof window === "undefined" || typeof window.matchMedia !== "function" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Still needed by the sidebar `layoutId` highlight and the mobile drawer. Also tells CSS when the tab is hidden, so looping animations pause. */
export function MotionProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const sync = () => document.documentElement.toggleAttribute("data-tab-hidden", document.hidden);
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);
  return <MotionConfig reducedMotion="user" transition={{ duration: MOTION.normal, ease: EASE }}>{children}</MotionConfig>;
}

/** Layout wrapper only. Its JS-driven whole-page fade is gone (2026-11-08): it restyled the entire page every frame
 * during hydration and made heavy pages stutter, and the CSS `rise-in` on page sections already covers the entrance. */
export function PageEnter({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={className}>{children}</div>;
}

/** Card entrance, staggered by index. Pure CSS (`.enter-item` in globals.css) so it costs no main-thread work:
 * the compositor runs it, it works before hydration, and reduced motion disables it with the other animations. */
export function EnterItem({ children, className, index = 0, as = "div" }: { children: ReactNode; className?: string; index?: number; as?: "div" | "article" }) {
  const Tag = as;
  return <Tag className={className ? `${className} enter-item` : "enter-item"} style={{ animationDelay: `${index * 30}ms` }}>{children}</Tag>;
}

/** Marks the signature moment as seen for this tab once its CSS animations have finished (see lib/entrance-flag.ts). Renders nothing. */
export function EntranceSeen() {
  useEffect(() => {
    const root = document.documentElement;
    if (root.dataset.entrance !== "play") return;
    let live = true;
    const running = [...document.querySelectorAll(".chart-reveal-outer, .medify-ward-fill")].flatMap((element) => element.getAnimations?.() ?? []);
    void Promise.allSettled(running.map((animation) => animation.finished)).then(() => {
      if (!live) return;
      root.dataset.entrance = "seen";
      try { sessionStorage.setItem(ENTRANCE_KEY, "1"); } catch { /* storage blocked: the moment may replay on the next load */ }
    });
    return () => { live = false; };
  }, []);
  return null;
}

/** One quiet highlight behind a value that just changed: a tint that fades (the `::after` of the figure, globals.css). Under reduced motion it holds, then goes, without fading. */
export function flashChanged(element: HTMLElement | null) {
  if (!element || typeof element.animate !== "function") return;
  element.animate([{ opacity: 1 }, { opacity: 0 }], { duration: MOTION.highlight * 1000, easing: reducedMotion() ? "steps(1, end)" : EASE_IN, pseudoElement: "::after" });
}

/**
 * Wraps a server-rendered figure and highlights it once when its value differs from the one this tab last saw under the same key.
 * The value itself never moves: the page was reloaded, so there is no old number on screen to count from.
 */
export function ChangedSince({ watchKey, value, className, children }: { watchKey: string; value: string; className?: string; children: ReactNode }) {
  const element = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    try {
      const key = `melindaos-seen:${watchKey}`;
      const before = sessionStorage.getItem(key);
      sessionStorage.setItem(key, value);
      if (before !== null && before !== value) flashChanged(element.current);
    } catch { /* storage blocked: no highlight */ }
  }, [watchKey, value]);
  return <p ref={element} className={className}>{children}</p>;
}

/**
 * Inline disclosure for a small form: the row opens from 0fr to 1fr and closes back (`.expand` in globals.css), so what sits
 * below glides instead of jumping. Mounted only while open or closing; while closing it shows the last open content and is inert.
 */
export function Expand({ open, children }: { open: boolean; children: ReactNode }) {
  const [phase, setPhase] = useState<"closed" | "open" | "closing">(open ? "open" : "closed");
  const [last, setLast] = useState<ReactNode>(open ? children : null);
  if (open && last !== children) setLast(children);
  if (open && phase !== "open") setPhase("open");
  if (!open && phase === "open") setPhase(reducedMotion() ? "closed" : "closing");
  useEffect(() => {
    if (phase !== "closing") return;
    const timer = window.setTimeout(() => setPhase("closed"), MOTION.exit * 1000);
    return () => window.clearTimeout(timer);
  }, [phase]);
  if (phase === "closed") return null;
  return <div className="expand" data-closing={phase === "closing" || undefined} inert={phase === "closing"}><div className="expand-inner">{open ? children : last}</div></div>;
}

/**
 * Lets a layer play its CSS exit (`[data-closing]`) before it unmounts. Under reduced motion it closes at once.
 * Returns `[closing, close, keep]`: `keep` calls off a close that is still playing, for when the layer is asked to open again.
 */
export function useClosing(onClosed: () => void): [boolean, () => void, () => void] {
  const [closing, setClosing] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const closed = useRef(onClosed);
  useEffect(() => { closed.current = onClosed; }, [onClosed]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  // Stable, so a layer that lists it as an effect dependency does not re-run that effect (and re-take focus) when closing starts.
  const close = useCallback(() => {
    if (timer.current !== undefined) return;
    if (reducedMotion()) { closed.current(); return; }
    setClosing(true);
    timer.current = window.setTimeout(() => { timer.current = undefined; setClosing(false); closed.current(); }, MOTION.exit * 1000);
  }, []);
  const keep = useCallback(() => {
    if (timer.current === undefined) return;
    window.clearTimeout(timer.current);
    timer.current = undefined;
    setClosing(false);
  }, []);
  return [closing, close, keep];
}
