import { afterEach, describe, expect, it, vi } from "vitest";
import { exportReportPdf, reportPdfFileName } from "@/lib/report-pdf";

describe("reportPdfFileName", () => {
  it("builds a safe PDF filename from facility, title, and date", () => {
    expect(
      reportPdfFileName({
        facility: "RSIA Melinda DHAI",
        title: "After Services Brief",
        dateIso: "2026-10-24",
      }),
    ).toBe("RSIA-Melinda-DHAI-After-Services-Brief-2026-10-24.pdf");
  });
});

describe("exportReportPdf", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sets a suggested document title and opens the print dialog", () => {
    const listeners = new Map<string, EventListener>();
    const print = vi.fn();
    const doc = { title: "MelindaOS" };
    vi.stubGlobal("document", doc);
    vi.stubGlobal("window", {
      print,
      addEventListener: (type: string, listener: EventListener) => {
        listeners.set(type, listener);
      },
      removeEventListener: (type: string) => {
        listeners.delete(type);
      },
      setTimeout: ((() => 0) as unknown) as typeof setTimeout,
    });

    exportReportPdf({ fileName: "RSIA-Melinda-Morning-Brief-2026-10-23.pdf" });

    expect(doc.title).toBe("RSIA-Melinda-Morning-Brief-2026-10-23");
    expect(print).toHaveBeenCalledTimes(1);

    listeners.get("afterprint")?.(new Event("afterprint"));
    expect(doc.title).toBe("MelindaOS");
  });
});
