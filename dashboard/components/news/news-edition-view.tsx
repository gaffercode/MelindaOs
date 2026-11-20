import type { ReactNode } from "react";
import { longDate, validReportDate } from "@/lib/director/director-data";
import type { NewsStory } from "@/lib/news/news-edition-contract";
import { readNewsEdition } from "@/lib/news/news-edition-store";
import type { NewsEditionResult } from "@/lib/news/news-edition-store";
import { readLatestNessNews, type NessNewsResult } from "@/lib/ness-news";
import { metricText, PublicationNote } from "@/components/publication-facts";
import { ExecutiveSyncBar } from "../work-schedule/executive-sync-bar";
import { Info } from "lucide-react";

function SourceLine({ name, url }: { name: string; url: string }) {
  return <details className="published-source"><summary><Info size={14} aria-hidden="true" /><span>Info sumber</span></summary><p>{name} · <a href={url} rel="noreferrer" target="_blank">Buka sumber</a></p></details>;
}

/** The one place a publisher's image is drawn. It keeps its width and height so the page does not shift while it loads. */
function NewsImage({ src, alt, width, height }: { src: string; alt: string | null; width: number; height: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="koran-image" src={src} alt={alt ?? ""} width={width} height={height} />;
}

/**
 * The paper's nameplate, shared by every state of the page (full edition, a single Ness item, no edition): the ears
 * above the title carry the edition's own facts, the dateline under it carries the date and the PDF.
 */
function Nameplate({ date, ears, tagline, action }: { date: string | null; ears?: [string, string, string]; tagline?: string; action?: ReactNode }) {
  return (
    <header className="koran-nameplate">
      {ears ? <p className="koran-ears"><span>{ears[0]}</span><span>{ears[1]}</span><span>{ears[2]}</span></p> : null}
      <h1 className="koran-title">Warta &amp; Regulasi</h1>
      {tagline ? <p className="koran-tagline">{tagline}</p> : null}
      <div className="koran-dateline">
        {date ? <time dateTime={date}>{longDate(date)}</time> : <span>Tanggal tidak valid</span>}
        <span>RSIA Melinda DHAI</span>
        {action ?? <span aria-hidden="true" />}
      </div>
    </header>
  );
}

function Story({ story, lead = false }: { story: NewsStory; lead?: boolean }) {
  return (
    <article className={lead ? "koran-story koran-story-lead" : "koran-story"}>
      <p className="koran-kicker">{story.kicker}</p>
      <h3 className="koran-headline">{story.headline}</h3>
      <p className="koran-deck">{story.deck}</p>
      <div className="koran-byline"><span>{story.byline}</span><SourceLine name={story.sourceName} url={story.sourceUrl} /></div>
      {story.image ? <NewsImage src={story.image} alt={story.imageAlt} width={1563} height={480} /> : null}
      <div className="koran-body">
        {story.paragraphs.map((paragraph) => <p key={paragraph.slice(0, 40)}>{paragraph}</p>)}
      </div>
      {story.editorNote ? <p className="koran-editor"><strong>Ringkasan editor.</strong> {story.editorNote}</p> : null}
    </article>
  );
}

export function NewsEditionView({ result }: { result: Extract<NewsEditionResult, { status: "current" }> }) {
  const edition = result.document.edition;
  const weather = edition.weather;
  return (
    <article className="published-report published-news koran">
      <Nameplate
        date={result.document.date}
        ears={[`Vol. ${edition.volume}, No. ${edition.number}`, edition.city, `Terbit ${edition.publishedAt}`]}
        tagline={edition.tagline}
        action={edition.pdfUrl ? <a className="koran-pdf" href={edition.pdfUrl} target="_blank" rel="noreferrer">Unduh PDF edisi</a> : undefined}
      />
      <section className="koran-front" aria-labelledby="koran-utama">
        <div className="koran-lead">
          <h2 id="koran-utama" className="koran-flag">Berita utama</h2>
          {edition.lead ? <Story story={edition.lead} lead /> : <p role="status">Tidak tersedia. Tidak ada berita utama pada edisi ini.</p>}
        </div>
        <aside className="koran-rail" aria-label="Cuaca dan pantauan">
          <section className="koran-box">
            <h2 className="koran-flag">Cuaca</h2>
            {weather ? (
              <>
                <p className="koran-temp">{metricText(weather.high)}° / {metricText(weather.low)}°<span>Tertinggi / Terendah</span></p>
                <p>{weather.summary}</p>
                {weather.image ? <NewsImage src={weather.image} alt={weather.imageAlt} width={738} height={318} /> : null}
                {weather.forecast.length ? (
                  <ul className="koran-forecast">
                    {weather.forecast.map((day) => <li key={day.day}><strong>{day.day}</strong><span>{day.label}</span><em>{metricText(day.high)} / {metricText(day.low)}</em></li>)}
                  </ul>
                ) : <p role="status">Prakiraan harian tidak tersedia.</p>}
                <SourceLine name={weather.sourceName} url={weather.sourceUrl} />
              </>
            ) : <p role="status">Tidak tersedia. Cuaca tidak ada pada edisi ini.</p>}
          </section>
          <section className="koran-box">
            <h2 className="koran-flag">Perlu dilihat</h2>
            {edition.watchlist.length ? (
              <ul className="koran-watch">
                {edition.watchlist.map((item) => <li key={`${item.org}-${item.sourceUrl}-${item.text.slice(0, 24)}`}><strong>{item.org}</strong><span>{item.text}</span><SourceLine name={item.sourceName} url={item.sourceUrl} /></li>)}
              </ul>
            ) : <p role="status">Tidak tersedia. Tidak ada butir pantauan pada edisi ini.</p>}
          </section>
        </aside>
      </section>
      <section className="koran-section" aria-labelledby="koran-tempo">
        <h2 id="koran-tempo" className="koran-flag">Jatuh tempo</h2>
        {edition.deadlines.length ? (
          <ul className="koran-agenda">
            {edition.deadlines.map((item) => (
              <li key={`${item.when}-${item.title}`}>
                <time>{item.when}</time>
                <div><strong>{item.title}</strong><p>{item.note}</p><SourceLine name={item.sourceName} url={item.sourceUrl} /></div>
                <span className="koran-org">{item.org}</span>
              </li>
            ))}
          </ul>
        ) : <p role="status">Tidak tersedia. Tidak ada jatuh tempo pada edisi ini.</p>}
      </section>
      <section className="koran-section" aria-labelledby="koran-regulasi">
        <h2 id="koran-regulasi" className="koran-flag">Radar regulasi &amp; kepatuhan</h2>
        {edition.regulasi.length ? (
          <ul className="koran-briefs">
            {edition.regulasi.map((item) => (
              <li key={item.title}><p className="koran-kicker">{item.kicker}</p><h3>{item.title}</h3><p>{item.summary}</p><span className="koran-status">{item.status}</span><SourceLine name={item.sourceName} url={item.sourceUrl} /></li>
            ))}
          </ul>
        ) : <p role="status">Tidak tersedia. Tidak ada regulasi pada edisi ini.</p>}
      </section>
      <section className="koran-section" aria-labelledby="koran-kotak">
        <h2 id="koran-kotak" className="koran-flag">Kotak masuk</h2>
        {edition.inbox.length ? <div className="koran-inbox">{edition.inbox.map((story) => <Story key={story.headline} story={story} />)}</div> : <p role="status">Tidak tersedia. Kotak masuk edisi ini kosong.</p>}
      </section>
      <footer className="koran-colophon">
        <PublicationNote provenance={result.document.provenance} revisionId={result.revisionId} payloadHash={result.payloadHash} receivedAt={result.receivedAt} producer={result.producer} />
      </footer>
    </article>
  );
}

export function NessNewsView({ result }: { result: NessNewsResult }) {
  return (
    <article className="published-report published-news koran" aria-label="Warta Ness terbaru">
      <Nameplate date={result.item.date} />
      <section className="koran-section koran-solo" aria-labelledby="koran-ness">
        <h2 id="koran-ness" className="koran-flag">Warta Ness</h2>
        <article className="koran-story koran-story-lead">
          <p className="koran-kicker">Otomatis oleh NESS</p>
          <h3 className="koran-headline">{result.item.title}</h3>
          <div className="koran-byline"><span>Ness</span><SourceLine name="Ness" url={result.item.sourceUrl} /></div>
          <div className="koran-body">
            {result.item.summary.split(/\n+/).filter((paragraph) => paragraph.trim()).map((paragraph, index) => <p key={index}>{paragraph}</p>)}
          </div>
        </article>
      </section>
    </article>
  );
}

export async function NewsEditionGate({ date }: { date: string }) {
  const result = validReportDate(date) ? await readNewsEdition(date) : { status: "invalid" as const, message: "Tanggal tidak valid. Tidak ada data contoh yang ditampilkan." };
  if (result.status === "current") {
    return (
      <>
        <div className="mb-4"><ExecutiveSyncBar date={date} label="Sinkronkan warta hari ini" /></div>
        <NewsEditionView result={result} />
      </>
    );
  }
  if (validReportDate(date)) {
    const ness = await readLatestNessNews(date);
    if (ness) return <NessNewsView result={ness} />;
  }
  return (
    <article className="published-report published-news koran" aria-label="Status edisi">
      <Nameplate date={validReportDate(date) ? date : null} action={validReportDate(date) ? <ExecutiveSyncBar date={date} label="Sinkronkan warta hari ini" /> : undefined} />
      <section className="koran-section">
        <p role="status" className={result.status === "invalid" ? "director-notice director-error" : "director-notice"}>{result.message}</p>
        <p>Tanggal diminta: {validReportDate(date) ? longDate(date) : date}. Edisi diterbitkan melalui <code>POST /api/director/news-edition</code> atau tombol sinkronisasi di atas. Arsip lokal tidak ditampilkan sebagai pengganti.</p>
      </section>
    </article>
  );
}
