import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MELINDA_QUICK_ASKS, MelindaBriefingView } from "@/components/melinda/melinda-briefing";
import type { MelindaBriefing } from "@/lib/melinda/briefing";
import { sendMelinda } from "@/lib/melinda/client";
import type { TurnEvent } from "@/lib/melinda/turn";

const noop = () => undefined;
const briefing: MelindaBriefing = {
  greeting: "Selamat datang, Pak Direktur", dateLabel: "Senin, 9 November 2026", timeLabel: "08.00 WIB",
  schedule: { state: "ok", items: [{ start: "08.30", end: "09.00", title: "Rapat komite", place: "Ruang direksi", flag: "belum siap", href: "/#section-01" }] },
  tasks: { state: "ok", waiting: 2, overdue: 1, urgent: [{ id: "a", title: "Laporan klaim", note: "Tenggat kemarin", href: "/arahan" }] },
  attention: { state: "ok", items: [{ text: "1 berkas order obat menunggu keputusan.", href: "/order-obat" }] },
};
const render = (value: MelindaBriefing) => renderToStaticMarkup(<MelindaBriefingView briefing={value} onAsk={noop} />);

describe("MelindaBriefingView", () => {
  it("opens on the filled briefing with its three headings and quick asks", () => {
    const html = render(briefing);
    for (const text of ["Selamat datang, Pak Direktur", "Jadwal hari ini", "Tugas hari ini", "Perlu perhatian", "Ringkas ulang hari ini", "Rapat komite", "Laporan klaim", "belum siap"]) expect(html).toContain(text);
    expect(html).toContain('href="/order-obat"');
    expect(MELINDA_QUICK_ASKS).toEqual(["Ringkas ulang hari ini", "Apa yang paling mendesak?", "Siapa yang belum membalas tugas?"]);
  });

  it("shows an unavailable section in warn text without a badge", () => {
    expect(render({ ...briefing, schedule: { state: "unavailable", message: "Data jadwal belum tersedia." } })).toMatch(/text-\[var\(--warn\)\][^>]*>Data jadwal belum tersedia\./);
  });

  it("shows a failed schedule source in warn text instead of the empty-day line", () => {
    const html = render({ ...briefing, schedule: { state: "ok", items: [], note: "Jadwal Dash belum tersedia." } });
    expect(html).toMatch(/text-\[var\(--warn\)\][^>]*>Jadwal Dash belum tersedia\./);
    expect(html).not.toContain("Belum ada jadwal hari ini.");
  });

  it("says the day is empty, in words", () => {
    const html = render({ ...briefing, schedule: { state: "ok", items: [] }, tasks: { state: "ok", waiting: 0, overdue: 0, urgent: [] }, attention: { state: "ok", items: [] } });
    expect(html).toContain("Belum ada jadwal hari ini.");
    expect(html).toContain("Tidak ada tugas yang mendesak.");
    expect(html).toContain("Tidak ada yang perlu perhatian.");
  });
});

describe("sendMelinda", () => {
  afterEach(() => vi.unstubAllGlobals());
  const chunks = (parts: string[]) => new ReadableStream<Uint8Array>({ start(controller) { for (const part of parts) controller.enqueue(new TextEncoder().encode(part)); controller.close(); } });
  const stub = (chat: () => Response | Promise<Response>) => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => { calls.push({ url, init }); return url === "/api/director/session" ? Response.json({ csrfToken: "csrf-1" }) : chat(); });
    return calls;
  };

  it("parses SSE events split across chunks and sends the CSRF header", async () => {
    const calls = stub(() => new Response(chunks(['data: {"type":"te', 'xt","delta":"Halo"}\n\ndata: {"type":"done","complete":true}\n\n'])));
    const events: TurnEvent[] = [];
    await sendMelinda({ conversationId: "c1", message: "Halo", onEvent: (event) => events.push(event) });
    expect(events).toEqual([{ type: "text", delta: "Halo" }, { type: "done", complete: true }]);
    const chat = calls.find((call) => call.url === "/api/melinda/chat");
    expect((chat?.init?.headers as Record<string, string>)["X-CSRF-Token"]).toBe("csrf-1");
    expect(JSON.parse(chat?.init?.body as string)).toEqual({ conversationId: "c1", message: "Halo" });
  });

  it("surfaces a JSON error response as an error event", async () => {
    stub(() => Response.json({ error: "Terlalu banyak percobaan." }, { status: 429 }));
    const events: TurnEvent[] = [];
    await sendMelinda({ conversationId: null, message: "Halo", onEvent: (event) => events.push(event) });
    expect(events).toEqual([{ type: "error", message: "Terlalu banyak percobaan." }, { type: "done", complete: false }]);
  });

  it("reports a network failure in words", async () => {
    stub(() => { throw new TypeError("network"); });
    const events: TurnEvent[] = [];
    await sendMelinda({ conversationId: null, message: "Halo", onEvent: (event) => events.push(event) });
    expect(events).toEqual([{ type: "error", message: "Melinda sedang tidak tersedia." }, { type: "done", complete: false }]);
  });

  it("stays quiet when the caller aborted", async () => {
    const abort = new AbortController();
    stub(() => { abort.abort(); throw new DOMException("aborted", "AbortError"); });
    const events: TurnEvent[] = [];
    await sendMelinda({ conversationId: null, message: "Halo", onEvent: (event) => events.push(event), signal: abort.signal });
    expect(events).toEqual([]);
  });
});
