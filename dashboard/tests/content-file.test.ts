import { describe, expect, it } from "vitest";
import { ContentFileError, arrayOf, fill, isString, oneOf, requireFields } from "@/lib/content/content-file";
import { REQUIRED_FILES } from "../scripts/fetch-private-data.mjs";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("content files", () => {
  it("fills placeholders and refuses one without a value", () => {
    expect(fill("{openCount} tugas, dipimpin {leaderName}", { openCount: 3, leaderName: "Contoh" })).toBe("3 tugas, dipimpin Contoh");
    expect(fill("tanpa isian", {})).toBe("tanpa isian");
    expect(() => fill("{missing}", {})).toThrow("{missing}");
  });

  it("names the file and the field when a content file is malformed", () => {
    expect(() => requireFields("x.json", "root", { a: 1 }, { a: isString })).toThrow(new ContentFileError("x.json", "root.a is missing or malformed."));
    expect(() => requireFields("x.json", "root", [], {})).toThrow("root is not an object");
    expect(() => requireFields("x.json", "item", { a: "ok", b: 2 }, { a: isString }, { b: isString })).toThrow("item.b is malformed");
    expect(() => requireFields("x.json", "item", { a: "ok" }, { a: oneOf(["ok"]) }, { b: isString })).not.toThrow();
    expect(arrayOf(isString)(["a", 1])).toBe(false);
  });

  it("keeps a fictional sample for every file production requires, and nothing else in the folder", () => {
    const folder = join(process.cwd(), "data", "content");
    const files = readdirSync(folder).sort();
    expect(files.map((file) => `dashboard/data/content/${file}`)).toEqual(REQUIRED_FILES.filter((path) => path.startsWith("dashboard/data/content/")).sort());
    for (const file of files) expect(JSON.parse(readFileSync(join(folder, file), "utf8"))._note).toMatch(/^Fictional sample/);
  });
});
