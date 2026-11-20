import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as auditRoute from "@/app/api/access/audit/route";
import * as sessionRoute from "@/app/api/access/session/route";
import * as passwordRoute from "@/app/api/access/users/[id]/password/route";
import * as userRoute from "@/app/api/access/users/[id]/route";
import * as usersRoute from "@/app/api/access/users/route";
import { csrfForSession } from "@/lib/director/director-auth";
import { ACCESS_FIXTURES } from "./fixtures/access-accounts";
import { createAccessFakeFetch } from "./helpers/access-fake-store";
import { ACCESS_TEST_ORIGIN as ORIGIN, ACCESS_TEST_PASSCODE_HASH, stubAccessEnv } from "./helpers/access-test-env";

const VICE = ACCESS_FIXTURES[0];
const FINANCE = ACCESS_FIXTURES[1];
const HR = ACCESS_FIXTURES[2];
const OPS = ACCESS_FIXTURES[3];
const NEW_EMAIL = "staff.new@melinda.test";
let fake: ReturnType<typeof createAccessFakeFetch>;

function setup(options?: { migrated?: boolean }) {
  fake = createAccessFakeFetch(options);
  vi.stubGlobal("fetch", fake.fetch);
}
beforeEach(() => {
  stubAccessEnv();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  setup();
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const userOf = (email: string) => fake.state.users.find((user) => user.email === email)!;
/** The Director's cookie and CSRF header. */
function director() {
  const raw = fake.directorToken();
  return { Cookie: `melinda_director=${raw}`, "X-CSRF-Token": csrfForSession(raw, ACCESS_TEST_PASSCODE_HASH) };
}
/** An account's cookie and CSRF header. */
function account(email: string) {
  const raw = fake.signIn(email);
  return { Cookie: `melinda_user=${raw}`, "X-CSRF-Token": csrfForSession(raw, userOf(email).credentialVersion) };
}
const call = (method: string, path: string, headers: Record<string, string>, body?: unknown) =>
  new Request(`${ORIGIN}${path}`, { method, headers: { Origin: ORIGIN, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const idParams = (id: string) => ({ params: Promise.resolve({ id }) });
const create = (headers: Record<string, string>, body: unknown) => usersRoute.POST(call("POST", "/api/access/users", headers, body));
const patch = (id: string, headers: Record<string, string>, body: unknown) => userRoute.PATCH(call("PATCH", `/api/access/users/${id}`, headers, body), idParams(id));
const reset = (id: string, headers: Record<string, string>) => passwordRoute.POST(call("POST", `/api/access/users/${id}/password`, headers), idParams(id));
const signIn = (email: string, password: string) => sessionRoute.POST(call("POST", "/api/access/session", {}, { email, password }));
const sessionStatus = async (headers: Record<string, string>) => (await sessionRoute.GET(call("GET", "/api/access/session", headers))).status;
const newUser = { email: NEW_EMAIL, displayName: "Staf Baru", role: "STAFF_OPS" };

const handlers: [string, (headers: Record<string, string>) => Promise<Response>][] = [
  ["list", (headers) => usersRoute.GET(call("GET", "/api/access/users", headers))],
  ["create", (headers) => create(headers, newUser)],
  ["update", (headers) => patch(userOf(HR.email).id, headers, { displayName: "Nama Lain" })],
  ["reset", (headers) => reset(userOf(HR.email).id, headers)],
  ["audit", (headers) => auditRoute.GET(call("GET", "/api/access/audit", headers))],
];
const MUTATIONS = ["user_create", "user_update", "user_set_disabled", "password_set"];

describe("access control of the five handlers", () => {
  it.each(handlers)("%s answers 401 without a session", async (_name, run) => {
    expect((await run({})).status).toBe(401);
  });
  it.each(handlers)("%s answers 403 to a Vice Director and to staff, and changes nothing", async (_name, run) => {
    for (const email of [VICE.email, OPS.email]) {
      const response = await run(account(email));
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "Akses tidak sesuai peran." });
    }
    expect(fake.state.calls.filter((entry) => MUTATIONS.includes(entry.command))).toEqual([]);
  });
  it("refuses every Director write without the CSRF token", async () => {
    const cookie = { Cookie: director().Cookie };
    expect((await create(cookie, newUser)).status).toBe(403);
    expect((await patch(userOf(HR.email).id, cookie, { disabled: true })).status).toBe(403);
    expect((await reset(userOf(HR.email).id, cookie)).status).toBe(403);
    expect(fake.state.calls.filter((entry) => MUTATIONS.includes(entry.command))).toEqual([]);
  });
});

describe("list and create", () => {
  it("lists the accounts without hashes or credential versions", async () => {
    const response = await usersRoute.GET(call("GET", "/api/access/users", director()));
    expect(response.status).toBe(200);
    const { users } = await response.json();
    expect(users.map((user: { email: string }) => user.email)).toEqual(ACCESS_FIXTURES.map((entry) => entry.email));
    expect(JSON.stringify(users)).not.toMatch(/passwordHash|credentialVersion|scrypt/);
  });

  it("creates an account with a 20-character temporary password that must be changed at first sign-in", async () => {
    const response = await create(director(), newUser);
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.user).toMatchObject({ email: NEW_EMAIL, displayName: "Staf Baru", role: "STAFF_OPS", mustChange: true, disabled: false });
    expect(body.temporaryPassword).toMatch(/^[A-Za-z0-9_-]{20}$/);
    expect(JSON.stringify(body.user)).not.toMatch(/passwordHash|credentialVersion/);
    const login = await signIn(NEW_EMAIL, body.temporaryPassword);
    expect(login.status).toBe(200);
    expect(await login.json()).toMatchObject({ mustChange: true, returnTo: "/ganti-password", role: "STAFF_OPS" });
  });

  it("normalises the email and answers 409 for a duplicate", async () => {
    expect((await create(director(), { ...newUser, email: "  STAFF.NEW@melinda.test " })).status).toBe(201);
    expect(userOf(NEW_EMAIL)).toBeDefined();
    const again = await create(director(), { ...newUser, email: "STAFF.NEW@melinda.test" });
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "Email sudah terdaftar." });
    expect(fake.state.users.filter((user) => user.email === NEW_EMAIL)).toHaveLength(1);
  });

  it("refuses DIRECTOR and unknown roles before any store call", async () => {
    for (const role of ["DIRECTOR", "OWNER", "", 5, null]) {
      const response = await create(director(), { ...newUser, role });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Peran tidak valid." });
    }
    expect(fake.state.calls.some((entry) => entry.command === "user_create")).toBe(false);
  });

  it("refuses a malformed email or display name, extra keys and a missing field", async () => {
    const bad: unknown[] = [
      { ...newUser, email: "no-at-sign" }, { ...newUser, email: "a@b" }, { ...newUser, email: "staf@melinda" }, { ...newUser, email: `${"a".repeat(250)}@m.test` }, { ...newUser, email: 7 }, { ...newUser, email: "a b@melinda.test" },
      { ...newUser, displayName: "   " }, { ...newUser, displayName: "x".repeat(81) }, { ...newUser, displayName: 3 },
      { ...newUser, actor: "someone" }, { ...newUser, password: "chosen-example-1" }, { email: NEW_EMAIL, role: "STAFF_OPS" },
    ];
    for (const body of bad) expect((await create(director(), body)).status).toBe(400);
    expect(fake.state.calls.some((entry) => entry.command === "user_create")).toBe(false);
  });

  it("takes the actor from the session, never from the body", async () => {
    await create(director(), newUser);
    expect(fake.state.calls.find((entry) => entry.command === "user_create")?.args.actor).toBe("director");
  });
});

