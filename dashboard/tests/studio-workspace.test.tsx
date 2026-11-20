import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StudioPackageWorkspace } from "@/components/studio/studio-package-workspace";
import { StudioQualityPanel } from "@/components/studio/studio-quality-panel";

describe("Studio package workspace", () => {
  it("offers_package_creation_without_claiming_an_unsigned_package_is_signed", () => {
    const html = renderToStaticMarkup(<StudioPackageWorkspace />);
    expect(html).toContain("Paket dokumen"); expect(html).toContain("Pilih paket");
    expect(html).toContain("Buat paket identifikasi pasien");
    expect(html).toContain("Pengesahan dicatat setelah dokumen ditandatangani.");
    expect(html).not.toContain("Unduh PDF final");
  });
  it("blocker_panel_not_printed", () => {
    const html = renderToStaticMarkup(<StudioQualityPanel issues={[{ code: "source_changed", documentId: "doc", field: "sources", severity: "blocker", message: "Sumber berubah" }]} />);
    expect(html).toContain("print:hidden"); expect(html).toContain("Sumber berubah");
  });
  it("groups_blockers_before_warnings_and_counts_them", () => {
    const html = renderToStaticMarkup(<StudioQualityPanel issues={[
      { code: "unit", documentId: "doc", field: "unit", severity: "warning", message: "Unit perlu dikonfirmasi" },
      { code: "source", documentId: "doc", field: "sources", severity: "blocker", message: "Sumber berubah" },
    ]} />);
    expect(html).toContain("Perlu diperbaiki (1)"); expect(html).toContain("Perlu perhatian (1)");
    expect(html.indexOf("Sumber berubah")).toBeLessThan(html.indexOf("Unit perlu dikonfirmasi"));
    expect(html).toContain('data-severity="blocker"');
  });
  it("says_the_checks_pass_only_when_there_are_no_issues", () => {
    expect(renderToStaticMarkup(<StudioQualityPanel issues={[]} />)).toContain("lolos pemeriksaan otomatis");
  });
});
