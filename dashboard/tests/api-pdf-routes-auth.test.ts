import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as studio } from "@/app/api/studio/generate/route";
import { POST as starkes } from "@/app/api/starkes/bundle/route";
import { DirectorApiError } from "@/lib/director/director-api";

const requireHuman = vi.fn();
const requirePermission = vi.fn();
const buildStarkesDossierPdf = vi.fn();
const buildStudioPdf = vi.fn();

vi.mock("@/lib/starkes/audit-store", () => ({
  listStarkesAuditScores: async () => [],
}));

vi.mock("@/lib/director/director-auth", async (original) => ({ ...(await original<typeof import("@/lib/director/director-auth")>()), protectedDirectorMode: () => true }));
vi.mock("@/lib/director/director-api", async (original) => ({
  ...(await original<typeof import("@/lib/director/director-api")>()),
  requireConfiguration: () => ({}),
  requireHuman: (...args: unknown[]) => requireHuman(...args),
}));
vi.mock("@/lib/access/access-api", async (original) => ({
  ...(await original<typeof import("@/lib/access/access-api")>()),
  requirePermission: (...args: unknown[]) => requirePermission(...args),
}));
vi.mock("@/lib/pdf/build-starkes-dossier", () => ({
  buildStarkesDossierPdf: (...args: unknown[]) => buildStarkesDossierPdf(...args),
}));
vi.mock("@/lib/starkes/audit-store", () => ({ listStarkesAuditScores: async () => [] }));
vi.mock("@/lib/pdf/build-studio-pdf", () => ({
  buildStudioPdf: (...args: unknown[]) => buildStudioPdf(...args),
}));

const request = (url: string, body: unknown) =>
  new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("POST studio in protected mode", () => {
  const url = "https://director.test/api/studio/generate";
  const body = { docType: "spo", data: { title: "SPO" } };

  it("rejects a request without a Director session before running the generator", async () => {
    requireHuman.mockRejectedValue(new DirectorApiError(401, "Silakan masuk sebagai Direktur."));
    const response = await studio(request(url, body));
    expect(response.status).toBe(401);
    expect(buildStudioPdf).not.toHaveBeenCalled();
  });

  it("requires a CSRF-checked write session", async () => {
    requireHuman.mockRejectedValue(new DirectorApiError(403, "Permintaan tidak berasal dari sesi yang sah."));
    expect((await studio(request(url, body))).status).toBe(403);
    expect(requireHuman.mock.calls[0][2]).toBe(true);
    expect(buildStudioPdf).not.toHaveBeenCalled();
  });

  it("rejects an oversized body", async () => {
    requireHuman.mockResolvedValue({ reviewerId: "director" });
    const response = await studio(request(url, JSON.stringify({ ...body, pad: "x".repeat(260_000) })));
    expect(response.status).toBe(413);
    expect(buildStudioPdf).not.toHaveBeenCalled();
  });

  it("does not echo generator internals to the caller", async () => {
    requireHuman.mockResolvedValue({ reviewerId: "director" });
    buildStudioPdf.mockRejectedValue(new Error("Traceback C:\\secret\\path"));
    const response = await studio(request(url, body));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("secret");
  });
});

describe("POST starkes in protected mode", () => {
  const url = "https://director.test/api/starkes/bundle";
  const body = { chapterCode: "SKP", data: { items: [] } };

  it("rejects a request without a Director session before running the generator", async () => {
    requirePermission.mockRejectedValue(new DirectorApiError(401, "Silakan masuk sebagai Direktur."));
    const response = await starkes(request(url, body));
    expect(response.status).toBe(401);
    expect(buildStarkesDossierPdf).not.toHaveBeenCalled();
  });

  it("requires a CSRF-checked write session", async () => {
    requirePermission.mockRejectedValue(new DirectorApiError(403, "Permintaan tidak berasal dari sesi yang sah."));
    expect((await starkes(request(url, body))).status).toBe(403);
    expect(requirePermission.mock.calls[0][2]).toBe(true);
    expect(buildStarkesDossierPdf).not.toHaveBeenCalled();
  });

  it("rejects an oversized body", async () => {
    requirePermission.mockResolvedValue({ reviewerId: "director" });
    const response = await starkes(request(url, JSON.stringify({ ...body, pad: "x".repeat(260_000) })));
    expect(response.status).toBe(413);
    expect(buildStarkesDossierPdf).not.toHaveBeenCalled();
  });

  it("does not echo generator internals to the caller", async () => {
    requirePermission.mockResolvedValue({ reviewerId: "director" });
    buildStarkesDossierPdf.mockRejectedValue(new Error("Traceback C:\\secret\\path"));
    const response = await starkes(request(url, body));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("secret");
  });
});

describe("POST starkes chapterCode", () => {
  it.each(["../../evil", "SKP/x", "skp", "A".repeat(13)])("rejects %s before compiling the dossier", async (chapterCode) => {
    requirePermission.mockResolvedValue({ reviewerId: "director" });
    const response = await starkes(request("https://director.test/api/starkes/bundle", { chapterCode, data: { items: [] } }));
    expect(response.status).toBe(400);
    expect(buildStarkesDossierPdf).not.toHaveBeenCalled();
  });
});
