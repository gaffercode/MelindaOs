import { describe, expect, it } from "vitest";
import { ACCOUNT_ROLES, allowedPages, API_PERMISSIONS, BOT_API_ROUTES, hasPermission, landingFor, PAGE_PERMISSIONS, permissionFor, PUBLIC_API_ROUTES, ROLE_LABELS, ruleFor, type Permission, type Role } from "@/lib/access/access-control";
import { files, pageRoutes, PUBLIC_PAGES } from "./helpers/app-routes";

const ROLES: Role[] = ["DIRECTOR", "VICE_DIRECTOR", "DOCTOR", "STAFF_FINANCE", "STAFF_HR", "STAFF_OPS", "STAFF_SUPPORT"];
/** Spec section 3, one row per permission; the columns follow ROLES. */
const MATRIX: Record<string, readonly [boolean, boolean, boolean, boolean, boolean, boolean, boolean]> = {
  "executive.view": [true, true, false, false, false, false, false],
  "credentials.view": [true, true, false, false, false, false, false],
  "pharmacy.decide": [true, true, false, false, false, false, false],
  "casemix.view": [true, true, false, true, false, false, false],
  "hrd.view": [true, true, false, false, true, false, false],
  "hrd.edit": [true, false, false, false, true, false, false],
  "pharmacy.view": [true, true, false, false, false, true, false],
  "pharmacy.upload": [true, true, false, false, false, true, false],
  "starkes.use": [true, true, false, false, false, true, false],
  "crm.view": [true, true, false, false, false, false, true],
  "news.view": [true, true, false, false, false, false, true],
  "knowledge.ask": [true, true, true, true, true, true, true],
  "studio.use": [true, false, false, false, false, false, false],
  "instructions.send": [true, false, false, false, false, false, false],
  "melinda.chat": [true, false, false, false, false, false, false],
  "clinical.use": [true, false, true, false, false, false, false],
  "users.manage": [true, false, false, false, false, false, false],
  "account.self": [true, true, true, true, true, true, true],
  "director.only": [true, false, false, false, false, false, false],
};
const cases = Object.entries(MATRIX).flatMap(([permission, row]) => ROLES.map((role, index) => [role, permission, row[index]] as const));

describe("role permissions", () => {
  it.each(cases)("%s / %s is %s", (role, permission, expected) => {
    expect(hasPermission({ role, mustChange: false }, permission as Permission)).toBe(expected);
  });

  it("limits a principal who must change the password to account.self", () => {
    expect(hasPermission({ role: "VICE_DIRECTOR", mustChange: true }, "executive.view")).toBe(false);
    expect(hasPermission({ role: "VICE_DIRECTOR", mustChange: true }, "account.self")).toBe(true);
  });

  it("lists the five account roles and a label for every role", () => {
    expect(ACCOUNT_ROLES).toEqual(ROLES.slice(1));
    expect(Object.keys(ROLE_LABELS).sort()).toEqual([...ROLES].sort());
  });
});

describe("route lookup", () => {
  it("separates upload, listing and decision on the pharmacy order routes", () => {
    expect(permissionFor("/api/director/order-obat/berkas", "POST")).toBe("pharmacy.upload");
    expect(permissionFor("/api/director/order-obat/berkas", "GET")).toBe("pharmacy.view");
    expect(permissionFor("/api/director/order-obat/berkas/00000000-0000-4000-8000-000000000001/keputusan", "POST")).toBe("pharmacy.decide");
  });

  it("lets only the Director and HR staff save the HR directory", () => {
    expect(permissionFor("/api/hrd/directory", "PUT")).toBe("hrd.edit");
    expect(permissionFor("/api/hrd/directory", "GET")).toBe("director.only");
  });

  it("matches catch-all segments and defaults to Director only", () => {
    expect(permissionFor("/kredensial/a/b.pdf")).toBe("credentials.view");
    expect(permissionFor("/unlisted")).toBe("director.only");
    expect(permissionFor("/api/integrations/buffer", "GET")).toBe("director.only");
  });

  it("sends each role to its landing page", () => {
    expect(landingFor("VICE_DIRECTOR")).toBe("/");
    expect(landingFor("STAFF_OPS")).toBe("/ruang-kerja");
  });

  it("lists the pages a role may open, in matrix order", () => {
    const vice = allowedPages({ role: "VICE_DIRECTOR", mustChange: false });
    for (const page of ["/studio", "/melinda", "/arahan", "/pengguna"]) expect(vice).not.toContain(page);
    expect(vice).toContain("/kredensial");
    expect(allowedPages({ role: "STAFF_FINANCE", mustChange: false })).toEqual(["/casemix", "/ruang-kerja", "/ganti-password"]);
    expect(allowedPages({ role: "STAFF_HR", mustChange: true })).toEqual(["/ganti-password"]);
  });
});

