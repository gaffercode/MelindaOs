import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/starkes/bundle/route";

describe("API STARKES Chapter Dossier Bundle Endpoint", () => {
  it("rejects missing chapterCode or data", async () => {
    const req = new Request("http://localhost:3000/api/starkes/bundle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("chapterCode dan data wajib disertakan");
  });

  it("compiles a valid chapter dossier PDF from API payload", async () => {
    const payload = {
      chapterCode: "SKP",
      data: {
        chapter_code: "SKP",
        chapter_name: "Sasaran Keselamatan Pasien",
        chapter_group: "Keselamatan & Mutu",
        desc: "Standar Keselamatan Pasien Kemenkes RI",
        target_score: 80,
        current_score: 20,
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
    const req = new Request("http://localhost:3000/api/starkes/bundle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    const arrayBuf = await res.arrayBuffer();
    expect(arrayBuf.byteLength).toBeGreaterThan(1000);
  }, 40000);
});
