"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { MelindaLogo } from "@/components/entrance/melinda-logo";
import { wibDate, wibTime } from "@/lib/director/director-data";
import { COMPLAINTS, complaintFor, vitalsFor } from "@/lib/referral/referral-complaints";
import { CHECKLIST_GROUP_LABELS, profileFor, profilesByGroup, type ChecklistGroup } from "@/lib/referral/referral-checklist";
import { patientAgeLabel, composeReferralText, referralFieldErrors, referralDateLabel, whatsappHref } from "@/lib/referral/referral-letter";
import {
  CITIES,
  DESTINATIONS,
  FACILITY_TYPES,
  INSURERS,
  VITAL_KEYS,
  VITAL_LABELS,
  emptyReferralDraft,
  type ReferralDraft,
  type ReferralReceipt,
  type VitalKey,
} from "@/lib/referral/referral-types";

const GROUPS: readonly ChecklistGroup[] = ["anamnesis", "pemeriksaan", "penunjang"];
const BASE_VITALS: readonly VitalKey[] = ["td", "nadi", "rr", "suhu", "spo2"];
const QUICK_COMPLAINTS = COMPLAINTS.filter((entry) => ["sesak", "demam", "perdarahan", "kejang", "nyeri_kepala", "diare_muntah"].includes(entry.id));
const REFERRER_KEY = "melindaos.referral.referrer.v1";
const DRAFT_KEY = "melindaos.referral.draft.v1";
const HOSPITAL = {
  name: "RSIA Melinda DHAI",
  address: "Jl. Balowerti II No. 59, Kediri, Jawa Timur",
  phone: "(0354) 691016",
  phoneHref: "tel:+62354691016",
};

