import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DocumentStudioView } from "@/components/studio/document-studio-view";
import { CasemixSimulatorView } from "@/components/casemix-simulator-view";
import { StarkesReadinessView } from "@/components/starkes/starkes-readiness-view";
import { loadKelulusan } from "@/lib/starkes/kelulusan";
import { loadRequirementRegister } from "@/lib/starkes/requirements";

describe("Director tools", () => {
  it.each([DocumentStudioView, CasemixSimulatorView])("gives every text and number field an accessible name", (View) => {
    const html = renderToStaticMarkup(<View />);
    const controls = html.match(/<(?:input|textarea)\b[^>]*>/g) ?? [];
    expect(controls.length).toBeGreaterThan(5);
    for (const control of controls.filter((tag) => !tag.includes('type="checkbox"'))) {
      expect(control).toMatch(/aria-label="[^"]+"/);
    }
  });

  it("names every STARKES score selector and checkbox", async () => {
    const initial = { requirements: loadRequirementRegister().requirements, scores: [], evidence: [], rules: await loadKelulusan() };
    const html = renderToStaticMarkup(<StarkesReadinessView initial={initial} auditRole="director" />);
    const controls = html.match(/<(?:input|select)\b[^>]*>/g) ?? [];
    expect(controls.length).toBeGreaterThan(100);
    for (const control of controls) expect(control).toMatch(/aria-label="[^"]+"/);
  });

  it("explains how editable tariff examples behave", () => {
    const html = renderToStaticMarkup(<CasemixSimulatorView />);
    expect(html).toContain("Contoh simulasi");
    expect(html).toContain("Perubahan kode tidak menghitung tarif otomatis");
  });
});
