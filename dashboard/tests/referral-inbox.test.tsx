// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ReferralInbox } from "@/components/referral/referral-inbox";
import { emptyReferralDraft, type StoredReferral } from "@/lib/referral/referral-types";

const NOW = new Date("2026-11-19T10:00:00+07:00").getTime();

function referral(overrides: { id: string; name: string; receivedAt: string; status: StoredReferral["status"]; phone: string }): StoredReferral {
  const draft = emptyReferralDraft("2026-11-19", "09:00");
  return {
    id: overrides.id,
    reference: `RJ-20261119-${overrides.id.toUpperCase()}`,
    receivedAt: overrides.receivedAt,
    status: overrides.status,
    note: null,
    handledBy: null,
    handledAt: null,
    payload: {
      ...draft,
      patient: { ...draft.patient, name: overrides.name, sex: "P" },
      referrer: { ...draft.referrer, facility: "Klinik Sehat", doctor: "dr. Ani", phone: overrides.phone },
      clinical: { ...draft.clinical, chiefComplaint: "sesak", diagnosis: "Sesak napas — perlu evaluasi" },
    },
  };
}

const rows = [
  referral({ id: "aaaa1111", name: "Budi", receivedAt: "2026-11-19T07:00:00+07:00", status: "baru", phone: "081234567890" }),
  referral({ id: "bbbb2222", name: "Siti", receivedAt: "2026-11-19T09:00:00+07:00", status: "diterima", phone: "081200000002" }),
];

function renderInbox() {
  return render(<ReferralInbox initial={rows} initialStatus="semua" unavailable="" initialNow={NOW} />);
}

afterEach(cleanup);

describe("referral inbox", () => {
  it("shows the new count and the waiting time for an unhandled referral", () => {
    renderInbox();
    expect(screen.getByText("1 baru")).toBeTruthy();
    expect(screen.getByText(/Menunggu 3 jam/)).toBeTruthy();
  });

  it("filters by patient name", () => {
    renderInbox();
    fireEvent.change(screen.getByLabelText("Cari rujukan"), { target: { value: "Budi" } });
    expect(screen.queryByText("Siti")).toBeNull();
    expect(screen.getAllByText("Budi").length).toBeGreaterThan(0);
    expect(screen.getByText(/1 rujukan cocok/)).toBeTruthy();
  });

  it("normalizes the referrer phone into WhatsApp and call links", () => {
    renderInbox();
    expect(screen.getByRole("link", { name: "WhatsApp perujuk" }).getAttribute("href")).toBe("https://wa.me/6281234567890");
    expect(screen.getByRole("link", { name: "Telepon perujuk" }).getAttribute("href")).toBe("tel:+6281234567890");
  });

  it("sorts oldest first when asked", () => {
    renderInbox();
    fireEvent.click(screen.getByRole("button", { name: "Terlama" }));
    const items = screen.getAllByRole("listitem");
    expect(items[0].textContent).toContain("Budi");
  });
});
