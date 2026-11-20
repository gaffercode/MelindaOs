import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DirectorShell } from "@/components/director/director-shell";
import { KredensialView } from "@/components/kredensial/kredensial-view";
import { KREDENSIAL_CATEGORIES, KREDENSIAL_DOCUMENTS } from "@/lib/kredensial/kredensial-data";
import { InstructionProvider } from "@/components/director/director-instruction";
import { readFileSync } from "node:fs";
import { ArahanLoading, ArahanReload, QuickInstructionButton } from "@/components/instruction/quick-instruction-button";
import { recoverableImport } from "@/lib/recoverable-import";
import { QuickInstructionCard, QuickInstructionPanel } from "@/components/instruction/quick-instruction-panel";
import { messageText, type Instruction } from "@/lib/director/director-instructions";
import { cardFromDraft, toInstructionInput } from "@/lib/instruction/instruction-draft";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/" }));

const today = "2026-11-05";
const context = "STARKES Command";
const card = cardFromDraft({ title: "Ketua pokja PMKP", action: "assign", pic: ["Kepala SDM – Oriza Rahmawati, A.Md.Keb."], deadline: null, note: "Ketua Pokja PMKP: dr. Novia Dwi Anggraini.", urgent: false }, today);
const officials = ["Wadir Operasional – dr. Novia Dwi Anggraini", "Kepala SDM – Oriza Rahmawati, A.Md.Keb."];
const noop = () => {};
const render = (props: Partial<Parameters<typeof QuickInstructionCard>[0]> = {}) => renderToStaticMarkup(
  <QuickInstructionCard card={card} index={0} today={today} context={context} preview={false} officials={officials} onChange={noop} onRemove={noop} {...props} />,
);

describe("Arahan button module", () => {
  it("loads the panel lazily and never imports it statically", () => {
    const source = readFileSync("components/instruction/quick-instruction-button.tsx", "utf8");
    expect(source).toContain('import("./quick-instruction-panel")');
    expect(source).not.toContain('from "./quick-instruction-panel"');
    expect(source).not.toContain('from "./director-instruction"');
  });

  it("shows a closable drawer with a loading status while the panel chunk loads", () => {
    const html = renderToStaticMarkup(<ArahanLoading context={context} onClose={noop} />);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('role="status"');
    expect(html).toContain("Memuat panel arahan");
    expect(html).toMatch(/<button[^>]*class="quick-instruction-scrim"[^>]*aria-label="Tutup panel arahan"/);
    expect(html).toContain(context);
  });

  it("shows a reload notice, not an error page, when the panel chunk cannot load", () => {
    const html = renderToStaticMarkup(<ArahanReload context={context} onClose={noop} />);
    expect(html).toContain('role="dialog"');
    expect(html).toContain("Memuat ulang halaman");
  });
});

describe("recoverableImport", () => {
  it("retries a failed chunk load once", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("ChunkLoadError")).mockResolvedValueOnce("panel");
    const giveUp = vi.fn(() => "fallback");
    await expect(recoverableImport(load, giveUp)()).resolves.toBe("panel");
    expect(load).toHaveBeenCalledTimes(2);
    expect(giveUp).not.toHaveBeenCalled();
  });

  it("falls back after the retry also fails, without rejecting", async () => {
    const load = vi.fn().mockRejectedValue(new Error("ChunkLoadError"));
    const giveUp = vi.fn(() => "fallback");
    await expect(recoverableImport(load, giveUp)()).resolves.toBe("fallback");
    expect(load).toHaveBeenCalledTimes(2);
    expect(giveUp).toHaveBeenCalledTimes(1);
  });
});

