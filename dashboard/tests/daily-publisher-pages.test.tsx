import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NessNewsView, NewsEditionGate } from "@/components/news/news-edition-view";
import newsFixture from "@/data/synthetic/news-edition.json";

afterEach(() => vi.unstubAllEnvs());

function emptyDirs() {
  const news = mkdtempSync(join(tmpdir(), "news-page-"));
  vi.stubEnv("MELINDAOS_DIRECTOR_STORE", "file");
  vi.stubEnv("MELINDAOS_NEWS_EDITION_DIR", news);
  return { news };
}

describe("stored daily pages", () => {
  it("keeps the route modules off the static fixtures", () => {
    const beritaPage = readFileSync(new URL("../app/berita/page.tsx", import.meta.url), "utf8");
    const newsView = readFileSync(new URL("../components/news/news-edition-view.tsx", import.meta.url), "utf8");
    expect(beritaPage + newsView).not.toContain("loadGafferEdition");
    expect(beritaPage + newsView).not.toContain("gaffer-times");
  });

  it("shows an empty berita date instead of the archived newspaper", async () => {
    emptyDirs();
    const berita = renderToStaticMarkup(await NewsEditionGate({ date: "2099-01-16" }));
    expect(berita).toContain("Belum ada edisi Warta");
    expect(berita).not.toContain("Calon Bidan");
    expect(berita).not.toContain("Edisi sintetis, bukan berita harian");
    expect(berita).toContain("POST /api/director/news-edition");
  });

  it("renders the stored synthetic edition for its own date only", async () => {
    const dirs = emptyDirs();
    writeFileSync(join(dirs.news, "2099-01-15.json"), JSON.stringify(newsFixture));
    const berita = renderToStaticMarkup(await NewsEditionGate({ date: "2099-01-15" }));
    expect(berita).toContain("Edisi sintetis, bukan berita harian");
    expect(berita).toContain("Butir sintetis, bukan regulasi");
    expect(berita).not.toContain("PDF edisi tidak tersedia");
    expect(berita).not.toContain("Gambar tidak tersedia");
    expect(berita).not.toContain("Calon Bidan");
    const other = renderToStaticMarkup(await NewsEditionGate({ date: "2099-01-16" }));
    expect(other).not.toContain("Edisi sintetis, bukan berita harian");
  });

  it("sets every berita state under one newspaper nameplate", async () => {
    const dirs = emptyDirs();
    writeFileSync(join(dirs.news, "2099-01-15.json"), JSON.stringify(newsFixture));
    const edition = renderToStaticMarkup(await NewsEditionGate({ date: "2099-01-15" }));
    const empty = renderToStaticMarkup(await NewsEditionGate({ date: "2099-01-16" }));
    const ness = renderToStaticMarkup(
      NessNewsView({
        result: {
          item: { title: "Judul uji Ness", summary: "Ringkasan uji Ness.\nParagraf kedua.", sourceUrl: "https://example.org/uji", date: "2099-01-15" },
          receivedAt: "2099-01-15T00:00:00.000Z",
          producer: "ness",
        },
      }),
    );
    for (const html of [edition, empty, ness]) {
      expect(html.match(/<h1[^>]*>Warta &amp; Regulasi<\/h1>/g)).toHaveLength(1);
      expect(html).toContain("koran-dateline");
    }
    expect(edition).toContain("Berita utama");
    expect(edition).toContain("koran-story-lead");
    expect(ness).toContain("Judul uji Ness");
    expect(ness).toContain("<p>Ringkasan uji Ness.</p><p>Paragraf kedua.</p>");
    expect(ness).toContain('href="https://example.org/uji"');
  });
});
