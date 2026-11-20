/** Supabase Storage connection shared by the private buckets (kredensial, hrd). Server-side only: it holds the service key. */
export interface StorageConfiguration { origin: string; secret: string }

/** Same env and same https rule as the Director store; null when Storage is not configured. */
export function storageConfiguration(env: NodeJS.ProcessEnv = process.env): StorageConfiguration | null {
  const secret = env.MELINDAOS_SUPABASE_SECRET_KEY ?? "";
  let url: URL;
  try { url = new URL(env.MELINDAOS_SUPABASE_URL ?? ""); } catch { return null; }
  const localHttp = !env.VERCEL && env.MELINDAOS_ALLOW_LOCAL_HTTP === "1";
  const httpsOk = url.protocol === "https:" || (localHttp && url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname));
  if (!secret || !httpsOk || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
  return { origin: url.origin, secret };
}
