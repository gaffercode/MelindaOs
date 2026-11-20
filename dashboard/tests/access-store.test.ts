import { describe, expect, it } from "vitest";
import { AccessStore } from "@/lib/access/access-store";
import { DirectorStoreError, SupabaseDirectorStore } from "@/lib/director/director-store";
import { ACCESS_FIXTURES } from "./fixtures/access-accounts";
import { createAccessFakeFetch } from "./helpers/access-fake-store";

function setup(options?: { migrated?: boolean }) {
  const fake = createAccessFakeFetch(options);
  const access = new AccessStore(new SupabaseDirectorStore("https://db.synthetic.example", "synthetic-secret", fake.fetch));
  return { fake, access };
}

describe("AccessStore", () => {
  it("lists the five fixture accounts without any password hash", async () => {
    const { access } = setup();
    const users = await access.listUsers();
    expect(users.map((user) => user.email)).toEqual(ACCESS_FIXTURES.map((account) => account.email));
    expect(users.every((user) => !("passwordHash" in user))).toBe(true);
  });

  it("rejects a duplicate email, ignoring case and spaces, with status 409", async () => {
    const { access } = setup();
    const input = { email: " STAFF.HR@melinda.test ", displayName: "Duplikat", role: "STAFF_HR" as const, passwordHash: "x", credentialVersion: "v1", actor: "director" };
    await expect(access.createUser(input)).rejects.toMatchObject({ name: "DirectorStoreError", status: 409 });
  });

  it("surfaces a missing RPC as DirectorStoreError 503", async () => {
    const { access } = setup({ migrated: false });
    const failure = await access.listUsers().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DirectorStoreError);
    expect(failure).toMatchObject({ status: 503, code: "missing_function" });
  });

  it("refuses the DIRECTOR role before calling the database", async () => {
    const { access, fake } = setup();
    await expect(access.createUser({ email: "x@melinda.test", displayName: "X", role: "DIRECTOR" as never, passwordHash: "x", credentialVersion: "v1", actor: "director" })).rejects.toBeInstanceOf(DirectorStoreError);
    await expect(access.updateUser(fake.state.users[0].id, { role: "DIRECTOR" as never }, "director")).rejects.toBeInstanceOf(DirectorStoreError);
    expect(fake.state.calls).toEqual([]);
  });

  it("looks a login up by normalised email, only for enabled accounts, and is the only call returning the hash", async () => {
    const { access } = setup();
    const found = await access.loginLookup("  VICEDIRECTOR@melinda.test ");
    expect(found).toMatchObject({ email: "vicedirector@melinda.test", role: "VICE_DIRECTOR" });
    expect(found?.passwordHash).toMatch(/^scrypt\$/);
    await access.setDisabled(found!.id, true, "director");
    expect(await access.loginLookup("vicedirector@melinda.test")).toBeNull();
    expect(await access.loginLookup("nobody@melinda.test")).toBeNull();
  });

  it("ends a session when the account is disabled, edited, expired or revoked", async () => {
    const { access, fake } = setup();
    const user = (await access.loginLookup("staff.hr@melinda.test"))!;
    await access.createSession("hash-1", user.id, user.credentialVersion);
    expect(await access.readSession("hash-1")).toMatchObject({ userId: user.id, role: "STAFF_HR", credentialVersion: user.credentialVersion });

    const edited = await access.updateUser(user.id, { displayName: "Nama Baru" }, "director");
    expect(edited.displayName).toBe("Nama Baru");
    expect(await access.readSession("hash-1")).toBeNull();

    const fresh = (await access.loginLookup("staff.hr@melinda.test"))!;
    expect(fresh.credentialVersion).not.toBe(user.credentialVersion);
    await access.createSession("hash-2", user.id, fresh.credentialVersion);
    expect(await access.readSession("hash-2")).not.toBeNull();
    fake.state.sessions.get("hash-2")!.expiresAt = Date.now() - 1;
    expect(await access.readSession("hash-2")).toBeNull();

    await access.createSession("hash-3", user.id, fresh.credentialVersion);
    await access.revokeSession("hash-3");
    expect(await access.readSession("hash-3")).toBeNull();
  });

  it("sets a password, records the audit trail newest first and reports unknown accounts as 404", async () => {
    const { access } = setup();
    const user = (await access.loginLookup("staff.ops@melinda.test"))!;
    const changed = await access.setPassword(user.id, { passwordHash: "scrypt$new", credentialVersion: "v2", mustChange: true, action: "password_reset" }, "director");
    expect(changed).toMatchObject({ mustChange: true });
    await access.appendAudit("login_ok", user.email, user.email);
    expect((await access.listAudit()).map((event) => event.action)).toEqual(["login_ok", "password_reset"]);
    await expect(access.setDisabled("00000000-0000-4000-8000-0000000000ff", true, "director")).rejects.toMatchObject({ status: 404 });
  });
});
