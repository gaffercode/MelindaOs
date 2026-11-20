import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as auditGet, POST as auditPost } from "@/app/api/starkes/audit/route";
import { DirectorApiError } from "@/lib/director/director-api";
import { DirectorStoreError } from "@/lib/director/director-store";

const listStarkesAuditScores = vi.fn();
const starkesAuditCommand = vi.fn();
const requirePermission = vi.fn();

vi.mock("@/lib/director/director-auth", async (original) => ({
  ...(await original<typeof import("@/lib/director/director-auth")>()),
  protectedDirectorMode: () => true,
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
  starkesAuditCommand: (...args: unknown[]) => starkesAuditCommand(...args),
}));

const origin = "https://synthetic.example";
const request = (path: string, method: string, body?: unknown) =>
  new Request(`${origin}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Origin: origin },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

beforeEach(() => {
  vi.resetAllMocks();
  listStarkesAuditScores.mockResolvedValue([]);
  starkesAuditCommand.mockResolvedValue({ ok: true });
  requirePermission.mockResolvedValue({ principal: { role: "DIRECTOR" }, reviewerId: "director-test" });
});

afterEach(() => vi.unstubAllEnvs());

describe("STARKES audit API", () => {
  it("lists scores for authenticated sessions", async () => {
    listStarkesAuditScores.mockResolvedValue([{ ep_id: "skp-1", score: 10 }]);
    const response = await auditGet(request("/api/starkes/audit", "GET"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ scores: [{ ep_id: "skp-1" }] });
  });

  it("allows director lock and rejects locked upsert conflicts", async () => {
    requirePermission.mockResolvedValue({ principal: { role: "DIRECTOR" }, reviewerId: "director-test" });
    expect((await auditPost(request("/api/starkes/audit", "POST", { command: "lock", chapter_code: "SKP" }))).status).toBe(200);
    starkesAuditCommand.mockRejectedValueOnce(new DirectorStoreError(409, "conflict"));
    const failed = await auditPost(
      request("/api/starkes/audit", "POST", {
        command: "upsert_draft",
        ep_id: "47104-2024:SKP:1:1",
        score: 5,
        evidence_status: "draft",
      })
    );
    expect(failed.status).toBe(409);
  });

  it.each(["VICE_DIRECTOR", "STAFF_OPS"])("refuses %s lock and unlock with 403 before the store (ruling R8)", async (role) => {
    requirePermission.mockResolvedValue({ principal: { role }, reviewerId: "account-test" });
    for (const command of ["lock", "unlock"]) {
      const response = await auditPost(request("/api/starkes/audit", "POST", { command, chapter_code: "SKP" }));
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "Akses tidak sesuai peran." });
    }
    expect(starkesAuditCommand).not.toHaveBeenCalled();
    expect((await auditPost(request("/api/starkes/audit", "POST", { command: "submit_chapter", chapter_code: "SKP" }))).status).toBe(200);
    expect(starkesAuditCommand).toHaveBeenCalledWith("submit_chapter", { chapter_code: "SKP", updated_by: "account-test", actorRole: role });
  });

  it("requires human session for writes in protected mode", async () => {
    requirePermission.mockRejectedValue(new DirectorApiError(401, "Silakan masuk"));
    expect((await auditPost(request("/api/starkes/audit", "POST", { command: "submit_chapter", chapter_code: "SKP" }))).status).toBe(401);
  });
});
