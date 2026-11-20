import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import type { StarkesPayload } from "@/components/starkes/use-starkes-data";
import { StarkesReadinessView } from "@/components/starkes/starkes-readiness-view";
import type { StarkesEvidence } from "@/lib/starkes/evidence-store";
import { loadKelulusan } from "@/lib/starkes/kelulusan";
import { loadRequirementRegister } from "@/lib/starkes/requirements";
import { parseStarkesTeams } from "@/lib/starkes/starkes-team";

let payload: StarkesPayload;
beforeAll(async () => {
  payload = { requirements: loadRequirementRegister().requirements, scores: [], evidence: [], rules: await loadKelulusan() };
});

const approvedD: StarkesEvidence = {
  id: "11111111-1111-4111-8111-111111111111", source: "drive", ref: "f1", chapter_code: "SKP", kind: "D", ep_ids: ["47104-2024:SKP:1:4"],
  name: "Audit gelang.pdf", mime: "application/pdf", web_link: "https://drive.google.com/f1", modified_at: "2026-11-01T00:00:00Z",
  matched_by: "ai", confidence: 0.8, phi_flag: false, status: "approved", decided_at: "2026-11-02T00:00:00Z",
};

describe("/starkes readiness view", () => {
  it("predicts tidak terakreditasi and shows no EP as complete without evidence", () => {
    const html = renderToStaticMarkup(<StarkesReadinessView initial={payload} />);
    expect(html).toContain('data-predicate="tidak_terakreditasi"');
    expect(html).not.toContain(">Lengkap<");
    expect(html).toContain("Target minimal: Utama · Target tinggi: Paripurna");
  });

  it("shows PPK as Tidak diterapkan", () => {
    const html = renderToStaticMarkup(<StarkesReadinessView initial={payload} />);
    expect(html).toContain('aria-label="PPK tidak diterapkan"');
  });

  it("fills the D chip once a D file is approved", () => {
    const html = renderToStaticMarkup(<StarkesReadinessView initial={{ ...payload, evidence: [approvedD] }} />);
    const row = html.slice(html.indexOf('data-ep="47104-2024:SKP:1:4"'));
    expect(row.slice(0, row.indexOf('data-ep="47104-2024:SKP:2:1"'))).toContain('class="sv-chip is-filled" data-kind="D"');
  });

  it("keeps the working-group lead and an Arahan link per chapter", () => {
    const html = renderToStaticMarkup(<StarkesReadinessView initial={payload} />);
    expect((html.match(/aria-label="Arahan untuk bab [^"]+"/g) ?? []).length).toBe(16);
    expect(html).toContain('aria-label="Arahan untuk bab PMKP"');
  });
});

describe("/starkes working groups", () => {
  // The real teams live in the private Supabase bucket `hrd`; tests use only the fictional sample.
  const teams = parseStarkesTeams(JSON.parse(readFileSync(join(process.cwd(), "data", "synthetic", "starkes-team.json"), "utf8")));

  it("shows each chapter lead, the open choice, and the committee where there is no working group", () => {
    expect(teams).not.toBeNull();
    const html = renderToStaticMarkup(<StarkesReadinessView initial={payload} teams={teams} />);
    expect(html).toContain("Contoh Ketua SKP");
    expect(html).toContain("Belum diputuskan: Contoh Kandidat A atau Contoh Kandidat B");
    expect(html).toContain("Panitia akreditasi");
  });

  it("says plainly when the teams could not be loaded", () => {
    const html = renderToStaticMarkup(<StarkesReadinessView initial={payload} />);
    expect(html).toContain("Data tim belum tersedia");
    expect(html).not.toContain("Contoh Ketua SKP");
  });

  it("rejects a teams document with a malformed entry", () => {
    expect(parseStarkesTeams({ chapters: { skp: { lead: 7, members: [] } } })).toBeNull();
    expect(parseStarkesTeams({ chapters: [] })).toBeNull();
  });
});
