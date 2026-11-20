import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { exportDocument, documentFilename } from "@/lib/studio/export-document";
import { buildStudioMarkdown } from "@/lib/studio/build-markdown";
import { makeDocument } from "./fixtures/studio-package";

describe("Studio structured exports", () => {
  it("same_snapshot_drives_both_formats", { timeout: 30_000 }, async () => {
    const doc = makeDocument(); const result = await exportDocument(doc, "final");
    expect(result.markdown).toContain("001/TEST/2026");
    expect(result.markdown).toContain("Identifikasi Pasien");
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect((await PDFDocument.load(result.pdf)).getPageCount()).toBeGreaterThan(0);
  });
  it("final_has_no_draft_or_placeholder_copy", { timeout: 30_000 }, async () => {
    const result = await exportDocument(makeDocument(), "final");
    expect(result.markdown).not.toMatch(/\[ISI\]|\[CEK\]|DRAF UNTUK KOREKSI|governance:/);
    const doc = makeDocument(); doc.sections[0].blocks = [{ type: "text", text: "[ISI]" }];
    await expect(exportDocument(doc, "final")).rejects.toThrow();
  });
  it("keeps_blank_operational_form_fields", { timeout: 30_000 }, async () => {
    const doc = makeDocument({ kind: "form", sections: [{ id: "petunjuk", heading: "Petunjuk", blocks: [
      { type: "text", text: "Isi setelah observasi nyata." }, { type: "input", label: "Hasil observasi", purpose: "operational" },
    ] }] });
    const result = await exportDocument(doc, "final");
    expect(result.markdown).toContain("Hasil observasi: ____________________");
  });
  it("retains_Unicode_long_tables_and_signoff", { timeout: 30_000 }, async () => {
    const doc = makeDocument({ title: "Édukasi – Keselamatan Pasien" });
    doc.sections[0].blocks = [{ type: "table", headers: ["No", "Uraian"], rows: Array.from({ length: 140 }, (_, i) => [String(i), `Pengamatan ${i}: ${"verifikasi identitas ".repeat(12)}`]) }];
    const result = await exportDocument(doc, "final");
    expect((await PDFDocument.load(result.pdf)).getPageCount()).toBeGreaterThan(2);
    expect(result.markdown).toContain("Pengamatan 139:");
    expect(result.markdown).toContain("dr. Ferdi Andriska, S.H., M.Kn., CMDC");
  });
  it("has_pdf_filename_extension", () => {
    expect(documentFilename(makeDocument({ title: 'SPO / identitas "é"' }), "pdf")).toMatch(/\.pdf$/);
    expect(documentFilename(makeDocument(), "markdown")).toMatch(/\.md$/);
  });
  it("markdown_escapes_yaml_and_pipe_cells", () => {
    const doc = makeDocument({ title: 'Judul: "uji"\nbaru' });
    doc.sections[0].blocks = [{ type: "table", headers: ["A", "B"], rows: [["a|b", "multi\nline"]] }];
    const md = buildStudioMarkdown(doc);
    expect(JSON.parse(md.split("\n").find((line) => line.startsWith("title: "))!.slice(7))).toBe('Judul: "uji"\nbaru');
    expect(md).toContain("a\\|b"); expect(md).toContain("multi<br>line");
  });
});
