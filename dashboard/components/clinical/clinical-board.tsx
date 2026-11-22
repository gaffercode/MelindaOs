"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  CLINICAL_KINDS,
  CLINICAL_KIND_LABELS,
  INCIDENT_GRADES,
  INCIDENT_PROGRESS,
  INCIDENT_TYPES,
  SHIFTS,
  SHIFT_LABELS,
  type ClinicalDraft,
  type ClinicalKind,
  type RosterPerson,
  type Shift,
  type StoredClinicalEntry,
} from "@/lib/clinical/clinical-types";

type Fields = Record<string, string>;

const dateLabel = (value: string) => {
  const parsed = new Date(`${value}T00:00:00+07:00`);
  return Number.isFinite(parsed.getTime()) ? new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "full" }).format(parsed) : value;
};

/** One line per person, "Nama - Peran" (the role is optional). */
function parsePeople(raw: string): RosterPerson[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, ...rest] = line.split(/\s+-\s+/);
      return { name: name.trim(), role: rest.join(" - ").trim() };
    });
}

function buildDraft(kind: ClinicalKind, date: string, shift: Shift | "", unit: string, f: Fields): ClinicalDraft {
  const base = { date, unit, shift: shift === "" ? null : shift };
  if (kind === "handover") {
    return { kind, ...base, payload: { patient: f.patient ?? "", rm: f.rm ?? "", room: f.room ?? "", situation: f.situation ?? "", background: f.background ?? "", assessment: f.assessment ?? "", recommendation: f.recommendation ?? "", pending: f.pending ?? "", from: f.from ?? "", to: f.to ?? "" } };
  }
  if (kind === "roster") return { kind, ...base, payload: { people: parsePeople(f.people ?? ""), notes: f.notes ?? "" } };
  const type = INCIDENT_TYPES.find((value) => value === f.type) ?? INCIDENT_TYPES[0];
  const grade = INCIDENT_GRADES.find((value) => value === f.grade) ?? INCIDENT_GRADES[0];
  const progress = INCIDENT_PROGRESS.find((value) => value === f.progress) ?? INCIDENT_PROGRESS[0];
  return { kind, ...base, payload: { time: f.time ?? "", place: f.place ?? "", type, grade, chronology: f.chronology ?? "", followUp: f.followUp ?? "", progress, reporter: f.reporter ?? "" } };
}