describe("route tables", () => {
  const listed = PAGE_PERMISSIONS.map((rule) => rule.pattern);
  const routes = files("page.tsx").flatMap(pageRoutes).filter((route) => !PUBLIC_PAGES.includes(route));

  it.each(routes)("page %s has a permission", (route) => expect(listed).toContain(route));

  it("keeps bot routes out of the human table", () => {
    const bot = new Set(BOT_API_ROUTES);
    const human = API_PERMISSIONS.flatMap((rule) => (rule.methods ?? ["GET", "POST", "PUT", "PATCH", "DELETE"]).map((method) => `${method} ${rule.pattern}`));
    expect(human.filter((route) => bot.has(route))).toEqual([]);
  });

  const modules = import.meta.glob<Record<string, unknown>>("../app/api/**/route.ts");
  const handlers = async () => (await Promise.all(Object.entries(modules).map(async ([file, load]) => {
    const exported = await load();
    return ["GET", "POST", "PUT", "PATCH", "DELETE"].filter((method) => typeof exported[method] === "function").map((method) => `${method} ${file.replace("../app", "").replace("/route.ts", "")}`);
  }))).flat().sort();

  it("gives every handler a bot entry or an explicit human rule, and every bot entry a handler", async () => {
    const all = await handlers(), bot = new Set(BOT_API_ROUTES), open = new Set(PUBLIC_API_ROUTES);
    expect(BOT_API_ROUTES.filter((route) => !all.includes(route))).toEqual([]);
    expect(all.filter((route) => !bot.has(route) && !open.has(route) && !ruleFor(API_PERMISSIONS, route.split(" ")[1].replace(/\[\.\.\.(\w+)\]/g, "x/y").replace(/\[(\w+)\]/g, "x"), route.split(" ")[0]))).toEqual([]);
  });
});

