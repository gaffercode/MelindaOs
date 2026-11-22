/**
 * Who may open which page or call which API route. Pure data and lookups, with no server-only imports,
 * so client components can import it to hide links; the server still enforces every rule.
 */
export type Role = "DIRECTOR" | "VICE_DIRECTOR" | "DOCTOR" | "STAFF_FINANCE" | "STAFF_HR" | "STAFF_OPS" | "STAFF_SUPPORT";
export const ACCOUNT_ROLES: readonly Exclude<Role, "DIRECTOR">[] = ["VICE_DIRECTOR", "DOCTOR", "STAFF_FINANCE", "STAFF_HR", "STAFF_OPS", "STAFF_SUPPORT"];

export type Permission = "executive.view" | "credentials.view" | "pharmacy.decide" | "casemix.view" | "hrd.view" | "hrd.edit" | "pharmacy.view" | "pharmacy.upload" | "starkes.use" | "crm.view" | "news.view" | "knowledge.ask" | "account.self" | "studio.use" | "instructions.send" | "melinda.chat" | "clinical.use" | "users.manage" | "director.only";

export type Principal = { kind: "director" | "account"; role: Role; id: string; displayName: string; csrfSecret: string; mustChange: boolean };

/** What a client component may know about the signed-in person: never `id` or `csrfSecret`. */
export type PublicPrincipal = Pick<Principal, "kind" | "role" | "displayName" | "mustChange">;
export function publicPrincipal(principal: Principal | null): PublicPrincipal | null {
  return principal && { kind: principal.kind, role: principal.role, displayName: principal.displayName, mustChange: principal.mustChange };
}

const EVERYONE: readonly Permission[] = ["knowledge.ask", "account.self"];
const VICE: readonly Permission[] = ["executive.view", "credentials.view", "pharmacy.decide", "casemix.view", "hrd.view", "pharmacy.view", "pharmacy.upload", "starkes.use", "crm.view", "news.view", ...EVERYONE];

/** Spec section 3. `DIRECTOR` holds every permission, including `director.only`; every account holds `account.self`. */
export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  DIRECTOR: [...VICE, "hrd.edit", "studio.use", "instructions.send", "melinda.chat", "clinical.use", "users.manage", "director.only"],
  VICE_DIRECTOR: VICE,
  DOCTOR: ["clinical.use", ...EVERYONE],
  STAFF_FINANCE: ["casemix.view", ...EVERYONE],
  STAFF_HR: ["hrd.view", "hrd.edit", ...EVERYONE],
  STAFF_OPS: ["pharmacy.view", "pharmacy.upload", "starkes.use", ...EVERYONE],
  STAFF_SUPPORT: ["crm.view", "news.view", ...EVERYONE],
};

export const ROLE_LABELS: Readonly<Record<Role, string>> = {
  DIRECTOR: "Direktur",
  VICE_DIRECTOR: "Wakil Direktur",
  DOCTOR: "Dokter",
  STAFF_FINANCE: "Staf keuangan",
  STAFF_HR: "Staf SDM",
  STAFF_OPS: "Staf operasional",
  STAFF_SUPPORT: "Staf layanan pelanggan",
};

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
/** `[name]` matches one path segment and `[...name]` one or more, as in Next file routes. Without `methods`, every method matches. */
export type RouteRule = { pattern: string; methods?: readonly Method[]; permission: Permission };

const page = (permission: Permission, ...patterns: string[]): RouteRule[] => patterns.map((pattern) => ({ pattern, permission }));

/** Matrix order matters: `allowedPages` returns pages in this order. */
export const PAGE_PERMISSIONS: readonly RouteRule[] = [
  ...page("executive.view", "/", "/overview", "/knowledge", "/integrations", "/director-review"),
  ...page("credentials.view", "/kredensial", "/kredensial/[...path]"),
  ...page("casemix.view", "/casemix"),
  ...page("hrd.view", "/hrd"),
  ...page("pharmacy.view", "/order-obat", "/formularium"),
  ...page("starkes.use", "/starkes"),
  ...page("crm.view", "/crm"),
  ...page("news.view", "/berita"),
  ...page("knowledge.ask", "/ruang-kerja"),
  ...page("account.self", "/ganti-password"),
  ...page("studio.use", "/studio"),
  ...page("instructions.send", "/arahan", "/arahan/arsip", "/arahan/persiapan"),
  ...page("melinda.chat", "/melinda"),
  ...page("clinical.use", "/klinis"),
  ...page("users.manage", "/pengguna"),
  ...page("director.only", "/isian-dokumen"),
  ...page("executive.view", "/rujukan-masuk", "/satu-sehat"),
];

