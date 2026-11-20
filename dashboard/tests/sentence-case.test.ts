import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Director decision 2026-11-08: dashboard text is sentence case only, never all caps.
// Official document previews (Document Studio naskah dinas) keep their printed format.
const OFFICIAL_DOCUMENT_PREVIEWS = new Set(["document-studio-preview.tsx"]);

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.name.endsWith(".tsx") && !OFFICIAL_DOCUMENT_PREVIEWS.has(entry.name) ? [path] : [];
  });
}

describe("sentence case only", () => {
  it("never transforms dashboard text to all caps in CSS", () => {
    const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    expect(css).not.toMatch(/text-transform:\s*uppercase/);
    expect(css).not.toMatch(/font-variant(-caps)?:\s*(all-)?small-caps/);
  });

  it("never uses the Tailwind uppercase class in dashboard components", () => {
    const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
    const offenders = [...tsxFiles(join(root, "components")), ...tsxFiles(join(root, "app"))]
      .filter((file) => /\buppercase\b/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});