describe("update", () => {
  it("changes the display name and role, and ends the account's open sessions", async () => {
    const staff = account(FINANCE.email);
    expect(await sessionStatus(staff)).toBe(200);
    const response = await patch(userOf(FINANCE.email).id, director(), { role: "STAFF_OPS", displayName: "  Staf Baru Lagi " });
    expect(response.status).toBe(200);
    expect((await response.json()).user).toMatchObject({ email: FINANCE.email, role: "STAFF_OPS", displayName: "Staf Baru Lagi" });
    expect(await sessionStatus(staff)).toBe(401);
  });

  it("disables an account, which ends its session, and enables it again", async () => {
    const staff = account(HR.email);
    expect(await sessionStatus(staff)).toBe(200);
    const response = await patch(userOf(HR.email).id, director(), { disabled: true });
    expect(response.status).toBe(200);
    expect((await response.json()).user).toMatchObject({ disabled: true });
    expect(await sessionStatus(staff)).toBe(401);
    expect((await signIn(HR.email, HR.password)).status).toBe(401);
    expect((await patch(userOf(HR.email).id, director(), { disabled: false })).status).toBe(200);
    expect((await signIn(HR.email, HR.password)).status).toBe(200);
  });

  it("applies a role change and a disable together", async () => {
    const response = await patch(userOf(HR.email).id, director(), { role: "STAFF_SUPPORT", disabled: true });
    expect((await response.json()).user).toMatchObject({ role: "STAFF_SUPPORT", disabled: true });
  });

  it("refuses an empty body, wrong types, unknown keys and a bad role without touching the store", async () => {
    const id = userOf(HR.email).id;
    const bad: unknown[] = [{}, { disabled: "yes" }, { disabled: 1 }, { displayName: "" }, { displayName: 4 }, { role: "DIRECTOR" }, { role: 4 }, { email: "other@melinda.test" }, { actor: "x" }, [], null];
    for (const body of bad) expect((await patch(id, director(), body)).status).toBe(400);
    expect(await (await patch(id, director(), { role: "DIRECTOR" })).json()).toEqual({ error: "Peran tidak valid." });
    expect(fake.state.calls.some((entry) => ["user_update", "user_set_disabled"].includes(entry.command))).toBe(false);
  });

  it("answers 404 for a malformed or unknown id", async () => {
    for (const id of ["not-a-uuid", "00000000-0000-4000-8000-0000000000ff"]) {
      const response = await patch(id, director(), { disabled: true });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Akun tidak ditemukan." });
    }
    expect((await reset("not-a-uuid", director())).status).toBe(404);
  });
});

