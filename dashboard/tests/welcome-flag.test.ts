import { describe, expect, it } from "vitest";
import { WELCOME, WELCOME_KEY, WELCOME_SCRIPT, WELCOME_TEXT } from "@/lib/welcome-flag";

/** Runs the inline <head> script against a fake page and returns what it left on <html> and in storage. */
function run(stored: string | null, pathname: string, now: number) {
  const storage = new Map<string, string>(stored === null ? [] : [[WELCOME_KEY, stored]]);
  const dataset: Record<string, string> = {}, style: Record<string, string> = {};
  const sessionStorage = { getItem: (key: string) => storage.get(key) ?? null, removeItem: (key: string) => { storage.delete(key); } };
  const document = { documentElement: { dataset, style: { setProperty: (name: string, value: string) => { style[name] = value; } } } };
  const timers: { fire: () => void; delay: number }[] = [];
  const setTimeout = (fire: () => void, delay: number) => { timers.push({ fire, delay }); };
  new Function("sessionStorage", "document", "location", "Date", "setTimeout", WELCOME_SCRIPT)(sessionStorage, document, { pathname }, { now: () => now }, setTimeout);
  return { dataset, style, left: storage.has(WELCOME_KEY), timers };
}

describe("welcome after Director sign-in", () => {
  it("keeps the Director's exact line", () => {
    expect(WELCOME_TEXT).toBe("Selamat datang dr Ferdi Andriska, our Director");
  });

  it("puts the veil back on the destination and tells CSS how far the fade is, once", () => {
    const { dataset, style, left } = run("1000", "/", 1900);
    expect(dataset).toEqual({ welcome: "in", welcomeStart: "1000" });
    expect(style).toEqual({ "--welcome-elapsed": "900ms" });
    expect(left).toBe(false);
  });

  it("drops the veil by itself when the page's scripts never take over, and leaves a newer welcome alone", () => {
    const stuck = run("1000", "/", 1900);
    expect(stuck.timers.map((timer) => timer.delay)).toEqual([WELCOME.failsafe]);
    stuck.timers[0].fire();
    expect(stuck.dataset).toEqual({});

    const replaced = run("1000", "/", 1900);
    replaced.dataset.welcomeStart = "2000";
    replaced.timers[0].fire();
    expect(replaced.dataset).toEqual({ welcome: "in", welcomeStart: "2000" });
  });

  it("does nothing without a flag", () => {
    const { dataset, timers } = run(null, "/", 1900);
    expect(dataset).toEqual({});
    expect(timers).toEqual([]);
  });

  it("ignores and removes a stale flag, a flag from the future, and a sign-in that bounced back to the login page", () => {
    for (const result of [run("1000", "/", 1000 + WELCOME.maxAge), run("5000", "/", 1000), run("1000", "/director-login", 1500), run("abc", "/", 1500)]) {
      expect(result.dataset).toEqual({});
      expect(result.left).toBe(false);
    }
  });

  it("gives the text its reading time and always lifts", () => {
    expect(WELCOME.read).toBeGreaterThanOrEqual(WELCOME.textIn);
    expect(WELCOME.cap).toBeLessThan(WELCOME.failsafe);
    expect(WELCOME.failsafe).toBeLessThan(WELCOME.maxAge);
  });
});
