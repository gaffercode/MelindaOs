import { describe, expect, it, vi } from "vitest";
import { ASK_ESCALATE_PHI, ASK_NOT_FOUND, ASK_UNAVAILABLE, ask } from "@/lib/ask/answer";
import { ASK_SYSTEM_PROMPT } from "@/lib/ask/prompt";
import { buildRetriever } from "@/lib/ask/retrieve";
import type { ClaudeOptions } from "@/lib/claude-client";
import type { KnowledgeChunk } from "@/lib/contracts";
import { DirectorApiError } from "@/lib/director/director-api";

const chunk = (id: string, title: string, headingPath: string[], text: string): KnowledgeChunk => ({ id, docId: id.split("#")[0], path: `knowledge/06_CLINICAL_SAFETY/${id.split("#")[0]}.md`, title, headingPath, text });

const corpus = [
  chunk("SPO-HPP#prosedur", "SPO Penatalaksanaan HPP", ["Prosedur"], "Pada HPP berikan oksitosin 10 IU intramuskular, lanjutkan infus oksitosin 20 IU dalam 500 ml."),
  chunk("SPO-SKP#gelang", "SPO Identifikasi Pasien", ["Prosedur", "Gelang"], "Petugas memasang gelang identitas pasien dengan nama lengkap dan tanggal lahir."),
  chunk("SPO-BESUK-2024#jam", "SPO Jam Besuk 2024", ["Jam besuk"], "Jam besuk rawat inap pukul 11.00-13.00."),
  chunk("SPO-BESUK-2026#jam", "SPO Jam Besuk 2026", ["Jam besuk"], "Jam besuk rawat inap pukul 16.00-18.00."),
];
const retriever = buildRetriever(corpus);
const reply = (value: unknown) => vi.fn(async (options: ClaudeOptions) => { void options; return JSON.stringify(value); });

describe("ask", () => {
  it("answers with sources mapped from cited retrieved chunks", async () => {
    const call = reply({ status: "answered", answer: "Berikan oksitosin 10 IU IM.", citations: [{ chunkId: "SPO-HPP#prosedur" }] });
    const result = await ask("dosis oksitosin pada HPP menurut SPO", { retriever, call });
    expect(result).toEqual({ status: "answered", answer: "Berikan oksitosin 10 IU IM.", sources: [{ docId: "SPO-HPP", title: "SPO Penatalaksanaan HPP", heading: "Prosedur", path: "knowledge/06_CLINICAL_SAFETY/SPO-HPP.md" }] });
    const options = call.mock.calls[0][0];
    expect(options.event).toBe("ai_ask");
    expect(options.system).toBe(ASK_SYSTEM_PROMPT);
    expect(options.user).toContain("[SPO-HPP#prosedur]");
    expect(options.schema).toBeDefined();
  });

  it("escalates a question naming a patient without calling the model", async () => {
    const call = reply({});
    expect(await ask("berapa dosis oksitosin untuk pasien Ny. X", { retriever, call })).toEqual({ status: "escalate", answer: ASK_ESCALATE_PHI, sources: [] });
    expect(call).not.toHaveBeenCalled();
  });

  it("returns not_found without a model call when nothing matches", async () => {
    const call = reply({});
    expect(await ask("jadwal kereta ke Surabaya", { retriever, call })).toEqual({ status: "not_found", answer: ASK_NOT_FOUND, sources: [] });
    expect(call).not.toHaveBeenCalled();
  });

  it.each([
    ["a chunk that was not retrieved", { status: "answered", answer: "Karangan.", citations: [{ chunkId: "SPO-LAIN#x" }] }],
    ["no citations", { status: "answered", answer: "Tanpa sumber.", citations: [] }],
  ])("downgrades an answer citing %s to not_found", async (_label, value) => {
    expect(await ask("dosis oksitosin pada HPP", { retriever, call: reply(value) })).toEqual({ status: "not_found", answer: ASK_NOT_FOUND, sources: [] });
  });

  it("passes both conflicting documents and keeps both citations", async () => {
    const call = reply({ status: "answered", answer: "Kedua SPO berbeda: 2024 pukul 11.00-13.00, 2026 pukul 16.00-18.00.", citations: [{ chunkId: "SPO-BESUK-2024#jam" }, { chunkId: "SPO-BESUK-2026#jam" }] });
    const result = await ask("jam besuk rawat inap", { retriever, call });
    expect(call.mock.calls[0][0].user).toContain("[SPO-BESUK-2024#jam]");
    expect(call.mock.calls[0][0].user).toContain("[SPO-BESUK-2026#jam]");
    expect(result.sources.map((source) => source.docId)).toEqual(["SPO-BESUK-2024", "SPO-BESUK-2026"]);
  });

  it("keeps the model's not_found and escalate decisions", async () => {
    expect(await ask("dosis oksitosin pada HPP", { retriever, call: reply({ status: "not_found", answer: "x", citations: [] }) })).toEqual({ status: "not_found", answer: ASK_NOT_FOUND, sources: [] });
    const escalated = await ask("dosis oksitosin pada HPP untuk pasien saya sekarang", { retriever, call: reply({ status: "escalate", answer: "Keputusan untuk pasien tertentu ada pada DPJP.", citations: [] }) });
    expect(escalated).toEqual({ status: "escalate", answer: "Keputusan untuk pasien tertentu ada pada DPJP.", sources: [] });
  });

  it.each([["empty", "   "], ["too long", "a".repeat(501)]])("rejects a %s question with 400", async (_label, question) => {
    const call = reply({});
    await expect(ask(question, { retriever, call })).rejects.toMatchObject({ status: 400 });
    expect(call).not.toHaveBeenCalled();
  });

  it.each([
    ["timeout", vi.fn(async () => null)],
    ["missing key", vi.fn(async () => { throw new DirectorApiError(503, "Asisten AI belum dikonfigurasi."); })],
    ["malformed reply", vi.fn(async () => "bukan json")],
  ])("reports %s as 503 without internals", async (_label, call) => {
    const error = await ask("dosis oksitosin pada HPP", { retriever, call }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DirectorApiError);
    expect(error).toMatchObject({ status: 503, message: ASK_UNAVAILABLE });
  });

  it("uses MELINDAOS_ASK_MODEL when set and the default model otherwise", async () => {
    const value = { status: "not_found", answer: "x", citations: [] };
    const fallback = reply(value);
    await ask("dosis oksitosin pada HPP", { retriever, call: fallback });
    expect(fallback.mock.calls[0][0].model).toBeUndefined();
    vi.stubEnv("MELINDAOS_ASK_MODEL", "claude-sonnet-5-5");
    try {
      const override = reply(value);
      await ask("dosis oksitosin pada HPP", { retriever, call: override });
      expect(override.mock.calls[0][0].model).toBe("claude-sonnet-5-5");
    } finally { vi.unstubAllEnvs(); }
  });

  it("instructs the model on grounding, conflicts, DPJP referral and length", () => {
    for (const rule of ["hanya", "tidak ditemukan di dokumen MelindaOS", "berbeda", "DPJP", "120 kata"]) expect(ASK_SYSTEM_PROMPT).toContain(rule);
  });
});
