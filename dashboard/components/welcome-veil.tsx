"use client";
import { useEffect } from "react";
import { WELCOME, WELCOME_KEY } from "@/lib/welcome-flag";

/** Anything that means "this page is still loading": every `LoadingState` and the route skeleton's blocks. */
const LOADERS = "[data-loading], .shell-skeleton-block";

function clear(root: HTMLElement) {
  delete root.dataset.welcome;
  delete root.dataset.welcomeStart;
  root.style.removeProperty("--welcome-elapsed");
}

/** Called by the login page once its form has faded out: the white veil comes up and the text starts to fade in. */
export function startWelcome() {
  const root = document.documentElement, now = String(Date.now());
  try { window.sessionStorage.setItem(WELCOME_KEY, now); } catch { /* storage blocked: the destination opens without the welcome */ }
  root.dataset.welcomeStart = now;
  root.dataset.welcome = "in";
}

/**
 * Lifts the welcome veil. The veil is CSS only: two pseudo-elements of <html> (white layer, text) that exist while
 * <html> carries `data-welcome`, set by `startWelcome` on the login page and by the inline <head> script on the
 * destination. Phases, all CSS fades: "in" (text fades in, veil opaque), "text-out", "veil-out", then the attribute is removed.
 * The veil lifts when the text has had its reading time and no loader has been on the page for a short while;
 * `WELCOME.cap` lifts it regardless, so it can never trap anyone.
 */
export function WelcomeVeil() {
  useEffect(() => {
    const root = document.documentElement;
    // Back to the login page out of the back/forward cache: the veil it left with must not come back.
    const restored = (event: PageTransitionEvent) => { if (event.persisted) clear(root); };
    window.addEventListener("pageshow", restored);
    const started = Number(root.dataset.welcomeStart);
    // Nothing to do on a normal load. A phase past "in" is a run that was cut off: finish it.
    if (root.dataset.welcome !== "in" || !Number.isFinite(started)) {
      if (root.dataset.welcome) clear(root);
      return () => window.removeEventListener("pageshow", restored);
    }
    const mounted = Date.now();
    let quietSince: number | null = null, timer: number | undefined;
    const lift = () => {
      window.clearInterval(poll);
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { clear(root); return; }
      root.dataset.welcome = "text-out";
      timer = window.setTimeout(() => {
        root.dataset.welcome = "veil-out";
        timer = window.setTimeout(() => clear(root), WELCOME.veilOut);
      }, WELCOME.textOut);
    };
    const poll = window.setInterval(() => {
      const now = Date.now();
      if (document.readyState === "loading" || document.querySelector(LOADERS)) quietSince = null; else quietSince ??= now;
      const ready = quietSince !== null && now - quietSince >= WELCOME.settle && now - started >= WELCOME.read;
      if (ready || now - mounted >= WELCOME.cap) lift();
    }, 50);
    return () => {
      window.clearInterval(poll);
      window.clearTimeout(timer);
      window.removeEventListener("pageshow", restored);
    };
  }, []);

  return null;
}