function Summary({ entry }: { entry: StoredClinicalEntry }) {
  if (entry.kind === "handover") {
    const p = entry.payload;
    return (
      <>
        <strong>{p.patient}{p.rm ? ` · RM ${p.rm}` : ""}{p.room ? ` · ${p.room}` : ""}</strong>
        <p>{p.situation}</p>
        {p.recommendation ? <p>Rekomendasi: {p.recommendation}</p> : null}
        {p.pending ? <p>Belum selesai: {p.pending}</p> : null}
        <small>{p.from} → {p.to}</small>
      </>
    );
  }
  if (entry.kind === "roster") {
    return (
      <>
        <ul className="klinis-people">
          {entry.payload.people.map((person, index) => <li key={`${person.name}-${index}`}>{person.name}{person.role ? ` — ${person.role}` : ""}</li>)}
        </ul>
        {entry.payload.notes ? <small>{entry.payload.notes}</small> : null}
      </>
    );
  }
  const p = entry.payload;
  return (
    <>
      <strong>{p.type} · grading {p.grade} · {p.progress}</strong>
      <p>{p.time} di {p.place}</p>
      <p>{p.chronology}</p>
      {p.followUp ? <p>Tindak lanjut: {p.followUp}</p> : null}
      <small>Pelapor: {p.reporter}</small>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="klinis-field"><span>{label}</span>{children}</label>;
}

export function ClinicalBoard({ initial, today, unavailable }: { initial: StoredClinicalEntry[]; today: string; unavailable: string }) {
  const [rows, setRows] = useState(initial);
  const [kind, setKind] = useState<ClinicalKind>("handover");
  const [adding, setAdding] = useState(false);
  const [date, setDate] = useState(today);
  const [shift, setShift] = useState<Shift | "">("pagi");
  const [unit, setUnit] = useState("");
  const [fields, setFields] = useState<Fields>({});
  const [key, setKey] = useState("");
  const [csrf, setCsrf] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/access/session")
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { csrfToken?: string } | null) => { if (!cancelled && body?.csrfToken) setCsrf(body.csrfToken); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const shown = rows.filter((row) => row.kind === kind && row.status === "aktif");
  const set = (name: string) => (event: { target: { value: string } }) => setFields((current) => ({ ...current, [name]: event.target.value }));
  const text = (name: string, props: { required?: boolean; max?: number } = {}) => <input value={fields[name] ?? ""} onChange={set(name)} required={props.required} maxLength={props.max} />;
  const area = (name: string, props: { required?: boolean; max: number }) => <textarea rows={3} value={fields[name] ?? ""} onChange={set(name)} required={props.required} maxLength={props.max} />;
  const choice = (name: string, options: readonly string[]) => (
    <select value={fields[name] ?? options[0]} onChange={set(name)}>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select>
  );

  const openForm = (next: ClinicalKind) => {
    setKind(next);
    setAdding(false);
    setMessage("");
    setError("");
  };
  const startAdding = () => {
    setFields({});
    setKey(crypto.randomUUID());
    setShift(kind === "insiden" ? "" : "pagi");
    setAdding(true);
    setMessage("");
    setError("");
  };

  async function send(url: string, body: unknown, idempotency?: string) {
    if (!csrf) throw new Error("Sesi belum siap. Muat ulang halaman lalu coba lagi.");
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf, ...(idempotency ? { "Idempotency-Key": idempotency } : {}) },
      body: JSON.stringify(body),
    });
    const result = (await response.json().catch(() => ({}))) as { error?: string; entry?: StoredClinicalEntry; id?: string; createdAt?: string };
    if (!response.ok) throw new Error(result.error ?? "Permintaan belum dapat diproses.");
    return result;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const draft = buildDraft(kind, date, shift, unit, fields);
      const receipt = await send("/api/director/klinis", draft, key);
      if (!receipt.id || !receipt.createdAt) throw new Error("Jawaban server tidak lengkap.");
      const stored = { ...draft, id: receipt.id, status: "aktif", revision: 1, createdBy: "Anda", createdAt: receipt.createdAt, updatedBy: null, updatedAt: null } as StoredClinicalEntry;
      setRows((current) => [stored, ...current]);
      setAdding(false);
      setMessage("Isian tersimpan.");
    } catch (submitError) {
      setError((submitError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function cancel(entry: StoredClinicalEntry) {
    if (!window.confirm("Batalkan isian ini? Isian yang dibatalkan tidak tampil lagi di sini maupun di MCP.")) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await send(`/api/director/klinis/${entry.id}`, { kind: entry.kind, revision: entry.revision, status: "dibatalkan" });
      setRows((current) => current.filter((row) => row.id !== entry.id));
      setMessage("Isian dibatalkan.");
    } catch (cancelError) {
      setError((cancelError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="klinis">
      <header className="klinis-head">
        <div>
          <h1>Data klinis</h1>
          <p>Serah terima, roster jaga, dan insiden. Hanya Direktur dan dokter yang dapat membuka halaman ini.</p>
        </div>
        {!unavailable && !adding ? <button type="button" className="klinis-primary" onClick={startAdding}>Tambah {CLINICAL_KIND_LABELS[kind].toLowerCase()}</button> : null}
      </header>

      <nav className="klinis-tabs" aria-label="Jenis isian">
        {CLINICAL_KINDS.map((value) => (
          <button key={value} type="button" className={value === kind ? "is-active" : ""} aria-pressed={value === kind} onClick={() => openForm(value)}>{CLINICAL_KIND_LABELS[value]}</button>
        ))}
      </nav>

      {unavailable ? <p className="klinis-error" role="alert">{unavailable}</p> : null}
      {message ? <p className="klinis-ok" role="status">{message}</p> : null}
      {error ? <p className="klinis-error" role="alert">{error}</p> : null}

      {adding ? (
        <form className="klinis-form" onSubmit={submit}>
          <Field label="Tanggal"><input type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></Field>
          {kind !== "insiden" ? (
            <Field label="Shift">
              <select value={shift} onChange={(event) => setShift(SHIFTS.find((value) => value === event.target.value) ?? "pagi")}>
                {SHIFTS.map((value) => <option key={value} value={value}>{SHIFT_LABELS[value]}</option>)}
              </select>
            </Field>
          ) : null}
          <Field label="Unit"><input value={unit} onChange={(event) => setUnit(event.target.value)} required maxLength={60} placeholder="mis. Rawat inap" /></Field>

          {kind === "handover" ? (
            <>
              <Field label="Nama pasien">{text("patient", { required: true, max: 120 })}</Field>
              <Field label="No. RM">{text("rm", { max: 30 })}</Field>
              <Field label="Ruang">{text("room", { max: 60 })}</Field>
              <Field label="Situasi">{area("situation", { required: true, max: 1000 })}</Field>
              <Field label="Latar belakang">{area("background", { max: 1000 })}</Field>
              <Field label="Penilaian">{area("assessment", { max: 1000 })}</Field>
              <Field label="Rekomendasi">{area("recommendation", { max: 1000 })}</Field>
              <Field label="Tindakan yang belum selesai">{area("pending", { max: 500 })}</Field>
              <Field label="Diserahkan oleh">{text("from", { required: true, max: 80 })}</Field>
              <Field label="Diterima oleh">{text("to", { required: true, max: 80 })}</Field>
            </>
          ) : null}

          {kind === "roster" ? (
            <>
              <Field label="Petugas jaga (satu baris per orang, tulis: Nama - Peran)">{area("people", { required: true, max: 4000 })}</Field>
              <Field label="Catatan">{area("notes", { max: 500 })}</Field>
            </>
          ) : null}

          {kind === "insiden" ? (
            <>
              <Field label="Jam kejadian"><input type="time" value={fields.time ?? ""} onChange={set("time")} required /></Field>
              <Field label="Lokasi">{text("place", { required: true, max: 100 })}</Field>
              <Field label="Jenis">{choice("type", INCIDENT_TYPES)}</Field>
              <Field label="Grading">{choice("grade", INCIDENT_GRADES)}</Field>
              <Field label="Kronologi">{area("chronology", { required: true, max: 2000 })}</Field>
              <Field label="Tindak lanjut">{area("followUp", { max: 1000 })}</Field>
              <Field label="Status">{choice("progress", INCIDENT_PROGRESS)}</Field>
              <Field label="Pelapor">{text("reporter", { required: true, max: 80 })}</Field>
            </>
          ) : null}

          <div className="klinis-actions">
            <button type="submit" className="klinis-primary" disabled={busy}>{busy ? "Menyimpan…" : "Simpan"}</button>
            <button type="button" onClick={() => setAdding(false)} disabled={busy}>Batal</button>
          </div>
        </form>
      ) : null}

      <section aria-label={CLINICAL_KIND_LABELS[kind]}>
        {shown.length === 0 && !unavailable ? <p className="klinis-empty">Belum ada isian {CLINICAL_KIND_LABELS[kind].toLowerCase()}.</p> : null}
        <ul className="klinis-list">
          {shown.map((entry) => (
            <li key={entry.id} className="klinis-entry">
              <div className="klinis-entry-meta">
                <span>{dateLabel(entry.date)}{entry.shift ? ` · shift ${SHIFT_LABELS[entry.shift].toLowerCase()}` : ""} · {entry.unit}</span>
                <button type="button" className="klinis-link" onClick={() => cancel(entry)} disabled={busy}>Batalkan</button>
              </div>
              <Summary entry={entry} />
              <small>Dicatat oleh {entry.createdBy}</small>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
