import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/studio/packages/route";
import { POST as update } from "@/app/api/studio/packages/[id]/route";
import { POST as download } from "@/app/api/studio/packages/[id]/export/route";
import { DirectorApiError } from "@/lib/director/director-api";

const requireHuman = vi.fn();
const get = vi.fn(); const create = vi.fn(); const list = vi.fn();
vi.mock("@/lib/director/director-auth", async (original) => ({ ...(await original<typeof import("@/lib/director/director-auth")>()), protectedDirectorMode: () => true }));
vi.mock("@/lib/director/director-api", async (original) => ({ ...(await original<typeof import("@/lib/director/director-api")>()), requireConfiguration: () => ({}), requireHuman: (...args: unknown[]) => requireHuman(...args) }));
vi.mock("@/lib/studio/store", () => ({ studioStore: () => ({ get, create, list }) }));
vi.mock("@/lib/studio/source-snapshot", () => ({ loadStudioSourceSnapshot: async () => ({ hash: "current", sources: [], facts: [] }) }));
const request = (body: unknown) => new Request("https://test/studio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const params = { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) };
beforeEach(() => { vi.resetAllMocks(); requireHuman.mockResolvedValue({ role: "mutu", reviewerId: "mutu-test" }); list.mockResolvedValue([]); });
describe("Protected Studio package API", () => {
  it("anonymous_and_csrf_writes_fail", async () => {
    requireHuman.mockRejectedValue(new DirectorApiError(401, "Silakan masuk"));
    expect((await POST(request({ packageKey: "identifikasi-pasien" }))).status).toBe(401);
    requireHuman.mockRejectedValue(new DirectorApiError(403, "CSRF"));
    expect((await POST(request({ packageKey: "identifikasi-pasien" }))).status).toBe(403);
  });
  it("cannot_force_ready_by_client_flag", async () => {
    expect((await update(request({ command: "finalize", expectedRevision: 1, requestId: "r", issueDate: "2026-11-05", status: "ready_for_signature" }), params)).status).toBe(400);
  });
  it("stale_source_export_fails", async () => {
    get.mockResolvedValue({ status: "ready_for_signature", revision: 3, snapshotHash: "old" });
    expect((await download(request({ documentId: "spo", mode: "final", format: "pdf", expectedRevision: 3 }), params)).status).toBe(409);
  });
  it("reload_restores_package", async () => {
    list.mockResolvedValue([{ id: "saved", revision: 2 }]);
    expect(await (await GET(new Request("https://test/studio"))).json()).toMatchObject({ packages: [{ id: "saved", revision: 2 }], role: "mutu" });
  });
});