describe("Arahan panel", () => {
  it("shows a closed Arahan button", () => {
    const html = renderToStaticMarkup(<QuickInstructionButton context={context} />);
    expect(html).toMatch(/<button[^>]*>.*Arahan<\/span><\/button>/);
    expect(html).not.toContain("Catatan Direktur");
  });
  it("previews exactly the WhatsApp text the ledger will send", () => {
    const html = render({ preview: true });
    expect(html).toContain(messageText(toInstructionInput(card, today, context), "IOC-…"));
    expect(html).not.toContain("<input");
  });
  it("flags a Tugaskan card without recipients", () => {
    expect(render({ card: { ...card, pic: [] } })).toContain("Tugaskan perlu tujuan.");
    expect(render()).not.toContain("Tugaskan perlu tujuan.");
  });
  it("shows a saved card read-only with its ledger status", () => {
    const saved = { ...toInstructionInput(card, today, context), id: "IOC-0012", status: "terkirim_ke_grokbot", history: [], createdAt: "2026-11-05T02:00:00Z" } as Instruction;
    const html = render({ saved });
    expect(html).toContain("IOC-0012 · Terkirim ke GrokBot");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<textarea");
  });
  it("offers officials as quick picks, and still works without the list", () => {
    expect(render()).toContain("quick-instruction-pick");
    const html = render({ officials: [] });
    expect(html).not.toContain("quick-instruction-pick");
    expect(html).toContain("Tujuan");
    expect(html).toContain("<input");
  });
  it("puts the Arahan button in the Director shell only for a signed-in Director, and on /kredensial", () => {
    const shell = (authenticated: boolean) => renderToStaticMarkup(<DirectorShell date={today} pending={null} authenticated={authenticated} activeSection="starkes"><p>isi</p></DirectorShell>);
    expect(shell(true)).toContain("quick-instruction-trigger");
    expect(shell(false)).not.toContain("quick-instruction-trigger");
    expect(renderToStaticMarkup(<KredensialView authenticated categories={KREDENSIAL_CATEGORIES} documents={KREDENSIAL_DOCUMENTS} />)).toContain("quick-instruction-trigger");
    expect(renderToStaticMarkup(<KredensialView authenticated={false} categories={KREDENSIAL_CATEGORIES} documents={KREDENSIAL_DOCUMENTS} />)).not.toContain("quick-instruction-trigger");
  });
});

describe("Arahan panel review fixes", () => {
  it("shows a picked official with a comma in the label as one removable recipient", () => {
    const html = render();
    expect(html).toContain('aria-label="Hapus tujuan Kepala SDM – Oriza Rahmawati, A.Md.Keb."');
    expect(html).not.toContain('<option value="Kepala SDM – Oriza Rahmawati, A.Md.Keb."');
    expect(html).toContain('<option value="Wadir Operasional – dr. Novia Dwi Anggraini"');
  });
  it("shows a saved card read-only with its ledger status and no resend button", () => {
    const failed = { ...toInstructionInput(card, today, context), id: "IOC-0013", status: "gagal", history: [], createdAt: "2026-11-05T02:00:00Z" } as Instruction;
    const html = render({ saved: failed });
    expect(html).toContain("IOC-0013 · Gagal terkirim");
    expect(html).not.toContain("Coba lagi");
  });
  it("renders the panel as a dialog with a scrim that closes it", () => {
    const html = renderToStaticMarkup(<InstructionProvider date={today}><QuickInstructionPanel context={context} onClose={noop} /></InstructionProvider>);
    expect(html).toContain('role="dialog"');
    expect(html).toMatch(/<button[^>]*class="quick-instruction-scrim"[^>]*aria-label="Tutup panel arahan"/);
  });
});

describe("Teruskan ke staf", () => {
  it("uses the card's own context for the WhatsApp title when it came from another section", () => {
    const fromAgenda = { ...card, context: "Jadwal hari ini" };
    const html = render({ card: fromAgenda, preview: true });
    expect(html).toContain("Jadwal hari ini · Ketua pokja PMKP");
    expect(render({ card: fromAgenda })).toContain("Dari: Jadwal hari ini");
  });
});
