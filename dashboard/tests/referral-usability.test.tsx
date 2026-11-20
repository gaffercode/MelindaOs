// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReferralForm } from "@/components/referral/referral-form";
import { ReferralInbox } from "@/components/referral/referral-inbox";
import { renderToStaticMarkup } from "react-dom/server";
import { parseReferralPayload } from "@/lib/referral/referral-contract";
import { composeReferralText, patientAgeLabel } from "@/lib/referral/referral-letter";
import { emptyReferralDraft } from "@/lib/referral/referral-types";

const input = (name: string) => screen.getByLabelText(name, { exact: false }) as HTMLInputElement;
const change = (name: string, value: string) => fireEvent.change(input(name), { target: { value } });
const send = () => fireEvent.click(screen.getAllByRole("button", { name: "Kirim rujukan" })[0]);
const renderForm = () => render(<ReferralForm today="2026-11-19" time="10:30" whatsapp="" />);
function fill() {
  change("Nama pasien", "Pasien Uji");
  change("Umur bila", "3");
  change("Satuan umur", "bulan");
  change("Jenis kelamin", "P");
  change("Nama faskes", "Klinik Uji");
  change("Nama dokter", "Perujuk Uji");
  change("Nomor WhatsApp", "081200000000");
  fireEvent.click(input("Saya sudah menjelaskan"));
}
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("shared referral form usability", () => {
  it("focuses missing identity and removes its inline error when corrected", () => {
    renderForm();
    send();
    expect(document.activeElement).toBe(input("Nama pasien"));
    expect(input("Nama pasien").getAttribute("aria-invalid")).toBe("true");
    change("Nama pasien", "Pasien Uji");
    expect(input("Nama pasien").getAttribute("aria-invalid")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Tanggal lahir atau umur pasien" }));
    expect(document.activeElement).toBe(input("Umur bila"));
  });

  it("filters diagnosis choices and allows a custom diagnosis in the letter", () => {
    renderForm();
    const picker = screen.getByLabelText("Diagnosis rujukan");
    const before = within(picker).getAllByRole("option").length;
    change("Cari diagnosis", "hipertensi");
    expect(within(picker).getAllByRole("option").length).toBeLessThan(before);
    change("Diagnosis untuk surat", "Diagnosis hasil pemeriksaan perujuk");
    expect(within(screen.getByLabelText("Pratinjau lembar rujukan")).getByText("Diagnosis hasil pemeriksaan perujuk")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sesak napas" }));
    expect(input("Diagnosis untuk surat").value).toBe("Diagnosis hasil pemeriksaan perujuk");
  });

  it("can undo diagnosis selection including its previous checklist", () => {
    renderForm();
    change("Diagnosis rujukan", "hipertensi_dewasa");
    const checklist = screen.getByText("Kelengkapan yang disarankan (opsional)").parentElement!;
    const check = within(checklist).getAllByRole("checkbox", { hidden: true })[0] as HTMLInputElement;
    fireEvent.click(check);
    const label = check.parentElement!.textContent!;
    change("Diagnosis rujukan", "asma_anak");
    fireEvent.click(screen.getByRole("button", { name: "Batalkan perubahan diagnosis" }));
    expect(input("Diagnosis rujukan").value).toBe("hipertensi_dewasa");
    expect((screen.getByLabelText(label) as HTMLInputElement).checked).toBe(true);
  });

  it("clears patient, clinical data, consent and draft but keeps the referrer", () => {
    renderForm();
    fill();
    change("Diagnosis untuk surat", "Diagnosis uji");
    fireEvent.click(screen.getByRole("button", { name: "Pasien berikutnya" }));
    fireEvent.click(screen.getByRole("button", { name: "Batal" }));
    expect(input("Nama pasien").value).toBe("Pasien Uji");
    fireEvent.click(screen.getByRole("button", { name: "Pasien berikutnya" }));
    fireEvent.click(screen.getByRole("button", { name: "Ya, mulai pasien baru" }));
    expect(input("Nama pasien").value).toBe("");
    expect(input("Diagnosis untuk surat").value).toBe("");
    expect(input("Saya sudah menjelaskan").checked).toBe(false);
    expect(input("Nama faskes").value).toBe("Klinik Uji");
    expect(sessionStorage.getItem("melindaos.referral.draft.v1")).toBeNull();
  });

  it("locks a sent document and gives a corrected copy its own reference", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ reference: "RJ-FIRST" }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ reference: "RJ-SECOND" }), { status: 201 }));
    vi.stubGlobal("fetch", fetcher);
    renderForm();
    fill();
    send();
    await screen.findByRole("heading", { name: "RJ-FIRST" });
    expect(input("Nama pasien").closest("fieldset")?.disabled).toBe(true);
    expect(sessionStorage.getItem("melindaos.referral.draft.v1")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Buat salinan untuk koreksi" }));
    expect(screen.queryByText("Nomor RJ-FIRST")).toBeNull();
    expect(input("Saya sudah menjelaskan").checked).toBe(false);
    change("Nama pasien", "Pasien Dikoreksi");
    fireEvent.click(input("Saya sudah menjelaskan"));
    send();
    await screen.findByRole("heading", { name: "RJ-SECOND" });
    expect(fetcher.mock.calls[0][1].headers["Idempotency-Key"]).not.toBe(fetcher.mock.calls[1][1].headers["Idempotency-Key"]);
    expect(JSON.parse(fetcher.mock.calls[1][1].body).patient.name).toBe("Pasien Dikoreksi");
    fireEvent.click(screen.getByRole("button", { name: "Pasien berikutnya" }));
    expect(input("Nama pasien").value).toBe("");
    expect(screen.queryByText("Nomor RJ-SECOND")).toBeNull();
  });

  it("reuses the key for an unchanged failed request and changes it for edited data", async () => {
    const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ error: "Coba lagi" }), { status: 503 }));
    vi.stubGlobal("fetch", fetcher);
    renderForm();
    fill();
    send();
    await screen.findByText("Coba lagi");
    send();
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await screen.findByText("Coba lagi");
    expect(fetcher.mock.calls[0][1].headers["Idempotency-Key"]).toBe(fetcher.mock.calls[1][1].headers["Idempotency-Key"]);
    change("Diagnosis untuk surat", "Diagnosis koreksi");
    send();
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    expect(fetcher.mock.calls[1][1].headers["Idempotency-Key"]).not.toBe(fetcher.mock.calls[2][1].headers["Idempotency-Key"]);
  });

  it("restores the original referral date instead of silently changing it", () => {
    const saved = emptyReferralDraft("2026-11-18", "22:15");
    saved.patient.name = "Pasien Draft";
    sessionStorage.setItem("melindaos.referral.draft.v1", JSON.stringify(saved));
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Pulihkan draft" }));
    expect(screen.getByLabelText("Tanggal", { exact: true }).getAttribute("value")).toBe("2026-11-18");
    expect(screen.getByLabelText("Jam", { exact: true }).getAttribute("value")).toBe("22:15");
  });
});

