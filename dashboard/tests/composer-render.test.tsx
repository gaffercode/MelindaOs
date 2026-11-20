import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MelindaBriefGate } from "@/components/melinda-brief/melinda-brief-gate";
import { composeBrief } from "@/lib/composer/compose";
import { detectFacts } from "@/lib/composer/facts";
import { decisionCode } from "@/lib/composer/grounding";
import type { Narrative } from "@/lib/composer/narrative";
import type { DashScheduleForBrief } from "@/lib/dash-schedule-brief";
import type { MelindaManagementMorningBrief } from "@/lib/melinda/melinda-brief-data";
import { snapshot } from "./fixtures/medify-snapshot";

const dash = vi.hoisted(() => ({ schedule: null as DashScheduleForBrief }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/dash-schedule-brief", () => ({ readDashScheduleForBrief: async () => dash.schedule }));

const medify = snapshot({ bed: [46, 50], nullSections: ["inpatientMix"], runUnavailable: ["inpatientMix"] });
const facts = detectFacts(medify);
const narrative: Narrative = {
  serviceSummary: "Okupansi rawat inap tinggi pada hari lengkap terakhir.",
  safetyQuality: "Mutu dan keselamatan tidak menunjukkan eksepsi baru.",
  pharmacy: "Nilai stok farmasi tercatat per gudang.",
  staffing: "Jumlah pegawai menurut jenis tercatat tanpa perubahan.",
  decisions: [
    { kode: decisionCode("ambang:bor"), keputusan: "Tinjau kapasitas tempat tidur cadangan.", rekomendasi: "Koordinasikan dengan kepala ruang." },
    { kode: decisionCode("data:inpatientMix"), keputusan: "Minta ulang tarikan komposisi rawat inap.", rekomendasi: "Hubungi pengelola Medify." },
  ],
  conclusion: ["Okupansi perlu dipantau hari ini.", "Satu tarikan data perlu diulang."],
};
const brief = composeBrief({ snapshot: medify, facts, narrative, openInstructions: [{ id: "IOC-0042", title: "Evaluasi kontrak vendor linen", pic: ["Sintetis A"] }] });

const dirs: string[] = [];
async function renderHome(overrides: Partial<MelindaManagementMorningBrief> = {}): Promise<string> {
  const dir = (name: string) => {
    const path = mkdtempSync(join(tmpdir(), `composer-render-${name}-`));
    dirs.push(path);
    return path;
  };
  const [briefDir, medifyDir] = [dir("brief"), dir("medify")];
  writeFileSync(join(briefDir, `${brief.dateIso}.json`), JSON.stringify({ ...brief, ...overrides }), "utf8");
  writeFileSync(join(medifyDir, `${medify.date}.json`), JSON.stringify(medify), "utf8");
  vi.stubEnv("MELINDAOS_DIRECTOR_STORE", "file");
  vi.stubEnv("MELINDAOS_MELINDA_BRIEF_DIR", briefDir);
  vi.stubEnv("MELINDAOS_MEDIFY_DIR", medifyDir);
  vi.stubEnv("MELINDAOS_MEDIFY_RUN_STATUS_DIR", dir("run"));
  vi.stubEnv("MELINDAOS_SIMRS_DIR", dir("simrs"));
  return renderToStaticMarkup(await MelindaBriefGate({ date: brief.dateIso }));
}
const between = (html: string, from: string, to: string) => {
  const start = html.indexOf(from);
  return start < 0 ? "" : html.slice(start, html.indexOf(to, start));
};
/** The page without what sits behind a closed "Sumber data" icon. */
const openText = (html: string) => html.replace(/<details class="source-info">.*?<\/details>/gs, "");

afterEach(() => {
  vi.unstubAllEnvs();
  dash.schedule = null;
  for (const path of dirs.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("a composed brief rendered on the home page", () => {
  it("shows the parts of the composed brief that must stay visible", async () => {
    const html = await renderHome();
    // The gate read the stored snapshot: section 02 shows rows derived from it.
    expect(html).toContain(">Hunian tempat tidur</td>");
    // The bed fact states the same figures as that row, and the SATUSEHAT fact is listed as an exception in section 03.
    const [occupied, capacity, bor] = facts.find((fact) => fact.id === "ambang:bor")!.values;
    expect(html).toContain(`${occupied}/${capacity} terisi · BOR ${bor}%`);
    // The page respells the name ("SatuSehat"), so the row is matched from the figures on.
    expect(between(html, 'id="brief-03"', 'id="brief-04"')).toContain(facts.find((fact) => fact.id === "ambang:satusehat")!.text.split("Medify ")[1]);
    const heading02 = between(html, 'id="section-02"', "</h2>");
    expect(heading02).toContain("Ringkasan layanan");
    expect(heading02).not.toContain(brief.date);
    for (const decision of narrative.decisions) {
      expect(html).toContain(decision.keputusan);
      expect(html).toContain(decision.kode);
    }
    for (const line of narrative.conclusion) expect(html).toContain(line);
    expect(html).toContain("Angka keuangan Medify belum ditampilkan");
    expect(html).toContain("Evaluasi kontrak vendor linen");
    expect(html).toContain("Tarikan komposisi rawat inap gagal");
    expect(html).not.toContain("inpatientMix");
  });

  it("shows each section's analysis in the open page, not behind the source icon", async () => {
    const open = openText(await renderHome());
    expect(between(open, 'id="brief-02"', 'id="brief-03"')).toContain(narrative.serviceSummary);
    expect(between(open, 'id="brief-03"', 'id="brief-04"')).toContain(narrative.safetyQuality);
    expect(between(open, 'id="brief-04"', 'id="brief-05"')).toContain(narrative.pharmacy);
    expect(between(open, 'id="brief-05"', 'id="brief-06"')).toContain(narrative.staffing);
    // The section's source note keeps its place behind the icon.
    expect(open).not.toContain("Usulan otomatis; berlaku setelah Direktur memutuskan.");
  });

  it("says the schedule has not arrived when neither Dash nor the brief has rows", async () => {
    dash.schedule = { items: [] };
    const section01 = between(await renderHome(), 'id="brief-01"', 'id="brief-02"');
    expect(section01).toContain("Jadwal hari ini belum dikirim Dash.");
    expect(section01).not.toContain("menampilkan jadwal dari brief");
  });

  it("shows how an automatic brief was produced, with the model called", async () => {
    const html = await renderHome({ composer: { outcome: "stored", at: "2026-10-23T22:30:00.000Z", modelCalled: true, facts: 7, decisions: 2 } });
    expect(html).toContain("Brief otomatis · 7 fakta · 2 keputusan");
    expect(html).toContain("model dipanggil");
    expect(html).not.toContain("model tidak dipanggil");
  });

  it("says the model was not called for a stored brief without analysis", async () => {
    const html = await renderHome({ composer: { outcome: "stored_without_analysis", at: "2026-10-23T22:30:00.000Z", modelCalled: false, facts: 4, decisions: 0 } });
    expect(html).toContain("Brief otomatis · 4 fakta · 0 keputusan");
    expect(html).toContain("model tidak dipanggil");
  });
});
