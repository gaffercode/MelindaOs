import schemaDocument from "../../schemas/news-edition-v1.schema.json";
import { DAILY_DOCUMENT_MAX_BYTES } from "../daily/daily-documents";
import {
  assertPublication,
  jsonByteLength,
  matchClosedSchema,
  PublisherValidationError,
  type CountMetric,
  type DocumentProvenance,
} from "../publisher-contract";

export type NewsStory = {
  kicker: string;
  headline: string;
  deck: string;
  byline: string;
  image: string | null;
  imageAlt: string | null;
  paragraphs: string[];
  editorNote: string;
  sourceUrl: string;
  sourceName: string;
};
export type NewsForecast = { day: string; label: string; high: CountMetric; low: CountMetric };
export type NewsWeather = {
  summary: string;
  high: CountMetric;
  low: CountMetric;
  image: string | null;
  imageAlt: string | null;
  forecast: NewsForecast[];
  sourceUrl: string;
  sourceName: string;
  observedAt: string;
  cutoff: string | null;
};
export type NewsWatch = { org: string; text: string; sourceUrl: string; sourceName: string };
export type NewsDeadline = { when: string; title: string; note: string; org: string; sourceUrl: string; sourceName: string };
export type NewsRegulasi = { kicker: string; title: string; summary: string; status: string; sourceUrl: string; sourceName: string };
export type NewsEditionDocument = {
  schemaVersion: 1;
  date: string;
  edition: {
    volume: string;
    number: string;
    city: string;
    publishedAt: string;
    tagline: string;
    pdfUrl: string | null;
    lead: NewsStory | null;
    weather: NewsWeather | null;
    watchlist: NewsWatch[];
    deadlines: NewsDeadline[];
    regulasi: NewsRegulasi[];
    inbox: NewsStory[];
  };
  provenance: DocumentProvenance;
};

/** Parse an untrusted news edition. Every cited item must carry an https source. */
export function parseNewsEdition(value: unknown): NewsEditionDocument {
  if (jsonByteLength(value, "document") > DAILY_DOCUMENT_MAX_BYTES) throw new PublisherValidationError("document.size");
  matchClosedSchema(value, schemaDocument, "document");
  const edition = value as NewsEditionDocument;
  assertPublication(edition, "document");
  return edition;
}

export { PublisherValidationError };
