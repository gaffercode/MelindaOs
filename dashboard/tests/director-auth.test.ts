import { scryptSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authConfiguration, protectedDirectorMode, hashSecret, verifyPasscode, safeReturnPath, sessionCookie, csrfForSession, verifyCsrf, authenticateBot } from "@/lib/director/director-auth";

afterEach(() => vi.unstubAllEnvs());
const salt = "00112233445566778899aabbccddeeff";
const passcodeHash = `scrypt$${salt}$${scryptSync("synthetic-test-passcode", salt, 64).toString("hex")}`;

describe("director authentication boundaries", () => {
  it("does not expose file data when a configured storage mode is misspelled", () => {
    vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("VERCEL", ""); vi.stubEnv("MELINDAOS_DIRECTOR_STORE", "supabse");
    expect(protectedDirectorMode()).toBe(true);
    expect(() => authConfiguration()).toThrow();
  });
  it("verifies a real scrypt hash and rejects incorrect or unbounded passcodes", () => {
    expect(verifyPasscode("synthetic-test-passcode", passcodeHash)).toBe(true);
    expect(verifyPasscode("incorrect", passcodeHash)).toBe(false);
    expect(verifyPasscode("x".repeat(1000), passcodeHash)).toBe(false);
    expect(verifyPasscode("synthetic-test-passcode", "invalid")).toBe(false);
  });
  it("binds CSRF to the session and refuses missing, forged and wrong-origin requests", () => {
    const token = csrfForSession("synthetic-session", passcodeHash);
    const request = (origin: string, csrf: string) => new Request("https://synthetic.example/api/director/reviews/x", { method: "POST", headers: { Origin: origin, "X-CSRF-Token": csrf } });
    expect(verifyCsrf(request("https://synthetic.example", token), "synthetic-session", passcodeHash, "https://synthetic.example")).toBe(true);
    expect(verifyCsrf(request("https://other.example", token), "synthetic-session", passcodeHash, "https://synthetic.example")).toBe(false);
    expect(verifyCsrf(request("https://synthetic.example", ""), "synthetic-session", passcodeHash, "https://synthetic.example")).toBe(false);
    expect(verifyCsrf(request("https://synthetic.example", token), "another-session", passcodeHash, "https://synthetic.example")).toBe(false);
  });
  it("allows only an exact submitter token and does not use reviewer credentials", () => {
    const configuration = { producerId: "biznet-medify", tokenHash: hashSecret("synthetic-bot-token") };
    expect(authenticateBot(new Request("https://example.test", { headers: { Authorization: "Bearer synthetic-bot-token" } }), configuration)).toBe("biznet-medify");
    expect(authenticateBot(new Request("https://example.test", { headers: { Authorization: "Bearer other" } }), configuration)).toBeNull();
    expect(authenticateBot(new Request("https://example.test", { headers: { Cookie: "melinda_director=other" } }), configuration)).toBeNull();
  });
  it("allows only local registered destinations and never sets a script-readable cookie", () => {
    expect(safeReturnPath("/?tanggal=2026-10-03")).toBe("/?tanggal=2026-10-03");
    expect(safeReturnPath("/director-review?tanggal=2026-10-03")).toBe("/director-review?tanggal=2026-10-03");
    expect(safeReturnPath("/arahan?hari=31")).toBe("/arahan?hari=31");
    expect(safeReturnPath("/kredensial")).toBe("/kredensial");
    expect(safeReturnPath("/order-obat")).toBe("/order-obat");
    expect(safeReturnPath("/formularium")).toBe("/formularium");
    expect(safeReturnPath("/order-obat?tanggal=2026-11-03")).toBe("/order-obat?tanggal=2026-11-03");
    expect(safeReturnPath("/arahan?hari=abc")).toBe("/");
    expect(safeReturnPath("/arahan/arsip")).toBe("/arahan/arsip");
    expect(safeReturnPath("/arahan?hari=31&tugas=terlambat")).toBe("/arahan?hari=31&tugas=terlambat");
    expect(safeReturnPath("/arahan?tugas=tanpa_balasan")).toBe("/arahan?tugas=tanpa_balasan");
    expect(safeReturnPath("/arahan?tugas=semua")).toBe("/");
  });
  it("returns to / when returnTo is a removed Puskesmas path", () => {
    expect(safeReturnPath("/puskesmas")).toBe("/");
    expect(safeReturnPath("/konsultasi-medis")).toBe("/");
    expect(safeReturnPath("/puskesmas?tanggal=2026-11-05")).toBe("/");
    for (const path of ["https://attacker.example", "//attacker.example", "/\\attacker.example", "/api/search", "/unregistered", "/?other=bad"]) expect(safeReturnPath(path)).toBe("/");
    const cookie = sessionCookie("abc", true);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("Max-Age=1800");
  });
  it("fails closed on Vercel and on partial or invalid server configuration", () => {
    vi.stubEnv("MELINDAOS_DIRECTOR_STORE", "file");
    vi.stubEnv("VERCEL", "1");
    expect(() => authConfiguration()).toThrow();
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("NODE_ENV", "test");
    expect(authConfiguration()).toBeNull();
    vi.stubEnv("MELINDAOS_DIRECTOR_STORE", "supabase");
    expect(() => authConfiguration()).toThrow();
  });
  it("configures Director login from the passcode, reviewer, origin and Supabase settings alone", () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("MELINDAOS_DIRECTOR_STORE", "supabase");
    vi.stubEnv("MELINDAOS_APP_ORIGIN", "https://synthetic.example");
    vi.stubEnv("MELINDAOS_SUPABASE_URL", "https://synthetic.supabase.co");
    vi.stubEnv("MELINDAOS_SUPABASE_SECRET_KEY", "sb_secret_synthetic");
    vi.stubEnv("MELINDAOS_REVIEWER_PASSCODE_HASH", passcodeHash);
    vi.stubEnv("MELINDAOS_REVIEWER_ID", "director-test");
    expect(authConfiguration()).toMatchObject({ reviewerId: "director-test", passcodeHash, origin: "https://synthetic.example", secure: true });
  });
});
