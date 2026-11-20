import { KREDENSIAL_DOCUMENTS } from "@/lib/kredensial/kredensial-data";
import { DirectorApiError } from "../director/director-api";
import type { StorageConfiguration } from "@/lib/storage/supabase-storage";

export { storageConfiguration, type StorageConfiguration } from "@/lib/storage/supabase-storage";

/** Private Supabase Storage bucket that holds the BPJS credentialing files; nothing under public/ any more. */
export const KREDENSIAL_BUCKET = "kredensial";
/** Session-gated route that redirects to a short-lived signed URL. */
export const KREDENSIAL_API_PREFIX = "/api/director/kredensial/";
export const SIGNED_URL_SECONDS = 600;

const documentPaths = new Set(KREDENSIAL_DOCUMENTS.map((doc) => doc.rel_path));

/** The object path when the segments name a document in the index, else null: an allowlist, so no traversal or probing. */
export function documentPath(segments: string[]): string | null {
  const path = segments.join("/");
  return documentPaths.has(path) ? path : null;
}

const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

/** Asks Storage to sign `path` in the private bucket; the answer is absolute and expires after `expiresIn` seconds. */
export async function signedFileUrl(path: string, options: StorageConfiguration & { transport?: typeof fetch; expiresIn?: number; download?: string }): Promise<string> {
  const { origin, secret, transport = fetch, expiresIn = SIGNED_URL_SECONDS, download } = options;
  const base = `${origin}/storage/v1`;
  let signedURL: unknown;
  try {
    const response = await transport(`${base}/object/sign/${KREDENSIAL_BUCKET}/${encodePath(path)}`, {
      method: "POST",
      headers: { apikey: secret, Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
    ({ signedURL } = (await response.json()) as { signedURL?: unknown });
  } catch {
    throw new DirectorApiError(503, "Penyimpanan berkas belum tersedia. Coba lagi nanti.");
  }
  if (typeof signedURL !== "string" || !signedURL.startsWith(`/object/sign/${KREDENSIAL_BUCKET}/`)) throw new DirectorApiError(503, "Penyimpanan berkas belum tersedia. Coba lagi nanti.");
  return `${base}${signedURL}${download ? `&download=${encodeURIComponent(download)}` : ""}`;
}
