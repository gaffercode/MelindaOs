import { randomBytes } from "node:crypto";
import { ACCOUNT_ROLES, hasPermission, landingFor, permissionFor, ROLE_LABELS, type Permission, type Principal, type Role } from "./access-control";
import { DUMMY_HASH, hashPassword, temporaryPassword, validNewPassword, verifyPassword } from "./access-password";
import { AccessStore, type AccessSession, type AccessUser, type AccountRole } from "./access-store";
import { clientAddress, DirectorApiError, jsonResponse, objectBody, rateLimit, readBoundedJson, requireConfiguration, requireHuman, validRevisionId } from "../director/director-api";
import { cookieUserSession, csrfForSession, hashSecret, safeReturnPath, userCookie, verifyCsrf, type DirectorAuthConfiguration } from "../director/director-auth";
import { DirectorStoreError } from "../director/director-store";
import { logError } from "../log";

const SIGN_IN = "Silakan masuk.";
const WRONG_LOGIN = "Email atau password tidak sesuai.";
const FORBIDDEN = "Akses tidak sesuai peran.";
const BAD_CSRF = "Permintaan tidak berasal dari sesi yang sah.";

/** A missing `melinda_access` RPC (migration not applied) reads as 503 from the store; say so plainly. */
async function available<T>(pending: Promise<T>): Promise<T> {
  try { return await pending; } catch (error) {
    if (error instanceof DirectorStoreError && error.status === 503) {
      logError("access_unavailable", error);
      throw new DirectorApiError(503, "Akun belum diaktifkan.");
    }
    throw error;
  }
}

type AccountContext = { principal: Principal; raw: string; session: AccessSession; access: AccessStore };

/**
 * The `melinda_user` cookie only; `null` when it is absent or no longer valid. A store 503 (migration not applied)
 * also reads as no session, so a leftover cookie ends in 401 and the sign-in redirect, not 503 (spec section 8).
 */
async function accountSession(request: Request, config: DirectorAuthConfiguration): Promise<AccountContext | null> {
  const raw = cookieUserSession(request);
  if (!raw) return null;
  const access = new AccessStore(config.store);
  let session: AccessSession | null;
  try { session = await access.readSession(hashSecret(raw)); } catch (error) {
    if (!(error instanceof DirectorStoreError) || error.status !== 503) throw error;
    logError("access_unavailable", error);
    return null;
  }
  if (!session) return null;
  const principal: Principal = { kind: "account", role: session.role, id: session.userId, displayName: session.displayName, csrfSecret: session.credentialVersion, mustChange: session.mustChange };
  return { principal, raw, session, access };
}

/** Own-account actions (sign-out, password change) act on the account cookie even when a Director cookie is also present. */
async function requireAccount(request: Request, config: DirectorAuthConfiguration): Promise<AccountContext> {
  const account = await accountSession(request, config);
  if (!account) throw new DirectorApiError(401, SIGN_IN);
  if (!verifyCsrf(request, account.raw, account.principal.csrfSecret, config.origin)) throw new DirectorApiError(403, BAD_CSRF);
  return account;
}

/** The Director cookie first, through the unchanged `requireHuman`; only its 401 falls through to the account cookie. */
export async function requirePrincipal(request: Request, config: DirectorAuthConfiguration = requireConfiguration()): Promise<{ principal: Principal; config: DirectorAuthConfiguration; raw: string }> {
  try {
    const { raw, reviewerId } = await requireHuman(request, config);
    return { principal: { kind: "director", role: "DIRECTOR", id: reviewerId, displayName: ROLE_LABELS.DIRECTOR, csrfSecret: config.passcodeHash, mustChange: false }, config, raw };
  } catch (error) {
    if (!(error instanceof DirectorApiError) || error.status !== 401) throw error;
  }
  const account = await accountSession(request, config);
  if (!account) throw new DirectorApiError(401, SIGN_IN);
  return { principal: account.principal, config, raw: account.raw };
}

