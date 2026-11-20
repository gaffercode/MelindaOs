import { describe, expect, it } from "vitest";
import { DUMMY_HASH, hashPassword, temporaryPassword, validNewPassword, verifyPassword } from "@/lib/access/access-password";

describe("access password helpers", () => {
  it("verifies the password it hashed and rejects a wrong one", () => {
    const hash = hashPassword("synthetic-pass-0001");
    expect(verifyPassword("synthetic-pass-0001", hash)).toBe(true);
    expect(verifyPassword("synthetic-pass-0002", hash)).toBe(false);
  });

  it("salts every hash so the same password gives different hashes", () => {
    expect(hashPassword("synthetic-pass-0001")).not.toBe(hashPassword("synthetic-pass-0001"));
  });

  it("produces the scrypt format", () => {
    expect(hashPassword("synthetic-pass-0001")).toMatch(/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
  });

  it("generates 20-character url-safe temporary passwords that do not repeat", () => {
    const values = Array.from({ length: 50 }, () => temporaryPassword());
    for (const value of values) expect(value).toMatch(/^[A-Za-z0-9_-]{20}$/);
    expect(new Set(values).size).toBe(50);
  });

  it("accepts new passwords from 12 to 256 characters only", () => {
    expect(validNewPassword("a".repeat(11))).toBe(false);
    expect(validNewPassword("a".repeat(12))).toBe(true);
    expect(validNewPassword("a".repeat(256))).toBe(true);
    expect(validNewPassword("a".repeat(257))).toBe(false);
    expect(validNewPassword("123")).toBe(false);
    expect(validNewPassword(12345678901234)).toBe(false);
  });

  it("rejects any password against the dummy hash", () => {
    expect(verifyPassword("anything", DUMMY_HASH)).toBe(false);
  });
});
