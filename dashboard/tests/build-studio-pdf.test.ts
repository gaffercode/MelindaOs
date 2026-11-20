import { describe, expect, it } from "vitest";
import { buildStudioPdf } from "@/lib/pdf/build-studio-pdf";

function expectPdf(bytes: Uint8Array) {
  expect(bytes.byteLength).toBeGreaterThan(1000);
  expect(Buffer.from(bytes.subarray(0, 4)).toString("utf8")).toBe("%PDF");
}

describe("buildStudioPdf", () => {
  it("builds SPO, SK, and Form PDFs from Studio payloads", { timeout: 30_000 }, async () => {
    expectPdf(
      await buildStudioPdf("spo", {
        title: "SPO Uji",
        doc_no: "001/SPO/UJI/2026",
        sections: {
          "1. Pengertian": "Definisi uji.",
          "2. Tujuan": "Tujuan uji.",
        },
      })
    );
    expectPdf(
      await buildStudioPdf("sk", {
        no_sk: "001/SK-DIR/XI/2026",
        tentang: "Uji SK",
        menimbang: ["bahwa uji diperlukan;"],
        mengingat: ["UU 17/2023;"],
        diktum: [{ label: "KESATU", isi: "Menetapkan uji." }],
      })
    );
    expectPdf(
      await buildStudioPdf("form", {
        title: "Form Uji",
        form_code: "FORM-UJI",
        starkes_ref: "STARKES SKP 1",
        unit: "IGD",
        instructions: "Isi lengkap.",
        sections: [{ title: "Checklist", rows: [{ item: "Identitas", options: "[  ] Ya" }] }],
      })
    );
  });
});
