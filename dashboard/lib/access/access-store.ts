import { randomBytes } from "node:crypto";
import { ACCOUNT_ROLES, type Role } from "./access-control";
import { DirectorStoreError, type SupabaseDirectorStore } from "../director/director-store";

export type AccountRole = Exclude<Role, "DIRECTOR">;
export type AccessUser = { id: string; email: string; displayName: string; role: AccountRole; mustChange: boolean; disabled: boolean; updatedAt: string };
/** Only `login_lookup` returns the hash and the credential version. */
export type AccessLoginUser = Pick<AccessUser, "id" | "email" | "displayName" | "role" | "mustChange"> & { passwordHash: string; credentialVersion: string };
export type AccessSession = { userId: string; email: string; role: AccountRole; displayName: string; credentialVersion: string; mustChange: boolean };
export type AccessAuditAction = "login_ok" | "login_fail" | "logout" | "user_create" | "user_update" | "user_disable" | "user_enable" | "password_reset" | "password_change";
export type AccessAuditEvent = { actor: string | null; action: AccessAuditAction; target: string | null; createdAt: string };

const newVersion = () => randomBytes(32).toString("hex");
function accountRole(role: unknown): AccountRole {
  if (!ACCOUNT_ROLES.includes(role as AccountRole)) throw new DirectorStoreError(400, "invalid_role");
  return role as AccountRole;
}

/** One method per `melinda_access` command. Failures arrive as `DirectorStoreError`: 409 conflict, 404 not found, 503 anything else, including a migration not applied yet. */
export class AccessStore {
  constructor(private readonly store: SupabaseDirectorStore) {}

  private call<T>(command: string, args: Record<string, unknown>): Promise<T> {
    return this.store.call<T>(command, args, "melinda_access");
  }

  async loginLookup(email: string): Promise<AccessLoginUser | null> {
    return (await this.call<{ user: AccessLoginUser | null }>("login_lookup", { email })).user;
  }

  async createSession(tokenHash: string, userId: string, credentialVersion: string): Promise<void> {
    await this.call("session_create", { tokenHash, userId, credentialVersion });
  }

  async readSession(tokenHash: string): Promise<AccessSession | null> {
    return (await this.call<{ session: AccessSession | null }>("session_read", { tokenHash })).session;
  }

  async revokeSession(tokenHash: string): Promise<void> {
    await this.call("session_revoke", { tokenHash });
  }

  async listUsers(): Promise<AccessUser[]> {
    return (await this.call<{ users: AccessUser[] }>("user_list", {})).users;
  }

  async createUser(input: { email: string; displayName: string; role: AccountRole; passwordHash: string; credentialVersion: string; actor: string }): Promise<AccessUser> {
    accountRole(input.role);
    return (await this.call<{ user: AccessUser }>("user_create", input)).user;
  }

  /** Always rotates the credential version, which ends the account's open sessions. */
  async updateUser(id: string, changes: { displayName?: string; role?: AccountRole }, actor: string): Promise<AccessUser> {
    if (changes.role !== undefined) accountRole(changes.role);
    return (await this.call<{ user: AccessUser }>("user_update", { userId: id, ...changes, credentialVersion: newVersion(), actor })).user;
  }

  /** Always rotates the credential version, so disabling ends the account's open sessions. */
  async setDisabled(id: string, disabled: boolean, actor: string): Promise<AccessUser> {
    return (await this.call<{ user: AccessUser }>("user_set_disabled", { userId: id, disabled, credentialVersion: newVersion(), actor })).user;
  }

  async setPassword(id: string, input: { passwordHash: string; credentialVersion: string; mustChange: boolean; action: "password_reset" | "password_change" }, actor: string): Promise<AccessUser> {
    return (await this.call<{ user: AccessUser }>("password_set", { userId: id, ...input, actor })).user;
  }

  async appendAudit(action: AccessAuditAction, target: string | null, actor: string | null): Promise<void> {
    await this.call("audit_append", { action, target, actor });
  }

  /** The 100 newest events, newest first. */
  async listAudit(): Promise<AccessAuditEvent[]> {
    return (await this.call<{ events: AccessAuditEvent[] }>("audit_list", {})).events;
  }
}
