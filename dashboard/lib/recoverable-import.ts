/**
 * A lazy chunk import that retries one failed load (a network blip), then resolves to `giveUp`'s value
 * instead of rejecting, so a missing chunk (an old tab after a deploy) never reaches an error page.
 */
export function recoverableImport<T>(load: () => Promise<T>, giveUp: () => T): () => Promise<T> {
  return () => load().catch(() => load()).catch(giveUp);
}