describe("permission matrix snapshots", () => {
  // Golden copies: any edit to the matrix shows up here as a diff that has to be reviewed.
  it("pins API_PERMISSIONS", () => {
    expect(API_PERMISSIONS).toMatchInlineSnapshot(`
      [
        {
          "pattern": "/api/dashboard",
          "permission": "executive.view",
        },
        {
          "methods": [
            "GET",
          ],
          "pattern": "/api/director/melinda-brief",
          "permission": "executive.view",
        },
        {
          "methods": [
            "GET",
          ],
          "pattern": "/api/director/news-edition",
          "permission": "executive.view",
        },
        {
          "methods": [
            "GET",
          ],
          "pattern": "/api/director/executive/plan",
          "permission": "executive.view",
        },
        {
          "pattern": "/api/director/reviews",
          "permission": "executive.view",
        },
        {
          "pattern": "/api/director/reviews/[id]",
          "permission": "executive.view",
        },
        {
          "pattern": "/api/director/tasks/[...path]",
          "permission": "executive.view",
        },
        {
          "pattern": "/api/director/kredensial/[...path]",
          "permission": "credentials.view",
        },
        {
          "methods": [
            "POST",
          ],
          "pattern": "/api/director/order-obat/berkas/[id]/keputusan",
          "permission": "pharmacy.decide",
        },
        {
          "methods": [
            "POST",
          ],
          "pattern": "/api/director/order-obat/berkas",
          "permission": "pharmacy.upload",
        },
        {
          "methods": [
            "GET",
          ],
          "pattern": "/api/director/order-obat/berkas",
          "permission": "pharmacy.view",
        },
        {
          "methods": [
            "GET",
          ],
          "pattern": "/api/director/order-obat/berkas/[id]",
          "permission": "pharmacy.view",
        },
        {
          "methods": [
            "DELETE",
          ],
          "pattern": "/api/director/order-obat/berkas/[id]",
          "permission": "director.only",
        },
        {
          "methods": [
            "GET",
          ],
          "pattern": "/api/director/order-obat/sumber",
          "permission": "pharmacy.view",
        },
        {
          "pattern": "/api/starkes/[...path]",
          "permission": "starkes.use",
        },
        {
          "methods": [
            "PUT",
          ],
          "pattern": "/api/hrd/directory",
          "permission": "hrd.edit",
        },
        {
          "pattern": "/api/search",
          "permission": "knowledge.ask",
        },
        {
          "pattern": "/api/ask",
          "permission": "knowledge.ask",
        },
        {
          "pattern": "/api/studio/[...path]",
          "permission": "studio.use",
        },
        {
          "pattern": "/api/director/instructions",
          "permission": "instructions.send",
        },
        {
          "pattern": "/api/director/instructions/draft",
          "permission": "instructions.send",
        },
        {
          "pattern": "/api/director/instructions/polish",
          "permission": "instructions.send",
        },
        {
          "pattern": "/api/melinda/[...path]",
          "permission": "melinda.chat",
        },
        {
          "pattern": "/api/access/session",
          "permission": "account.self",
        },
        {
          "pattern": "/api/access/password",
          "permission": "account.self",
        },
        {
          "pattern": "/api/access/users",
          "permission": "users.manage",
        },
        {
          "pattern": "/api/access/users/[id]",
          "permission": "users.manage",
        },
        {
          "pattern": "/api/access/users/[id]/password",
          "permission": "users.manage",
        },
        {
          "pattern": "/api/access/audit",
          "permission": "users.manage",
        },
        {
          "pattern": "/api/integrations/buffer",
          "permission": "director.only",
        },
        {
          "pattern": "/api/director/session",
          "permission": "director.only",
        },
        {
          "pattern": "/api/director/marks",
          "permission": "director.only",
        },
        {
          "pattern": "/api/director/document-answers",
          "permission": "director.only",
        },
        {
          "pattern": "/api/director/document-answers/unduh",
          "permission": "director.only",
        },
        {
          "pattern": "/api/director/agent-drafts",
          "permission": "director.only",
        },
        {
          "pattern": "/api/director/agent-drafts/[id]",
          "permission": "director.only",
        },
        {
          "pattern": "/api/director/agent-drafts/[id]/unduh",
          "permission": "director.only",
        },
        {
          "pattern": "/api/director/klinis",
          "permission": "clinical.use",
        },
        {
          "pattern": "/api/director/klinis/[id]",
          "permission": "clinical.use",
        },
        {
          "methods": [
            "POST",
          ],
          "pattern": "/api/director/referrals/[id]",
          "permission": "executive.view",
        },
        {
          "methods": [
            "POST",
          ],
          "pattern": "/api/director/satusehat/sync",
          "permission": "executive.view",
        },
      ]
    `);
  });

  it("pins PAGE_PERMISSIONS", () => {
    expect(PAGE_PERMISSIONS).toMatchInlineSnapshot(`
      [
        {
          "pattern": "/",
          "permission": "executive.view",
        },
        {
          "pattern": "/overview",
          "permission": "executive.view",
        },
        {
          "pattern": "/knowledge",
          "permission": "executive.view",
        },
        {
          "pattern": "/integrations",
          "permission": "executive.view",
        },
        {
          "pattern": "/director-review",
          "permission": "executive.view",
        },
        {
          "pattern": "/kredensial",
          "permission": "credentials.view",
        },
        {
          "pattern": "/kredensial/[...path]",
          "permission": "credentials.view",
        },
        {
          "pattern": "/casemix",
          "permission": "casemix.view",
        },
        {
          "pattern": "/hrd",
          "permission": "hrd.view",
        },
        {
          "pattern": "/order-obat",
          "permission": "pharmacy.view",
        },
        {
          "pattern": "/formularium",
          "permission": "pharmacy.view",
        },
        {
          "pattern": "/starkes",
          "permission": "starkes.use",
        },
        {
          "pattern": "/crm",
          "permission": "crm.view",
        },
        {
          "pattern": "/berita",
          "permission": "news.view",
        },
        {
          "pattern": "/ruang-kerja",
          "permission": "knowledge.ask",
        },
        {
          "pattern": "/ganti-password",
          "permission": "account.self",
        },
        {
          "pattern": "/studio",
          "permission": "studio.use",
        },
        {
          "pattern": "/arahan",
          "permission": "instructions.send",
        },
        {
          "pattern": "/arahan/arsip",
          "permission": "instructions.send",
        },
        {
          "pattern": "/arahan/persiapan",
          "permission": "instructions.send",
        },
        {
          "pattern": "/melinda",
          "permission": "melinda.chat",
        },
        {
          "pattern": "/klinis",
          "permission": "clinical.use",
        },
        {
          "pattern": "/pengguna",
          "permission": "users.manage",
        },
        {
          "pattern": "/isian-dokumen",
          "permission": "director.only",
        },
        {
          "pattern": "/rujukan-masuk",
          "permission": "executive.view",
        },
        {
          "pattern": "/satu-sehat",
          "permission": "executive.view",
        },
      ]
    `);
  });
});
