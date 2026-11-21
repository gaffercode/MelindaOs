import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReferralForm } from "@/components/referral/referral-form";

describe("public referral sheet", () => {
  it("renders the form, the completeness prompts and the printed sheet", () => {
    const html = renderToStaticMarkup(<ReferralForm today="2026-11-16" time="09:30" whatsapp="81200000001" />);
    expect(html).toContain("Lembar rujukan pasien");
    expect(html).toContain("referral-sheet-logo");
    expect(html).toContain("Identitas pasien");
    expect(html).toContain("Faskes perujuk");
    expect(html).toContain("Data klinis dan tujuan");
    expect(html).toContain("Nama pasien");
    expect(html).toContain("Rujukan umum");
    expect(html).toContain("Pilih diagnosis");
    expect(html).toContain("Keluhan utama");
    expect(html).toContain("Pilih keluhan");
    expect(html).toContain("Tanda vital dasar");
    expect(html).toContain("Kediri Kota");
    expect(html).toContain("Kediri Kabupaten");
    expect(html).toContain("Nganjuk");
    expect(html).not.toContain("Nomor SIP");
    expect(html).toContain("Kirim rujukan");
    expect(html).toContain("Cetak / simpan PDF");
  });

  it("keeps the patient identifier fields bounded in the markup", () => {
    const html = renderToStaticMarkup(<ReferralForm today="2026-11-16" time="09:30" whatsapp="" />);
    expect(html).toMatch(/maxlength="16"/i);
    expect(html).toMatch(/maxlength="120"/i);
    expect(html).toContain('max="2026-11-16"');
  });

  it("does not render a WhatsApp link before the referral is sent", () => {
    const html = renderToStaticMarkup(<ReferralForm today="2026-11-16" time="09:30" whatsapp="81200000001" />);
    expect(html).not.toContain("wa.me");
    expect(html).not.toContain("Buka WhatsApp");
  });

  it("tells the referrer who receives the data, what it is used for and how to ask for a correction", () => {
    const html = renderToStaticMarkup(<ReferralForm today="2026-11-16" time="09:30" whatsapp="" />);
    expect(html).toContain("Pemberitahuan privasi");
    expect(html).toContain("hanya dibuka oleh petugas rumah sakit yang berwenang");
    expect(html).toContain("koreksi atau penghapusan data");
  });
});
