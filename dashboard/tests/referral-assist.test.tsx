// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ReferralForm } from "@/components/referral/referral-form";

const renderForm = () => render(<ReferralForm today="2026-11-16" time="09:30" whatsapp="" />);
const field = (label: string) => screen.getByLabelText(new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))) as HTMLInputElement;

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
afterEach(cleanup);

describe("referral assistance", () => {
  it("fills the complaint from a one-tap chip and generates its vitals", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Sesak napas" }));
    expect((screen.getByLabelText("Keluhan utama") as HTMLSelectElement).value).toBe("sesak");
    expect(screen.getByPlaceholderText("mis. 98")).toBeTruthy();
    expect(screen.getByText("Sesak napas — perlu evaluasi")).toBeTruthy();
  });

  it("remembers the referrer on this device when asked", () => {
    const first = renderForm();
    fireEvent.change(field("Nama faskes / klinik"), { target: { value: "Klinik Ingat" } });
    fireEvent.change(field("Nama dokter / bidan perujuk"), { target: { value: "dr. Ingat" } });
    fireEvent.change(field("Nomor WhatsApp perujuk"), { target: { value: "081200000002" } });
    fireEvent.click(screen.getByLabelText(/Ingat faskes, kota, dokter/));
    first.unmount();

    renderForm();
    expect(field("Nama faskes / klinik").value).toBe("Klinik Ingat");
    expect(field("Nama dokter / bidan perujuk").value).toBe("dr. Ingat");
    expect(field("Nomor WhatsApp perujuk").value).toBe("081200000002");
  });

  it("offers the draft left in the tab and restores it only when asked", () => {
    const first = renderForm();
    fireEvent.change(field("Nama pasien"), { target: { value: "Pasien Draft" } });
    first.unmount();

    renderForm();
    expect(screen.getByText("Draft rujukan ditemukan")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pulihkan draft" }));
    expect(field("Nama pasien").value).toBe("Pasien Draft");
  });

  it("deletes the draft when the referrer chooses Hapus", () => {
    const first = renderForm();
    fireEvent.change(field("Nama pasien"), { target: { value: "Pasien Hapus" } });
    first.unmount();

    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Hapus" }));
    expect(screen.queryByText("Draft rujukan ditemukan")).toBeNull();
    expect(field("Nama pasien").value).toBe("");
  });
});