describe("password reset", () => {
  it("replaces the password with a temporary one that must be changed and ends open sessions", async () => {
    const staff = account(FINANCE.email);
    const response = await reset(userOf(FINANCE.email).id, director());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Object.keys(body)).toEqual(["temporaryPassword"]);
    expect(body.temporaryPassword).toMatch(/^[A-Za-z0-9_-]{20}$/);
    expect(await sessionStatus(staff)).toBe(401);
    expect((await signIn(FINANCE.email, FINANCE.password)).status).toBe(401);
    const login = await signIn(FINANCE.email, body.temporaryPassword);
    expect(login.status).toBe(200);
    expect(await login.json()).toMatchObject({ mustChange: true, returnTo: "/ganti-password" });
  });
});

describe("audit", () => {
  it("lists the management events by the Director, with no password or token anywhere", async () => {
    const created = await (await create(director(), newUser)).json();
    await patch(userOf(HR.email).id, director(), { disabled: true });
    const reseted = await (await reset(userOf(FINANCE.email).id, director())).json();
    const response = await auditRoute.GET(call("GET", "/api/access/audit", director()));
    expect(response.status).toBe(200);
    const payload = await response.json();
    const events: { actor: string; action: string; target: string }[] = payload.events;
    expect(events.map((event) => event.action)).toEqual(["password_reset", "user_disable", "user_create"]);
    expect(events.map((event) => event.actor)).toEqual(["director", "director", "director"]);
    expect(events.map((event) => event.target)).toEqual([FINANCE.email, HR.email, NEW_EMAIL]);
    const keys: string[] = [];
    JSON.stringify(payload, (key, value: unknown) => { keys.push(key); return value; });
    expect(keys.filter((key) => /password|token|hash|secret/i.test(key))).toEqual([]);
    const text = JSON.stringify(payload);
    expect(text).not.toContain(created.temporaryPassword);
    expect(text).not.toContain(reseted.temporaryPassword);
    expect(text).not.toContain("scrypt$");
  });
});

describe("migration missing", () => {
  it("answers 503 to the Director while the Director session itself still works", async () => {
    setup({ migrated: false });
    const response = await usersRoute.GET(call("GET", "/api/access/users", director()));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Akun belum diaktifkan." });
    expect((await create(director(), newUser)).status).toBe(503);
  });
});
