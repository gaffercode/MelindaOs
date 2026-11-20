import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DirectorLogin } from "@/components/director/director-login";
import { DirectorReview, loadDirectorReview, ReviewActions } from "@/components/director/director-review";
import { DirectorCenter } from "@/components/director/director-center";
import { emptyDirectorDay } from "@/lib/director/director-data";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
afterEach(() => vi.unstubAllGlobals());
describe("director login and publication controls", () => {
  it("loads the session and dated queue without hiding a network failure", async () => {
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      expect(init.cache).toBe("no-store");
      if (url === "/api/director/session") return Response.json({ csrfToken: "session-token" });
      expect(url).toBe("/api/director/reviews?tanggal=2026-10-04");
      return Response.json({ pending: [], publishedRevisionId: null, published: null });
    });
    expect(await loadDirectorReview("2026-10-04")).toEqual({ session: { csrfToken: "session-token" }, queue: { pending: [], publishedRevisionId: null, published: null } });
    vi.stubGlobal("fetch", async () => Response.json({ error: "Antrean belum tersedia" }, { status: 503 }));
    await expect(loadDirectorReview("2026-10-04")).rejects.toThrow("Antrean belum tersedia");
  });
  it("uses the inline brand mark and an accessible real passcode form", () => {
    const html = renderToStaticMarkup(<DirectorLogin available returnTo="/director-review" />);
    expect(html).toContain("Connecting hospital knowledge with the daily work and decisions that shape patient care.");
    expect(html).toContain('aria-label="MelindaOS"');
    expect(html).not.toContain('role="button"');
    expect(html).not.toContain("tabindex");
    expect(html).toContain('type="password"');
    expect(html).toContain('autoComplete="current-password"');
    expect(html).toContain('type="submit"');
  });
  it("disables login when secure storage/auth has not been provisioned", () => {
    const html = renderToStaticMarkup(<DirectorLogin available={false} returnTo="/" />);
    expect(html).toContain("belum dikonfigurasi");
    expect(html).toContain("disabled");
  });
  it("keeps approve disabled until explicit aggregate/source confirmation and blocks empty rejection", () => {
    const html = renderToStaticMarkup(<ReviewActions confirmed={false} reason="" busy={false} onReview={() => undefined} />);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Tandai sudah diperiksa/);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Tolak laporan/);
    const ready = renderToStaticMarkup(<ReviewActions confirmed reason="Sumber perlu dikoreksi" busy={false} onReview={() => undefined} />);
    expect(ready).not.toContain("disabled");
  });
  it("explains optional review without telling directors that incoming reports are hidden", () => {
    const html = renderToStaticMarkup(<DirectorReview date="2026-10-03" />);
    expect(html).toContain("Laporan yang tersimpan langsung tampil di dashboard setelah lolos validasi");
    expect(html).toContain("Pemeriksaan ini opsional");
    expect(html).not.toContain("Draf Bot belum tampil");
  });
  it("adds review navigation without replacing the wide dashboard shell", () => {
    const html = renderToStaticMarkup(<DirectorCenter authenticated result={{ data: emptyDirectorDay("2026-10-03"), status: "missing", message: "Belum terbit" }} today="2026-10-03" />);
    expect(html).toContain('class="app-shell"');
    expect(html).toContain('href="/director-review?tanggal=2026-10-03"');
    expect(html).toContain("Keluar");
  });
});