const D = "/api/director";
const ORDER = `${D}/order-obat`;
/** First match wins, so a method-specific rule sits before the general rule for the same path. */
export const API_PERMISSIONS: readonly RouteRule[] = [
  { pattern: "/api/dashboard", permission: "executive.view" },
  { pattern: `${D}/melinda-brief`, methods: ["GET"], permission: "executive.view" },
  { pattern: `${D}/news-edition`, methods: ["GET"], permission: "executive.view" },
  { pattern: `${D}/executive/plan`, methods: ["GET"], permission: "executive.view" },
  { pattern: `${D}/reviews`, permission: "executive.view" },
  { pattern: `${D}/reviews/[id]`, permission: "executive.view" },
  { pattern: `${D}/tasks/[...path]`, permission: "executive.view" },
  { pattern: `${D}/kredensial/[...path]`, permission: "credentials.view" },
  { pattern: `${ORDER}/berkas/[id]/keputusan`, methods: ["POST"], permission: "pharmacy.decide" },
  { pattern: `${ORDER}/berkas`, methods: ["POST"], permission: "pharmacy.upload" },
  { pattern: `${ORDER}/berkas`, methods: ["GET"], permission: "pharmacy.view" },
  { pattern: `${ORDER}/berkas/[id]`, methods: ["GET"], permission: "pharmacy.view" },
  { pattern: `${ORDER}/berkas/[id]`, methods: ["DELETE"], permission: "director.only" },
  { pattern: `${ORDER}/sumber`, methods: ["GET"], permission: "pharmacy.view" },
  { pattern: "/api/starkes/[...path]", permission: "starkes.use" },
  { pattern: "/api/hrd/directory", methods: ["PUT"], permission: "hrd.edit" },
  { pattern: "/api/search", permission: "knowledge.ask" },
  { pattern: "/api/ask", permission: "knowledge.ask" },
  { pattern: "/api/studio/[...path]", permission: "studio.use" },
  { pattern: `${D}/instructions`, permission: "instructions.send" },
  { pattern: `${D}/instructions/draft`, permission: "instructions.send" },
  { pattern: `${D}/instructions/polish`, permission: "instructions.send" },
  { pattern: "/api/melinda/[...path]", permission: "melinda.chat" },
  { pattern: "/api/access/session", permission: "account.self" },
  { pattern: "/api/access/password", permission: "account.self" },
  { pattern: "/api/access/users", permission: "users.manage" },
  { pattern: "/api/access/users/[id]", permission: "users.manage" },
  { pattern: "/api/access/users/[id]/password", permission: "users.manage" },
  { pattern: "/api/access/audit", permission: "users.manage" },
  // Not named by the spec, so Director only by default; listed so every human route has an explicit rule.
  { pattern: "/api/integrations/buffer", permission: "director.only" },
  { pattern: `${D}/session`, permission: "director.only" },
  { pattern: `${D}/marks`, permission: "director.only" },
  { pattern: `${D}/document-answers`, permission: "director.only" },
  { pattern: `${D}/document-answers/unduh`, permission: "director.only" },
  { pattern: `${D}/agent-drafts`, permission: "director.only" },
  { pattern: `${D}/agent-drafts/[id]`, permission: "director.only" },
  { pattern: `${D}/agent-drafts/[id]/unduh`, permission: "director.only" },
  { pattern: `${D}/klinis`, permission: "clinical.use" },
  { pattern: `${D}/klinis/[id]`, permission: "clinical.use" },
  { pattern: `${D}/referrals/[id]`, methods: ["POST"], permission: "executive.view" },
  { pattern: `${D}/satusehat/sync`, methods: ["POST"], permission: "executive.view" },
];

/**
 * `METHOD /path` handlers open to a caller with no session by design. Each keeps its own
 * check (same-origin, rate limit, capability token); adding one here is a security decision.
 */
export const PUBLIC_API_ROUTES: readonly string[] = ["POST /api/rujukan"];

/** `METHOD /pattern` handlers that a bot or capability token calls, never a signed-in person. They keep their own checks. */
export const BOT_API_ROUTES: readonly string[] = [
  "GET /api/health",
  "GET /api/mcp", "POST /api/mcp",
  "POST /api/director/medify-snapshot", "POST /api/director/medify-run-status",
  "POST /api/director/satusehat-snapshot", "GET /api/cron/satusehat",
  "POST /api/unit-reports", "GET /api/unit-reports/session", "POST /api/unit-reports/session",
];

const matchers = new Map<string, RegExp>();
function matches(pattern: string, path: string): boolean {
  let matcher = matchers.get(pattern);
  if (!matcher) {
    const body = pattern.split("/").slice(1).map((segment) => segment.startsWith("[...") ? ".+" : segment.startsWith("[") ? "[^/]+" : segment.replace(/[.*+?^${}()|\\]/g, "\\$&")).join("/");
    matchers.set(pattern, matcher = new RegExp(`^/${body}$`));
  }
  return matcher.test(path);
}

/** The first rule that matches the path and method, or `undefined` when none does. */
export function ruleFor(rules: readonly RouteRule[], path: string, method?: string): RouteRule | undefined {
  const clean = path.split(/[?#]/)[0].replace(/(.)\/+$/, "$1");
  return rules.find((rule) => matches(rule.pattern, clean) && (!rule.methods || !method || rule.methods.includes(method.toUpperCase() as Method)));
}

/** A page path (no method) or an API path with its method. A path no rule names is Director only. */
export function permissionFor(path: string, method?: string): Permission {
  return (ruleFor(path.startsWith("/api/") ? API_PERMISSIONS : PAGE_PERMISSIONS, path, method) ?? { permission: "director.only" }).permission;
}

/** True when some API rule names this path (regardless of method), so "unlisted means Director only" stays a tested default. */
export function hasExplicitRule(path: string): boolean {
  const clean = path.split(/[?#]/)[0].replace(/(.)\/+$/, "$1");
  return API_PERMISSIONS.some((rule) => matches(rule.pattern, clean));
}

/** A principal who must change the password holds only `account.self`. */
export function hasPermission(principal: Pick<Principal, "role" | "mustChange">, permission: Permission): boolean {
  return ROLE_PERMISSIONS[principal.role].includes(permission) && (!principal.mustChange || permission === "account.self");
}

export function landingFor(role: Role): "/" | "/ruang-kerja" {
  return ROLE_PERMISSIONS[role].includes("executive.view") ? "/" : "/ruang-kerja";
}

/** Page patterns the principal may open, without dynamic segments, in matrix order. */
export function allowedPages(principal: Pick<Principal, "role" | "mustChange">): string[] {
  return PAGE_PERMISSIONS.filter((rule) => !rule.pattern.includes("[") && hasPermission(principal, rule.permission)).map((rule) => rule.pattern);
}
