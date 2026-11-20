import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DocumentStudioView } from "@/components/studio/document-studio-view";
import { FORM_PRESETS, SK_PRESETS, SPO_PRESETS } from "@/components/studio/document-studio-presets";

describe("Melinda Studio - extracted preset data", () => {
  // The repository holds fictional presets (dashboard/data/content/studio-presets.json); production loads the real ones.
  it("loads the SPO presets in file order with unique names", () => {
    expect(SPO_PRESETS.length).toBeGreaterThanOrEqual(6);
    expect(SPO_PRESETS[0].name).toBe("SPO Contoh 1");
    expect(new Set(SPO_PRESETS.map((preset) => preset.name)).size).toBe(SPO_PRESETS.length);
  });

  it("loads the form presets with their STARKES references in file order", () => {
    expect(FORM_PRESETS).toHaveLength(2);
    expect(FORM_PRESETS[0].form_code).toBe("FRM-CONTOH-01");
    expect(FORM_PRESETS.map((preset) => preset.starkes_ref)).toEqual(["STARKES PAB 2", "STARKES PKPO 2"]);
  });

  it("loads the SK presets in file order", () => {
    expect(SK_PRESETS).toHaveLength(2);
    expect(SK_PRESETS[0].no_sk).toBe("001/SK-CONTOH/I/2099");
  });
});

describe("Melinda Studio - Document Builder Component", () => {
  it("renders the studio header and default SPO form", () => {
    const html = renderToStaticMarkup(<DocumentStudioView />);
    expect(html).toContain("Studio Dokumen Rumah Sakit");
    expect(html).toContain("SPO / Pedoman 9 Elemen");
    expect(html).toContain("SK Keputusan Direktur");
    expect(html).toContain("Formulir Rekam Medis (Elemen D)");
    expect(html).toContain('aria-label="Judul SPO"');
    expect(html).toContain("Pratinjau dokumen");
    expect(html).toContain("RSIA Melinda DHAI");
  });

  it("contains preloaded 9 STARKES sections and canonical director signatory", () => {
    const html = renderToStaticMarkup(<DocumentStudioView />);
    expect(html).toContain("1. Pengertian");
    expect(html).toContain("2. Tujuan");
    expect(html).toContain("3. Ruang Lingkup");
    expect(html).toContain("4. Kebijakan");
    expect(html).toContain("5. Tanggung Jawab");
    expect(html).toContain("6. Unit Terkait");
    expect(html).toContain("7. Prosedur");
    expect(html).toContain("8. Dokumen Terkait");
    expect(html).toContain("9. Riwayat Revisi");
    expect(html).toContain("dr. Ferdi Andriska, S.H., M.Kn., CMDC");
  });

  it("offers_the_package_and_the_drafting_tool_as_two_tabs_with_the_drafting_tool_first_and_the_package_panel_kept_mounted", () => {
    const html = renderToStaticMarkup(<DocumentStudioView />);
    expect(html).toContain('role="tablist"');
    expect(html).toContain("Paket akreditasi");
    expect(html).toContain("Penyusun SPO, SK, formulir");
    expect(html).toMatch(/id="studio-panel-paket"[^>]*>/);
    expect(html).toMatch(/id="studio-panel-paket"[^>]*hidden/);
    expect(html).not.toMatch(/id="studio-panel-penyusun"[^>]*hidden/);
    expect(html.indexOf("Penyusun SPO, SK, formulir")).toBeLessThan(html.indexOf("Paket akreditasi"));
  });
});
