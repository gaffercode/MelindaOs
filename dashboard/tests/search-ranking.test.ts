import { describe, expect, it } from "vitest";
import type { KnowledgeDocument } from "@/lib/contracts";
import { searchDocuments } from "@/lib/repository";

function doc(partial: Partial<KnowledgeDocument> & { path: string; title: string; body: string }): KnowledgeDocument {
  const { body, ...rest } = partial;
  const base = { category: "A" as const, docId: "", domain: "Operasional", department: "Umum", lastReviewed: "2026-09-28", tags: [] as string[], ...rest };
  return { ...base, searchableText: `${base.title} ${base.docId} ${base.domain} ${base.department} ${base.tags.join(" ")} ${base.path} ${body}`.toLowerCase() };
}

const klaim = doc({ path: "04_BPJS/kb-finansial-klaim-bpjs.md", title: "Alur klaim BPJS", docId: "SOP-FIN-KLAIM", tags: ["bpjs", "klaim"], body: "Verifikasi berkas klaim sebelum pengajuan ke BPJS Kesehatan." });
const rujukan = doc({ path: "05_REFERRAL/kb-operasional-rujukan.md", title: "Rujukan pasien", docId: "SOP-OPS-RUJUK", body: "Pasien peserta BPJS dirujuk sesuai jenjang. Formulir klaim tidak dibahas di sini." });
const kebersihan = doc({ path: "01_HOSPITAL/kb-operasional-kebersihan.md", title: "Kebersihan tangan", docId: "SOP-OPS-CUCI", body: "Lima momen cuci tangan untuk seluruh petugas." });
const agentRules = doc({ path: "09_AGENT_ARCHITECTURE/agents/agent-katt-rules.prompt.md", category: "B", title: "Agent Katt rules", body: "Orchestrator untuk rutinitas harian." });
const schema = doc({ path: "11_MACHINE_READABLE/schema-rujukan.json", category: "C", title: "Schema rujukan", body: "Bidang wajib: asal, tujuan, diagnosis." });
const corpus = [kebersihan, rujukan, agentRules, klaim, schema];

describe("ranked document search", () => {
  it("finds a document despite a one-letter typo and labels it as a nearest result", () => {
    const results = searchDocuments(corpus, "kebersihen");
    expect(results.map((result) => result.path)).toEqual([kebersihan.path]);
    expect(results[0].match).toBe("partial");
  });

  it("ranks a title match above a body-only mention", () => {
    const results = searchDocuments(corpus, "klaim");
    expect(results.map((result) => result.path)).toEqual([klaim.path, rujukan.path]);
    expect(results.every((result) => result.match === "full")).toBe(true);
  });

  it("puts documents with every term before documents with only some terms", () => {
    const results = searchDocuments(corpus, "rujukan diagnosis");
    expect(results[0]).toMatchObject({ path: schema.path, match: "full" });
    expect(results.slice(1).map((result) => [result.path, result.match])).toEqual([[rujukan.path, "partial"]]);
  });

  it("treats a word prefix as a full match", () => {
    expect(searchDocuments(corpus, "verifik")).toMatchObject([{ path: klaim.path, match: "full" }]);
  });

  it("still finds agent rules and schemas, not only knowledge documents", () => {
    expect(searchDocuments(corpus, "orchestrator")[0]).toMatchObject({ path: agentRules.path, category: "B" });
    expect(searchDocuments(corpus, "diagnosis")[0]).toMatchObject({ path: schema.path, category: "C" });
  });

  it("matches on doc id and path segments", () => {
    expect(searchDocuments(corpus, "SOP-OPS-CUCI")[0].path).toBe(kebersihan.path);
    expect(searchDocuments(corpus, "05_REFERRAL")[0].path).toBe(rujukan.path);
  });

  it("returns nothing for an empty query or a word unlike anything in the corpus", () => {
    expect(searchDocuments(corpus, "   ")).toEqual([]);
    expect(searchDocuments(corpus, "zzzqqqxxx")).toEqual([]);
  });

  it("honours the limit and never returns the internal search corpus", () => {
    const results = searchDocuments(corpus, "bpjs", 1);
    expect(results).toHaveLength(1);
    expect(results[0]).not.toHaveProperty("searchableText");
    expect(results[0].snippet).toContain("bpjs");
  });

});

describe("what counts as a full match", () => {
  it("keeps a document that only has the word inside a longer word, as a nearest result above spelling near-misses", () => {
    const affixed = doc({ path: "a/kb-affix.md", title: "Tata graha", body: "Petugas membersihkan ruangan setiap pagi." });
    const nearMiss = doc({ path: "a/kb-near.md", title: "Logistik", body: "Stok bersik dicatat harian." });
    const exact = doc({ path: "a/kb-exact.md", title: "Linen", body: "Linen bersih disimpan terpisah." });
    const results = searchDocuments([nearMiss, affixed, exact], "bersih");
    expect(results.map((result) => [result.path, result.match])).toEqual([[exact.path, "full"], [affixed.path, "partial"], [nearMiss.path, "partial"]]);
  });

  it("requires a dotted or hyphenated query word to appear as written", () => {
    const scattered = doc({ path: "01_HOSPITAL/kb-scattered.md", title: "Catatan hk", body: "Berlaku tahun 07." });
    const literal = doc({ path: "07_LEGAL/kb-literal.md", title: "Fornas", body: "KMK HK.01.07/MENKES/1199/2025 berlaku." });
    const results = searchDocuments([scattered, literal], "HK.01.07");
    expect(results[0]).toMatchObject({ path: literal.path, match: "full" });
    expect(results.find((result) => result.path === scattered.path)?.match).toBe("partial");
  });

  it("does not let a number match a longer number", () => {
    const hundred = doc({ path: "a/kb-100.md", title: "Dosis A", body: "Berikan 100 mg per oral." });
    const ten = doc({ path: "a/kb-10.md", title: "Dosis B", body: "Berikan 10 mg per oral." });
    const results = searchDocuments([hundred, ten], "10 mg");
    expect(results[0]).toMatchObject({ path: ten.path, match: "full" });
    expect(results.find((result) => result.path === hundred.path)?.match).toBe("partial");
  });

  it("does not let a single letter match any word that starts with it", () => {
    const vitaminK = doc({ path: "a/kb-vitk.md", title: "Vitamin K neonatus", body: "Injeksi vitamin k saat lahir." });
    const vitaminC = doc({ path: "a/kb-vitc.md", title: "Vitamin C", body: "Diberikan bersama kalium." });
    const results = searchDocuments([vitaminC, vitaminK], "vitamin k");
    expect(results.map((result) => [result.path, result.match])).toEqual([[vitaminK.path, "full"], [vitaminC.path, "partial"]]);
  });

  it("does not stretch a short abbreviation to a different one", () => {
    const icd = doc({ path: "a/kb-icd.md", title: "Kode ICD", body: "Pengodean diagnosis." });
    expect(searchDocuments([icd], "igd")).toEqual([]);
  });

  it("checks every word of a long regulation query, not only its first fragments", () => {
    const regulation = doc({ path: "07_LEGAL/kb-reg.md", title: "Regulasi", body: "KMK HK.01.07/MENKES/1128/2022 tentang standar." });
    expect(searchDocuments([regulation], "HK.01.07/MENKES/1128/2022 kebidanan")).toMatchObject([{ path: regulation.path, match: "partial" }]);
    expect(searchDocuments([regulation], "HK.01.07/MENKES/1128/2022 standar")).toMatchObject([{ path: regulation.path, match: "full" }]);
  });
});
