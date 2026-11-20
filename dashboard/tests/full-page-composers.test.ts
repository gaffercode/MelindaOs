import { describe, expect, it } from "vitest";
import { composeFullExecutiveBrief } from "../lib/composer/compose";
import { parseMelindaBrief } from "../lib/melinda/melinda-brief-contract";
import { composeNewsEdition } from "../lib/news/news-composer";
import { parseNewsEdition } from "../lib/news/news-edition-contract";

describe("full-page-composers", () => {
  it("composes a complete Management Morning Brief for / even without a Medify snapshot or AI narrative", () => {
    const brief = composeFullExecutiveBrief({
      date: "2026-11-19",
      snapshot: null,
      facts: [],
      narrative: null,
      instructions: [],
      roleId: "direktur",
    });

    const parsed = parseMelindaBrief(brief);
    expect(parsed.schedule.items.length).toBeGreaterThanOrEqual(8);
    expect(parsed.schedule.items.some((i) => i.kegiatan.toLowerCase().includes("keuangan"))).toBe(true);
    expect(parsed.safetyQuality.exceptions.length).toBeGreaterThanOrEqual(1);
    expect(parsed.claimsFinance.items.length).toBeGreaterThanOrEqual(1);
    expect(parsed.staffing.items.length).toBeGreaterThanOrEqual(1);
    expect(parsed.systemFindings.items.length).toBeGreaterThanOrEqual(1);
    expect(parsed.emailTriage.data).not.toBeNull();
    expect(parsed.decisions.items.length).toBeGreaterThanOrEqual(1);
    expect(parsed.followUps.items.length).toBeGreaterThanOrEqual(1);
    expect(parsed.conclusion.paragraphs.length).toBeGreaterThanOrEqual(1);
  });

  it("composes a schema-valid The Gaffer Times daily news edition for /berita", () => {
    const edition = composeNewsEdition({
      date: "2026-11-19",
      snapshot: null,
      instructions: [],
    });

    const parsed = parseNewsEdition(edition);
    expect(parsed.date).toBe("2026-11-19");
    expect(parsed.edition.lead).not.toBeNull();
    expect(parsed.edition.weather).not.toBeNull();
    expect(parsed.edition.watchlist.length).toBeGreaterThanOrEqual(3);
    expect(parsed.edition.deadlines.length).toBeGreaterThanOrEqual(3);
    expect(parsed.edition.regulasi.length).toBeGreaterThanOrEqual(3);
    expect(parsed.edition.inbox.length).toBeGreaterThanOrEqual(2);
  });
});
