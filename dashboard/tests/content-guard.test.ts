import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regression guard against content errors corrected on 2026-11-07 (plan 02):
 * the revoked standard 1128/2022 cited without the current 1596/2024, the
 * wrong owner spelling "PT RSIA Melinda", and the non-existent chapter code
 * PANDU in the STARKES catalog.
 */
const DASHBOARD_ROOT = join(__dirname, "..");
const SOURCE_DIRS = ["lib", "components", "app", "data"];
const SKIP = new Set(["node_modules", ".next", "coverage"]);

const REVOKED_STANDARD = /1128\/2022/;
const CURRENT_STANDARD = /1596\/2024/;
const WRONG_OWNER = /PT\.?\s+RSIA\s+Melinda/i;
const PANDU = /\bPANDU\b/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/**
 * Committed and new files, not what Git ignores: a build writes copies of `docs/` into `data/` (agent-file-contents.json
 * and the like), and those copies quote the wrong spellings that the correction plan lists as examples.
 */
function sourceFiles(): string[] {
  let listed: string;
  try {
    listed = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...SOURCE_DIRS], { cwd: DASHBOARD_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    // No git checkout: the SAFRS standalone extraction copies the capsule without .git and runs tests before any build
    // writes the generated data/ copies, so the source folders can be listed directly.
    return SOURCE_DIRS.flatMap((dir) => walk(join(DASHBOARD_ROOT, dir)));
  }
  return listed.split("\0").filter(Boolean).map((file) => join(DASHBOARD_ROOT, file));
}

function hits(files: string[], matches: (line: string) => boolean): string[] {
  const found: string[] = [];
  for (const file of files) {
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      if (matches(line)) found.push(`${relative(DASHBOARD_ROOT, file).replace(/\\/g, "/")}:${index + 1}`);
    });
  }
  return found;
}

describe("content guard", () => {
  it("never cites the revoked standard 1128/2022 without 1596/2024 on the same line", () => {
    const found = hits(sourceFiles(), (line) => REVOKED_STANDARD.test(line) && !CURRENT_STANDARD.test(line));
    expect(found, found.join("\n")).toEqual([]);
  });

  it("never spells the owner as PT RSIA Melinda", () => {
    const found = hits(sourceFiles(), (line) => WRONG_OWNER.test(line));
    expect(found, found.join("\n")).toEqual([]);
  });

  it("never uses PANDU as a chapter code in lib/starkes", () => {
    const found = hits(walk(join(DASHBOARD_ROOT, "lib", "starkes")), (line) => PANDU.test(line));
    expect(found, found.join("\n")).toEqual([]);
  });
});
