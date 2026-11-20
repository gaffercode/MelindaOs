import { describe, expect, it } from "vitest";
import { buildStarkesDossierPdf } from "@/lib/pdf/build-starkes-dossier";

describe("buildStarkesDossierPdf", () => {
  it("returns a PDF buffer for a chapter dossier payload", async () => {
    const pdf = await buildStarkesDossierPdf({
      chapter_code: "SKP",
      chapter_name: "Sasaran Keselamatan Pasien",
      chapter_group: "Keselamatan & Mutu",
      desc: "Standar Keselamatan Pasien Kemenkes RI",
      target_score: 80,
      current_score: 10,
      items: [
        {
          code: "SKP 1",
          title: "Ketepatan Identifikasi Pasien",
          r: "SPO Identifikasi Pasien 2 Indikator",
          d: "Formulir stiker identitas rekam medis",
          o: "Observasi gelang pasien",
          w: "Wawancara perawat",
          score: 10,
        },
      ],
    });
    expect(pdf.byteLength).toBeGreaterThan(1000);
    expect(Buffer.from(pdf.subarray(0, 4)).toString("utf8")).toBe("%PDF");
  });

  it("includes evidence index metadata and draft watermark when unlocked", async () => {
    const pdf = await buildStarkesDossierPdf({
      chapter_code: "SKP",
      lock_state: "draft",
      watermark_text: "DRAF AUDIT",
      evidence_index: [{ code: "SKP 1", title: "Identifikasi", status: "linked", attachments: ["spo.pdf"] }],
      items: [{ code: "SKP 1", title: "Identifikasi", score: 10 }],
    });
    expect(pdf.byteLength).toBeGreaterThan(1000);
  });
});
