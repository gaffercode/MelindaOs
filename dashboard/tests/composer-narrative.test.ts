import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectFacts, type Fact } from "@/lib/composer/facts";
import { decisionCode } from "@/lib/composer/grounding";
import { writeNarrative } from "@/lib/composer/narrative";
import { snapshot } from "./fixtures/medify-snapshot";

const facts = detectFacts(snapshot({ bed: [46, 50] }));
const texts = { serviceSummary: "BOR 92% di atas batas 85%.", safetyQuality: "Mutu terjaga.", pharmacy: "Stok stabil.", staffing: "Tidak ada perubahan.", decisions: [], conclusion: ["Okupansi tinggi.", "Perlu perhatian."] };
const jsonReply = (value: unknown) => async () => Response.json({ content: [{ type: "text", text: JSON.stringify(value) }], stop_reason: "end_turn" });

let calls: { url: string; init: RequestInit }[];
let reply: () => Promise<Response>;

beforeEach(() => {
  calls = [];
  reply = jsonReply(texts);
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-anthropic-key");
  vi.stubEnv("MELINDAOS_CLAUDE_API_KEY", "");
  vi.stubEnv("MELINDAOS_BRIEF_MODEL", "");
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => { calls.push({ url, init }); return reply(); });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});
const infoLines = (code: string) => vi.mocked(console.info).mock.calls.map(([line]) => JSON.parse(String(line))).filter((line) => line.code === code);
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("writeNarrative", () => {
  it("returns null when the model call fails", async () => {
    reply = async () => new Response("", { status: 500 });
    expect(await writeNarrative(facts)).toBeNull();
  });
  it("returns null without throwing when no API key is configured", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(await writeNarrative(facts)).toBeNull();
  });
  it("returns null when the reply is not the expected JSON", async () => {
    reply = async () => Response.json({ content: [{ type: "text", text: "bukan json" }], stop_reason: "end_turn" });
    expect(await writeNarrative(facts)).toBeNull();
    reply = jsonReply({ ...texts, pharmacy: 5 });
    expect(await writeNarrative(facts)).toBeNull();
  });
  it("drops only the paragraph that states an unknown number", async () => {
    reply = jsonReply({ ...texts, safetyQuality: "Ada 999 kasus." });
    const n = (await writeNarrative(facts))!;
    expect(n.serviceSummary).toContain("92");
    expect(n.safetyQuality).toBeNull();
    expect(n.pharmacy).toBe("Stok stabil.");
  });
  it("logs the kept and dropped counts once, without any text", async () => {
    reply = jsonReply({ ...texts, safetyQuality: "Ada 999 kasus.", staffing: "", decisions: [{ factId: "ambang:bor", keputusan: "Buka bed cadangan.", rekomendasi: "" }, { factId: "tidak:ada", keputusan: "Abaikan.", rekomendasi: "" }], conclusion: ["Okupansi tinggi.", "", "Naik 555 poin."] });
    await writeNarrative(facts);
    // The blank staffing paragraph and the blank conclusion line count as neither kept nor dropped.
    expect(infoLines("ai_brief_checked")).toEqual([{ level: "info", code: "ai_brief_checked", paragraphsKept: 2, paragraphsDropped: 1, decisionsKept: 1, decisionsDropped: 1, conclusionKept: 1, conclusionDropped: 1 }]);
  });
  it("drops a paragraph that holds a control character the brief contract rejects", async () => {
    reply = jsonReply({ ...texts, pharmacy: "Stok stabil.", staffing: "Tidak ada	perubahan." });
    const n = (await writeNarrative(facts))!;
    expect(n.pharmacy).toBeNull();
    expect(n.staffing).toBe("Tidak ada	perubahan.");
    expect(infoLines("ai_brief_checked")[0]).toMatchObject({ paragraphsKept: 3, paragraphsDropped: 1 });
  });
  it("keeps one decision per real fact and gives it a stable code", async () => {
    reply = jsonReply({ ...texts, decisions: [
      { factId: "ambang:bor", keputusan: "Buka bed cadangan.", rekomendasi: "Koordinasi dengan keperawatan." },
      { factId: "ambang:bor", keputusan: "Tunda operasi elektif.", rekomendasi: "" },
      { factId: "tidak:ada", keputusan: "Abaikan.", rekomendasi: "" },
    ] });
    const n = (await writeNarrative(facts))!;
    expect(n.decisions).toEqual([{ kode: decisionCode("ambang:bor"), keputusan: "Buka bed cadangan.", rekomendasi: "Koordinasi dengan keperawatan." }]);
  });
  it("checks a paragraph against the facts of its own section only", async () => {
    // 92 is the BOR of section 02; 69 is the active staff count of section 05.
    reply = jsonReply({ ...texts, staffing: "Pegawai aktif 69 orang, BOR 92%.", pharmacy: "Pegawai aktif 69 orang." });
    const n = (await writeNarrative(facts))!;
    expect(n.serviceSummary).toContain("92");
    expect(n.staffing).toBeNull();
    expect(n.pharmacy).toBeNull();
    reply = jsonReply({ ...texts, staffing: "Pegawai aktif 69 orang." });
    expect((await writeNarrative(facts))!.staffing).toBe("Pegawai aktif 69 orang.");
  });
  it("checks a decision against the one fact it cites", async () => {
    reply = jsonReply({ ...texts, decisions: [
      { factId: "ambang:bor", keputusan: "Meninjau kapasitas karena pegawai aktif 69 orang.", rekomendasi: "" },
      { factId: "keadaan:staff_active", keputusan: "Meninjau kebutuhan 69 pegawai aktif.", rekomendasi: "" },
    ] });
    expect((await writeNarrative(facts))!.decisions.map((item) => item.kode)).toEqual([decisionCode("keadaan:staff_active")]);
  });
  it("drops a decision or conclusion line that states an unknown number", async () => {
    reply = jsonReply({ ...texts, decisions: [{ factId: "ambang:bor", keputusan: "Tambah 777 bed.", rekomendasi: "" }], conclusion: ["Okupansi tinggi.", "Naik 555 poin."] });
    const n = (await writeNarrative(facts))!;
    expect(n.decisions).toEqual([]);
    expect(n.conclusion).toEqual(["Okupansi tinggi."]);
  });
  it("drops an over-long paragraph, decision or conclusion line and keeps the rest", async () => {
    const long = "Kalimat sintetis. ".repeat(40);
    reply = jsonReply({ ...texts, pharmacy: long, decisions: [{ factId: "ambang:bor", keputusan: long, rekomendasi: "" }], conclusion: [long, "Okupansi tinggi."] });
    const n = (await writeNarrative(facts))!;
    expect(n.pharmacy).toBeNull();
    expect(n.staffing).toBe("Tidak ada perubahan.");
    expect(n.decisions).toEqual([]);
    expect(n.conclusion).toEqual(["Okupansi tinggi."]);
  });
  it("keeps at most 3 conclusion lines and 5 decisions", async () => {
    const many = Array.from("abcdef", (letter): Fact => ({ id: `data:${letter}`, kind: "data", metric: null, section: "dataLimitations", severity: "info", values: [], text: "Data sintetis." }));
    reply = jsonReply({ ...texts, conclusion: ["Satu.", "Dua.", "Tiga.", "Empat."], decisions: many.map((fact) => ({ factId: fact.id, keputusan: `Keputusan ${fact.id}.`, rekomendasi: "" })) });
    const n = (await writeNarrative(many))!;
    expect(n.conclusion).toEqual(["Satu.", "Dua.", "Tiga."]);
    expect(n.decisions.map((item) => item.keputusan)).toEqual(many.slice(0, 5).map((fact) => `Keputusan ${fact.id}.`));
  });
  it("drops a paragraph that looks like it names a patient", async () => {
    reply = jsonReply({ ...texts, staffing: "Ny. Sintetis dirawat di ruang A." });
    expect((await writeNarrative(facts))!.staffing).toBeNull();
  });
  it("sends only the facts, on the default model, with fallbacks on", async () => {
    await writeNarrative(facts);
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body.model).toBe("claude-opus-5-5");
    expect(body.fallbacks).toBe("default");
    expect(body.messages[0].content).toContain("ambang:bor");
    const sent: { id: string; bagian: string }[] = JSON.parse(body.messages[0].content);
    expect(sent.every((fact) => Object.keys(fact).sort().join() === "bagian,id,severity,text")).toBe(true);
    // Each fact names the reply key it belongs to; section 04 is written under "pharmacy".
    expect(sent.find((fact) => fact.id === "ambang:bor")!.bagian).toBe("serviceSummary");
    expect(sent.find((fact) => fact.id === "penyumbang:outpatient.byPayer")!.bagian).toBe("pharmacy");
    expect(sent.find((fact) => fact.id === "data:staff.mismatch")!.bagian).toBe("staffing");
    expect(body.output_config.format.type).toBe("json_schema");
    expect(JSON.stringify(body.output_config.format.schema)).not.toMatch(/maxLength|minItems|maxItems/);
  });
});
