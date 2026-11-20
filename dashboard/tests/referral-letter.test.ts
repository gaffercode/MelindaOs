import { describe, expect, it } from "vitest";
import { parseReferralPayload, parseReferralStatus, ReferralValidationError } from "@/lib/referral/referral-contract";
import { profileFor, REFERRAL_PROFILES } from "@/lib/referral/referral-checklist";
import { vitalsFor } from "@/lib/referral/referral-complaints";
import { ageLabel, composeReferralText, missingFields, normaliseWhatsapp, referralDateLabel, whatsappHref } from "@/lib/referral/referral-letter";
import { emptyReferralDraft, type ReferralDraft } from "@/lib/referral/referral-types";

function filled(): ReferralDraft {
  const draft = emptyReferralDraft("2026-11-16", "09:30");
  draft.patient = { name: "Siti Aminah", birthDate: "1992-03-04", age: "", sex: "P", rm: "123456", nik: "" };
  draft.referrer = {
    facilityType: "FKTP / Puskesmas",
    facility: "Puskesmas Balowerti",
    city: "Kediri Kota",
    doctor: "dr. Rina",
    phone: "0812-3456-7890",
  };
  draft.clinical = {
    ...draft.clinical,
    profileId: "hipertensi_dewasa",
    chiefComplaint: "nyeri_kepala",
    diagnosis: "Hipertensi esensial",
    reason: "Tekanan darah tidak terkontrol, perlu evaluasi Sp.PD",
    onset: "3 hari",
    vitals: { ...draft.clinical.vitals, td: "165/100", nadi: "92" },
    checks: { nyeri_kepala: true, ekg: true, ronki: false },
    therapy: "Amlodipin 10 mg",
    allergy: "Tidak ada",
    insurer: "BPJS Kesehatan",
    destination: "Poli Penyakit Dalam",
    notes: "Pasien datang sendiri",
  };
  draft.consent = true;
  return draft;
}

describe("referral letter", () => {
  it("lists every required field on a blank draft", () => {
    expect(missingFields(emptyReferralDraft("2026-11-16", "08:00"))).toEqual([
      "Nama pasien",
      "Tanggal lahir atau umur pasien",
      "Jenis kelamin pasien",
      "Nama faskes atau klinik perujuk",
      "Nama dokter atau bidan perujuk",
      "Nomor WhatsApp perujuk yang dapat dihubungi",
      "Persetujuan pengiriman data pasien",
    ]);
  });

  it("generates the vital set from the chief complaint and adds the diagnosis's suggested vital", () => {
    const draft = filled();
    draft.clinical.chiefComplaint = "sesak";
    draft.clinical.profileId = "";
    draft.clinical.diagnosis = "Sesak napas";
    expect(vitalsFor("sesak", "")).toEqual({ vitals: ["rr", "spo2", "nadi", "suhu"], requiredVitals: ["spo2"] });
    draft.clinical.vitals.spo2 = "";
    expect(missingFields(draft)).not.toContain("SpO2 (wajib untuk Sesak napas)");
    const preeclampsia = vitalsFor("demam", "preeklamsia");
    expect(preeclampsia.vitals).toContain("td");
    expect(preeclampsia.requiredVitals).toEqual(["suhu", "td"]);
    expect(profileFor("preeklamsia").requiredVitals).toEqual(["td"]);
    expect(profileFor("asma_anak").requiredVitals).toEqual(["spo2"]);
  });

  it("never blocks an emergency referral on the clinical fields", () => {
    const draft = filled();
    draft.clinical.diagnosis = "";
    draft.clinical.chiefComplaint = "";
    draft.clinical.vitals = { td: "", nadi: "", rr: "", suhu: "", spo2: "", gds: "", bb: "", tb: "" };
    expect(missingFields(draft)).toEqual([]);
    expect(parseReferralPayload(draft).clinical.diagnosis).toBe("");
  });

  it("accepts a filled draft and the fallback age in years", () => {
    expect(missingFields(filled())).toEqual([]);
    const byAge = filled();
    byAge.patient.birthDate = "";
    byAge.patient.age = "34";
    expect(missingFields(byAge)).toEqual([]);
  });

  it("formats age and dates in Indonesian", () => {
    expect(ageLabel("1992-03-04", "2026-11-16")).toBe("34 tahun");
    expect(ageLabel("2026-09-01", "2026-11-16")).toBe("2 bulan");
    expect(ageLabel("2026-11-10", "2026-11-16")).toBe("6 hari");
    expect(ageLabel("", "2026-11-16")).toBe("");
    expect(referralDateLabel("2026-11-16")).toBe("16 November 2026");
  });

  it("normalises an Indonesian WhatsApp number and builds a wa.me link", () => {
    expect(normaliseWhatsapp("812-3456-7890")).toBe("81234567890");
    expect(normaliseWhatsapp("812 0000 0001")).toBe("81200000001");
    expect(whatsappHref("", "halo")).toBeNull();
    expect(whatsappHref("812-0000-0001", "halo dunia")).toBe("https://wa.me/81200000001?text=halo%20dunia");
  });

  it("writes the referral text with the filled values and without unchecked items", () => {
    const text = composeReferralText(filled(), "RJ-20261116-AB12CD");
    expect(text).toContain("LEMBAR RUJUKAN — RSIA MELINDA DHAI");
    expect(text).toContain("Nomor: RJ-20261116-AB12CD");
    expect(text).toContain("Pasien: Siti Aminah · perempuan, 34 tahun");
    expect(text).toContain("Hipertensi esensial");
    expect(text).toContain("Tekanan darah 165/100 mmHg");
    expect(text).toContain("Nyeri kepala");
    expect(text).toContain("EKG 12 sadapan");
    expect(text).not.toContain("Ronki basal paru");
    expect(text).toContain("Poli Penyakit Dalam · BPJS Kesehatan");
  });

  it("keeps a blank line between groups but never leading or trailing blanks", () => {
    const text = composeReferralText(filled());
    expect(text.startsWith("LEMBAR RUJUKAN")).toBe(true);
    expect(text.endsWith("Keputusan klinis tetap pada dokter yang memeriksa.")).toBe(true);
    expect(text).not.toMatch(/\n{3,}/);
  });
});

