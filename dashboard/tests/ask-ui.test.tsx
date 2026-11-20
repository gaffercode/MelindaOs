import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AskAnswer, AskMelinda } from "@/components/ask-melinda";
import { fetchAsk } from "@/lib/client-api";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const source = { docId: "SPO-HPP", title: "SPO Penatalaksanaan HPP", heading: "Prosedur", path: "knowledge/06_CLINICAL_SAFETY/maternal_sop/kb-hpp.md" };

describe("AskAnswer", () => {
  it("shows the answer and each source as Judul › Bagian linking to the document search", () => {
    const html = renderToStaticMarkup(<AskAnswer result={{ status: "answered", answer: "Berikan oksitosin 10 IU IM.", sources: [source] }} />);
    expect(html).toContain("Berikan oksitosin 10 IU IM.");
    expect(html).toContain("Sumber");
    expect(html).toContain("SPO Penatalaksanaan HPP › Prosedur");
    expect(html).toContain('href="/knowledge?q=SPO-HPP"');
  });

  it("links a source without docId by its title, cut to the 120-character search limit", () => {
    const title = `Revisi Peraturan Internal ${"x".repeat(150)}`;
    const html = renderToStaticMarkup(<AskAnswer result={{ status: "answered", answer: "Ya.", sources: [{ ...source, docId: "", title }] }} />);
    const href = html.match(/href="([^"]+)"/)![1].replace(/&amp;/g, "&");
    expect(new URL(href, "https://x.test").searchParams.get("q")).toBe(title.slice(0, 120));
  });

  it("shows the not-found text without sources", () => {
    const html = renderToStaticMarkup(<AskAnswer result={{ status: "not_found", answer: "Tidak ditemukan di dokumen MelindaOS.", sources: [] }} />);
    expect(html).toContain("Tidak ditemukan di dokumen MelindaOS.");
    expect(html).not.toContain("Sumber");
  });

  it("shows the escalation in plain red-orange text, not a badge", () => {
    const html = renderToStaticMarkup(<AskAnswer result={{ status: "escalate", answer: "Pertanyaan menyebut identitas pasien. Silakan tanyakan langsung ke DPJP.", sources: [] }} />);
    expect(html).toMatch(/<p[^>]*class="[^"]*text-\[var\(--warn\)\][^"]*"[^>]*>Pertanyaan menyebut identitas pasien/);
    expect(html).not.toMatch(/bg-\[var\(--(warn|danger)-soft\)\]/);
  });
});

describe("AskMelinda", () => {
  it("renders the ask box with its label and example placeholder", () => {
    const html = renderToStaticMarkup(<AskMelinda />);
    expect(html).toContain("Tanya Melinda");
    expect(html).toContain("Contoh: Bagaimana SPO identifikasi pasien di ruang bayi?");
    expect(html).toContain('maxLength="500"');
  });
});

describe("fetchAsk", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts the question with the CSRF header and returns a valid result", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return url === "/api/director/session" ? Response.json({ csrfToken: "csrf-1" }) : Response.json({ status: "answered", answer: "Ya.", sources: [source] });
    });
    expect(await fetchAsk("dosis oksitosin HPP")).toEqual({ status: "answered", answer: "Ya.", sources: [source] });
    const ask = calls.find((call) => call.url === "/api/ask")!;
    expect(ask.init?.method).toBe("POST");
    expect((ask.init?.headers as Record<string, string>)["X-CSRF-Token"]).toBe("csrf-1");
    expect(JSON.parse(ask.init?.body as string)).toEqual({ question: "dosis oksitosin HPP" });
  });

  it("surfaces the server's Indonesian error message", async () => {
    vi.stubGlobal("fetch", async (url: string) => url === "/api/director/session" ? new Response(null, { status: 401 }) : Response.json({ error: "Tanya Melinda sedang tidak tersedia." }, { status: 503 }));
    await expect(fetchAsk("HPP")).rejects.toThrow("Tanya Melinda sedang tidak tersedia.");
  });
});
