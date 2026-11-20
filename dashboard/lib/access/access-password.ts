import { randomBytes, scryptSync } from "node:crypto";
import { verifyPasscode } from "../director/director-auth";

/** Salt is the hex string itself, exactly as verifyPasscode reads it back from the stored hash. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`;
}

export function verifyPassword(password: unknown, hash: string): boolean {
  return verifyPasscode(password, hash);
}

export function temporaryPassword(): string {
  return randomBytes(15).toString("base64url");
}

export function validNewPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= 12 && value.length <= 256;
}

/** Computed once at load; verifying an unknown email against it costs the same scrypt work as a real account. */
export const DUMMY_HASH = hashPassword(randomBytes(32).toString("base64url"));