describe("diagnosis checklist", () => {
  it("offers the pathways with their sources and falls back to the generic set", () => {
    expect(REFERRAL_PROFILES.map((profile) => profile.id)).toContain("preeklamsia");
    expect(profileFor("tidak-ada").id).toBe("umum");
    const hypertension = profileFor("hipertensi_dewasa");
    expect(hypertension.vitals).toContain("td");
    expect(hypertension.items.map((entry) => entry.id)).toContain("ekg");
    expect(hypertension.source?.docId).toBe("SOP-KLI-CP-PD-HIPERTENSI-ESENSIAL");
    expect(profileFor("preeklamsia").note).toContain("Kegawatan maternal");
  });
});

describe("referral payload contract", () => {
  it("parses a filled draft and drops unchecked items and unknown keys", () => {
    const parsed = parseReferralPayload({ ...filled(), extra: "x" });
    expect(parsed.patient.name).toBe("Siti Aminah");
    expect(parsed.clinical.checks).toEqual({ nyeri_kepala: true, ekg: true });
    expect(parsed.clinical.profileId).toBe("hipertensi_dewasa");
    expect(parsed.clinical.destination).toBe("Poli Penyakit Dalam");
  });

  it.each([
    ["not an object", "x", "draft"],
    ["missing consent", { ...filled(), consent: false }, "consent"],
    ["blank patient name", { ...filled(), patient: { ...filled().patient, name: "  " } }, "patient.name"],
    ["bad sex", { ...filled(), patient: { ...filled().patient, sex: "X" } }, "patient.sex"],
    ["short NIK", { ...filled(), patient: { ...filled().patient, nik: "123" } }, "patient.nik"],
    ["unknown facility", { ...filled(), referrer: { ...filled().referrer, facilityType: "Apotek" } }, "referrer.facilityType"],
    ["bad phone", { ...filled(), referrer: { ...filled().referrer, phone: "123" } }, "referrer.phone"],
    ["unknown destination", { ...filled(), clinical: { ...filled().clinical, destination: "Kandang" } }, "clinical.destination"],
    ["bad vital", { ...filled(), clinical: { ...filled().clinical, vitals: { ...filled().clinical.vitals, td: "<script>" } } }, "clinical.vitals.td"],
    ["non-boolean check", { ...filled(), clinical: { ...filled().clinical, checks: { ekg: "yes" } } }, "clinical.checks"],
    ["future-invalid date", { ...filled(), clinical: { ...filled().clinical, date: "16-11-2026" } }, "clinical.date"],
  ])("rejects %s", (_name, payload, path) => {
    expect(() => parseReferralPayload(payload)).toThrow(ReferralValidationError);
    try {
      parseReferralPayload(payload);
    } catch (error) {
      expect((error as ReferralValidationError).path).toBe(path);
    }
  });

  it("accepts only the known statuses", () => {
    expect(parseReferralStatus("diterima")).toBe("diterima");
    expect(() => parseReferralStatus("baru-sekali")).toThrow(ReferralValidationError);
  });
});
