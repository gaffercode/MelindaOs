import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PAGE_PERMISSIONS } from "@/lib/access/access-control";
import { describe, expect, it } from "vitest";

const proxyPath = fileURLToPath(new URL("../proxy.ts", import.meta.url));

const expected = PAGE_PERMISSIONS.map((rule) => rule.pattern.replace(/\[\.\.\.([^\]]+)\]/g, ":$1*"));

function matcherFromProxy(): string[] {
  const content = readFileSync(proxyPath, "utf8");
  const start = content.indexOf("// <generated:matcher>");
  const end = content.indexOf("// </generated:matcher>");
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  const block = content.slice(start, end);
  return [...block.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

describe("proxy matcher", () => {
  it("equals the page matrix", () => {
    expect(matcherFromProxy()).toEqual(expected);
  });
});
