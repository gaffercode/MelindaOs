"use client";
import { useAnimate, useMotionValue, useReducedMotion, type AnimationSequence, type MotionValue } from "motion/react";
import { useEffect, useState } from "react";
import { startWelcome } from "@/components/welcome-veil";
import { WELCOME } from "@/lib/welcome-flag";
import { AccountForm } from "./account-form";
import { BrandAttribution } from "./brand-attribution";
import { BrandLockupText } from "./brand-lockup";
import { LogoReveal, REVEAL_RADIUS } from "./logo-reveal";
import { PasscodeForm } from "./passcode-form";
import { SignInChoice, type SignInMode } from "./sign-in-choice";
import { WelcomeMessage } from "./welcome-message";

/** Fast start, long soft landing (reveals). */
const SETTLE = [0.16, 1, 0.3, 1] as const;
/** Soft acceleration and deceleration, no overshoot (movement). */
const GLIDE = [0.4, 0, 0.16, 1] as const;
/** Logo scale while it holds the centre of the viewport, before it shrinks into the stack. */
const HERO_SCALE = 1.6;
/** Session flag: the full sequence plays once per tab session, later visits get the short reveal. */
const SEEN_KEY = "melindaos-entrance";
const FIELD_START = 4.6;

const SHAPES = '[data-reveal="left"], [data-reveal="right"], [data-reveal="oval"], [data-reveal="dot"]';
const BLOCKS = '[data-entrance="brand-name"], [data-entrance="brand-tagline"], [data-entrance="brand-credit"], [data-entrance="welcome"], [data-entrance="field"], [data-entrance="status"], [data-entrance="attribution"]';

/** One coordinated timeline. `lift` is how far (px) the logo's final slot sits above the viewport centre; the clip
 * radii are motion values written to the circles' `r` attribute (a CSS `r` is not portable across browsers). */
function fullSequence(lift: number, clipLeft: MotionValue<number>, clipRight: MotionValue<number>): AnimationSequence {
  return [
    // Phase A: 300 ms of white. Phase B: the two forms grow out of their convergence point and slide together.
    [clipLeft, [0, REVEAL_RADIUS], { at: 0.3, duration: 1.7, ease: SETTLE }],
    ['[data-reveal="left"]', { opacity: [0, 1], x: [-14, 0], y: [6, 0] }, { at: 0.3, duration: 1.4, ease: GLIDE }],
    [clipRight, [0, REVEAL_RADIUS], { at: 0.5, duration: 1.7, ease: SETTLE }],
    ['[data-reveal="right"]', { opacity: [0, 1], x: [14, 0], y: [6, 0] }, { at: 0.5, duration: 1.4, ease: GLIDE }],
    ['[data-reveal="oval"]', { opacity: [0, 1], scale: [0.4, 1], y: [10, 0] }, { at: 1.55, duration: 0.7, ease: SETTLE }],
    ['[data-reveal="dot"]', { opacity: [0, 1], scale: [0.2, 1], y: [8, 0] }, { at: 1.8, duration: 0.6, ease: SETTLE }],
    // Phase C: the mark is whole; one gleam travels across it, masked to the shapes so the colours stay.
    ['[data-reveal="gleam"]', { opacity: [0, 1, 1, 0], x: [0, 560] }, { at: 2.45, duration: 1.0, ease: GLIDE }],
    // Phase D: the logo settles beside the name and tagline, then the credit and welcome follow.
    ['[data-entrance="logo"]', { y: [lift, 0], scale: [HERO_SCALE, 1] }, { at: 3.05, duration: 1.0, ease: GLIDE }],
    ['[data-entrance="brand-name"], [data-entrance="brand-tagline"]', { opacity: [0, 1], x: [-12, 0] }, { at: 3.5, duration: 0.8, ease: SETTLE }],
    ['[data-entrance="brand-credit"]', { opacity: [0, 1], y: [6, 0] }, { at: 3.68, duration: 0.9, ease: SETTLE }],
    ['[data-entrance="welcome"]', { opacity: [0, 1], y: [10, 0], filter: ["blur(8px)", "blur(0px)"] }, { at: 4.05, duration: 1.1, ease: SETTLE }],
    ['[data-entrance="field"]', { opacity: [0, 1], y: [12, 0] }, { at: FIELD_START, duration: 0.7, ease: SETTLE }],
    // The cat peeks over the field's edge, holds a beat, then pops out and sits on it.
    ['[data-cat-body]', { y: ["105%", "58%", "58%", "0%"] }, { at: 5.55, duration: 5.2, ease: GLIDE, times: [0, 0.27, 0.63, 1] }],
    ['[data-entrance="status"]', { opacity: [0, 1], y: [8, 0] }, { at: 4.8, duration: 0.6, ease: SETTLE }],
    ['[data-entrance="attribution"]', { opacity: [0, 1], y: [6, 0] }, { at: 5.0, duration: 0.6, ease: SETTLE }],
  ];
}

