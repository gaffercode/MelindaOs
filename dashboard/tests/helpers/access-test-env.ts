import { scryptSync } from "node:crypto";
import { vi } from "vitest";
import { DIRECTOR_FIXTURE_PASSCODE } from "../fixtures/access-accounts";

export const ACCESS_TEST_ORIGIN = "https://synthetic.example";
const salt = "00112233445566778899aabbccddeeff";
/** The stored Director passcode hash; it is also the Director session's CSRF secret. */
export const ACCESS_TEST_PASSCODE_HASH = `scrypt$${salt}$${scryptSync(DIRECTOR_FIXTURE_PASSCODE, salt, 64).toString("hex")}`;

/** Protected-mode environment for tests that run the access handlers against `createAccessFakeFetch`. */
export function stubAccessEnv(): void {
  vi.stubEnv("MELINDAOS_DIRECTOR_STORE", "supabase");
  vi.stubEnv("MELINDAOS_APP_ORIGIN", ACCESS_TEST_ORIGIN);
  vi.stubEnv("MELINDAOS_SUPABASE_URL", "https://db.synthetic.example");
  vi.stubEnv("MELINDAOS_SUPABASE_SECRET_KEY", "synthetic-secret");
  vi.stubEnv("MELINDAOS_REVIEWER_ID", "director");
  vi.stubEnv("MELINDAOS_REVIEWER_PASSCODE_HASH", ACCESS_TEST_PASSCODE_HASH);
}
