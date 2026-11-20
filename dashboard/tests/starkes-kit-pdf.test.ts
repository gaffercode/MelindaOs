import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/starkes/kit/route";
import { buildStarkesKitPdf } from "@/lib/pdf/build-starkes-kit";
import { loadChapterKits } from "@/lib/starkes/kits";

beforeEach(() => vi.stubEnv("MELINDAOS_DIRECTOR_STORE", "file"));
afterEach(() => vi.unstubAllEnvs());

describe("Evidence Kit PDF", () => {
  it("has one page per SKP form plus checklist pages and stays under 2 MB", async () => {
    const kits = (await loadChapterKits("SKP")) ?? [];
    const forms = kits.filter((k) => k.form).length;
    const bytes = await buildStarkesKitPdf(kits, "SKP");
    const pages = (await PDFDocument.load(bytes)).getPageCount();
    expect(forms).toBeGreaterThan(0);
    expect(pages).toBeGreaterThan(forms);
    const onlyForms = await PDFDocument.load(await buildStarkesKitPdf(kits.filter((k) => k.form).map((k) => ({ ...k, photoChecklist: null, practice: null })), "SKP"));
    expect(onlyForms.getPageCount()).toBe(forms);
    expect(bytes.byteLength).toBeLessThan(2 * 1024 * 1024);
  }, 30_000);

  it("serves one EP's kit and rejects an unknown chapter", async () => {
    const ok = await GET(new Request("http://127.0.0.1:3000/api/starkes/kit?chapter=SKP&ep=47104-2024:SKP:1:1"));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("application/pdf");
    expect((await GET(new Request("http://127.0.0.1:3000/api/starkes/kit?chapter=XYZ"))).status).toBe(400);
  });
});