/** Return visits in the same session, and reduced motion (duration 0): the finished composition fades in as one. */
function shortSequence(duration: number): AnimationSequence {
  return [
    [SHAPES, { opacity: [0, 1] }, { at: 0, duration, ease: SETTLE }],
    [BLOCKS, { opacity: [0, 1] }, { at: 0, duration, ease: SETTLE }],
    ['[data-cat-body]', { y: ["0%", "0%"] }, { at: 0, duration: 0 }],
  ];
}

export function EntranceSequence({ available, returnTo }: { available: boolean; returnTo: string }) {
  const [scope, animate] = useAnimate<HTMLElement>();
  const reduced = useReducedMotion();
  const clipLeft = useMotionValue(0), clipRight = useMotionValue(0);
  // The passcode form is always mounted (its entrance animation state must survive a switch); the account form mounts on first use.
  const [mode, setMode] = useState<SignInMode>("director");
  const [accountOpened, setAccountOpened] = useState(false);
  const choose = (next: SignInMode) => { setMode(next); if (next === "account") setAccountOpened(true); };

  useEffect(() => {
    const root = scope.current;
    if (!root) return;
    const bind = (value: MotionValue<number>, selector: string) => {
      const circle = root.querySelector<SVGCircleElement>(selector);
      return value.on("change", (r) => circle?.setAttribute("r", r.toFixed(1)));
    };
    const unbind = [bind(clipLeft, '[data-reveal="clip-left"]'), bind(clipRight, '[data-reveal="clip-right"]')];
    let seen = false;
    try { seen = window.sessionStorage.getItem(SEEN_KEY) === "1"; } catch { seen = false; }
    const markSeen = () => { try { window.sessionStorage.setItem(SEEN_KEY, "1"); } catch { /* private mode: the sequence just replays */ } };
    window.addEventListener("pagehide", markSeen, { once: true });

    let controls;
    const shortReveal = reduced || seen;
    if (shortReveal) {
      clipLeft.set(REVEAL_RADIUS); clipRight.set(REVEAL_RADIUS);
      controls = animate(shortSequence(reduced ? 0 : 0.6));
    } else {
      const logo = root.querySelector<HTMLElement>('[data-entrance="logo"]');
      const slot = logo?.getBoundingClientRect();
      const lift = slot ? Math.max(0, window.innerHeight / 2 - (slot.top + slot.height / 2)) : 0;
      if (logo) animate(logo, { y: lift, scale: HERO_SCALE }, { duration: 0 });
      controls = animate(fullSequence(lift, clipLeft, clipRight));
    }
    // The page answers the user at once: a click or key press while the entrance is still running speeds it up
    // (no cut, the same curves at four times the pace), and a key press lands in the passcode field.
    const input = root.querySelector<HTMLInputElement>("[data-entrance-input]");
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const focusPasscode = () => { if (input && fine && !input.disabled && document.activeElement === document.body) input.focus({ preventScroll: true }); };
    const hurry = () => { controls.speed = 4; };
    const hurryAndFocus = () => { hurry(); focusPasscode(); };
    root.addEventListener("pointerdown", hurry, { once: true });
    root.addEventListener("keydown", hurryAndFocus, { once: true });
    // On desktop, focus with the field reveal while the decorative animation continues.
    let focusFrame = 0;
    if (input && fine && !input.disabled) {
      const focusOnReveal = () => {
        if (controls.time >= (shortReveal ? 0 : FIELD_START)) focusPasscode();
        else focusFrame = requestAnimationFrame(focusOnReveal);
      };
      focusFrame = requestAnimationFrame(focusOnReveal);
    }
    return () => {
      cancelAnimationFrame(focusFrame);
      controls.stop();
      for (const stop of unbind) stop();
      window.removeEventListener("pagehide", markSeen);
      root.removeEventListener("pointerdown", hurry);
      root.removeEventListener("keydown", hurryAndFocus);
    };
  }, [animate, clipLeft, clipRight, reduced, scope]);

  // After a successful sign-in: the form fades out on its own (no movement), and only when it is fully gone does the
  // welcome veil come up, so the two are never on screen together. The page changes once the text is fully in: a
  // document that arrives in the middle of the fade freezes it, then snaps it to its end.
  const exit = () => new Promise<void>((resolve) => {
    void animate('[data-entrance="stack"], [data-entrance="attribution"]', { opacity: 0 }, { duration: reduced ? 0 : WELCOME.formOut / 1000, ease: GLIDE }).then(() => {
      startWelcome();
      window.setTimeout(resolve, reduced ? 0 : WELCOME.textIn);
    });
  });

  return (
    <main ref={scope} className="entrance">
      <div className="entrance-stack" data-entrance="stack">
        <div className="entrance-lockup">
          <div className="entrance-logo" data-entrance="logo"><LogoReveal /></div>
          <BrandLockupText />
        </div>
        <WelcomeMessage />
        <SignInChoice mode={mode} onChange={choose} />
        <PasscodeForm available={available} returnTo={returnTo} beforeNavigate={exit} hidden={mode !== "director"} />
        {accountOpened && <AccountForm returnTo={returnTo} hidden={mode !== "account"} />}
      </div>
      <BrandAttribution />
    </main>
  );
}
