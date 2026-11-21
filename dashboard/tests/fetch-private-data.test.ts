import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REQUIRED_FILES, fetchPrivateData, parseManifest, safePath, untrackedKnowledge } from "../scripts/fetch-private-data.mjs";

const env = { MELINDAOS_PRIVATE_DATA: "required", MELINDAOS_SUPABASE_URL: "https://project.supabase.example", MELINDAOS_SUPABASE_SECRET_KEY: "test-service-key" } as unknown as NodeJS.ProcessEnv;
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

function storage(objects: Record<string, string>) {
  const calls: string[] = [];
  const transport = (async (url: string, init?: RequestInit) => {
    calls.push(url);
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer test-service-key");
    const key = decodeURIComponent(url.replace("https://project.supabase.example/storage/v1/object/build-data/", ""));
    return key in objects ? new Response(objects[key], { status: 200 }) : new Response("missing", { status: 404 });
  }) as unknown as typeof fetch;
  return { calls, transport };
}

const release = "20261119T150000Z";
const doc = "# Dokumen\n";
const manifest = { release, files: [{ path: "knowledge/01_HOSPITAL/kb-operasional-contoh.md", sha256: sha(doc), bytes: Buffer.byteLength(doc) }] };

describe("fetch-private-data", () => {
  it("does nothing unless production asks for the private data", async () => {
    const lines: string[] = [];
    const { calls, transport } = storage({});
    expect(await fetchPrivateData({ env: {} as NodeJS.ProcessEnv, transport, log: (line) => lines.push(line) })).toEqual({ skipped: true, files: 0 });
    expect(calls).toEqual([]);
    expect(lines[0]).toContain("skipped");
  });

  it("stops a Vercel production build that has neither the flag nor the private files on disk", async () => {
    const production = { VERCEL_ENV: "production" } as unknown as NodeJS.ProcessEnv;
    const { calls, transport } = storage({});
    const empty = mkdtempSync(join(tmpdir(), "private-data-"));
    await expect(fetchPrivateData({ env: production, transport, root: empty, log: () => {} })).rejects.toThrow("MELINDAOS_PRIVATE_DATA=required");
    const carried = mkdtempSync(join(tmpdir(), "private-data-"));
    mkdirSync(join(carried, "knowledge", "01_HOSPITAL"), { recursive: true });
    expect(await fetchPrivateData({ env: production, transport, root: carried, log: () => {} })).toEqual({ skipped: true, files: 0 });
    expect(calls).toEqual([]);
  });

  it("names knowledge files that Git does not track, except the folders kept local by design", () => {
    expect(untrackedKnowledge([
      "knowledge/06_CLINICAL_SAFETY/kb-klinis-baru.md",
      "knowledge/07_LEGAL_REGULATORY/kredensial/berkas_2026/bukti_foto/lembar-01.pdf",
      "dashboard/data/melinda/2026-11-20.json",
    ])).toEqual(["knowledge/06_CLINICAL_SAFETY/kb-klinis-baru.md"]);
  });

  it("downloads the current release and checks every file", async () => {
    const root = mkdtempSync(join(tmpdir(), "private-data-"));
    const { transport } = storage({ "current.json": JSON.stringify({ release }), [`releases/${release}/manifest.json`]: JSON.stringify(manifest), [`releases/${release}/files/${manifest.files[0].path}`]: doc });
    const result = await fetchPrivateData({ env, transport, root, log: () => {}, required: [] });
    expect(result).toEqual({ skipped: false, files: 1, release });
    expect(readFileSync(join(root, "knowledge", "01_HOSPITAL", "kb-operasional-contoh.md"), "utf8")).toBe(doc);
  });

  it("stops the build when a file does not match its hash, or a secret is missing", async () => {
    const root = mkdtempSync(join(tmpdir(), "private-data-"));
    const { transport } = storage({ "current.json": JSON.stringify({ release }), [`releases/${release}/manifest.json`]: JSON.stringify(manifest), [`releases/${release}/files/${manifest.files[0].path}`]: "tampered" });
    await expect(fetchPrivateData({ env, transport, root, log: () => {}, required: [] })).rejects.toThrow("does not match");
    await expect(fetchPrivateData({ env: { MELINDAOS_PRIVATE_DATA: "required" } as unknown as NodeJS.ProcessEnv, transport, root, log: () => {} })).rejects.toThrow("required");
  });

  it("stops the build when the release lacks the real content files, before downloading anything", async () => {
    const root = mkdtempSync(join(tmpdir(), "private-data-"));
    const { calls, transport } = storage({ "current.json": JSON.stringify({ release }), [`releases/${release}/manifest.json`]: JSON.stringify(manifest), [`releases/${release}/files/${manifest.files[0].path}`]: doc });
    await expect(fetchPrivateData({ env, transport, root, log: () => {} })).rejects.toThrow("dashboard/data/content/task-vault.json");
    expect(calls).toHaveLength(2);
    expect(REQUIRED_FILES.every((path) => safePath(path))).toBe(true);
  });

  it("accepts only relative paths inside the private data folders", () => {
    expect(safePath("knowledge/06_CLINICAL_SAFETY/x.md")).toBe(true);
    expect(safePath("dashboard/data/melinda/2026-10-23.json")).toBe(true);
    expect(safePath("dashboard/scripts/trace-manifest.json")).toBe(true);
    for (const bad of ["../etc/passwd", "/etc/passwd", "knowledge/../../x", "dashboard/lib/x.ts", "C:/x", "knowledge\\x.md", "", 7]) expect(safePath(bad)).toBe(false);
    expect(parseManifest({ release, files: [{ path: "../x", sha256: sha("x"), bytes: 1 }] })).toBeNull();
  });
});