export function ReferralForm({ today, time, whatsapp }: { today: string; time: string; whatsapp: string }) {
  const [draft, setDraft] = useState<ReferralDraft>(() => emptyReferralDraft(today, time));
  const [attempted, setAttempted] = useState(false);
  const [diagnosisSearch, setDiagnosisSearch] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const [previousProfile, setPreviousProfile] = useState<Pick<ReferralDraft["clinical"], "profileId" | "diagnosis" | "checks"> | null>(null);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [receipt, setReceipt] = useState<ReferralReceipt | null>(null);
  const [copied, setCopied] = useState(false);
  const [rememberReferrer, setRememberReferrer] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<ReferralDraft | null>(null);
  const [notice, setNotice] = useState("");
  const idempotencyKey = useRef<string | null>(null);
  const submittedPayload = useRef<string | null>(null);
  const sendLock = useRef(false);
  const errors = attempted ? referralFieldErrors(draft) : {};
  const fieldProps = (id: string) => ({ id, "aria-invalid": Boolean(errors[id]), "aria-describedby": errors[id] ? `${id}-error` : undefined });
  const fieldError = (id: string) => errors[id] ? <small className="referral-field-error" id={`${id}-error`}>{errors[id]}</small> : null;
  const focusField = (id: string) => {
    const field = document.getElementById(id);
    field?.focus();
    field?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  };
  const profile = profileFor(draft.clinical.profileId);
  const complaint = complaintFor(draft.clinical.chiefComplaint);
  const hasChoice = Boolean(draft.clinical.chiefComplaint || draft.clinical.profileId);
  const plan = hasChoice ? vitalsFor(draft.clinical.chiefComplaint, draft.clinical.profileId) : { vitals: [...BASE_VITALS], requiredVitals: [] as VitalKey[] };
  const age = patientAgeLabel(draft.patient, draft.clinical.date);
  const text = useMemo(() => composeReferralText(draft, receipt?.reference), [draft, receipt?.reference]);
  const whatsappLink = receipt ? whatsappHref(whatsapp, text) : null;

  useEffect(() => {
    if (receipt) document.getElementById("referral-status")?.scrollIntoView?.({ behavior: "smooth", block: "center" });
  }, [receipt]);

  const patchPatient = (patch: Partial<ReferralDraft["patient"]>) => setDraft((current) => ({ ...current, patient: { ...current.patient, ...patch } }));
  const patchReferrer = (patch: Partial<ReferralDraft["referrer"]>) => setDraft((current) => ({ ...current, referrer: { ...current.referrer, ...patch } }));
  const patchClinical = (patch: Partial<ReferralDraft["clinical"]>) => setDraft((current) => ({ ...current, clinical: { ...current.clinical, ...patch } }));
  const setVital = (key: VitalKey, value: string) => patchClinical({ vitals: { ...draft.clinical.vitals, [key]: value } });
  const setCheck = (id: string, checked: boolean) => patchClinical({ checks: { ...draft.clinical.checks, [id]: checked } });
  /** The selected diagnosis is the group: it fills the printed diagnosis and resets the checklist. */
  const chooseProfile = (id: string) => {
    const chosen = id ? profileFor(id) : null;
    setPreviousProfile({ profileId: draft.clinical.profileId, diagnosis: draft.clinical.diagnosis, checks: { ...draft.clinical.checks } });
    patchClinical({ profileId: id, diagnosis: chosen?.label ?? "", checks: {} });
  };
  /** The complaint generates a starting diagnosis and reason; the referrer can replace both. */
  const chooseComplaint = (value: string) => {
    const chosen = complaintFor(value);
    const autoDiagnosis = !draft.clinical.diagnosis.trim() || draft.clinical.diagnosis.endsWith(" — perlu evaluasi");
    const autoReason = !draft.clinical.reason.trim() || (draft.clinical.reason.startsWith("Rujukan karena ") && draft.clinical.reason.endsWith("."));
    patchClinical({
      chiefComplaint: value,
      ...(autoDiagnosis ? { diagnosis: chosen ? `${chosen.label} — perlu evaluasi` : "" } : {}),
      ...(autoReason ? { reason: chosen ? `Rujukan karena ${chosen.label.toLowerCase()}.` : "" } : {}),
    });
  };

  // Load the remembered referrer and any draft left in this tab. Both are client-only.
  useEffect(() => {
    try {
      const savedReferrer = localStorage.getItem(REFERRER_KEY);
      if (savedReferrer) {
        const parsed = JSON.parse(savedReferrer) as Partial<ReferralDraft["referrer"]>;
        if (parsed && typeof parsed === "object") {
          // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration from local storage
          setDraft((current) => ({ ...current, referrer: { ...current.referrer, ...parsed } }));
          setRememberReferrer(true);
        }
      }
    } catch { /* storage unavailable */ }
    try {
      const savedDraft = sessionStorage.getItem(DRAFT_KEY);
      if (savedDraft) {
        const parsed = JSON.parse(savedDraft) as ReferralDraft;
        if (parsed?.patient && parsed?.clinical) {
          setPendingDraft(parsed);
        }
      }
    } catch { /* storage unavailable */ }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      if (!rememberReferrer) localStorage.removeItem(REFERRER_KEY);
      else localStorage.setItem(REFERRER_KEY, JSON.stringify(draft.referrer));
    } catch { /* storage unavailable */ }
  }, [hydrated, rememberReferrer, draft.referrer]);

  useEffect(() => {
    if (!hydrated || receipt) return;
    const dirty = draft.patient.name.trim() !== "" || draft.patient.birthDate !== "" || draft.clinical.chiefComplaint !== "" || Object.values(draft.clinical.vitals).some((value) => value.trim() !== "");
    try {
      if (dirty) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch { /* storage unavailable */ }
  }, [hydrated, draft, receipt]);

  const restoreDraft = () => {
    if (!pendingDraft) return;
    setDraft(pendingDraft);
    setPendingDraft(null);
    setNotice("Draft dipulihkan. Periksa tanggal dan jam rujukan sebelum mengirim.");
  };
  const discardDraft = () => {
    try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* storage unavailable */ }
    setPendingDraft(null);
    setNotice("Draft dihapus.");
  };

  function nextPatient() {
    if (sendLock.current) return;
    const now = new Date();
    const fresh = emptyReferralDraft(wibDate(now), wibTime(now.toISOString()).replace(" WIB", ""));
    setDraft({ ...fresh, referrer: { ...draft.referrer } });
    setReceipt(null);
    setPendingDraft(null);
    setAttempted(false);
    setError("");
    setCopied(false);
    setDiagnosisSearch("");
    setPreviousProfile(null);
    setConfirmReset(false);
    idempotencyKey.current = null;
    submittedPayload.current = null;
    try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* storage unavailable */ }
    setNotice("Form pasien baru siap. Data perujuk tetap terisi.");
  }

  function editAsNew() {
    setReceipt(null);
    setDraft((current) => ({ ...current, consent: false }));
    setAttempted(false);
    setCopied(false);
    setNotice("Salinan untuk rujukan baru. Pengiriman berikutnya mendapat nomor baru; rujukan sebelumnya tetap tersimpan.");
  }

  async function submit() {
    if (sendLock.current || receipt) return;
    const absent = referralFieldErrors(draft);
    setAttempted(true);
    setError("");
    if (Object.keys(absent).length) {
      focusField(Object.keys(absent)[0]);
      return;
    }
    const payload = JSON.stringify(draft);
    if (submittedPayload.current !== payload) idempotencyKey.current = null;
    if (!idempotencyKey.current) idempotencyKey.current = crypto.randomUUID();
    submittedPayload.current = payload;
    sendLock.current = true;
    setSending(true);
    try {
      const response = await fetch("/api/rujukan", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey.current },
        body: payload,
      });
      const body = (await response.json().catch(() => ({}))) as Partial<ReferralReceipt> & { error?: string };
      if (!response.ok || !body.reference) throw new Error(body.error ?? "Rujukan belum dapat dikirim. Periksa sambungan lalu coba lagi.");
      setReceipt({ reference: body.reference, receivedAt: body.receivedAt ?? new Date().toISOString(), replayed: body.replayed === true });
      // A correction after a successful send is a new referral with its own number, not a replay of the old one.
      idempotencyKey.current = null;
      try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* storage unavailable */ }
      setPendingDraft(null);
    } catch (submitError) {
      setError((submitError as Error).message);
    } finally {
      sendLock.current = false;
      setSending(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("Ringkasan tidak dapat disalin di peramban ini. Gunakan cetak atau WhatsApp.");
    }
  }

  const vitals = plan.vitals;
  const checkedItems = profile.items.filter((entry) => draft.clinical.checks[entry.id]);

  return (
    <div className="referral-page">
      <header className="referral-topbar">
        <div className="referral-brand">
          <Image src="/brand/melindaos-logo.png" alt="" width={40} height={41} priority />
          <span><strong>MelindaOS</strong><small>RSIA Melinda DHAI</small></span>
        </div>
        <div className="referral-top-actions">
          <a className="referral-emergency" href={HOSPITAL.phoneHref}>IGD {HOSPITAL.phone}</a>
          <Link className="referral-help" href="/">Masuk dashboard</Link>
        </div>
      </header>

      <div className="referral-intro">
        <p className="referral-kicker">Untuk FKTP, klinik, dan praktik dokter perorangan</p>
        <h1>Lembar rujukan pasien</h1>
        <p>
          Lengkapi kolom bertanda * dan salah satu: tanggal lahir atau umur. Pilih keluhan utama; sistem menyiapkan tanda vital,
          diagnosis awal, dan draft alasan rujukan. Semua bisa diubah, dan keputusan tetap pada dokter.
          Data pasien hanya dipakai untuk menindaklanjuti rujukan ini.
        </p>
      </div>

      <div className="referral-workspace">
        <div className="referral-form-column">
          {pendingDraft && (
            <section className="referral-restore" role="status">
              <div>
                <strong>Draft rujukan ditemukan</strong>
                <p>Dari tab ini. Pulihkan atau hapus sebelum mengisi yang baru.</p>
              </div>
              <div className="referral-actions">
                <button type="button" className="director-button" disabled={sending} onClick={restoreDraft}>Pulihkan draft</button>
                <button type="button" className="referral-button-secondary" disabled={sending} onClick={discardDraft}>Hapus</button>
              </div>
            </section>
          )}
          {notice && <p className="referral-inbox-message" role="status">{notice}</p>}
          {receipt && (
            <section className="referral-success" id="referral-status" aria-live="polite">
              <p className="referral-success-kicker">{receipt.replayed ? "Rujukan ini sudah terkirim" : "Rujukan terkirim"}</p>
              <h2>{receipt.reference}</h2>
              <p>Simpan nomor ini. Resepsionis akan menghubungi nomor perujuk untuk konfirmasi.</p>
              <p>Isi yang terkirim dikunci. Untuk perubahan, buat salinan sebagai rujukan baru.</p>
              <div className="referral-actions">
                <button type="button" className="referral-button-secondary" onClick={editAsNew}>Buat salinan untuk koreksi</button>
                <button type="button" className="director-button" onClick={() => window.print()}>Cetak / simpan PDF</button>
                {whatsappLink && <a className="referral-button-secondary" href={whatsappLink} target="_blank" rel="noreferrer">Buka WhatsApp</a>}
                <button type="button" className="referral-button-secondary" onClick={copy}>{copied ? "Tersalin" : "Salin ringkasan"}</button>
              </div>
            </section>
          )}

          <fieldset className="referral-editable" disabled={sending || Boolean(receipt)}>
          <legend className="sr-only">Data rujukan</legend>
          <section className="referral-card">
            <div className="referral-strip"><span>01</span><h2>Identitas pasien</h2></div>
            <div className="referral-grid">
              <label className="referral-field referral-span-2"><span>Nama pasien <b aria-hidden="true">*</b></span><input {...fieldProps("patient-name")} value={draft.patient.name} maxLength={120} autoComplete="off" onChange={(event) => patchPatient({ name: event.target.value })} />{fieldError("patient-name")}</label>
              <label className="referral-field"><span>Tanggal lahir (atau isi umur) <b aria-hidden="true">*</b></span><input type="date" value={draft.patient.birthDate} max={today} onChange={(event) => patchPatient({ birthDate: event.target.value, age: "" })} /></label>
              <label className="referral-field"><span>Umur bila tanggal lahir tidak diketahui <b aria-hidden="true">*</b></span><input type="number" min={0} max={999} step={1} inputMode="numeric" {...fieldProps("patient-age")} value={draft.patient.age} onChange={(event) => patchPatient({ age: event.target.value, birthDate: "" })} />{fieldError("patient-age")}</label>
              <label className="referral-field"><span>Satuan umur</span><select value={draft.patient.ageUnit ?? "tahun"} onChange={(event) => patchPatient({ ageUnit: event.target.value as "hari" | "bulan" | "tahun" })}><option value="tahun">Tahun</option><option value="bulan">Bulan</option><option value="hari">Hari</option></select></label>
              <label className="referral-field"><span>Jenis kelamin <b aria-hidden="true">*</b></span><select {...fieldProps("patient-sex")} value={draft.patient.sex} onChange={(event) => patchPatient({ sex: event.target.value as ReferralDraft["patient"]["sex"] })}><option value="">Pilih</option><option value="L">Laki-laki</option><option value="P">Perempuan</option></select>{fieldError("patient-sex")}</label>
              <details className="referral-more referral-span-2">
                <summary>Nomor RM / NIK (opsional)</summary>
                <div className="referral-grid">
                  <label className="referral-field"><span>Nomor rekam medis</span><input value={draft.patient.rm} maxLength={30} autoComplete="off" onChange={(event) => patchPatient({ rm: event.target.value })} /></label>
                  <label className="referral-field"><span>NIK (16 angka)</span><input value={draft.patient.nik} maxLength={16} inputMode="numeric" autoComplete="off" onChange={(event) => patchPatient({ nik: event.target.value.replace(/\D/g, "") })} /></label>
                </div>
              </details>
            </div>
          </section>

          <section className="referral-card">
            <div className="referral-strip"><span>02</span><h2>Faskes perujuk</h2></div>
            <div className="referral-grid">
              <label className="referral-field"><span>Nama faskes / klinik <b aria-hidden="true">*</b></span><input {...fieldProps("referrer-facility")} value={draft.referrer.facility} maxLength={160} onChange={(event) => patchReferrer({ facility: event.target.value })} />{fieldError("referrer-facility")}</label>
              <label className="referral-field"><span>Kota / kabupaten</span><select value={draft.referrer.city} onChange={(event) => patchReferrer({ city: event.target.value as ReferralDraft["referrer"]["city"] })}>{CITIES.map((city) => <option key={city} value={city}>{city}</option>)}</select></label>
              <label className="referral-field"><span>Nama dokter / bidan perujuk <b aria-hidden="true">*</b></span><input {...fieldProps("referrer-doctor")} value={draft.referrer.doctor} maxLength={120} onChange={(event) => patchReferrer({ doctor: event.target.value })} />{fieldError("referrer-doctor")}</label>
              <label className="referral-field"><span>Nomor WhatsApp perujuk <b aria-hidden="true">*</b></span><input type="tel" {...fieldProps("referrer-phone")} value={draft.referrer.phone} maxLength={24} placeholder="08xx xxxx xxxx" onChange={(event) => patchReferrer({ phone: event.target.value })} />{fieldError("referrer-phone")}</label>
              <label className="referral-remember referral-span-2"><input type="checkbox" checked={rememberReferrer} onChange={(event) => { setRememberReferrer(event.target.checked); setNotice(event.target.checked ? "Data perujuk akan diingat di perangkat ini." : "Data perujuk yang diingat sudah dihapus."); }} /><span>Ingat faskes, kota, dokter, dan nomor perujuk di perangkat ini. Pilihan ini hanya mengingat data perujuk.</span></label>
            </div>
          </section>

          <section className="referral-card">
            <div className="referral-strip"><span>03</span><h2>Data klinis dan tujuan</h2></div>
            <div className="referral-quick" role="group" aria-label="Keluhan cepat">
              <span>Keluhan cepat</span>
              {QUICK_COMPLAINTS.map((entry) => (
                <button key={entry.id} type="button" aria-pressed={draft.clinical.chiefComplaint === entry.id} className={draft.clinical.chiefComplaint === entry.id ? "is-active" : undefined} onClick={() => chooseComplaint(entry.id)}>{entry.label}</button>
              ))}
            </div>
            <div className="referral-grid">
              <label className="referral-field referral-span-2"><span>Keluhan utama</span><select aria-label="Keluhan utama" value={draft.clinical.chiefComplaint} onChange={(event) => chooseComplaint(event.target.value)}><option value="">Pilih keluhan…</option>{COMPLAINTS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</select></label>
              <label className="referral-field referral-span-2"><span>Cari diagnosis atau kode ICD</span><input type="search" value={diagnosisSearch} onChange={(event) => setDiagnosisSearch(event.target.value)} placeholder="Ketik nama diagnosis atau kode" /></label>
              <label className="referral-field referral-span-2"><span>Diagnosis rujukan</span><select aria-label="Diagnosis rujukan" value={draft.clinical.profileId} onChange={(event) => chooseProfile(event.target.value)}><option value="">Pilih diagnosis…</option>{profilesByGroup().map((section) => <optgroup key={section.group} label={section.label}>{section.profiles.filter((entry) => entry.id === draft.clinical.profileId || `${entry.label} ${entry.icd ?? ""}`.toLowerCase().includes(diagnosisSearch.trim().toLowerCase())).map((entry) => <option key={entry.id} value={entry.id}>{entry.label}{entry.icd ? ` (${entry.icd})` : ""}</option>)}</optgroup>)}</select></label>
              <label className="referral-field referral-span-2"><span>Diagnosis untuk surat (bisa diedit)</span><input value={draft.clinical.diagnosis} maxLength={200} onChange={(event) => patchClinical({ diagnosis: event.target.value })} placeholder="Tulis atau koreksi diagnosis rujukan" /></label>
              {previousProfile && <div className="referral-span-2"><p className="referral-hint">Pilihan diagnosis mengganti isian diagnosis dan checklist.</p><button type="button" className="referral-button-secondary" onClick={() => { patchClinical(previousProfile); setPreviousProfile(null); setDiagnosisSearch(""); }}>Batalkan perubahan diagnosis</button></div>}
              <label className="referral-field"><span>Tujuan <b aria-hidden="true">*</b></span><select value={draft.clinical.destination} onChange={(event) => patchClinical({ destination: event.target.value as ReferralDraft["clinical"]["destination"] })}>{DESTINATIONS.map((destination) => <option key={destination} value={destination}>{destination}</option>)}</select></label>
            </div>

            <div className="referral-subhead">
              <h3>{complaint ? `Tanda vital untuk keluhan ${complaint.label.toLowerCase()}` : draft.clinical.profileId ? `Tanda vital untuk ${profile.label}` : "Tanda vital dasar"}</h3>
              <span className="referral-tag">{hasChoice ? "otomatis" : "dasar"}</span>
            </div>
            <p className="referral-hint">{hasChoice ? "TTV mengikuti keluhan dan diagnosis. Isi yang sempat; tidak wajib lengkap." : "TTV dasar. Pilih keluhan utama untuk menyesuaikan; isi yang sempat."}</p>
            <div className="referral-vitals">
              {vitals.map((key) => {
                const suggested = plan.requiredVitals.includes(key);
                return (
                  <label key={key} className="referral-field">
                    <span>{VITAL_LABELS[key].label} {suggested && <small>disarankan</small>} <small>{VITAL_LABELS[key].unit}</small></span>
                    <input value={draft.clinical.vitals[key]} maxLength={20} placeholder={VITAL_LABELS[key].placeholder} onChange={(event) => setVital(key, event.target.value)} />
                  </label>
                );
              })}
            </div>

            <h3>Informasi untuk penerima (opsional)</h3>
            <div className="referral-grid">
                <label className="referral-field referral-span-2"><span>Alasan / keluhan utama</span><textarea value={draft.clinical.reason} maxLength={1000} rows={2} placeholder="mis. tensi tidak terkontrol, perlu evaluasi Sp.OG" onChange={(event) => patchClinical({ reason: event.target.value })} /></label>
                <label className="referral-field"><span>Alergi obat / makanan</span><input value={draft.clinical.allergy} maxLength={300} placeholder="mis. Tidak ada" onChange={(event) => patchClinical({ allergy: event.target.value })} /></label>
                <label className="referral-field referral-span-2"><span>Terapi atau tindakan yang sudah diberikan</span><textarea value={draft.clinical.therapy} maxLength={1000} rows={2} onChange={(event) => patchClinical({ therapy: event.target.value })} /></label>
            </div>

            <details className="referral-more">
              <summary>Data tambahan (opsional)</summary>
              <div className="referral-grid">
                <label className="referral-field"><span>Jenis faskes</span><select value={draft.referrer.facilityType} onChange={(event) => patchReferrer({ facilityType: event.target.value as ReferralDraft["referrer"]["facilityType"] })}>{FACILITY_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
                <label className="referral-field"><span>Penjamin</span><select value={draft.clinical.insurer} onChange={(event) => patchClinical({ insurer: event.target.value as ReferralDraft["clinical"]["insurer"] })}>{INSURERS.map((insurer) => <option key={insurer} value={insurer}>{insurer}</option>)}</select></label>
                <label className="referral-field"><span>Tanggal</span><input type="date" value={draft.clinical.date} onChange={(event) => patchClinical({ date: event.target.value })} /></label>
                <label className="referral-field"><span>Jam</span><input type="time" value={draft.clinical.time} onChange={(event) => patchClinical({ time: event.target.value })} /></label>
                <label className="referral-field"><span>Keluhan sejak</span><input value={draft.clinical.onset} maxLength={80} placeholder="mis. 3 hari" onChange={(event) => patchClinical({ onset: event.target.value })} /></label>
                <label className="referral-field"><span>Kehamilan (bila ada)</span><input value={draft.clinical.pregnancy} maxLength={120} placeholder="mis. G2P1A0, 32 minggu" onChange={(event) => patchClinical({ pregnancy: event.target.value })} /></label>
                <label className="referral-field"><span>Catatan tambahan</span><input value={draft.clinical.notes} maxLength={1000} onChange={(event) => patchClinical({ notes: event.target.value })} /></label>
              </div>
            </details>

            {draft.clinical.profileId && (
              <details className="referral-more">
                <summary>Kelengkapan yang disarankan (opsional)</summary>
                {GROUPS.map((group) => {
                  const items = profile.items.filter((entry) => entry.group === group);
                  if (!items.length) return null;
                  return (
                    <fieldset key={group} className="referral-check-group">
                      <legend>{CHECKLIST_GROUP_LABELS[group]}</legend>
                      <div className="referral-check-grid">
                        {items.map((entry) => (
                          <label key={entry.id} className="referral-check">
                            <input type="checkbox" checked={draft.clinical.checks[entry.id] === true} onChange={(event) => setCheck(entry.id, event.target.checked)} />
                            <span>{entry.label}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  );
                })}
                {profile.note && <p className="referral-note">{profile.note}</p>}
                {profile.source && <p className="referral-source">Mengacu {profile.source.title} ({profile.source.docId}).</p>}
              </details>
            )}

            <label className="referral-consent">
              <input {...fieldProps("referral-consent")} type="checkbox" checked={draft.consent} onChange={(event) => setDraft((current) => ({ ...current, consent: event.target.checked }))} />
              <span>Saya sudah menjelaskan tujuan rujukan kepada pasien atau keluarganya dan mendapat izin mengirim data ini ke RSIA Melinda DHAI. <b aria-hidden="true">*</b></span>
            </label>
            <p className="referral-privacy">Pemberitahuan privasi: data pasien dan perujuk pada form ini dikirim ke RSIA Melinda DHAI, hanya dibuka oleh petugas rumah sakit yang berwenang, dan dipakai untuk menyiapkan penerimaan pasien rujukan. Permintaan koreksi atau penghapusan data dapat disampaikan langsung ke RSIA Melinda DHAI.</p>

            {fieldError("referral-consent")}
            {Object.keys(errors).length > 0 && (
              <div className="referral-error" role="alert">
                <strong>Lengkapi dulu:</strong>
                <ul>{Object.entries(errors).map(([id, label]) => <li key={id}><button type="button" className="referral-error-link" onClick={() => focusField(id)}>{label}</button></li>)}</ul>
              </div>
            )}
            {error && <p className="referral-error" role="alert">{error}</p>}

            <div className="referral-actions">
              <button type="button" className="director-button" disabled={sending || Boolean(receipt)} onClick={submit}>{sending ? "Mengirim…" : receipt ? "Sudah terkirim" : "Kirim rujukan"}</button>
              <button type="button" className="referral-button-secondary" onClick={() => window.print()}>Cetak / simpan PDF</button>
              <button type="button" className="referral-button-secondary" onClick={copy}>{copied ? "Tersalin" : "Salin ringkasan"}</button>
            </div>
            <p className="referral-privacy">Data disimpan di sistem RSIA Melinda DHAI. Draft pasien disimpan sementara dalam sesi tab ini untuk pemulihan. Gunakan Pasien berikutnya untuk membersihkan form pada perangkat bersama.</p>
          </section>
          </fieldset>
          <div className="referral-actions">
            <button type="button" className="referral-button-secondary" disabled={sending} onClick={() => receipt ? nextPatient() : setConfirmReset(true)}>Pasien berikutnya</button>
            {confirmReset && <div role="group" aria-label="Konfirmasi pasien berikutnya">
              <p>Hapus data pasien dan isi klinis pada form ini? Data perujuk tetap terisi.</p>
              <button type="button" className="referral-button-secondary" onClick={() => setConfirmReset(false)}>Batal</button>
              <button type="button" className="director-button" disabled={sending} onClick={nextPatient}>Ya, mulai pasien baru</button>
            </div>}
          </div>
        </div>

        <aside className="referral-preview-column" aria-label="Pratinjau lembar rujukan">
          <div className="referral-preview-head">
            <h2>Pratinjau lembar</h2>
            <span>{receipt ? receipt.reference : "Draf"}</span>
          </div>
          <article className="referral-sheet" id="lembar-rujukan">
            <header className="referral-sheet-head">
              <div className="referral-sheet-brand">
                <MelindaLogo className="referral-sheet-logo" title="RSIA Melinda DHAI" />
                <div>
                  <strong>RSIA Melinda DHAI</strong>
                  <span>{HOSPITAL.address} · {HOSPITAL.phone}</span>
                </div>
              </div>
              <div className="referral-sheet-title">
                <strong>Lembar rujukan pasien</strong>
                <span>{receipt ? `Nomor ${receipt.reference}` : "Nomor dibuat saat dikirim"}</span>
              </div>
            </header>

            <dl className="referral-sheet-body">
              <div><dt>Pasien</dt><dd>{draft.patient.name || "—"}{draft.patient.sex ? ` · ${draft.patient.sex === "L" ? "laki-laki" : "perempuan"}` : ""}{age ? ` · ${age}` : ""}</dd></div>
              <div><dt>Keluhan</dt><dd>{complaint?.label ?? "—"}</dd></div>
              {draft.patient.rm && <div><dt>No. rekam medis</dt><dd>{draft.patient.rm}</dd></div>}
              <div><dt>Perujuk</dt><dd>{[draft.referrer.doctor, draft.referrer.facility, draft.referrer.city].filter(Boolean).join(" · ") || "—"}</dd></div>
              <div><dt>Kontak</dt><dd>{draft.referrer.phone || "—"}</dd></div>
              <div><dt>Diagnosis</dt><dd>{draft.clinical.diagnosis || "—"}</dd></div>
              <div><dt>Alasan rujukan</dt><dd>{draft.clinical.reason || "—"}</dd></div>
              <div><dt>Tanda vital</dt><dd>{VITAL_KEYS.filter((key) => draft.clinical.vitals[key].trim()).map((key) => `${VITAL_LABELS[key].label} ${draft.clinical.vitals[key]} ${VITAL_LABELS[key].unit}`).join(" · ") || "—"}</dd></div>
              <div><dt>Kelengkapan</dt><dd>{checkedItems.length ? checkedItems.map((entry) => entry.label).join("; ") : "—"}</dd></div>
              <div><dt>Terapi</dt><dd>{draft.clinical.therapy || "—"}</dd></div>
              <div><dt>Alergi</dt><dd>{draft.clinical.allergy || "—"}</dd></div>
              {draft.clinical.pregnancy && <div><dt>Kehamilan</dt><dd>{draft.clinical.pregnancy}</dd></div>}
              <div><dt>Tujuan</dt><dd>{draft.clinical.destination} · {draft.clinical.insurer}</dd></div>
              <div><dt>Tanggal</dt><dd>{referralDateLabel(draft.clinical.date)}{draft.clinical.time ? `, ${draft.clinical.time} WIB` : ""}</dd></div>
              {draft.clinical.notes && <div><dt>Catatan</dt><dd>{draft.clinical.notes}</dd></div>}
            </dl>

            <footer className="referral-sheet-foot">
              <div>
                <span>Dokter / bidan perujuk</span>
                <strong>{draft.referrer.doctor || "—"}</strong>
              </div>
              <div className="referral-sign">Tanda tangan &amp; stempel</div>
            </footer>
            <p className="referral-sheet-note">Lembar ini disiapkan melalui MelindaOS. Keputusan klinis tetap pada dokter yang memeriksa.</p>
          </article>
          {!receipt && <p className="referral-preview-hint">Lembar akan bernomor setelah rujukan dikirim.</p>}
        </aside>
      </div>
      <div className="referral-mobile-bar">
        <a className="referral-button-secondary" href={HOSPITAL.phoneHref}>Telepon IGD</a>
        <button type="button" className="director-button" disabled={sending || Boolean(receipt)} onClick={submit}>{sending ? "Mengirim…" : receipt ? "Sudah terkirim" : "Kirim rujukan"}</button>
      </div>
    </div>
  );
}
