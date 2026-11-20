import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as bundleAll } from "@/app/api/starkes/bundle-all/route";

const requirePermission = vi.fn();
const listStarkesAuditScores = vi.fn();
const buildStarkesDossierPdf = vi.fn();

vi.mock("@/lib/director/director-auth", async (original) => ({
  ...(await original<typeof import("@/lib/director/director-auth")>()),
  protectedDirectorMode: () => false,
}));
vi.mock("@/lib/director/director-api", async (original) => ({
  ...(await original<typeof import("@/lib/director/director-api")>()),
  requireConfiguration: () => ({}),
}));
vi.mock("@/lib/access/access-api", async (original) => ({
  ...(await original<typeof import("@/lib/access/access-api")>()),
  requirePermission: (...args: unknown[]) => requirePermission(...args),
}));
vi.mock("@/lib/starkes/audit-store", () => ({
  listStarkesAuditScores: (...args: unknown[]) => listStarkesAuditScores(...args),
}));
vi.mock("@/lib/pdf/build-starkes-dossier", () => ({
  buildStarkesDossierPdf: (...args: unknown[]) => buildStarkesDossierPdf(...args),
}));

beforeEach(() => {
  vi.resetAllMocks();
  listStarkesAuditScores.mockResolvedValue([]);
  buildStarkesDossierPdf.mockImplementation(async () => {
    const { PDFDocument, StandardFonts } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage();
    page.drawText("STARKES", { x: 50, y: 700, size: 12, font });
    return doc.save();
  });
});

describe("POST /api/starkes/bundle-all", () => {
  it("returns a merged PDF binder", async () => {
    const response = await bundleAll(
      new Request("https://local.test/api/starkes/bundle-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ practiceScores: [] }),
      })
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(Buffer.from(bytes.subarray(0, 4)).toString("utf8")).toBe("%PDF");
    expect(buildStarkesDossierPdf.mock.calls.length).toBeGreaterThan(10);
  });
});
