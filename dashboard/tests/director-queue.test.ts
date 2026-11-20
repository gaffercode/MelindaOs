import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copyDirectorQueue, DIRECTOR_QUEUE_SOURCE, directorQueuePath, loadDirectorQueue } from "@/lib/director/director-queue";

const queue = {
  valueRules: { maxLength: 200, refusePattern: "\\b(belum|menunggu)\\b" },
  items: [{
    id: "00000000000000aa", docPath: "knowledge/01_HOSPITAL/x/kb-operasional-x.md", docTitle: "Dokumen X", heading: null,
    text: "| Jam buka | [ISI jam] |", slots: [{ column: 13, placeholder: "[ISI jam]", kind: "ISI", detail: null, lock: null, header: null }],
  }],
  drafts: [],
};
let directory: string;

beforeEach(async () => { directory = await mkdtemp(path.join(tmpdir(), "director-queue-")); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

async function fileWith(content: string): Promise<string> {
  const file = path.join(directory, "director-queue.json");
  await writeFile(file, content, "utf8");
  return file;
}

describe("director queue file", () => {
  it("loads a queue file", async () => {
    expect(await loadDirectorQueue(await fileWith(JSON.stringify(queue)))).toEqual(queue);
  });

  it("returns null for a missing file", async () => {
    expect(await loadDirectorQueue(path.join(directory, "missing.json"))).toBeNull();
  });

  it("returns null for a file that is not JSON", async () => {
    expect(await loadDirectorQueue(await fileWith("{"))).toBeNull();
  });

  it("returns null for JSON that is not a queue", async () => {
    expect(await loadDirectorQueue(await fileWith('{"items": []}'))).toBeNull();
  });

  it("looks for the bundled copy under data/", () => {
    expect(directorQueuePath()).toBe(path.join(process.cwd(), "data", "director-queue.json"));
  });

  it("reads the bundled copy by default", async () => {
    const original = process.cwd();
    process.chdir(directory);
    try {
      expect(await loadDirectorQueue()).toBeNull();
    } finally {
      process.chdir(original);
    }
  });
});

describe("bundling the director queue file", () => {
  const target = () => path.join(directory, "out", "data", "director-queue.json");
  async function sourceWith(content: string): Promise<void> {
    const source = path.join(directory, DIRECTOR_QUEUE_SOURCE);
    await mkdir(path.dirname(source), { recursive: true });
    await writeFile(source, content, "utf8");
  }

  it("names the generated file in the knowledge folder", () => {
    expect(DIRECTOR_QUEUE_SOURCE).toBe("knowledge/12_GOVERNANCE/knowledge/readiness-director-queue.json");
  });

  it("copies a valid queue file and returns its number of lines", async () => {
    await sourceWith(JSON.stringify(queue, null, 2));
    expect(await copyDirectorQueue(directory, target())).toBe(1);
    expect(await loadDirectorQueue(target())).toEqual(queue);
  });

  it("returns null and writes nothing when the source is missing", async () => {
    expect(await copyDirectorQueue(directory, target())).toBeNull();
    expect(existsSync(target())).toBe(false);
  });

  it("returns null and writes nothing when the source is not a queue", async () => {
    await sourceWith('{"items": []}');
    expect(await copyDirectorQueue(directory, target())).toBeNull();
    expect(existsSync(target())).toBe(false);
  });

  it("writes to the bundled path by default", async () => {
    await sourceWith(JSON.stringify(queue));
    const original = process.cwd();
    process.chdir(directory);
    try {
      expect(await copyDirectorQueue(directory)).toBe(1);
      expect(await loadDirectorQueue()).toEqual(queue);
    } finally {
      process.chdir(original);
    }
  });
});
