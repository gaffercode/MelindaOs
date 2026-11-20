import { createHash, createHmac, scryptSync, timingSafeEqual } from "node:crypto";
import { PAGE_PERMISSIONS } from "../access/access-control";
import { DirectorStoreError, SupabaseDirectorStore } from "./director-store";

export type DirectorAuthConfiguration = {
  reviewerId: string;
  passcodeHash: string;
  origin: string;
  secure: boolean;
  store: SupabaseDirectorStore;
};
export const SESSION_COOKIE = "melinda_director";

export function hashSecret(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function equal(left: string, right: string): boolean {
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function protectedDirectorMode(): boolean {
  const mode = process.env.MELINDAOS_DIRECTOR_STORE;
  return Boolean(process.env.VERCEL) || process.env.NODE_ENV === "production" || (mode !== undefined && mode !== "file");
}
/** A short warning when the site runs without a login (local file mode); null in protected mode. */
export function fileModeWarning(): string | null {
  if (protectedDirectorMode()) return null;
  return "Mode lokal — tanpa login. Atur MELINDAOS_DIRECTOR_STORE=supabase untuk mengaktifkan login.";
}
export function authConfiguration(): DirectorAuthConfiguration | null {
  const mode = process.env.MELINDAOS_DIRECTOR_STORE;
  if (!protectedDirectorMode() && (mode === undefined || mode === "file")) return null;
  if (mode !== "supabase") throw new DirectorStoreError(503, "configuration");
  const passcodeHash = process.env.MELINDAOS_REVIEWER_PASSCODE_HASH ?? "";
  const reviewerId = process.env.MELINDAOS_REVIEWER_ID ?? "";
  let origin: URL;
  try { origin = new URL(process.env.MELINDAOS_APP_ORIGIN ?? ""); } catch { throw new DirectorStoreError(503, "configuration"); }
  const localHttp = !process.env.VERCEL && process.env.MELINDAOS_ALLOW_LOCAL_HTTP === "1";
  if ((!/^scrypt\$[a-f0-9]{32,128}\$[a-f0-9]{128}$/.test(passcodeHash)) || !/^[a-zA-Z0-9_-]{1,80}$/.test(reviewerId) || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash || (origin.protocol !== "https:" && !(localHttp && origin.protocol === "http:" && ["127.0.0.1", "localhost"].includes(origin.hostname)))) throw new DirectorStoreError(503, "configuration");
  const store = new SupabaseDirectorStore(process.env.MELINDAOS_SUPABASE_URL ?? "", process.env.MELINDAOS_SUPABASE_SECRET_KEY ?? "", fetch, localHttp);
  return {
    reviewerId,
    passcodeHash,
    origin: origin.origin,
    secure: origin.protocol === "https:",
    store,
  };
}
export function verifyPasscode(value: unknown, hash: string): boolean {
  if (typeof value !== "string" || value.length < 1 || value.length > 256 || !/^scrypt\$[a-f0-9]{32,128}\$[a-f0-9]{128}$/.test(hash)) return false;
  const [, salt, expected] = hash.split("$");
  try { return equal(scryptSync(value, salt, 64).toString("hex"), expected); } catch { return false; }
}
export type PublisherKey = { producerId: string; tokenHash: string };
export function authenticateBot(request: Request, config: PublisherKey): string | null {
  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ") || authorization.length > 512) return null;
  return equal(hashSecret(authorization.slice(7)), config.tokenHash) ? config.producerId : null;
}
/**
 * The only publisher key: it may submit Medify documents only (the Biznet Gio scheduler).
 * Unset or malformed configuration disables it (fail closed).
 */
export function medifyPublisherConfiguration(): PublisherKey | null {
  const tokenHash = process.env.MELINDAOS_MEDIFY_PUBLISHER_TOKEN_HASH ?? "";
  const producerId = process.env.MELINDAOS_MEDIFY_PUBLISHER_ID || "biznet-medify";
  if (!/^[a-f0-9]{64}$/.test(tokenHash) || !/^[a-zA-Z0-9_-]{1,80}$/.test(producerId)) return null;
  return { producerId, tokenHash };
}
/**
 * Dedicated publisher key for scheduled SATUSEHAT OAuth2 snapshots; falls back to the Medify publisher key
 * when no separate `MELINDAOS_SATUSEHAT_PUBLISHER_TOKEN_HASH` is configured so the same Biznet server can publish both.
 */
export function satusehatPublisherConfiguration(): PublisherKey | null {
  const raw = process.env.MELINDAOS_SATUSEHAT_PUBLISHER_TOKEN_HASH;
  if (!raw) return medifyPublisherConfiguration();
  const producerId = process.env.MELINDAOS_SATUSEHAT_PUBLISHER_ID || "biznet-satusehat";
  if (!/^[a-f0-9]{64}$/.test(raw) || !/^[a-zA-Z0-9_-]{1,80}$/.test(producerId)) return null;
  return { producerId, tokenHash: raw };
}
export function csrfForSession(session: string, secret: string): string { return createHmac("sha256", secret).update(`csrf:${session}`).digest("hex"); }
export function verifyCsrf(request: Request, session: string, secret: string, origin: string): boolean {
  return request.headers.get("Origin") === origin && equal(request.headers.get("X-CSRF-Token") ?? "", csrfForSession(session, secret));
}
export function sessionCookie(value: string, secure: boolean, logout = false): string {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${logout ? 0 : 1800}${secure ? "; Secure" : ""}`;
}
export function cookieSession(request: Request): string | null {
  const value = (request.headers.get("cookie") ?? "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  return value && /^[a-f0-9]{64}$/.test(value) ? value : null;
}
/** Account sessions (spec section 5) sit beside the Director cookie and never replace it. */
export const USER_COOKIE = "melinda_user";
export function userCookie(value: string, secure: boolean, logout = false): string {
  return `${USER_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${logout ? 0 : 1800}${secure ? "; Secure" : ""}`;
}
export function cookieUserSession(request: Request): string | null {
  const value = (request.headers.get("cookie") ?? "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${USER_COOKIE}=`))?.slice(USER_COOKIE.length + 1);
  return value && /^[a-f0-9]{64}$/.test(value) ? value : null;
}
/** Every page pattern without a dynamic segment; any other path returns to `/`. */
const RETURN_PATHS = PAGE_PERMISSIONS.map((rule) => rule.pattern).filter((pattern) => !pattern.includes("["));
export function safeReturnPath(value: unknown): string {
  if (typeof value !== "string" || value.length > 300 || value.includes("\\") || !value.startsWith("/") || value.startsWith("//")) return "/";
  try {
    const url = new URL(value, "https://local.invalid");
    if (!RETURN_PATHS.includes(url.pathname) || url.hash || [...url.searchParams.keys()].some((key) => !["tanggal", "q", "hari", "tugas"].includes(key))) return "/";
    if (url.searchParams.has("hari") && !/^\d{1,2}$/.test(url.searchParams.get("hari") ?? "")) return "/";
    if (url.searchParams.has("tugas") && !["terbuka", "terlambat", "kendala", "tanpa_balasan"].includes(url.searchParams.get("tugas") ?? "")) return "/";
    if (url.searchParams.has("tanggal") && !/^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("tanggal") ?? "")) return "/";
    return `${url.pathname}${url.search}`;
  } catch { return "/"; }
}
