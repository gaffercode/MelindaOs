import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// tools/secret-scan.mjs guards every folder of this repository, so its tests live beside it and run on plain
// node:test. This file only makes them part of the dashboard suite and of CI.
const suite = fileURLToPath(new URL("../../tools/secret-scan.test.mjs", import.meta.url));

describe("secret-scan", () => {
  it("passes its own node:test suite", () => {
    const run = spawnSync(process.execPath, ["--test", suite], { encoding: "utf8", timeout: 120_000 });
    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(run.stdout).toMatch(/pass 12\b/);
    expect(run.stdout).not.toMatch(/skipped [1-9]/);
  }, 130_000);
});
