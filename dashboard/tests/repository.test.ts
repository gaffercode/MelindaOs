import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildKnowledgeIndex, chunkDocument, getDashboardData, loadKnowledgeChunks, loadKnowledgeDocuments, parseValidationOutput, searchDocuments } from "@/lib/repository";
import type { KnowledgeDocument } from "@/lib/contracts";

const checker = vi.hoisted(() => ({ runs: 0, fail: false }));
vi.mock("node:child_process", () => ({
  execFile: (_command: string, _args: string[], _options: unknown, done: (error: unknown, result?: { stdout: string }) => void) => {
    if (checker.fail) {
      done(new Error("checker down"));
      return;
    }
    checker.runs += 1;
    done(null, { stdout: `Kategori A: ${checker.runs} lolos dari 9 file\nKategori B: 0 lolos dari 0 file\nKategori C: 0 lolos dari 0 file\nTOTAL: ${checker.runs} lolos dari 9 file` });
  },
}));

describe("parseValidationOutput", () => {
  it("parses valid summaries even when the checker process would exit 1", () => {
    const output = [
      "Kategori A: 254 lolos dari 255 file",
      "Kategori B: 29 lolos dari 29 file",
      "Kategori C: 9 lolos dari 9 file",
      "TOTAL: 292 lolos dari 293 file",
    ].join("\n");
    const result = parseValidationOutput(output, "2026-09-29T00:00:00.000Z");
    expect(result?.status).toBe("available");
    expect(result?.source).toBe("live");
    expect(result?.passed).toBe(292);
    expect(result?.counts[0]).toEqual({ category: "A", passed: 254, total: 255 });
  });
});

describe("searchDocuments", () => {
  const document: KnowledgeDocument = {
    path: "knowledge/04_BPJS/test/kb-operasional-klaim.md",
    category: "A",
    title: "Alur Klaim BPJS",
    docId: "SOP-OPS-KLAIM",
    domain: "Operasional",
    department: "Casemix",
    lastReviewed: "2026-09-28",
    tags: ["bpjs", "klaim"],
    searchableText: "alur klaim bpjs sop-ops-klaim operasional casemix bpjs klaim verifikasi dokumen",
  };

  it("labels a document with every query term as a full match and strips the internal search corpus", () => {
    const results = searchDocuments([document], "bpjs verifikasi");
    expect(results).toHaveLength(1);
    expect(results[0]).not.toHaveProperty("searchableText");
    expect(results[0].match).toBe("full");
  });
  it("keeps a document that has only some query terms, as a nearest result", () => {
    expect(searchDocuments([document], "bpjs pasien")).toMatchObject([{ path: document.path, match: "partial" }]);
  });
});

