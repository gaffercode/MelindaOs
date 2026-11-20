import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as generateDocument } from "../app/api/studio/generate/route";
import { POST as generateDossier } from "../app/api/starkes/bundle/route";

vi.mock("@/lib/director/director-auth", async (original) => {
  const actual = await original<typeof import("@/lib/director/director-auth")>();
  return {
    ...actual,
    // Hosted PDF builders must not depend on the old Vercel early-return; keep auth off so Node PDF is exercised.
    protectedDirectorMode: () => false,
  };
});

afterEach(() => vi.unstubAllEnvs());

describe("hosted PDF runtime", () => {
  it("compiles Studio SPO with the Node PDF builder on Vercel", async () => {
    vi.stubEnv("VERCEL", "1");
    const response = await generateDocument(
      new Request("https://dashboard.example/api/studio/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          docType: "spo",
          data: {
            title: "SPO Hosted Validation",
            doc_no: "001/SPO/TEST/2026",
            sections: {
              PENGERTIAN: ["Pengujian kompilasi Studio di Vercel."],
              TUJUAN: ["Memastikan PDF Node tersedia di production."],
            },
          },
        }),
      })
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(1000);
  });

  it("compiles the STARKES dossier with the Node PDF builder on Vercel", async () => {
    vi.stubEnv("VERCEL", "1");
    const payload = {
      chapterCode: "SKP",
      data: {
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
      },
    };
    const response = await generateDossier(
      new Request("https://dashboard.example/api/starkes/bundle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(1000);
    // ~1.3 s alone, but it timed out at the 5 s default twice under `test:coverage` load on the Director's Windows machine.
  }, 15000);
});
