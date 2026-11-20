import { describe, expect, it } from "vitest";
import { evaluateDocument } from "@/lib/studio/evaluate-document";
import { makeContext, makeDocument } from "./fixtures/studio-package";

const issues = (doc = makeDocument(), context = makeContext()) => evaluateDocument(doc, context);
describe("Studio finalization rules", () => {
  it("blocks_unresolved_publication_fields", () => {
    expect(issues(makeDocument({ number: null, issueDate: null })).filter((i) => i.code === "publication_missing")).toHaveLength(2);
    expect(issues(makeDocument({ number: null }), makeContext({ phase: "draft" })).some((i) => i.severity === "blocker")).toBe(false);
  });
  it.each(["[ISI]", "[CEK]", "[ISI nomor SK]", "[ISI: jam]", "[CEK: RS mitra]", "DRAF UNTUK KOREKSI", "Draft for owner approval"])("rejects placeholder or draft copy %s", (text) => {
    const doc = makeDocument(); doc.sections[0].blocks = [{ type: "table", headers: ["Isi"], rows: [[text]] }];
    const found = issues(doc).filter((i) => i.code === "placeholder");
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((i) => i.severity === "blocker")).toBe(true);
  });
  it("requires_nine_spo_sections", () => {
    const doc = makeDocument(); doc.sections.pop();
    expect(issues(doc).some((i) => i.code === "structure_missing")).toBe(true);
  });
  it("accepts_blank_operational_and_signature_inputs", () => {
    const doc = makeDocument({ kind: "form", sections: [{ id: "petunjuk", heading: "Petunjuk", blocks: [
      { type: "text", text: "Catat hasil pemeriksaan identitas sebelum pelayanan." },
      { type: "input", label: "Identitas pasien", purpose: "operational" },
      { type: "input", label: "Tanda tangan petugas", purpose: "signature" },
    ] }] });
    expect(issues(doc)).toEqual([]);
  });
  it("blocks_owner_document_director_release", () => {
    expect(issues(makeDocument({ authority: "owner" })).some((i) => i.code === "authority_mismatch")).toBe(true);
  });
  it("blocks_changed_unverified_or_absent_sources", () => {
    expect(issues(makeDocument(), makeContext({ sourceHashes: {} })).some((i) => i.code === "source_changed")).toBe(true);
    expect(issues(makeDocument({ sources: [] })).some((i) => i.code === "source_missing")).toBe(true);
    const doc = makeDocument(); doc.sources[0].status = "unresolved";
    expect(issues(doc).some((i) => i.code === "source_unverified")).toBe(true);
  });
  it("blocks_broken_references_and_unresolved_applicability", () => {
    expect(issues(makeDocument({ relatedDocumentIds: ["absent"] })).some((i) => i.code === "reference_missing")).toBe(true);
    expect(issues(makeDocument(), makeContext({ applicability: {} })).some((i) => i.code === "applicability_unresolved")).toBe(true);
  });
  it("rejects_empty_sections_invalid_dates_and_malformed_tables", () => {
    const doc = makeDocument({ issueDate: "2026-02-31" });
    doc.sections[0].blocks = [];
    doc.sections[1].blocks = [{ type: "table", headers: ["A", "B"], rows: [["one"]] }];
    expect(issues(doc).map((i) => i.code)).toEqual(expect.arrayContaining(["publication_invalid", "section_empty", "table_invalid"]));
  });
});
