import { DirectorApiError } from "../director/director-api";
import { storageConfiguration, type StorageConfiguration } from "../kredensial/kredensial-storage";

/** Private Supabase Storage bucket for the Director's Order obat uploads (migration 202611090001). */
export const ORDER_OBAT_BUCKET = "order-obat";
export const ORDER_OBAT_MAX_BYTES = 15 * 1024 * 1024;
export const SIGNED_URL_SECONDS = 600;

export type OrderFileKind = "csv" | "pdf" | "xlsx" | "other";

export { storageConfiguration };

const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");
const unavailable = () => new DirectorApiError(503, "Penyimpanan berkas belum tersedia. Coba lagi nanti.");

function storageHeaders(secret: string): Record<string, string> {
  return { apikey: secret, Authorization: `Bearer ${secret}` };
}

/** The file's kind from its bytes, never from the browser's content type: `%PDF`, a zip (xlsx), or text that parses as CSV. */
export function detectKind(bytes: Uint8Array<ArrayBuffer>, fileName: string): OrderFileKind {
  if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "pdf";
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return /\.xlsx?$/i.test(fileName) ? "xlsx" : "other";
  const sample = bytes.subarray(0, Math.min(bytes.length, 4096));
  const binary = sample.some((byte) => byte === 0 || (byte < 0x09) || (byte > 0x0d && byte < 0x20));
  if (!binary && /\.(csv|txt)$/i.test(fileName)) return "csv";
  return "other";
}

/** A safe object name: `YYYY/MM/<sha prefix>-<sanitised file name>`; the client's name never reaches Storage verbatim. */
export function objectPath(sha256: string, fileName: string, now = new Date()): string {
  const year = now.getUTCFullYear(), month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const base = fileName.normalize("NFKD").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "berkas";
  return `${year}/${month}/${sha256.slice(0, 12)}-${base}`;
}

/** Uploads `bytes` to the private bucket; refuses to overwrite. */
export async function uploadObject(path: string, bytes: Uint8Array<ArrayBuffer>, contentType: string, options: StorageConfiguration & { transport?: typeof fetch }): Promise<void> {
  const { origin, secret, transport = fetch } = options;
  let status = 0;
  try {
    const response = await transport(`${origin}/storage/v1/object/${ORDER_OBAT_BUCKET}/${encodePath(path)}`, {
      method: "POST",
      headers: { ...storageHeaders(secret), "Content-Type": contentType, "x-upsert": "false" },
      body: new Blob([bytes]),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
    });
    status = response.status;
  } catch {
    throw unavailable();
  }
  if (status === 409) throw new DirectorApiError(409, "Berkas yang sama sudah pernah diunggah.");
  if (status !== 200) throw unavailable();
}

/** Removes an object after a failed metadata write so no orphan stays in the bucket; errors are swallowed. */
export async function deleteObject(path: string, options: StorageConfiguration & { transport?: typeof fetch }): Promise<void> {
  const { origin, secret, transport = fetch } = options;
  try {
    await transport(`${origin}/storage/v1/object/${ORDER_OBAT_BUCKET}/${encodePath(path)}`, { method: "DELETE", headers: storageHeaders(secret), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000) });
  } catch { /* best effort */ }
}

/** Asks Storage to sign `path`; the answer is absolute and expires after `expiresIn` seconds. */
export async function signedObjectUrl(path: string, options: StorageConfiguration & { transport?: typeof fetch; expiresIn?: number; download?: string }): Promise<string> {
  const { origin, secret, transport = fetch, expiresIn = SIGNED_URL_SECONDS, download } = options;
  const base = `${origin}/storage/v1`;
  let signedURL: unknown;
  try {
    const response = await transport(`${base}/object/sign/${ORDER_OBAT_BUCKET}/${encodePath(path)}`, {
      method: "POST",
      headers: { ...storageHeaders(secret), "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
    ({ signedURL } = (await response.json()) as { signedURL?: unknown });
  } catch {
    throw unavailable();
  }
  if (typeof signedURL !== "string" || !signedURL.startsWith(`/object/sign/${ORDER_OBAT_BUCKET}/`)) throw unavailable();
  return `${base}${signedURL}${download ? `&download=${encodeURIComponent(download)}` : ""}`;
}
