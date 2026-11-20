// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ReferralForm } from "@/components/referral/referral-form";

const TD = "mis. 150/95";
const PULSE = "mis. 92";
const RR = "mis. 20";
const TEMP = "mis. 37,2";
const SPO2 = "mis. 98";
const WEIGHT = "mis. 62";
const GDS = "mis. 210";

const field = (placeholder: string) => screen.queryByPlaceholderText(placeholder);
const isSuggested = (placeholder: string) => field(placeholder)?.closest("label")?.textContent?.includes("disarankan") ?? false;
const choose = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const renderForm = () => render(<ReferralForm today="2026-11-16" time="09:30" whatsapp="" />);

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
afterEach(cleanup);

describe("TTV generator end to end (component)", () => {
  it("shows the base vital set before a complaint or diagnosis is chosen", () => {
    renderForm();
    expect(field(TD)).not.toBeNull();
    expect(field(PULSE)).not.toBeNull();
    expect(field(RR)).not.toBeNull();
    expect(field(TEMP)).not.toBeNull();
    expect(field(SPO2)).not.toBeNull();
    expect(screen.getByText("Tanda vital dasar")).toBeTruthy();
    expect(isSuggested(SPO2)).toBe(false);
  });

  it("sesak napas: RR, SpO2, pulse and temperature, and generates a starting diagnosis and reason", () => {
    renderForm();
    choose("Keluhan utama", "sesak");
    expect(field(RR)).not.toBeNull();
    expect(field(SPO2)).not.toBeNull();
    expect(field(PULSE)).not.toBeNull();
    expect(field(TEMP)).not.toBeNull();
    expect(field(TD)).toBeNull();
    expect(isSuggested(SPO2)).toBe(true);
    expect(isSuggested(RR)).toBe(false);
    expect(isSuggested(PULSE)).toBe(false);
    expect(screen.getByText("Sesak napas — perlu evaluasi")).toBeTruthy();
    expect((screen.getByLabelText("Alasan / keluhan utama") as HTMLTextAreaElement).value).toBe("Rujukan karena sesak napas.");
  });

  it("perdarahan: blood pressure appears and the pre-eclampsia diagnosis adds its own required blood pressure", () => {
    renderForm();
    choose("Keluhan utama", "perdarahan");
    expect(field(TD)).not.toBeNull();
    expect(isSuggested(PULSE)).toBe(true);
    choose("Diagnosis rujukan", "preeklamsia");
    expect(isSuggested(TD)).toBe(true);
    expect(isSuggested(PULSE)).toBe(true);
  });

  it("demam and asthma: temperature and SpO2 are both required", () => {
    renderForm();
    choose("Keluhan utama", "demam");
    choose("Diagnosis rujukan", "asma_anak");
    expect(field(TEMP)).not.toBeNull();
    expect(field(SPO2)).not.toBeNull();
    expect(isSuggested(TEMP)).toBe(true);
    expect(isSuggested(SPO2)).toBe(true);
  });

  it("diare/muntah: weight replaces SpO2 and pulse is required", () => {
    renderForm();
    choose("Keluhan utama", "diare_muntah");
    expect(field(WEIGHT)).not.toBeNull();
    expect(field(PULSE)).not.toBeNull();
    expect(field(SPO2)).toBeNull();
    expect(field(TD)).toBeNull();
    expect(isSuggested(PULSE)).toBe(true);
  });

  it("keluhan lain has no required vital until a diagnosis adds one", () => {
    renderForm();
    choose("Keluhan utama", "lainnya");
    expect(field(TD)).not.toBeNull();
    expect(isSuggested(TD)).toBe(false);
    choose("Diagnosis rujukan", "hipertensi_dewasa");
    expect(isSuggested(TD)).toBe(true);
  });

  it("falls back to the diagnosis when the complaint is cleared", () => {
    renderForm();
    choose("Diagnosis rujukan", "umum");
    expect(field(TD)).not.toBeNull();
    choose("Keluhan utama", "sesak");
    expect(field(TD)).toBeNull();
    choose("Keluhan utama", "");
    expect(field(TD)).not.toBeNull();
  });

  it("regenerates the auto diagnosis and reason when the complaint changes, but keeps a human edit", () => {
    renderForm();
    choose("Keluhan utama", "sesak");
    choose("Keluhan utama", "diare_muntah");
    expect(screen.getByText("Diare / muntah — perlu evaluasi")).toBeTruthy();
    const reason = screen.getByLabelText("Alasan / keluhan utama") as HTMLTextAreaElement;
    expect(reason.value).toBe("Rujukan karena diare / muntah.");
    fireEvent.change(reason, { target: { value: "Catatan dari dokter" } });
    choose("Keluhan utama", "sesak");
    expect((screen.getByLabelText("Alasan / keluhan utama") as HTMLTextAreaElement).value).toBe("Catatan dari dokter");
  });

  it("diabetes: glucose replaces respiratory rate and is suggested", () => {
    renderForm();
    choose("Keluhan utama", "lemah_pucat");
    choose("Diagnosis rujukan", "diabetes");
    expect(field(GDS)).not.toBeNull();
    expect(field(SPO2)).toBeNull();
    expect(isSuggested(GDS)).toBe(true);
  });
});


