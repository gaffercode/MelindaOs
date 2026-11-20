import { authConfiguration } from "./director/director-auth";
import { validReportDate } from "./director/director-data";
import { logError } from "./log";

/** Lightweight Warta ingest produced by the NESS agent (Mon–Fri 06.00/11.00/15.00 WIB). */
export const NESS_NEWS_KIND = "news.edition";
export const NESS_PRODUCER = "ness";

export interface NessNewsItem {
  title: string;
  summary: string;
  sourceUrl: string;
  date: string;
}

const EXPECTED_KEYS = ["title", "summary", "sourceUrl", "date"] as const;

function fail(message: string): never {
  throw new Error(message);
}

function hasControlChars(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code === 127 || (code < 32 && code !== 9 && code !== 10 && code !== 13)) return true;
  }
  return false;
}

/** Parse an untrusted NESS news item. Closed schema: these four keys and nothing else. */
export function parseNessNews(value: unknown): NessNewsItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("Format edisi Ness tidak valid.");
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== EXPECTED_KEYS.length || !EXPECTED_KEYS.every((key) => keys.includes(key))) fail("Format edisi Ness tidak valid.");
  const { title, summary, sourceUrl, date } = record;
  if (typeof title !== "string" || !title.trim() || title.length > 200 || hasControlChars(title)) fail("Judul edisi Ness tidak valid.");
  if (typeof summary !== "string" || !summary.trim() || summary.length > 1000 || hasControlChars(summary)) fail("Ringkasan edisi Ness tidak valid.");
  if (typeof sourceUrl !== "string" || sourceUrl.length > 2000) fail("Tautan sumber edisi Ness tidak valid.");
  try {
    if (new URL(sourceUrl).protocol !== "https:") fail("Tautan sumber edisi Ness tidak valid.");
  } catch {
    fail("Tautan sumber edisi Ness tidak valid.");
  }
  if (typeof date !== "string" || !validReportDate(date)) fail("Tanggal edisi Ness tidak valid.");
  return { title: title.trim(), summary: summary.trim(), sourceUrl, date };
}

export interface NessNewsResult {
  item: NessNewsItem;
  /** The exact stored payload (title, summary, sourceUrl, date) for audit display. */
  receivedAt: string;
  producer: string;
}

/**
 * Read the newest stored NESS item (received_at desc). Protected mode only;
 * file mode has no durable NESS store, so it reports null. Never throws.
 */
export async function readLatestNessNews(limitDate?: string): Promise<NessNewsResult | null> {
  try {
    const config = authConfiguration();
    if (!config) return null;
    const { records } = await config.store.call<{ records: Array<{ payload: unknown; received_at: string; producer: string }> }>(
      "data_list",
      { kind: NESS_NEWS_KIND, producer: null, since: null, limit: 20 },
      "melinda_agent_gateway",
    );
    if (!Array.isArray(records)) return null;
    for (const record of records) {
      try {
        const item = parseNessNews(record?.payload);
        if (limitDate && item.date > limitDate) continue;
        if (typeof record?.received_at !== "string" || typeof record?.producer !== "string") continue;
        return { item, receivedAt: record.received_at, producer: record.producer };
      } catch {
        continue;
      }
    }
    return null;
  } catch (error) {
    logError("ness_news_unavailable", error);
    return null;
  }
}
