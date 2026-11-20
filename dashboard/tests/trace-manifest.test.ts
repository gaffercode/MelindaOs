import nextConfig from "@/next.config";
import traceManifest from "@/scripts/trace-manifest.json";
import { describe, expect, it } from "vitest";

/** next.config stores dynamic segments with escaped brackets (a bare [id] is a regex character class). */
const unescape = (key: string): string => key.replace(/\\\[/g, "[").replace(/\\\]/g, "]");

describe("trace manifest is the single source", () => {
  it("next.config outputFileTracingIncludes equals the manifest", () => {
    expect(nextConfig.outputFileTracingIncludes).toEqual(traceManifest.nextIncludes);
  });

  it("trace-budget REQUIRED_FILES equals the manifest", async () => {
    const mod = await import("@/scripts/trace-budget.mjs");
    expect(mod.REQUIRED_FILES).toEqual(traceManifest.requires);
  });

  it("the two maps cover the same routes", () => {
    const nextKeys = Object.keys(traceManifest.nextIncludes).map(unescape);
    const requiredKeys = Object.keys(traceManifest.requires);
    // /formularium is the only route traced in the build that the budget guard does not assert.
    expect(nextKeys.filter((key) => !requiredKeys.includes(key))).toEqual(["/formularium"]);
    expect(requiredKeys.filter((key) => !nextKeys.includes(key))).toEqual([]);
  });
});
