import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DirectorCenter } from "@/components/director/director-center";
import { emptyDirectorDay, parseDirectorDay, type DirectorDecision } from "@/lib/director/director-data";
import { Kpi } from "@/components/shell";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const decision: DirectorDecision = { id: "d1", title: "Keputusan sintetis", note: "Hanya untuk tes", options: [{ id: "approve", label: "Setujui" }, { id: "revise", label: "Minta revisi" }] };

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  const found: ReactElement<Record<string, unknown>>[] = [];
  Children.forEach(node, (child) => { if (isValidElement<Record<string, unknown>>(child)) found.push(child, ...elements(child.props.children as ReactNode)); });
  return found;
}

describe("director scanning page", () => {
  it("does not pass non-serializable icon functions from the server view into client KPI components", () => {
    const tree = DirectorCenter({ result: { data: emptyDirectorDay("2026-10-03"), status: "available", message: null }, today: "2026-10-03" });
    const clientKpis = elements(tree).filter((node) => node.type === Kpi);
    expect(clientKpis).toHaveLength(0);
  });
  it("renders the executive content inside the original dashboard navigation and header", () => {
    const html = renderToStaticMarkup(<DirectorCenter result={{ data: emptyDirectorDay("2026-10-03"), status: "available", message: null }} today="2026-10-03" />);
    expect(html).toContain('class="app-shell"');
    expect(html).toContain('aria-label="Navigasi utama"');
    expect(html).toContain('class="app-header"');
    expect(html).toContain('aria-label="Cari knowledge canonical"');
    expect(html).toContain('href="#keputusan-direksi"');
    expect(html).toMatch(/href="\/"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/"/);
  });
  it("renders all six sections in order with honest empty states and functional date/refresh links", () => {
    const html = renderToStaticMarkup(<DirectorCenter result={{ data: emptyDirectorDay("2026-10-03"), status: "available", message: null }} today="2026-10-03" />);
    const headings = [...html.matchAll(/<h2 id="[^"]*">(.*?)<\/h2>/g)].map((match) => match[1]);
    expect(headings).toEqual(["Prioritas", "Keputusan yang menunggu direksi", "Jadwal Direktur", "Agenda hari ini", "Tindak lanjut berjalan", "Laporan harian"]);
    expect(html).toContain('name="tanggal"');
    expect(html).toContain('method="get"');
    expect(html).toContain('type="hidden" name="tanggal" value="2026-10-03"');
    const refreshForms = [...html.matchAll(/<form\b[^>]*>.*?<\/form>/g)].map((match) => match[0]).filter((form) => form.includes('aria-label="Perbarui laporan harian"'));
    expect(refreshForms).toHaveLength(1);
    expect(refreshForms.every((form) => form.includes('name="tanggal" value="2026-10-03"'))).toBe(true);
    expect(html).toContain('type="submit"');
    expect(html).toContain('href="/overview"');
    expect(html).toContain("Belum tersedia");
    expect(html.match(/diperbarui pukul/gi)).toHaveLength(6);
    expect(html).not.toContain("0 kunjungan");
  });
  it("renders schedule WIB, urgent numbered priorities, choices, PIC update and aggregate currency", () => {
    const day = emptyDirectorDay("2026-10-03");
    const updatedAt = "2026-10-03T08:00:00+07:00", source = "Fixture uji";
    day.schedule = { updatedAt, source, items: [{ id: "s1", start: "09:00", end: "10:00", title: "Rapat sintetis", note: "uji" }] };
    day.priorities = { updatedAt, source, items: [{ id: "p1", title: "Prioritas sintetis", note: "", urgent: true }] };
    day.decisions = { updatedAt, source, items: [decision] };
    day.followUps = { updatedAt, source, items: [{ id: "f1", title: "Tindak lanjut sintetis", status: "Dalam proses", pic: "Bu Aura · OPS", updatedAt }] };
    day.dailyReport = { updatedAt, source, visits: 23, bpjsSubmitted: 10, bpjsPending: 0, revenue: 1250000, expenses: null };
    const html = renderToStaticMarkup(<DirectorCenter result={{ data: parseDirectorDay(day, day.date), status: "available", message: null }} today={day.date} />);
    expect(html).toContain("09:00–10:00 WIB");
    expect(html).toContain("Mendesak");
    expect(html).toContain("director-numbered");
    expect(html).toContain("Setujui");
    expect(html).toContain("<td>Aura, OPS</td>");
    expect(html).toContain("08:00 WIB");
    expect(html).toContain("1.250.000");
    expect(html).toContain("Arahan direktur tercatat di buku besar arahan.");
    expect(html.match(/>Beri arahan</g)).toHaveLength(3);
    expect(html).not.toContain("Simpan draf lokal");
  });
  it("renders no instruction controls inside the embedded review preview", () => {
    const day = emptyDirectorDay("2026-10-03");
    const updatedAt = "2026-10-03T08:00:00+07:00", source = "Fixture uji";
    day.priorities = { updatedAt, source, items: [{ id: "p1", title: "Prioritas sintetis", note: "", urgent: true }] };
    day.decisions = { updatedAt, source, items: [decision] };
    day.followUps = { updatedAt, source, items: [{ id: "f1", title: "Tindak lanjut sintetis", status: "Dalam proses", pic: "Bu Aura · OPS", updatedAt }] };
    const html = renderToStaticMarkup(<DirectorCenter embedded authenticated result={{ data: parseDirectorDay(day, day.date), status: "available", message: null }} today={day.date} />);
    expect(html).toContain("Prioritas sintetis");
    expect(html).not.toContain(">Beri arahan<");
  });
  it("flags historical reports and stale section updates instead of presenting them as today's data", () => {
    const day = emptyDirectorDay("2026-10-02");
    day.agenda.updatedAt = "2026-10-01T16:00:00+07:00";
    const html = renderToStaticMarkup(<DirectorCenter result={{ data: day, status: "available", message: null }} today="2026-10-03" />);
    expect(html).toContain("Ini bukan laporan hari ini");
    expect(html).toContain("pembaruan bukan pada tanggal laporan");
  });
  it("keeps refresh on the latest-report view when yesterday's pending report is shown", () => {
    const day = emptyDirectorDay("2026-10-05");
    const html = renderToStaticMarkup(<DirectorCenter followLatest result={{ data: day, status: "available", message: null, submission: { revisionId: "incoming", payloadHash: "1".repeat(64), receivedAt: "2026-10-06T07:03:00+07:00", reviewStatus: "pending" } }} today="2026-10-06" />);
    const headerRefresh = [...html.matchAll(/<form\b[^>]*>.*?<\/form>/g)].map((match) => match[0]).find((form) => form.includes('aria-label="Perbarui laporan harian"'));
    expect(headerRefresh).toBeDefined();
    expect(headerRefresh).not.toContain('name="tanggal"');
    expect(html).toContain("belum ditinjau");
    expect(html).toContain("Belum tersedia");
    expect(html).toMatch(/<time datetime="2026-10-06T07:03:00\+07:00"/i);
    expect(html).toContain("Selasa, 6 Oktober 2026 pukul 07:03 WIB");
    expect(html).not.toContain("LAPORAN TANGGAL PILIHAN");
  });
  it("shows incoming report content and receipt without falsely labeling it as published", () => {
    const day = emptyDirectorDay("2026-10-03");
    day.priorities = { updatedAt: "2026-10-03T08:00:00+07:00", source: "Fixture uji", items: [{ id: "p1", title: "Laporan harian diterima", note: "Agregat sintetis", urgent: true }] };
    const html = renderToStaticMarkup(<DirectorCenter authenticated result={{ data: day, status: "available", message: null, submission: { revisionId: "incoming-123", payloadHash: "1".repeat(64), receivedAt: "2026-10-03T09:00:00+07:00", reviewStatus: "pending" } }} today={day.date} />);
    expect(html).toContain("Laporan harian diterima");
    expect(html).toContain("Kiriman incoming");
    expect(html).toContain("belum ditinjau");
    expect(html).toContain("laporan tetap tampil");
    expect(html).toContain("09:00 WIB");
    expect(html).not.toContain("Versi terbit");
    expect(html).not.toContain("belum dipublikasikan");
    expect(html).toContain('class="app-shell"');
  });
});