export async function requirePermission(request: Request, permission: Permission, write = false): Promise<{ principal: Principal; config: DirectorAuthConfiguration; raw: string; reviewerId: string }> {
  const resolved = await requirePrincipal(request);
  if (!hasPermission(resolved.principal, permission)) throw new DirectorApiError(403, FORBIDDEN);
  if (write && !verifyCsrf(request, resolved.raw, resolved.principal.csrfSecret, resolved.config.origin)) throw new DirectorApiError(403, BAD_CSRF);
  return { ...resolved, reviewerId: resolved.principal.id };
}

function returnPath(role: Role, requested: unknown): string {
  const path = safeReturnPath(requested);
  return hasPermission({ role, mustChange: false }, permissionFor(path)) ? path : landingFor(role);
}

export async function loginAccount(request: Request): Promise<Response> {
  const config = requireConfiguration();
  if (request.headers.get("Origin") !== config.origin) throw new DirectorApiError(403, "Permintaan login ditolak.");
  const body = objectBody(await readBoundedJson(request, 4096), ["email", "password"], ["returnTo"]);
  if (typeof body.email !== "string" || body.email.length > 254) throw new DirectorApiError(400, "Format permintaan tidak valid.");
  // Throttle before verification so wrong passwords count too; scrypt is CPU-bound.
  const address = clientAddress(request);
  await rateLimit(config, `access-ip:${address}`, 10, 900);
  const email = body.email.trim().toLowerCase();
  // Keyed on the address too: this counts before the password is checked, so an email-only bucket would let anyone lock a known account out.
  const emailBucket = `access-email:${email}:${address}`;
  await rateLimit(config, emailBucket, 5, 900);
  const access = new AccessStore(config.store);
  const user = await available(access.loginLookup(email));
  // Always run scrypt, so an unknown email costs the same time as a wrong password.
  const verified = verifyPassword(body.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !verified) {
    await available(access.appendAudit("login_fail", email, null));
    throw new DirectorApiError(401, WRONG_LOGIN);
  }
  const raw = randomBytes(32).toString("hex");
  await available(access.createSession(hashSecret(raw), user.id, user.credentialVersion));
  await available(access.appendAudit("login_ok", user.email, user.email));
  await config.store.call("rate_reset", { bucket: emailBucket });
  return jsonResponse(
    { returnTo: user.mustChange ? "/ganti-password" : returnPath(user.role, body.returnTo), csrfToken: csrfForSession(raw, user.credentialVersion), role: user.role, mustChange: user.mustChange },
    200,
    { "Set-Cookie": userCookie(raw, config.secure) }
  );
}

export async function currentAccount(request: Request): Promise<Response> {
  const { principal, raw } = await requirePrincipal(request);
  return jsonResponse({ kind: principal.kind, role: principal.role, displayName: principal.displayName, mustChange: principal.mustChange, csrfToken: csrfForSession(raw, principal.csrfSecret) });
}

export async function logoutAccount(request: Request): Promise<Response> {
  const config = requireConfiguration();
  const { raw, session, access } = await requireAccount(request, config);
  await available(access.revokeSession(hashSecret(raw)));
  await available(access.appendAudit("logout", session.email, session.email));
  return jsonResponse({ ok: true }, 200, { "Set-Cookie": userCookie("", config.secure, true) });
}

export async function changePassword(request: Request): Promise<Response> {
  const config = requireConfiguration();
  const { principal, raw, session, access } = await requireAccount(request, config);
  const body = objectBody(await readBoundedJson(request, 4096), ["currentPassword", "newPassword"]);
  if (!validNewPassword(body.newPassword) || body.newPassword === body.currentPassword) throw new DirectorApiError(400, "Password baru harus 12–256 karakter dan berbeda dari password lama.");
  // Its own bucket: only a signed-in session reaches this line, and failed sign-ins must not block a password change.
  await rateLimit(config, `access-password:${session.email}`, 5, 900);
  const user = await available(access.loginLookup(session.email));
  if (!verifyPassword(body.currentPassword, user?.passwordHash ?? DUMMY_HASH) || !user) throw new DirectorApiError(400, "Password saat ini tidak sesuai.");
  const credentialVersion = randomBytes(32).toString("hex");
  // The new credential version ends every other session of this account; `password_set` writes the audit row.
  await available(access.setPassword(principal.id, { passwordHash: hashPassword(body.newPassword), credentialVersion, mustChange: false, action: "password_change" }, session.email));
  await available(access.revokeSession(hashSecret(raw)));
  const next = randomBytes(32).toString("hex");
  await available(access.createSession(hashSecret(next), principal.id, credentialVersion));
  return jsonResponse({ returnTo: landingFor(principal.role), csrfToken: csrfForSession(next, credentialVersion) }, 200, { "Set-Cookie": userCookie(next, config.secure) });
}

