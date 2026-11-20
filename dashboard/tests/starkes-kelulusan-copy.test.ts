import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("kelulusan rules copy", () => {
  it("matches the machine-readable source", async () => {
    const read = (file: string) => readFile(path.resolve(process.cwd(), file), "utf8").then(JSON.parse);
    const source = await read("../knowledge/11_MACHINE_READABLE/starkes/starkes-kelulusan-2024.json");
    expect(await read("data/starkes/kelulusan-2024.json")).toEqual(source);
  });
});
