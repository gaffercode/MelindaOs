import { scryptSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as passwordRoute from "@/app/api/access/password/route";
import * as sessionRoute from "@/app/api/access/session/route";
import * as directorSessionRoute from "@/app/api/director/session/route";
import { requirePermission, requirePrincipal } from "@/lib/access/access-api";
import { DUMMY_HASH, verifyPassword } from "@/lib/access/access-password";
import { csrfForSession, userCookie } from "@/lib/director/director-auth";
import { ACCESS_FIXTURES, DIRECTOR_FIXTURE_PASSCODE } from "./fixtures/access-accounts";
import { createAccessFakeFetch } from "./helpers/access-fake-store";

vi.mock("@/lib/access/access-password", async (original) => {
  const actual = await original<typeof import("@/lib/access/access-password")>();
  return { ...actual, verifyPassword: vi.fn(actual.verifyPassword) };
});

const ORIGIN = "https://synthetic.example";
const FINANCE = ACCESS_FIXTURES[1];
const salt = "00112233445566778899aabbccddeeff";
let fake: ReturnType<typeof createAccessFakeFetch>;

function setup(options?: { migrated?: boolean }) {
  fake = createAccessFakeFetch(options);
  vi.stubGlobal("fetch", fake.fetch);
}
beforeEach(() => {
  vi.stubEnv("MELINDAOS_DIRECTOR_STORE", "supabase");
  vi.stubEnv("MELINDAOS_APP_ORIGIN", ORIGIN);
  vi.stubEnv("MELINDAOS_SUPABASE_URL", "https://db.synthetic.example");
  vi.stubEnv("MELINDAOS_SUPABASE_SECRET_KEY", "synthetic-secret");
  vi.stubEnv("MELINDAOS_REVIEWER_ID", "director");
  vi.stubEnv("MELINDAOS_REVIEWER_PASSCODE_HASH", `scrypt$${salt}$${scryptSync(DIRECTOR_FIXTURE_PASSCODE, salt, 64).toString("hex")}`);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.mocked(verifyPassword).mockClear();
  setup();
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const json = (path: string, method: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}${path}`, { method, headers: { Origin: ORIGIN, "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
const signIn = (email: string, password: string, returnTo?: string) => sessionRoute.POST(json("/api/access/session", "POST", { email, password, ...(returnTo ? { returnTo } : {}) }));
const withCookie = (cookie: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
  new Request(`${ORIGIN}/api/access/session`, { method: init.method ?? "GET", headers: { Cookie: cookie, Origin: ORIGIN, ...init.headers } });
const tokenFrom = (response: Response) => /^melinda_user=([a-f0-9]{64});/.exec(response.headers.get("Set-Cookie") ?? "")?.[1] ?? "";
const userOf = (email: string) => fake.state.users.find((user) => user.email === email)!;
const failure = (pending: Promise<unknown>) => pending.then(() => null, (error: unknown) => error);

describe("account sign-in", () => {
  it("signs a staff account in with a strict cookie and its landing page", async () => {
    const response = await signIn(FINANCE.email, FINANCE.password);
    expect(response.status).toBe(200);
    const cookie = response.headers.get("Set-Cookie") ?? "";
    expect(cookie).toMatch(/^melinda_user=[a-f0-9]{64}; /);
    for (const part of ["HttpOnly", "SameSite=Strict", "Secure", "Max-Age=1800", "Path=/"]) expect(cookie).toContain(part);
    const body = await response.json();
    expect(body).toMatchObject({ returnTo: "/ruang-kerja", role: "STAFF_FINANCE", mustChange: false });
    expect(body.csrfToken).toBe(csrfForSession(tokenFrom(response), userOf(FINANCE.email).credentialVersion));
    expect(fake.state.audit.at(-1)).toMatchObject({ action: "login_ok", target: FINANCE.email });
  });

  it("gives a wrong password and an unknown email the same answer, and runs scrypt for both", async () => {
    const wrong = await signIn(FINANCE.email, "not-the-password");
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual({ error: "Email atau password tidak sesuai." });
    const unknown = await signIn("nobody@melinda.test", "not-the-password");
    expect(unknown.status).toBe(401);
    expect(await unknown.json()).toEqual({ error: "Email atau password tidak sesuai." });
    expect(verifyPassword).toHaveBeenCalledTimes(2);
    expect(verifyPassword).toHaveBeenLastCalledWith("not-the-password", DUMMY_HASH);
    expect(fake.state.audit.map((event) => [event.action, event.target])).toEqual([["login_fail", FINANCE.email], ["login_fail", "nobody@melinda.test"]]);
  });

  it("rate limits by address and by email before looking the account up", async () => {
    await signIn(FINANCE.email, FINANCE.password);
    const lookup = fake.state.calls.findIndex((call) => call.command === "login_lookup");
    expect(fake.state.calls.slice(0, lookup).map((call) => [call.command, call.args.bucket])).toEqual([["rate_limit", "access-ip:unknown"], ["rate_limit", `access-email:${FINANCE.email}`]]);
    fake.state.rateLimits.set(`access-email:${FINANCE.email}`, 5);
    expect((await signIn(FINANCE.email, FINANCE.password)).status).toBe(429);
  });

  it("normalises the email before every check", async () => {
    const response = await signIn("  Staff.Finance@Melinda.TEST ", FINANCE.password);
    expect(response.status).toBe(200);
    expect(fake.state.calls.find((call) => call.command === "login_lookup")?.args.email).toBe(FINANCE.email);
  });

  it("refuses another origin before any store call", async () => {
    const { email, password } = FINANCE;
    const response = await sessionRoute.POST(json("/api/access/session", "POST", { email, password }, { Origin: "https://other.example" }));
    expect(response.status).toBe(403);
    expect(fake.state.calls).toEqual([]);
  });

  it("returns to a permitted page and otherwise to the landing page", async () => {
    expect((await (await signIn(FINANCE.email, FINANCE.password, "/casemix")).json()).returnTo).toBe("/casemix");
    expect((await (await signIn(FINANCE.email, FINANCE.password, "/hrd")).json()).returnTo).toBe("/ruang-kerja");
    expect((await (await signIn(ACCESS_FIXTURES[0].email, ACCESS_FIXTURES[0].password, "/studio")).json()).returnTo).toBe("/");
  });

  it("sends a must-change account to the password page and holds it to account.self", async () => {
    userOf(FINANCE.email).mustChange = true;
    const response = await signIn(FINANCE.email, FINANCE.password, "/casemix");
    expect(await response.json()).toMatchObject({ returnTo: "/ganti-password", mustChange: true });
    const request = withCookie(`melinda_user=${tokenFrom(response)}`);
    expect(await failure(requirePermission(request, "knowledge.ask"))).toMatchObject({ status: 403, message: "Akses tidak sesuai peran." });
    expect((await requirePermission(request, "account.self")).principal.mustChange).toBe(true);
  });

  it("answers 503 when the migration is missing while the Director passcode still works", async () => {
    setup({ migrated: false });
    const response = await signIn(FINANCE.email, FINANCE.password);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Akun belum diaktifkan." });
    const director = await directorSessionRoute.POST(json("/api/director/session", "POST", { passcode: DIRECTOR_FIXTURE_PASSCODE }));
    expect(director.status).toBe(200);
    expect(director.headers.get("Set-Cookie")).toMatch(/^melinda_director=/);
  });
});

describe("principal resolution", () => {
  it("prefers a valid Director cookie, falls through a stale one, and refuses neither", async () => {
    const director = fake.directorToken(), account = fake.signIn(FINANCE.email), stale = "f".repeat(64);
    expect((await requirePrincipal(withCookie(`melinda_director=${director}`))).principal).toMatchObject({ kind: "director", role: "DIRECTOR", id: "director", mustChange: false });
    expect((await requirePrincipal(withCookie(`melinda_director=${stale}; melinda_user=${account}`))).principal).toMatchObject({ kind: "account", role: "STAFF_FINANCE", id: userOf(FINANCE.email).id });
    expect((await requirePrincipal(withCookie(`melinda_director=${director}; melinda_user=${account}`))).principal.kind).toBe("director");
    expect(await failure(requirePrincipal(withCookie(`melinda_director=${stale}; melinda_user=${stale}`)))).toMatchObject({ status: 401, message: "Silakan masuk." });
    expect(await failure(requirePrincipal(new Request(`${ORIGIN}/api/access/session`)))).toMatchObject({ status: 401, message: "Silakan masuk." });
  });

  it("treats an account cookie as signed out when the migration is missing", async () => {
    setup({ migrated: false });
    const cookie = `melinda_user=${"e".repeat(64)}`;
    expect(await failure(requirePrincipal(withCookie(cookie)))).toMatchObject({ status: 401, message: "Silakan masuk." });
    expect((await sessionRoute.GET(withCookie(cookie))).status).toBe(401);
  });

  it("resolves a Director without touching melinda_access and checks the Director CSRF on writes", async () => {
    const raw = fake.directorToken(), cookie = `melinda_director=${raw}`;
    expect((await requirePrincipal(withCookie(cookie))).principal.kind).toBe("director");
    expect(fake.state.calls.filter((call) => call.rpc === "melinda_access")).toEqual([]);
    expect(await failure(requirePermission(withCookie(cookie, { method: "POST" }), "users.manage", true))).toMatchObject({ status: 403 });
    const csrf = csrfForSession(raw, process.env.MELINDAOS_REVIEWER_PASSCODE_HASH ?? "");
    expect((await requirePermission(withCookie(cookie, { method: "POST", headers: { "X-CSRF-Token": csrf } }), "users.manage", true)).reviewerId).toBe("director");
  });

  it("refuses a disabled account and a session whose credential version was rotated", async () => {
    const raw = fake.signIn(FINANCE.email);
    userOf(FINANCE.email).credentialVersion = "rotated";
    expect(await failure(requirePrincipal(withCookie(`melinda_user=${raw}`)))).toMatchObject({ status: 401, message: "Silakan masuk." });
    userOf(FINANCE.email).disabled = true;
    const response = await signIn(FINANCE.email, FINANCE.password);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Email atau password tidak sesuai." });
  });

  it("leaves sign-out and password change of a Director to the Director session", async () => {
    const cookie = `melinda_director=${fake.directorToken()}`;
    expect((await sessionRoute.DELETE(withCookie(cookie, { method: "DELETE" }))).status).toBe(401);
    expect((await passwordRoute.POST(json("/api/access/password", "POST", { currentPassword: "x", newPassword: "a-brand-new-password" }, { Cookie: cookie }))).status).toBe(401);
  });

  it("refuses a role without the permission and keeps the principal id as reviewer", async () => {
    const hr = withCookie(`melinda_user=${fake.signIn("staff.hr@melinda.test")}`);
    expect(await failure(requirePermission(hr, "executive.view"))).toMatchObject({ status: 403, message: "Akses tidak sesuai peran." });
    const vice = await requirePermission(withCookie(`melinda_user=${fake.signIn(ACCESS_FIXTURES[0].email)}`), "executive.view");
    expect(vice.principal.role).toBe("VICE_DIRECTOR");
    expect(vice.reviewerId).toBe(vice.principal.id);
  });

  it("checks CSRF on writes with the account credential version", async () => {
    const raw = fake.signIn(FINANCE.email);
    expect(await failure(requirePermission(withCookie(`melinda_user=${raw}`, { method: "POST" }), "knowledge.ask", true))).toMatchObject({ status: 403 });
    const csrf = csrfForSession(raw, userOf(FINANCE.email).credentialVersion);
    expect((await requirePermission(withCookie(`melinda_user=${raw}`, { method: "POST", headers: { "X-CSRF-Token": csrf } }), "knowledge.ask", true)).raw).toBe(raw);
  });

  it("reports the current principal with a CSRF token", async () => {
    const raw = fake.signIn(FINANCE.email);
    const response = await sessionRoute.GET(withCookie(`melinda_user=${raw}`));
    const body = await response.json();
    expect(body).toMatchObject({ kind: "account", role: "STAFF_FINANCE", csrfToken: csrfForSession(raw, userOf(FINANCE.email).credentialVersion) });
    expect(body).not.toHaveProperty("id");
    expect((await sessionRoute.GET(new Request(`${ORIGIN}/api/access/session`))).status).toBe(401);
  });
});

describe("password change and sign-out", () => {
  const change = (raw: string, body: unknown, csrf = csrfForSession(raw, userOf(FINANCE.email).credentialVersion)) =>
    passwordRoute.POST(json("/api/access/password", "POST", body, { Cookie: `melinda_user=${raw}`, "X-CSRF-Token": csrf }));

  it("rotates the credential, ends the old session and issues a new one", async () => {
    const raw = fake.signIn(FINANCE.email);
    const response = await change(raw, { currentPassword: FINANCE.password, newPassword: "a-brand-new-password" });
    expect(response.status).toBe(200);
    const next = tokenFrom(response);
    expect(next).not.toBe(raw);
    expect(response.headers.get("Set-Cookie")).toContain("Max-Age=1800");
    expect(await response.json()).toEqual({ returnTo: "/ruang-kerja", csrfToken: csrfForSession(next, userOf(FINANCE.email).credentialVersion) });
    expect(userOf(FINANCE.email).mustChange).toBe(false);
    expect(await failure(requirePrincipal(withCookie(`melinda_user=${raw}`)))).toMatchObject({ status: 401 });
    expect((await requirePrincipal(withCookie(`melinda_user=${next}`))).principal.kind).toBe("account");
    expect(fake.state.audit.at(-1)).toMatchObject({ action: "password_change", target: FINANCE.email });
    expect((await signIn(FINANCE.email, "a-brand-new-password")).status).toBe(200);
  });

  it("refuses a short, unchanged or wrongly confirmed password and a missing CSRF token", async () => {
    const raw = fake.signIn(FINANCE.email);
    expect((await change(raw, { currentPassword: FINANCE.password, newPassword: "short" })).status).toBe(400);
    expect((await change(raw, { currentPassword: FINANCE.password, newPassword: FINANCE.password })).status).toBe(400);
    expect((await change(raw, { currentPassword: "wrong-current-pass", newPassword: "a-brand-new-password" })).status).toBe(400);
    expect((await change(raw, { currentPassword: FINANCE.password, newPassword: "a-brand-new-password" }, "")).status).toBe(403);
    expect(fake.state.calls.some((call) => call.command === "password_set")).toBe(false);
  });

  it("signs out only with CSRF and clears the cookie", async () => {
    const raw = fake.signIn(FINANCE.email);
    expect((await sessionRoute.DELETE(withCookie(`melinda_user=${raw}`, { method: "DELETE" }))).status).toBe(403);
    const csrf = csrfForSession(raw, userOf(FINANCE.email).credentialVersion);
    const response = await sessionRoute.DELETE(withCookie(`melinda_user=${raw}`, { method: "DELETE", headers: { "X-CSRF-Token": csrf } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Set-Cookie")).toBe(userCookie("", true, true));
    expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect(fake.state.sessions.size).toBe(0);
    expect(fake.state.audit.at(-1)).toMatchObject({ action: "logout", target: FINANCE.email });
  });
});
