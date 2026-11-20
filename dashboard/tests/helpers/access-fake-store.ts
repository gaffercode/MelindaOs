import { randomBytes, randomUUID } from "node:crypto";
import { hashPassword } from "@/lib/access/access-password";
import { ACCOUNT_ROLES } from "@/lib/access/access-control";
import type { AccessAuditAction } from "@/lib/access/access-store";
import { hashSecret } from "@/lib/director/director-auth";
import { ACCESS_FIXTURES } from "../fixtures/access-accounts";

/**
 * In-memory stand-in for the Supabase RPC endpoint, shared by the route tests. Stub it with
 * `vi.stubGlobal("fetch", fake.fetch)`. It mirrors `melinda_access` (supabase/migrations/202611120001_access_rbac.sql),
 * the session and rate-limit commands of `melinda_director`, and answers every other RPC with `{ allowed: true }`.
 */
const FIXTURE_HASHES = ACCESS_FIXTURES.map((account) => hashPassword(account.password)); // scrypt is slow: once per fixture
const SESSION_MS = 30 * 60 * 1000;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isAccountRole = (role: string) => (ACCOUNT_ROLES as readonly string[]).includes(role);

export type FakeUser = { id: string; email: string; displayName: string; role: string; passwordHash: string; credentialVersion: string; mustChange: boolean; disabled: boolean; updatedAt: string };
export type FakeSession = { userId: string; credentialVersion: string; expiresAt: number };
export type FakeDirectorSession = { reviewerId: string; credentialVersion: string | null; expiresAt: number };
export type FakeCall = { rpc: string; command: string; args: Record<string, unknown> };