describe("loadKnowledgeDocuments", () => {
  it("includes approved KB files with quoted governance status", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "melindaos-repository-"));
    const directory = path.join(root, "knowledge/01_HOSPITAL", "governance");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "kb-manajemen-struktur.md"), [
      "---",
      'doc_id: "MGT-STRUCTURE"',
      'title: "Struktur Organisasi Melinda"',
      'domain: "Manajemen"',
      'department: "Direksi"',
      'last_reviewed: "2026-09-28"',
      "governance:",
      '  status: "APPROVED"',
      "---",
      "# Struktur Organisasi Melinda",
    ].join("\n"), "utf8");

    try {
      const documents = await loadKnowledgeDocuments(root);
      expect(documents).toHaveLength(1);
      expect(documents[0]).toMatchObject({ category: "A", title: "Struktur Organisasi Melinda", docId: "MGT-STRUCTURE" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("attaches readiness fills from the provenance log and skips malformed lines", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "melindaos-repository-fills-"));
    const directory = path.join(root, "knowledge/01_HOSPITAL", "governance");
    await mkdir(directory, { recursive: true });
    const doc = (name: string) => writeFile(path.join(directory, name), ["---", `title: "${name}"`, "governance:", '  status: "APPROVED"', "---", `# ${name}`].join("\n"), "utf8");
    await doc("kb-manajemen-satu.md");
    await doc("kb-manajemen-dua.md");
    await mkdir(path.join(root, "knowledge/12_GOVERNANCE", "knowledge"), { recursive: true });
    await writeFile(path.join(root, "knowledge/12_GOVERNANCE", "knowledge", "readiness-provenance.jsonl"), [
      JSON.stringify({ docPath: "knowledge/01_HOSPITAL/governance/kb-manajemen-satu.md", line: 7, placeholder: "[ISI]", value: "dr. A", method: "fact", sourceRef: "dashboard/data/studio/facts.json#director.name", quote: null, model: null, at: "2026-11-07T00:00:00+00:00" }),
      "{ this is not json",
      JSON.stringify({ docPath: "knowledge/01_HOSPITAL/governance/kb-manajemen-satu.md", line: 9, placeholder: "[ISI jam]", value: "07.00", method: "ai", sourceRef: "knowledge/01_HOSPITAL/x.md", quote: null, model: "m", at: "2026-11-07T00:00:00+00:00" }),
      JSON.stringify({ placeholder: "[ISI]", value: "no doc path" }),
      "",
    ].join("\n"), "utf8");
    try {
      const documents = await loadKnowledgeDocuments(root);
      const satu = documents.find((d) => d.path.endsWith("kb-manajemen-satu.md"));
      const dua = documents.find((d) => d.path.endsWith("kb-manajemen-dua.md"));
      expect(satu?.aiFills).toEqual([
        { placeholder: "[ISI]", value: "dr. A", method: "fact", sourceRef: "dashboard/data/studio/facts.json#director.name" },
        { placeholder: "[ISI jam]", value: "07.00", method: "ai", sourceRef: "knowledge/01_HOSPITAL/x.md" },
      ]);
      expect(dua?.aiFills).toBeUndefined();
      expect(searchDocuments(documents, "satu")[0]?.aiFills).toHaveLength(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reuses the index within the cache window and rereads after it expires", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "melindaos-repository-cache-"));
    const directory = path.join(root, "knowledge/01_HOSPITAL");
    await mkdir(directory, { recursive: true });
    const write = (name: string) => writeFile(path.join(directory, name), ["---", `title: "${name}"`, "governance:", '  status: "APPROVED"', "---", `# ${name}`].join("\n"), "utf8");
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      await write("kb-operasional-satu.md");
      expect(await loadKnowledgeDocuments(root)).toHaveLength(1);
      await write("kb-operasional-dua.md");
      expect(await loadKnowledgeDocuments(root)).toHaveLength(1);
      vi.setSystemTime(Date.now() + 61_000);
      expect(await loadKnowledgeDocuments(root)).toHaveLength(2);
    } finally {
      vi.useRealTimers();
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("knowledge index fallback", () => {
  async function liveRoot(): Promise<string> {
    const root = await mkdtemp(path.join(os.tmpdir(), "melindaos-index-live-"));
    await mkdir(path.join(root, "knowledge/01_HOSPITAL"), { recursive: true });
    await writeFile(path.join(root, "knowledge/01_HOSPITAL", "kb-manajemen-contoh.md"), "---\ntitle: Contoh Index\ngovernance:\n  status: APPROVED\n---\n# Contoh Index\n", "utf8");
    await mkdir(path.join(root, "knowledge/11_MACHINE_READABLE", "agentic_config"), { recursive: true });
    await writeFile(path.join(root, "knowledge/11_MACHINE_READABLE", "agentic_config", "providers.yaml"), "providers:\n  example:\n    primary_auth: api_key\n    capabilities: [chat]\n", "utf8");
    return root;
  }

  it("builds an index from a live repository", async () => {
    const root = await liveRoot();
    try {
      const index = await buildKnowledgeIndex(root);
      expect(index.documents.map((document) => document.title)).toEqual(["Contoh Index"]);
      expect(index).not.toHaveProperty("agents");
      expect(index.providers.map((provider) => provider.name)).toEqual(["example"]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("serves the last checker result while an expired one refreshes in the background", async () => {
    const root = await liveRoot();
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      checker.runs = 0;
      expect((await getDashboardData(root)).validation.passed).toBe(1);
      vi.setSystemTime(Date.now() + 61_000);
      expect((await getDashboardData(root)).validation.passed).toBe(1);
      expect(checker.runs).toBe(2);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect((await getDashboardData(root)).validation.passed).toBe(2);
      expect(checker.runs).toBe(2);
    } finally {
      vi.useRealTimers();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("serves documents and dashboard data from the index when the repository root is absent", async () => {
    const live = await liveRoot();
    const runtime = await mkdtemp(path.join(os.tmpdir(), "melindaos-index-runtime-"));
    const indexFile = path.join(runtime, "knowledge-index.json");
    try {
      await writeFile(indexFile, JSON.stringify(await buildKnowledgeIndex(live)), "utf8");
      const missingRoot = path.join(runtime, "no-repo");
      expect((await loadKnowledgeDocuments(missingRoot, indexFile)).map((document) => document.title)).toEqual(["Contoh Index"]);
      const data = await getDashboardData(missingRoot, indexFile, path.join(runtime, "validation-missing.json"));
      expect(data.documentCount).toBe(1);
      expect(data).not.toHaveProperty("agents");
      expect(data.validation).toMatchObject({ status: "unavailable", error: "Checker berjalan di CI." });
    } finally {
      await rm(live, { recursive: true, force: true });
      await rm(runtime, { recursive: true, force: true });
    }
  });

  it("serves the committed validation snapshot when the repository root is absent", async () => {
    const live = await liveRoot();
    const runtime = await mkdtemp(path.join(os.tmpdir(), "melindaos-index-validation-"));
    const indexFile = path.join(runtime, "knowledge-index.json");
    const validationFile = path.join(runtime, "validation.json");
    try {
      await writeFile(indexFile, JSON.stringify(await buildKnowledgeIndex(live)), "utf8");
      await writeFile(validationFile, JSON.stringify({
        status: "available",
        scannedAt: "2026-11-09T00:00:00.000Z",
        counts: [
          { category: "A", passed: 454, total: 454 },
          { category: "B", passed: 21, total: 21 },
          { category: "C", passed: 13, total: 13 },
        ],
        passed: 488,
        total: 488,
        limitation: "Mengukur format dokumen dan governance canonical.",
      }), "utf8");
      const data = await getDashboardData(path.join(runtime, "no-repo"), indexFile, validationFile);
      expect(data.validation).toMatchObject({ status: "available", passed: 488, total: 488, source: "snapshot" });
      expect(data.validation.counts).toEqual([
        { category: "A", passed: 454, total: 454 },
        { category: "B", passed: 21, total: 21 },
        { category: "C", passed: 13, total: 13 },
      ]);
    } finally {
      await rm(live, { recursive: true, force: true });
      await rm(runtime, { recursive: true, force: true });
    }
  });

  it("serves the snapshot when the runtime scan fails instead of the unavailable payload", async () => {
    const live = await liveRoot();
    const runtime = await mkdtemp(path.join(os.tmpdir(), "melindaos-index-scan-fail-"));
    const validationFile = path.join(runtime, "validation.json");
    try {
      await writeFile(validationFile, JSON.stringify({
        status: "available",
        scannedAt: "2026-11-09T00:00:00.000Z",
        counts: [{ category: "A", passed: 1, total: 1 }],
        passed: 1,
        total: 1,
        limitation: "Mengukur format dokumen dan governance canonical.",
      }), "utf8");
      checker.fail = true;
      const data = await getDashboardData(live, path.join(runtime, "unused-index.json"), validationFile);
      expect(data.validation).toMatchObject({ status: "available", passed: 1, total: 1, source: "snapshot" });
    } finally {
      checker.fail = false;
      await rm(live, { recursive: true, force: true });
      await rm(runtime, { recursive: true, force: true });
    }
  });

  it.each([["corrupt", "{not json"], ["unavailable-status", JSON.stringify({ status: "unavailable" })]])(
    "falls back to the CI notice when the validation snapshot is %s",
    async (_label, contents) => {
      const live = await liveRoot();
      const runtime = await mkdtemp(path.join(os.tmpdir(), "melindaos-index-bad-validation-"));
      const indexFile = path.join(runtime, "knowledge-index.json");
      const validationFile = path.join(runtime, "validation.json");
      try {
        await writeFile(indexFile, JSON.stringify(await buildKnowledgeIndex(live)), "utf8");
        await writeFile(validationFile, contents, "utf8");
        const data = await getDashboardData(path.join(runtime, "no-repo"), indexFile, validationFile);
        expect(data.validation).toMatchObject({ status: "unavailable", error: "Checker berjalan di CI." });
      } finally {
        await rm(live, { recursive: true, force: true });
        await rm(runtime, { recursive: true, force: true });
      }
    },
  );

  it.each([["missing", null], ["corrupt", "{not json"]])("fails with knowledge_index_missing when the index is %s", async (_label, contents) => {
    const runtime = await mkdtemp(path.join(os.tmpdir(), "melindaos-index-bad-"));
    const indexFile = path.join(runtime, "knowledge-index.json");
    try {
      if (contents !== null) await writeFile(indexFile, contents, "utf8");
      await expect(loadKnowledgeDocuments(path.join(runtime, "no-repo"), indexFile)).rejects.toThrow("knowledge_index_missing");
    } finally { await rm(runtime, { recursive: true, force: true }); }
  });
});

describe("knowledge chunks", () => {
  const doc = (body: string) => ({ docId: "KB-X", path: "knowledge/01_HOSPITAL/kb-x.md", title: "Dokumen X", body });

  it("emits one chunk per ## / ### section with its heading path", () => {
    const chunks = chunkDocument(doc("# Dokumen X\nPembuka.\n\n## A\nIsi A.\n\n### A.1\nIsi A1.\n\n## B\nIsi <b>B</b>.\n"));
    expect(chunks.map((chunk) => chunk.headingPath)).toEqual([["A"], ["A", "A.1"], ["B"]]);
    expect(chunks.map((chunk) => chunk.text)).toEqual(["Isi A.", "Isi A1.", "Isi B."]);
    expect(chunks[0]).toMatchObject({ docId: "KB-X", path: "knowledge/01_HOSPITAL/kb-x.md", title: "Dokumen X" });
  });

  it("splits long sections on paragraph boundaries and keeps ids unique and stable", () => {
    const paragraphs = Array.from({ length: 10 }, (_, index) => `Paragraf ${index} ${"kata ".repeat(78)}`.trim());
    const body = `## Panjang\n${paragraphs.join("\n\n")}\n`;
    const chunks = chunkDocument(doc(body));
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(1600);
      for (const part of chunk.text.split("\n\n")) expect(paragraphs).toContain(part);
    }
    expect(new Set(chunks.map((chunk) => chunk.id)).size).toBe(chunks.length);
    expect(chunkDocument(doc(body)).map((chunk) => chunk.id)).toEqual(chunks.map((chunk) => chunk.id));
  });

  it("keeps clinical thresholds written with < and > while stripping real HTML tags", () => {
    const [chunk] = chunkDocument(doc("## Rujuk\nTD <90 mmHg dan nadi >100 x/menit, SpO2 < 95%, skor <= 4.<br/>Lihat <span class=\"x\">tabel</span>.\n"));
    expect(chunk.text).toBe("TD <90 mmHg dan nadi >100 x/menit, SpO2 < 95%, skor <= 4.Lihat tabel.");
  });

  it("hard-splits a single oversized paragraph and ignores headings inside code fences", () => {
    const chunks = chunkDocument(doc(`## Tabel\n${"| sel | nilai |\n".repeat(200)}\n## Kode\n\`\`\`\n## bukan heading\n\`\`\`\n`));
    expect(chunks.every((chunk) => chunk.text.length <= 1600)).toBe(true);
    expect(chunks.some((chunk) => chunk.headingPath.includes("bukan heading"))).toBe(false);
    expect(chunks.at(-1)?.headingPath).toEqual(["Kode"]);
  });

  it("indexes chunks of approved category A documents only, without frontmatter, and serves them from the chunks file", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "melindaos-chunks-"));
    const runtime = await mkdtemp(path.join(os.tmpdir(), "melindaos-chunks-runtime-"));
    try {
      await mkdir(path.join(root, "knowledge/01_HOSPITAL"), { recursive: true });
      await writeFile(path.join(root, "knowledge/01_HOSPITAL", "kb-ok.md"), "---\ndoc_id: KB-OK\ntitle: Disetujui\ngovernance:\n  status: APPROVED\n---\n# Disetujui\n## Bagian\nIsi disetujui.\n", "utf8");
      await writeFile(path.join(root, "knowledge/01_HOSPITAL", "kb-draf.md"), "---\ndoc_id: KB-DRAF\ntitle: Draf\nstatus: DRAFT\n---\n## Bagian\nIsi draf.\n", "utf8");
      await mkdir(path.join(root, "knowledge/11_MACHINE_READABLE", "ontology"), { recursive: true });
      await mkdir(path.join(root, "knowledge/11_MACHINE_READABLE", "agentic_config"), { recursive: true });
      await writeFile(path.join(root, "knowledge/11_MACHINE_READABLE", "ontology", "rsia_clinical_ontology.json"), "{}", "utf8");
      await writeFile(path.join(root, "knowledge/11_MACHINE_READABLE", "agentic_config", "providers.yaml"), "providers:\n", "utf8");
      const index = await buildKnowledgeIndex(root);
      expect(index.chunks.map((chunk) => [chunk.docId, chunk.text])).toEqual([["KB-OK", "Isi disetujui."]]);
      expect(JSON.stringify(index.chunks)).not.toContain("doc_id");
      const chunksFile = path.join(runtime, "knowledge-chunks.json");
      await writeFile(chunksFile, JSON.stringify(index.chunks), "utf8");
      expect(await loadKnowledgeChunks(path.join(runtime, "no-repo"), chunksFile)).toEqual(index.chunks);
      await expect(loadKnowledgeChunks(path.join(runtime, "no-repo-2"), path.join(runtime, "missing.json"))).rejects.toThrow("knowledge_index_missing");
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(runtime, { recursive: true, force: true });
    }
  });
});