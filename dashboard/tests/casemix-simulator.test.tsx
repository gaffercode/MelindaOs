import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CasemixSimulatorView } from "@/components/casemix-simulator-view";

describe("Casemix Simulator - BPJS Claim & Dispute Predictor", () => {
  it("renders the casemix simulator header and financial margin calculation", () => {
    const html = renderToStaticMarkup(<CasemixSimulatorView />);
    expect(html).toContain("Kalkulator Casemix &amp; Pencegahan Dispute Klaim BPJS");
    expect(html).toContain("Kalkulasi Margin Rumah Sakit");
    expect(html).toContain("Tarif INA-CBG");
    expect(html).toContain("Rincian Unit Cost Riil Pelayanan RSIA Melinda DHAI");
  });

  it("contains critical clinical coding and dispute shield parameters", () => {
    const html = renderToStaticMarkup(<CasemixSimulatorView />);
    expect(html).toContain("O82.0");
    expect(html).toContain("74.1");
    expect(html).toContain("Early Dispute Warning (Verifikator BPJS Shield)");
    expect(html).toContain("Sesuai Fornas");
    expect(html).toContain("Margin Sehat");
  });
});