export function createAccessFakeFetch(options: { migrated?: boolean } = {}) {
  const migrated = options.migrated ?? true;
  const state = {
    users: ACCESS_FIXTURES.map((account, index): FakeUser => ({
      id: `00000000-0000-4000-8000-00000000000${index + 1}`, email: account.email, displayName: account.displayName, role: account.role,
      passwordHash: FIXTURE_HASHES[index], credentialVersion: randomBytes(16).toString("hex"), mustChange: false, disabled: false, updatedAt: new Date().toISOString(),
    })),
    /** Keyed by sha256 of the raw token, as the real table is. Tests may edit `expiresAt`. */
    sessions: new Map<string, FakeSession>(),
    directorSessions: new Map<string, FakeDirectorSession>(),
    /** Oldest first; `audit_list` answers newest first. */
    audit: [] as { actor: string | null; action: string; target: string | null; createdAt: string }[],
    rateLimits: new Map<string, number>(),
    /** Every RPC call in order, so a test can assert that `rate_limit` ran before `login_lookup`. */
    calls: [] as FakeCall[],
  };

  const publicUser = (user: FakeUser) => ({ id: user.id, email: user.email, displayName: user.displayName, role: user.role, mustChange: user.mustChange, disabled: user.disabled, updatedAt: user.updatedAt });
  const log = (actor: unknown, action: AccessAuditAction, target: string | null) => {
    if (typeof actor === "string" && actor) state.audit.push({ actor, action, target, createdAt: new Date().toISOString() });
  };

  function access(command: string, args: Record<string, unknown>): Response {
    const str = (key: string) => (typeof args[key] === "string" ? (args[key] as string) : null);
    const invalid = Response.json({ errorCode: "invalid_payload" });
    const notFound = Response.json({ errorCode: "not_found" });
    const constraint = Response.json({ code: "23514" }, { status: 400 });
    /** `null` when `userId` is not a UUID; otherwise the matching account, if any. */
    const byId = () => { const id = str("userId"); return id && UUID.test(id) ? { user: state.users.find((candidate) => candidate.id === id) } : null; };
    const reply = (user: FakeUser) => { user.updatedAt = new Date().toISOString(); return Response.json({ user: publicUser(user) }); };
    const now = Date.now();

    if (command === "login_lookup") {
      const email = str("email")?.trim().toLowerCase();
      if (email === undefined) return invalid;
      const user = state.users.find((candidate) => candidate.email === email && !candidate.disabled);
      return Response.json({ user: user ? { id: user.id, email: user.email, displayName: user.displayName, role: user.role, passwordHash: user.passwordHash, credentialVersion: user.credentialVersion, mustChange: user.mustChange } : null });
    }
    if (command === "session_create") {
      const tokenHash = str("tokenHash"), credentialVersion = str("credentialVersion"), found = byId();
      if (!tokenHash || !credentialVersion || !found) return invalid;
      if (!found.user || found.user.disabled) return notFound;
      state.sessions.set(tokenHash, { userId: found.user.id, credentialVersion, expiresAt: now + SESSION_MS });
      return Response.json({ ok: true });
    }
    if (command === "session_read") {
      const tokenHash = str("tokenHash");
      if (!tokenHash) return invalid;
      const session = state.sessions.get(tokenHash);
      const user = session && state.users.find((candidate) => candidate.id === session.userId);
      if (!session || !user || session.expiresAt <= now || user.disabled || session.credentialVersion !== user.credentialVersion) return Response.json({ session: null });
      return Response.json({ session: { userId: user.id, email: user.email, role: user.role, displayName: user.displayName, credentialVersion: user.credentialVersion, mustChange: user.mustChange } });
    }
    if (command === "session_revoke") {
      const tokenHash = str("tokenHash");
      if (!tokenHash) return invalid;
      state.sessions.delete(tokenHash);
      return Response.json({ ok: true });
    }
    if (command === "user_list") return Response.json({ users: state.users.map(publicUser) });
    if (command === "user_create") {
      const email = str("email")?.trim().toLowerCase(), displayName = str("displayName")?.trim(), role = str("role"), passwordHash = str("passwordHash"), credentialVersion = str("credentialVersion");
      if (!email || !displayName || !role || !passwordHash || !credentialVersion || !EMAIL.test(email) || displayName.length > 80) return invalid;
      if (!isAccountRole(role)) return constraint; // the table's check constraint, which also rejects DIRECTOR
      if (state.users.some((candidate) => candidate.email === email)) return Response.json({ errorCode: "conflict" });
      const user: FakeUser = { id: randomUUID(), email, displayName, role, passwordHash, credentialVersion, mustChange: true, disabled: false, updatedAt: "" };
      state.users.push(user);
      log(args.actor, "user_create", email);
      return reply(user);
    }
    if (command === "user_update") {
      const found = byId(), displayName = str("displayName")?.trim(), role = str("role");
      if (!found || (!displayName && !role)) return invalid;
      if (role && !isAccountRole(role)) return constraint;
      if (!found.user) return notFound;
      if (displayName) found.user.displayName = displayName;
      if (role) found.user.role = role;
      found.user.credentialVersion = str("credentialVersion") ?? randomUUID();
      log(args.actor, "user_update", found.user.email);
      return reply(found.user);
    }
    if (command === "user_set_disabled") {
      const found = byId();
      if (!found || typeof args.disabled !== "boolean") return invalid;
      if (!found.user) return notFound;
      found.user.disabled = args.disabled;
      found.user.credentialVersion = str("credentialVersion") ?? randomUUID();
      log(args.actor, args.disabled ? "user_disable" : "user_enable", found.user.email);
      return reply(found.user);
    }
    if (command === "password_set") {
      const found = byId(), passwordHash = str("passwordHash"), credentialVersion = str("credentialVersion"), action = str("action");
      if (!found || !passwordHash || !credentialVersion || typeof args.mustChange !== "boolean" || (action !== "password_reset" && action !== "password_change")) return invalid;
      if (!found.user) return notFound;
      Object.assign(found.user, { passwordHash, credentialVersion, mustChange: args.mustChange });
      log(args.actor, action, found.user.email);
      return reply(found.user);
    }
    if (command === "audit_append") {
      const action = str("action");
      if (!action) return invalid;
      state.audit.push({ actor: str("actor"), action, target: str("target"), createdAt: new Date().toISOString() });
      return Response.json({ ok: true });
    }
    if (command === "audit_list") return Response.json({ events: state.audit.slice(-100).reverse() });
    return invalid;
  }

  function director(command: string, args: Record<string, unknown>): Response {
    const tokenHash = typeof args.tokenHash === "string" ? args.tokenHash : "";
    const bucket = String(args.bucket);
    if (command === "rate_limit") {
      const attempts = (state.rateLimits.get(bucket) ?? 0) + 1;
      state.rateLimits.set(bucket, attempts);
      return Response.json({ allowed: attempts <= Number(args.limit) });
    }
    if (command === "rate_reset") { state.rateLimits.delete(bucket); return Response.json({ ok: true }); }
    if (command === "session_create") {
      state.directorSessions.set(tokenHash, { reviewerId: String(args.reviewerId), credentialVersion: String(args.credentialVersion), expiresAt: Date.now() + SESSION_MS });
      return Response.json({ ok: true });
    }
    if (command === "session_read") {
      const session = state.directorSessions.get(tokenHash);
      const live = session && session.expiresAt > Date.now() && (session.credentialVersion === null || session.credentialVersion === args.credentialVersion);
      return Response.json({ session: live ? { reviewerId: session.reviewerId } : null });
    }
    if (command === "session_revoke") { state.directorSessions.delete(tokenHash); return Response.json({ ok: true }); }
    return Response.json({ allowed: true });
  }

  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const rpc = new URL(String(input instanceof Request ? input.url : input)).pathname.split("/").pop() ?? "";
    const { command, args } = JSON.parse(String(init?.body ?? "{}")) as { command: string; args: Record<string, unknown> };
    state.calls.push({ rpc, command, args });
    if (rpc === "melinda_access") return migrated ? access(command, args) : new Response("{}", { status: 404 });
    if (rpc === "melinda_director") return director(command, args);
    return Response.json({ allowed: true });
  }) as typeof fetch;

  return {
    fetch: fakeFetch,
    state,
    /** Opens a session for an enabled account exactly as the login route will, and returns the raw `melinda_user` cookie token. */
    signIn(email: string): string {
      const user = state.users.find((candidate) => candidate.email === email.trim().toLowerCase() && !candidate.disabled);
      if (!user) throw new Error(`No enabled fixture account ${email}`);
      const token = randomBytes(32).toString("hex");
      state.sessions.set(hashSecret(token), { userId: user.id, credentialVersion: user.credentialVersion, expiresAt: Date.now() + SESSION_MS });
      return token;
    },
    /** Opens a Director session (reviewer `director`, any credential version) and returns the raw `melinda_director` cookie token. */
    directorToken(): string {
      const token = randomBytes(32).toString("hex");
      state.directorSessions.set(hashSecret(token), { reviewerId: "director", credentialVersion: null, expiresAt: Date.now() + SESSION_MS });
      return token;
    },
  };
}