/** Account-management store calls: 409 is a taken email, 404 an unknown account, 503 a missing migration. */
async function managed<T>(pending: Promise<T>): Promise<T> {
  try { return await available(pending); } catch (error) {
    if (error instanceof DirectorStoreError && error.status === 409) throw new DirectorApiError(409, "Email sudah terdaftar.");
    if (error instanceof DirectorStoreError && error.status === 404) throw new DirectorApiError(404, "Akun tidak ditemukan.");
    throw error;
  }
}

const BAD_ROLE = "Peran tidak valid.";
function accountRole(value: unknown): AccountRole {
  const role = ACCOUNT_ROLES.find((candidate) => candidate === value);
  if (!role) throw new DirectorApiError(400, BAD_ROLE);
  return role;
}
function accountEmail(value: unknown): string {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new DirectorApiError(400, "Email tidak valid.");
  return email;
}
function accountName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (name.length < 1 || name.length > 80) throw new DirectorApiError(400, "Nama tampilan harus 1–80 karakter.");
  return name;
}
function accountId(value: string): string {
  try { return validRevisionId(value); } catch { throw new DirectorApiError(404, "Akun tidak ditemukan."); }
}

export async function listAccounts(request: Request): Promise<Response> {
  const { config } = await requirePermission(request, "users.manage");
  return jsonResponse({ users: await managed(new AccessStore(config.store).listUsers()) });
}

export async function createAccount(request: Request): Promise<Response> {
  const { config, principal } = await requirePermission(request, "users.manage", true);
  const body = objectBody(await readBoundedJson(request, 4096), ["email", "displayName", "role"]);
  const role = accountRole(body.role);
  const email = accountEmail(body.email);
  const displayName = accountName(body.displayName);
  const issued = temporaryPassword();
  const user = await managed(new AccessStore(config.store).createUser({ email, displayName, role, passwordHash: hashPassword(issued), credentialVersion: randomBytes(32).toString("hex"), actor: principal.id }));
  return jsonResponse({ user, temporaryPassword: issued }, 201);
}

export async function updateAccount(request: Request, id: string): Promise<Response> {
  const { config, principal } = await requirePermission(request, "users.manage", true);
  const userId = accountId(id);
  const body = objectBody(await readBoundedJson(request, 4096), [], ["displayName", "role", "disabled"]);
  if (Object.keys(body).length === 0) throw new DirectorApiError(400, "Format permintaan tidak valid.");
  if (body.disabled !== undefined && typeof body.disabled !== "boolean") throw new DirectorApiError(400, "Format permintaan tidak valid.");
  const changes = { ...(body.displayName !== undefined && { displayName: accountName(body.displayName) }), ...(body.role !== undefined && { role: accountRole(body.role) }) };
  const access = new AccessStore(config.store);
  let user: AccessUser | null = null;
  if (Object.keys(changes).length > 0) user = await managed(access.updateUser(userId, changes, principal.id));
  if (typeof body.disabled === "boolean") user = await managed(access.setDisabled(userId, body.disabled, principal.id));
  return jsonResponse({ user });
}

export async function resetAccountPassword(request: Request, id: string): Promise<Response> {
  const { config, principal } = await requirePermission(request, "users.manage", true);
  const userId = accountId(id);
  const issued = temporaryPassword();
  // The new credential version ends the account's open sessions; `password_set` writes the `password_reset` audit row.
  await managed(new AccessStore(config.store).setPassword(userId, { passwordHash: hashPassword(issued), credentialVersion: randomBytes(32).toString("hex"), mustChange: true, action: "password_reset" }, principal.id));
  return jsonResponse({ temporaryPassword: issued });
}

export async function listAccessAudit(request: Request): Promise<Response> {
  const { config } = await requirePermission(request, "users.manage");
  return jsonResponse({ events: await managed(new AccessStore(config.store).listAudit()) });
}
