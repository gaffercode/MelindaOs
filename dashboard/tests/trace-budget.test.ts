import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MIB, REQUIRED_FILES, evaluateTraces, routeFromTracePath } from "../scripts/trace-budget.mjs";

describe("routeFromTracePath", () => {
  it.each([
    [".next/server/app/api/ask/route.js.nft.json", "/api/ask"],
    [".next/server/app/page.js.nft.json", "/"],
    [".next/server/app/[view]/page.js.nft.json", "/[view]"],
  ])("maps %s", (tracePath, route) => expect(routeFromTracePath(tracePath)).toBe(route));
});

describe("evaluateTraces", () => {
  const clean = { routes: [{ route: "/api/ask", bytes: 1000, files: ["data/knowledge-chunks.json"] }], buildLog: "Compiled successfully", required: {} };

  it("returns no failures for clean input", () => {
    expect(evaluateTraces(clean)).toEqual([]);
  });

  it("fails on a Turbopack dynamic filesystem warning", () => {
    const failures = evaluateTraces({ ...clean, buildLog: "Warning: Dynamic filesystem access causes tracing of the whole project" });
    expect(failures.some((f) => f.includes("Dynamic filesystem access"))).toBe(true);
  });

  it("applies the default budget but the larger knowledge budget to knowledge routes", () => {
    const over = evaluateTraces({ routes: [{ route: "/api/director/tasks/board", bytes: 6 * MIB + 1, files: [] }], buildLog: "", required: {} });
    expect(over).toHaveLength(1);
    expect(over[0]).toContain("/api/director/tasks/board");
    expect(over[0]).toContain("budget");
    expect(evaluateTraces({ routes: [{ route: "/api/director/tasks/board", bytes: 6 * MIB, files: [] }], buildLog: "", required: {} })).toEqual([]);
    expect(evaluateTraces({ routes: [{ route: "/api/ask", bytes: 9 * MIB + 1, files: [] }], buildLog: "", required: {} })).toEqual([]);
  });

  it("names the route and the file when a required file is missing", () => {
    const failures = evaluateTraces({
      routes: [{ route: "/api/starkes/kit", bytes: 10, files: ["lib/x.js"] }],
      buildLog: "",
      required: { "/api/starkes/kit": ["data/starkes/kits/TKRS.json"] },
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("/api/starkes/kit");
    expect(failures[0]).toContain("data/starkes/kits/TKRS.json");
  });

  it("fails when a required route has no trace at all", () => {
    const failures = evaluateTraces({ routes: [], buildLog: "", required: { "/api/starkes/kit": ["data/starkes/kits/TKRS.json"] } });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("/api/starkes/kit");
  });
});

describe("REQUIRED_FILES", () => {
  it.each(Object.keys(REQUIRED_FILES))("%s names an existing route handler or page", (route) => {
    const dir = join(process.cwd(), "app", ...route.split("/").filter(Boolean));
    expect(existsSync(join(dir, "route.ts")) || existsSync(join(dir, "page.tsx"))).toBe(true);
  });
});
