import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Activity } from "lucide-react";
import { Kpi } from "@/components/shell";
import { AiActivity } from "@/components/ai-activity";
import { DirectorBell } from "@/components/director/director-attention";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/" }));

// Rare UI components (components/ui) are vendored verbatim; these tests pin how MelindaOS drives them with real state.
describe("Kpi with the Rare UI animated counter", () => {
  it("renders a numeric figure as an animated counter whose accessible text is the id-ID formatted number", () => {
    const html = renderToStaticMarkup(<Kpi icon={Activity} tone="neutral" label="Kunjungan" value="1.234" number={1234} helper="hari ini" bars={[]} />);
    expect(html).toContain('data-slot="animated-counter"');
    expect(html).toMatch(/class="sr-only">1\.234</);
    expect(html).not.toContain("1,234");
  });

  it("keeps the plain text when there is no figure, so loading and missing states never animate", () => {
    for (const value of ["…", "—"]) {
      const html = renderToStaticMarkup(<Kpi icon={Activity} tone="neutral" label="Kunjungan" value={value} number={null} helper="Data belum tersedia" bars={[]} />);
      expect(html).not.toContain('data-slot="animated-counter"');
      expect(html).toContain(`<strong>${value}</strong>`);
    }
  });

  it("appends the unit after the digits", () => {
    const html = renderToStaticMarkup(<Kpi icon={Activity} tone="good" label="Governance" value="93%" number={93} unit="%" helper="" bars={[]} />);
    expect(html).toContain('data-slot="animated-counter"');
    expect(html).toMatch(/class="sr-only">93</);
    expect(html).toContain(">%</span>");
  });
});

describe("DirectorBell", () => {
  it("stays a real link with an Indonesian label and no badge when nothing waits", () => {
    const html = renderToStaticMarkup(<DirectorBell pending={null} authenticated={false} href="/arahan" />);
    expect(html).toMatch(/<a[^>]*href="\/arahan"/);
    expect(html).toContain('aria-label="Papan tugas Direktur"');
    expect(html).toContain("Notifikasi</span>");
    expect(html).not.toContain("Notifications");
  });

  it("counts pending decisions in the label and the badge", () => {
    const html = renderToStaticMarkup(<DirectorBell pending={3} authenticated={false} href="#keputusan-direksi" />);
    expect(html).toContain('href="#keputusan-direksi"');
    expect(html).toContain('aria-label="3 hal menunggu keputusan Direktur"');
    expect(html).toContain("Notifikasi, 3 belum ditangani");
  });
});

describe("AiActivity", () => {
  it("labels the AI run in Indonesian and marks it as a live status", () => {
    const html = renderToStaticMarkup(<AiActivity state="researching" label="Mencari jawaban" />);
    expect(html).toContain('role="status"');
    expect(html).toContain('data-state="researching"');
    expect(html).toContain("Mencari jawaban");
    const done = renderToStaticMarkup(<AiActivity state="done" />);
    expect(done).toContain("Selesai");
    expect(done).not.toContain("Worked for");
  });
});

describe("Rare UI vendoring", () => {
  it("keeps the attribution header and the manifest for every installed component", () => {
    const manifest = readFileSync(new URL("../components/ui/RARE-UI.md", import.meta.url), "utf8");
    for (const name of ["animated-counter", "notification-bell", "toast", "ai-status", "scroll-progress"]) {
      const source = readFileSync(new URL(`../components/ui/${name}.tsx`, import.meta.url), "utf8");
      expect(source.startsWith(`/**\n * Rare UI "${name}"`) || source.startsWith(`/**\r\n * Rare UI "${name}"`)).toBe(true);
      expect(manifest).toContain(`\`${name}.tsx\``);
    }
  });
});
