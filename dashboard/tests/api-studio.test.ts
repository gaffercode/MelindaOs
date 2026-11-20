import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/studio/generate/route";

describe("API Studio Generate Endpoint", () => {
  it("rejects missing or invalid docType", async () => {
    const req = new Request("http://localhost:3000/api/studio/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ docType: "invalid" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("docType harus 'spo'");
  });

  it("compiles a valid SPO PDF from API payload", async () => {
    const payload = {
      docType: "spo",
      data: {
        title: "SPO UJI VALIDASI SISTEM",
        doc_no: "999/SPO/TEST/2026",
        rev: "00",
        date: "25 Oktober 2026",
        sections: {
          PENGERTIAN: ["Pengujian endpoint kompilasi otomatis."],
          TUJUAN: ["1. Menguji fungsi API route."],
          KEBIJAKAN: ["Kebijakan pengujian sistem."],
          PROSEDUR: ["1. Menjalankan pengujian otomatis."],
          "UNIT TERKAIT": ["Unit IT"],
        },
      },
    };
    const req = new Request("http://localhost:3000/api/studio/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    const arrayBuf = await res.arrayBuffer();
    expect(arrayBuf.byteLength).toBeGreaterThan(1000);
  });

  it("compiles a valid SK Direktur PDF from API payload", async () => {
    const payload = {
      docType: "sk",
      data: {
        no_sk: "999/SK-DIR/XI/2026",
        tentang: "Pemberlakuan Uji Validasi Studio",
        menimbang: ["bahwa pengujian kompilasi SK diperlukan;"],
        mengingat: ["Undang-Undang Nomor 17 Tahun 2023 tentang Kesehatan;"],
        diktum: [
          { label: "KESATU", isi: "Menetapkan pengujian ini sah." },
          { label: "KEDUA", isi: "Memberlakukan sejak ditetapkan." },
          { label: "KETIGA", isi: "Menugaskan unit terkait." },
          { label: "KEEMPAT", isi: "Keputusan ini mulai berlaku pada tanggal ditetapkan." },
        ],
      },
    };
    const req = new Request("http://localhost:3000/api/studio/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(1000);
  });

  it("compiles a valid Clinical Form PDF from API payload", async () => {
    const payload = {
      docType: "form",
      data: {
        title: "FORMULIR UJI VALIDASI KLINIS",
        form_code: "FORM-TEST-01",
        starkes_ref: "STARKES PAB 2",
        unit: "Kamar Operasi",
        instructions: "Petunjuk pengujian formulir.",
        sections: [
          {
            title: "Fase Sign In",
            rows: [
              { item: "Identifikasi Pasien", desc: "Konfirmasi nama dan tanggal lahir.", options: "[  ] Sesuai" },
            ],
          },
        ],
      },
    };
    const req = new Request("http://localhost:3000/api/studio/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    const arrayBuf = await res.arrayBuffer();
    expect(arrayBuf.byteLength).toBeGreaterThan(1000);
  });
});
