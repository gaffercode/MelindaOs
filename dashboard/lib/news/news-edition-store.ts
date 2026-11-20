import { readDailyDocument } from "../daily/daily-documents";
import { validReportDate } from "../director/director-data";
import { logError } from "../log";
import { parseNewsEdition, type NewsEditionDocument } from "./news-edition-contract";

export type NewsEditionResult =
  | { status: "current"; document: NewsEditionDocument; requestedDate: string; sourceDate: string; receivedAt: string; producer: string; payloadHash: string; revisionId: string; message: null }
  | { status: "missing" | "invalid"; document: null; requestedDate: string; sourceDate: null; receivedAt: null; producer: null; payloadHash: null; revisionId: null; message: string };

const empty = (date: string) => ({ requestedDate: date, sourceDate: null, receivedAt: null, producer: null, payloadHash: null, revisionId: null, document: null }) as const;

/** Read the news edition for this date only. The archived Gaffer Times file is not a fallback. */
export async function readNewsEdition(date: string): Promise<NewsEditionResult> {
  if (!validReportDate(date)) return { ...empty(date), status: "invalid", message: "Tanggal tidak valid. Tidak ada data contoh yang ditampilkan." };
  let read;
  try {
    read = await readDailyDocument("news_edition", date, 0);
  } catch (error) {
    logError("news_edition_read", error);
    return { ...empty(date), status: "invalid", message: "Edisi berita belum dapat dibaca dari penyimpanan. Tidak ada data contoh yang ditampilkan." };
  }
  if (!read.document) return { ...empty(date), status: "missing", message: "Belum ada edisi Warta & Regulasi yang dipublikasikan untuk tanggal ini." };
  try {
    const document = parseNewsEdition(read.document.payload);
    if (document.date !== read.document.report_date) throw new Error("date mismatch");
    return { status: "current", document, requestedDate: date, sourceDate: document.date, receivedAt: read.document.received_at, producer: read.document.producer, payloadHash: read.document.payload_hash, revisionId: read.document.id, message: null };
  } catch (error) {
    logError("news_edition_invalid", error);
    return { ...empty(date), status: "invalid", message: "Edisi untuk tanggal ini tidak lolos validasi. Dashboard tidak menampilkan isi yang tidak valid." };
  }
}
