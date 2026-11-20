import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { capabilityFromHash, nextIssuesForAvailability, sessionRequestForHash, UnitReportForm } from "@/components/unit-report-form";

describe("unit report form", () => {
  it("renders a readable minimal form without source provenance clutter or capability text", () => {
    const html = renderToStaticMarkup(<UnitReportForm reportDate="2026-10-27" source={{ id: "sdm", label: "Laporan SDM", numericFields: [] }} />);
    expect(html).toContain("Laporan SDM");
    expect(html).toContain("Status laporan");
    expect(html).toContain("Masalah atau kendala");
    expect(html).toContain("Butuh keputusan Direktur");
    expect(html).not.toContain("capability");
  });

  it("reads only a strict capability from a URL fragment", () => {
    expect(capabilityFromHash(`#capability=${"a".repeat(43)}`)).toBe("a".repeat(43));
    expect(capabilityFromHash("#capability=short")).toBeNull();
    expect(capabilityFromHash(`#other=${"a".repeat(43)}`)).toBeNull();
    expect(sessionRequestForHash(`#capability=${"a".repeat(43)}`).method).toBe("POST");
    expect(sessionRequestForHash("").method).toBe("GET");
  });

  it("clears the no-issues default when the PIC changes status to a received report", () => {
    expect(nextIssuesForAvailability("Tidak ada kendala", "received")).toBe("");
    expect(nextIssuesForAvailability("Kendala jaringan", "received")).toBe("Kendala jaringan");
  });
});
