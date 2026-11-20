import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MelindaEntryCard, takeOpenConversation } from "@/components/melinda/melinda-entry-card";
import type { DirectorAuthConfiguration } from "@/lib/director/director-auth";
import { readBriefing, type MelindaBriefing } from "@/lib/melinda/briefing";
import type { MedifySnapshotResult } from "@/lib/medify/medify-snapshot-store";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const row = (start: string, title: string) => ({ start, end: null, title, place: null, flag: null, href: "/#section-01" });
const briefing: MelindaBriefing = {
  greeting: "Selamat datang, Pak Direktur", dateLabel: "Senin, 9 November 2026", timeLabel: "10.00 WIB",
  schedule: { state: "ok", items: [row("08.30", "Rapat pagi"), row("13.00", "Rapat komite"), row("15.00", "Tinjau klaim")] },
  tasks: { state: "ok", waiting: 2, overdue: 1, urgent: [] },
  attention: { state: "ok", items: [] },
};
const fakeStorage = (seed: Record<string, string>) => {
  const values = new Map(Object.entries(seed));
  return { getItem: (key: string) => values.get(key) ?? null, removeItem: (key: string) => { values.delete(key); } };
};

describe("takeOpenConversation", () => {
  it("takes the conversation to open exactly once", () => {
    const storage = fakeStorage({ "melinda:open": "percakapan-1" });
    expect(takeOpenConversation(storage)).toBe("percakapan-1");
    expect(takeOpenConversation(storage)).toBeNull();
  });
});

describe("MelindaEntryCard", () => {
  it("shows the greeting, the waiting count without a schedule preview", () => {
    const html = renderToStaticMarkup(<MelindaEntryCard briefing={briefing} />);
    expect(html).toContain("Selamat datang, Pak Direktur");
    expect(html).not.toContain("Rapat komite");
    expect(html).not.toContain("Rapat pagi");
    expect(html).not.toContain("Tinjau klaim");
    expect(html).toContain("2 tugas menunggu");
    expect(html).toContain('aria-label="Kirim pertanyaan"');
    expect(html).toContain("Apa yang paling mendesak?");
    expect(html).toContain('data-slot="matrix-orb"');
    expect(html).toContain('data-state="idle"');
    expect(html).not.toContain("<video");
  });

  it("renders with only the greeting and input when the briefing is missing", () => {
    const html = renderToStaticMarkup(<MelindaEntryCard briefing={null} />);
    expect(html).toContain("Selamat datang, Pak Direktur");
    expect(html).toContain('aria-label="Kirim pertanyaan"');
    expect(html).not.toContain("tugas menunggu");
  });
});

describe("readBriefing on the home page", () => {
  it("does not re-read schedule or Medify the gate already holds", async () => {
    const call = vi.fn(async (command: string) => {
      if (command === "board") return { instructions: [] };
      if (command === "plan") return { date: "2026-11-09", events: [], readiness: [], outbox: [], archives: [] };
      if (command === "list") return { orders: [], decisions: {} };
      if (command === "review_list") return { pending: [], publishedRevisionId: null, published: null };
      return {};
    });
    const medify = { status: "missing", snapshot: null, receivedAt: null, checkedAt: "", message: "Belum ada" } as MedifySnapshotResult;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await readBriefing({ store: { call } } as unknown as DirectorAuthConfiguration, new Date("2026-11-09T01:00:00Z"), { schedule: [], medify });
    expect(call.mock.calls.map(([command]) => command)).not.toContain("schedule_list");
  });
});
