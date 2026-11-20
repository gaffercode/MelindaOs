import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PAGE_PERMISSIONS } from "@/lib/access/access-control";
import type { AccountRole } from "@/lib/access/access-store";
import { ACCESS_FIXTURES } from "./fixtures/access-accounts";
import { createAccessFakeFetch } from "./helpers/access-fake-store";
import { ACCESS_TEST_ORIGIN, stubAccessEnv } from "./helpers/access-test-env";
import { APP, files, pageRoutes, PUBLIC_PAGES } from "./helpers/app-routes";

const ALL_PAGES = PAGE_PERMISSIONS.map((rule) => rule.pattern).filter((pattern) => !pattern.includes("["));
const emailOf = (role: AccountRole) => ACCESS_FIXTURES.find((account) => account.role === role)!.email;

const cookieGet = vi.fn();
vi.mock("next/headers", () => ({ cookies: async () => ({ get: cookieGet }) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));

const { proxy } = await import("@/proxy");
const { requirePagePermission } = await import("@/lib/director/director-access");
const { safeReturnPath } = await import("@/lib/director/director-auth");

let fake: ReturnType<typeof createAccessFakeFetch>;
beforeEach(() => {
  stubAccessEnv();
  fake = createAccessFakeFetch();
  vi.stubGlobal("fetch", fake.fetch);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  cookieGet.mockReset();
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const token = (role: AccountRole) => fake.signIn(emailOf(role));
const get = (path: string, cookie?: string) => proxy(new NextRequest(`${ACCESS_TEST_ORIGIN}${path}`, { headers: cookie ? { Cookie: cookie } : {} }));
const asUser = (path: string, role: AccountRole) => get(path, `melinda_user=${token(role)}`);
const passes = (response: Response) => response.headers.get("x-middleware-next") === "1" && !response.headers.get("location");
const location = (response: Response) => response.headers.get("location");

describe("proxy with roles", () => {
  it("sends a finance account from the executive dashboard to its workspace", async () => {
    const response = await asUser("/", "STAFF_FINANCE");
    expect(response.status).toBe(307);
    expect(location(response)).toMatch(/\/ruang-kerja$/);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("lets a finance account open casemix", async () => expect(passes(await asUser("/casemix", "STAFF_FINANCE"))).toBe(true));

  it("keeps a finance account out of HRD", async () => {
    const response = await asUser("/hrd", "STAFF_FINANCE");
    expect(response.status).toBe(307);
    expect(location(response)).toMatch(/\/ruang-kerja$/);
  });

  it("sends a Vice Director from Studio to the dashboard and lets it open kredensial", async () => {
    const studio = await asUser("/studio", "VICE_DIRECTOR");
    expect(studio.status).toBe(307);
    expect(location(studio)).toBe(`${ACCESS_TEST_ORIGIN}/`);
    const kredensial = await asUser("/kredensial", "VICE_DIRECTOR");
    expect(passes(kredensial)).toBe(true);
    expect(kredensial.headers.get("cache-control")).toBe("private, no-store");
    expect(passes(await asUser("/kredensial/01/a.pdf", "VICE_DIRECTOR"))).toBe(true);
  });

  it("sends an account that must change its password to the change page, and lets it open that page", async () => {
    fake.state.users.find((user) => user.role === "STAFF_FINANCE")!.mustChange = true;
    const response = await asUser("/casemix", "STAFF_FINANCE");
    expect(response.status).toBe(307);
    expect(location(response)).toMatch(/\/ganti-password$/);
    expect(passes(await asUser("/ganti-password", "STAFF_FINANCE"))).toBe(true);
  });

  it("refuses a kredensial file to a role without credentials.view, with the no-store headers", async () => {
    const response = await asUser("/kredensial/a.pdf", "STAFF_OPS");
    expect(response.status).toBe(403);
    expect(await response.text()).toBe("Akses tidak sesuai peran.");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
  });

  it("sends a role without credentials.view from the kredensial page to its landing page", async () => {
    const response = await asUser("/kredensial", "STAFF_OPS");
    expect(response.status).toBe(307);
    expect(location(response)).toMatch(/\/ruang-kerja$/);
  });

  it("sends a signed-out visitor to the login page", async () => {
    const response = await get("/hrd");
    expect(response.status).toBe(307);
    expect(location(response)).toBe(`${ACCESS_TEST_ORIGIN}/director-login?returnTo=%2Fhrd`);
  });

  it("lets the Director open every page", async () => {
    const cookie = `melinda_director=${fake.directorToken()}`;
    for (const page of ["/", "/studio", "/pengguna", "/hrd"]) expect(passes(await get(page, cookie))).toBe(true);
  });
});

describe("requirePagePermission", () => {
  const withUser = (role: AccountRole) => {
    const value = token(role);
    cookieGet.mockImplementation((name: string) => (name === "melinda_user" ? { value } : undefined));
  };

  it("returns every page and no principal in local file mode", async () => {
    vi.stubEnv("MELINDAOS_DIRECTOR_STORE", "file");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL", "");
    await expect(requirePagePermission("/hrd")).resolves.toEqual({ authenticated: false, principal: null, allowedPages: ALL_PAGES });
  });

  it("returns the principal and its pages when the role holds the permission", async () => {
    withUser("STAFF_FINANCE");
    const result = await requirePagePermission("/casemix");
    expect(result.authenticated).toBe(true);
    expect(result.principal).toMatchObject({ kind: "account", role: "STAFF_FINANCE" });
    expect(result.allowedPages).toEqual(["/casemix", "/ruang-kerja", "/ganti-password"]);
  });

  it("redirects a role without the permission to its landing page", async () => {
    withUser("STAFF_FINANCE");
    await expect(requirePagePermission("/hrd")).rejects.toThrow("REDIRECT:/ruang-kerja");
  });

  it("redirects an account that must change its password", async () => {
    fake.state.users.find((user) => user.role === "STAFF_HR")!.mustChange = true;
    withUser("STAFF_HR");
    await expect(requirePagePermission("/hrd")).rejects.toThrow("REDIRECT:/ganti-password");
  });

  it("redirects a signed-out visitor to the login page", async () => {
    cookieGet.mockReturnValue(undefined);
    await expect(requirePagePermission("/hrd?tanggal=2026-11-12")).rejects.toThrow("REDIRECT:/director-login?returnTo=%2Fhrd%3Ftanggal%3D2026-11-12");
  });

  it("accepts the Director cookie", async () => {
    const value = fake.directorToken();
    cookieGet.mockImplementation((name: string) => (name === "melinda_director" ? { value } : undefined));
    await expect(requirePagePermission("/pengguna")).resolves.toMatchObject({ authenticated: true, principal: { kind: "director", role: "DIRECTOR" } });
  });
});

describe("safeReturnPath", () => {
  it("accepts the new pages and still refuses non-pages", () => {
    for (const page of ["/ruang-kerja", "/pengguna", "/ganti-password"]) expect(safeReturnPath(page)).toBe(page);
    expect(safeReturnPath("/api/search")).toBe("/");
    expect(safeReturnPath("/kredensial/a.pdf")).toBe("/");
  });
});

describe("page guards", () => {
  /** These pages stay Director only and keep `requireDirectorPage`. */
  const DIRECTOR_ONLY = ["/studio", "/melinda", "/arahan", "/arahan/arsip", "/arahan/persiapan"];
  // Pages named in the matrix whose file does not exist yet (/ruang-kerja, /pengguna, /ganti-password) are skipped.
  const switched = [...new Set(ALL_PAGES.filter((page) => !DIRECTOR_ONLY.includes(page) && !PUBLIC_PAGES.includes(page)).flatMap((page) => files("page.tsx").filter((file) => pageRoutes(file).includes(page))))].sort();
  const source = (file: string) => readFileSync(path.join(APP, file), "utf8");
  const escaped = (route: string) => route.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

  it("covers the pages that exist", () => expect(switched.length).toBeGreaterThanOrEqual(12));

  it.each(switched)("%s asks requirePagePermission for its own path and no longer uses the Director-only guard", (file) => {
    const text = source(file);
    if (file === "[view]/page.tsx") {
      // One file serves /overview and every secondary view, so the path is built from the view in the URL, not written out.
      expect(text).toMatch(/requirePagePermission\(`\/\$\{/);
    } else {
      expect(text).toMatch(new RegExp(`requirePagePermission\\([^)]*["\`]${escaped(pageRoutes(file)[0])}["?\`]`));
    }
    expect(text).not.toMatch(/\b(requireDirectorPage|readDirectorPageSession)\(/);
  });

  it.each(DIRECTOR_ONLY.map((route) => [route, files("page.tsx").find((file) => pageRoutes(file).includes(route))!]))("%s keeps requireDirectorPage", (_route, file) => {
    expect(source(file)).toMatch(/\brequireDirectorPage\(/);
  });
});
