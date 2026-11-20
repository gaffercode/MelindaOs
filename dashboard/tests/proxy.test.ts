import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubAccessEnv } from "./helpers/access-test-env";

const requireHuman = vi.fn();
vi.mock("@/lib/director/director-api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/director/director-api")>()),
  requireHuman: (...args: unknown[]) => requireHuman(...args),
}));

const { config, proxy } = await import("@/proxy");
const { DirectorApiError } = await import("@/lib/director/director-api");

const get = (path: string, headers: Record<string, string> = {}) => proxy(new NextRequest(`https://melindaos.example${path}`, { headers }));
const passes = (response: Response) => response.headers.get("x-middleware-next") === "1";

describe("proxy", () => {
  beforeEach(() => {
    // The account fallback in `requirePrincipal` needs a complete configuration; there is no account cookie, so it never calls the store.
    stubAccessEnv();
    requireHuman.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("guards the Melinda page", () => expect(config.matcher).toContain("/melinda"));

  it("sends a signed-out full page load of a Director page to the login page before anything streams", async () => {
    requireHuman.mockRejectedValue(new DirectorApiError(401, "Silakan masuk sebagai Direktur."));
    const response = await get("/starkes");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://melindaos.example/director-login?returnTo=%2Fstarkes");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect((await get("/?tanggal=2026-11-08")).headers.get("location")).toBe("https://melindaos.example/director-login?returnTo=%2F%3Ftanggal%3D2026-11-08");
  });

  it("lets a signed-in Director through", async () => {
    requireHuman.mockResolvedValue({});
    expect(passes(await get("/arahan"))).toBe(true);
  });

  it("leaves client navigations and prefetches to the page guard, so they cost no extra session check", async () => {
    requireHuman.mockRejectedValue(new DirectorApiError(401, "x"));
    expect(passes(await get("/studio", { rsc: "1" }))).toBe(true);
    expect(passes(await get("/studio", { rsc: "1", "next-router-prefetch": "1" }))).toBe(true);
    expect(requireHuman).not.toHaveBeenCalled();
  });

  it("leaves other auth failures to the page, as before", async () => {
    requireHuman.mockRejectedValue(new Error("store unavailable"));
    expect(passes(await get("/casemix"))).toBe(true);
  });

  it("keeps the kredensial guard unchanged", async () => {
    requireHuman.mockRejectedValue(new DirectorApiError(401, "x"));
    expect((await get("/kredensial")).headers.get("location")).toBe("https://melindaos.example/director-login?returnTo=%2Fkredensial");
    expect((await get("/kredensial/01/a.pdf", { rsc: "1" })).status).toBe(401);
  });

  it("does nothing in local file mode", async () => {
    vi.stubEnv("MELINDAOS_DIRECTOR_STORE", "file");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL", "");
    expect(passes(await get("/starkes"))).toBe(true);
    expect(requireHuman).not.toHaveBeenCalled();
  });

  it("runs on every page that calls the Director page guard and on no public page", () => {
    expect(config.matcher).toEqual(expect.arrayContaining([
      "/", "/overview", "/knowledge", "/integrations", "/arahan", "/arahan/arsip", "/berita", "/casemix",
      "/director-review", "/order-obat", "/formularium", "/starkes", "/studio", "/kredensial", "/kredensial/:path*",
    ]));
    for (const open of ["/director-login", "/laporan-unit", "/api/:path*"]) expect(config.matcher).not.toContain(open);
  });
});