describe("age units across submission and export", () => {
  function validDraft() {
    const draft = emptyReferralDraft("2026-11-19", "10:30");
    draft.patient = { ...draft.patient, name: "Pasien Uji", age: "3", sex: "P" };
    draft.referrer = { ...draft.referrer, facility: "Klinik Uji", doctor: "Perujuk Uji", phone: "081200000000" };
    draft.consent = true;
    return draft;
  }
  it.each(["hari", "bulan", "tahun"] as const)("preserves %s in the API and letter", (ageUnit) => {
    const draft = validDraft();
    draft.patient.ageUnit = ageUnit;
    const parsed = parseReferralPayload(draft);
    expect(parsed.patient.ageUnit).toBe(ageUnit);
    expect(composeReferralText(parsed)).toContain(`3 ${ageUnit}`);
    expect(patientAgeLabel(parsed.patient, parsed.clinical.date)).toBe(`3 ${ageUnit}`);
  });
  it("keeps old referrals in years and rejects unknown units", () => {
    const draft = validDraft();
    expect(composeReferralText(parseReferralPayload(draft))).toContain("3 tahun");
    expect(() => parseReferralPayload({ ...draft, patient: { ...draft.patient, ageUnit: "minggu" } })).toThrow("patient.ageUnit");
  });
  it("shows the same infant age in the receiving inbox", () => {
    const draft = validDraft();
    draft.patient.ageUnit = "bulan";
    const html = renderToStaticMarkup(<ReferralInbox initial={[{ id: "test-id", reference: "RJ-TEST", receivedAt: "2026-11-19T03:30:00Z", status: "baru", payload: draft, note: null, handledAt: null, handledBy: null }]} initialStatus="semua" unavailable="" />);
    expect(html).toContain("3 bulan");
    expect(html).not.toContain("3 tahun");
  });
});
