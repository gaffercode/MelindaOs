import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/search/route";

describe("GET /api/search without repository or index", () => {
  let temp = "";
  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    if (temp) await rm(temp, { recursive: true, force: true });
  });

  it("returns 500 and logs knowledge_index_missing", async () => {
    temp = await mkdtemp(join(tmpdir(), "melinda-no-index-"));
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("MELINDAOS_DIRECTOR_STORE", "file");
    vi.stubEnv("MELINDAOS_ROOT", join(temp, "root"));
    vi.spyOn(process, "cwd").mockReturnValue(join(temp, "app"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await GET(new Request("http://localhost/api/search?q=BPJS"));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Search unavailable" });
    expect(log).toHaveBeenCalledOnce();
    expect(String(log.mock.calls[0][0])).toContain('"code":"knowledge_index_missing"');
  });
});
