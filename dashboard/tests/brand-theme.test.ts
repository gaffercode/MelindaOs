import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Melinda brand theme", () => {
  it("uses the Sentraverse token set shared with balowerti-os", () => {
    const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    const tokens = readFileSync(new URL("../styles/sentra-tokens.css", import.meta.url), "utf8");
    expect(css.startsWith('@import "../styles/sentra-tokens.css";')).toBe(true);
    for (const token of ["--p-ink-900: #0F0E0D", "--p-neutral-050: #FAFAF9", "--color-background-canvas: var(--p-neutral-050)", "--color-action-primary: var(--p-ink-900)", "--font-family-sans: \"Inter Variable\""]) {
      expect(tokens.includes(token), token).toBe(true);
    }
    for (const token of ["--background: var(--color-background-canvas)", "--accent: var(--color-accent-text)", "font-family: \"Inter Variable\"", "color-scheme: light"]) {
      expect(css.includes(token), token).toBe(true);
    }
    expect(css).not.toContain("--font-plex-sans");
  });
  it("ships the native transparent brandbook logo", () => {
    const png = readFileSync(new URL("../public/brand/melindaos-logo.png", import.meta.url));
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(375);
    expect(png.readUInt32BE(20)).toBe(382);
    expect(png[25]).toBe(6);
  });
});
