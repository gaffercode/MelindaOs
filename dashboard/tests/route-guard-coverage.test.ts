import { scryptSync } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BOT_API_ROUTES, hasExplicitRule, PAGE_PERMISSIONS, PUBLIC_API_ROUTES } from "@/lib/access/access-control";
import { safeReturnPath } from "@/lib/director/director-auth";
import { APP, files, pageRoutes, PUBLIC_PAGES } from "./helpers/app-routes";

/**
 * Login is checked per page and per API route, not by one switch. This file is the switch's stand-in:
 * a new page or route that forgets its check fails here instead of shipping open.
 */

/** `METHOD /api/path` handlers that are meant to answer without credentials. Adding one here is a security decision. */
const PUBLIC_API = ["GET /api/health", ...PUBLIC_API_ROUTES];

describe("Director pages", () => {
  const guarded = files("page.tsx").filter((file) => !pageRoutes(file).some((route) => PUBLIC_PAGES.includes(route)));

  it.each(guarded)("%s checks the Director session itself", (file) => {
    expect(readFileSync(path.join(APP, file), "utf8")).toMatch(/\b(requireDirectorPage|readDirectorPageSession|requirePagePermission)\(/);
  });

  it("are all listed in the proxy matcher and accepted as a return path after login", async () => {
    const { config } = await import("@/proxy");
    const routes = guarded.flatMap(pageRoutes);
    expect(routes.filter((route) => !config.matcher.includes(route))).toEqual([]);
    expect(routes.filter((route) => safeReturnPath(route) !== route)).toEqual([]);
    // Pages named in the access matrix may be guarded before their page file exists, so the matcher is checked against the matrix.
    const pages = PAGE_PERMISSIONS.map((rule) => rule.pattern).filter((pattern) => !pattern.includes("["));
    expect(config.matcher.filter((route) => !route.startsWith("/kredensial/") && !pages.includes(route))).toEqual([]);
  });
});

describe("API routes in protected mode", () => {
  const salt = "00112233445566778899aabbccddeeff";
  const modules = import.meta.glob<Record<string, unknown>>("../app/api/**/route.ts");
  const params = { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000001", path: ["a.pdf"] }) };

  beforeAll(() => {
    vi.stubEnv("MELINDAOS_DIRECTOR_STORE", "supabase");
    vi.stubEnv("MELINDAOS_APP_ORIGIN", "https://synthetic.example");
    vi.stubEnv("MELINDAOS_SUPABASE_URL", "https://db.synthetic.example");
    vi.stubEnv("MELINDAOS_SUPABASE_SECRET_KEY", "synthetic-secret");
    vi.stubEnv("MELINDAOS_REVIEWER_ID", "director");
    vi.stubEnv("MELINDAOS_REVIEWER_PASSCODE_HASH", `scrypt$${salt}$${scryptSync("synthetic-test-passcode", salt, 64).toString("hex")}`);
    vi.stubEnv("MELINDAOS_MEDIFY_PUBLISHER_TOKEN_HASH", "a".repeat(64));
    // The store and every outside service answer "yes" to anything, so only the route's own check can refuse.
    vi.stubGlobal("fetch", async () => Response.json({ allowed: true }));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterAll(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("has a route file for every module found", () => expect(Object.keys(modules).length).toBe(files("route.ts").filter((file) => file.startsWith("api/")).length));

  it("lists every non-bot route explicitly in the access matrix", () => {
    const botPaths = new Set(BOT_API_ROUTES.map((entry) => entry.split(" ").slice(1).join(" ")));
    const publicPaths = new Set(PUBLIC_API_ROUTES.map((entry) => entry.split(" ").slice(1).join(" ")));
    const unlisted = Object.keys(modules)
      .map((file) => file.replace("../app", "").replace("/route.ts", ""))
      .filter((route) => !botPaths.has(route))
      .filter((route) => !publicPaths.has(route))
      .filter((route) => !hasExplicitRule(route));
    expect(unlisted).toEqual([]);
  });

  it("wraps every handler in guard", async () => {
    const unguarded: string[] = [];
    for (const file of Object.keys(modules).sort()) {
      const route = file.replace("../app", "").replace("/route.ts", "");
      const handlers = await modules[file]();
      for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
        const handler = handlers[method];
        if (typeof handler !== "function" || PUBLIC_API.includes(`${method} ${route}`)) continue;
        if (!(handler as { __guarded?: boolean }).__guarded) unguarded.push(`${method} ${route}`);
      }
    }
    expect(unguarded).toEqual([]);
  });

  it.each(Object.keys(modules).sort())("%s refuses a caller without credentials", async (file) => {
    const route = file.replace("../app", "").replace("/route.ts", "");
    const handlers = await modules[file]();
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
      const handler = handlers[method];
      if (typeof handler !== "function" || PUBLIC_API.includes(`${method} ${route}`)) continue;
      const body = method === "GET" || method === "DELETE" ? {} : { headers: { "Content-Type": "application/json" }, body: "{}" };
      const response: Response = await handler(new Request(`https://synthetic.example${route}`, { method, ...body }), params);
      expect(`${method} ${route} -> ${response.status}`).toMatch(/-> 40[13]$/);
    }
  }, 30_000);
});
