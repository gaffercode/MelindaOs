import { Info } from "lucide-react";
import { formatUtcDayMonth, formatUtcMonthYear } from "@/lib/date-label";
import { displayCaseDeep } from "@/lib/display-case";
import { wibTime } from "@/lib/director/director-data";
import { MEDIFY_MAX_AGE_MS } from "@/lib/freshness";
import { staggerStyle } from "@/lib/stagger-style";
import type { MedifyBedWard } from "@/lib/medify/medify-snapshot-contract";
import type { MedifySnapshotResult } from "@/lib/medify/medify-snapshot-store";
import { DailyChart } from "./medify-daily-chart";
import { MonthlyVisitsChart } from "./medify-monthly-chart";
import { MedifyPharmacyBlock, MedifyQualityBlock, MedifyServiceBlock, MedifyStaffBlock } from "./medify-section-extras";
import { SectionHeading } from "../melinda-brief/melinda-morning-brief";
import { ChangedSince, EntranceSeen } from "../motion";

const STALE_MS = 2 * 60 * 60 * 1000;
const warn = "text-[color:var(--warn)]";
const number = new Intl.NumberFormat("id-ID");
const decimal = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 });
const BOR_IDEAL_MAX = 85;
const TITLE = "Sensus & operasional (Medify)";
const MEDIFY_URL = "https://simrs.melinda.co.id";

/** Occupancy per ward, classes summed; a full ward is named in red-orange text, never a badge. */
function WardBars({ wards }: { wards: MedifyBedWard[] }) {
  const totals = [...wards.reduce((map, ward) => {
    const total = map.get(ward.ward) ?? { ward: ward.ward, occupied: 0, capacity: 0 };
    total.occupied += ward.occupied;
    total.capacity += ward.capacity;
    return map.set(ward.ward, total);
  }, new Map<string, { ward: string; occupied: number; capacity: number }>()).values()];
  return (
    <ul className="medify-wards">
      {totals.map((ward, index) => {
        const full = ward.capacity > 0 && ward.occupied >= ward.capacity;
        return (
          <li key={ward.ward}>
            <span className={full ? warn : undefined}>{ward.ward}</span>
            <span className="medify-ward-track" aria-hidden="true"><span className={full ? "medify-ward-fill medify-ward-full" : "medify-ward-fill"} style={staggerStyle({ width: `${ward.capacity ? Math.min(100, (ward.occupied / ward.capacity) * 100) : 0}%` }, index)} /></span>
            <span className="medify-ward-count">{ward.occupied}/{ward.capacity}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** The strip states the pull time once; a block speaks only when its section failed or lags the rest of the pull. */
function Freshness({ observedAt, newest, checkedAt }: { observedAt: string | null; newest: number; checkedAt: string }) {
  if (!observedAt) return <p className={`text-base m-0 mt-3 ${warn}`}>Gagal ditarik pada tarikan terakhir.</p>;
  if (newest - Date.parse(observedAt) <= STALE_MS) return null;
  return <p className={`text-base m-0 mt-3 ${warn}`}>Data {Math.floor((Date.parse(checkedAt) - Date.parse(observedAt)) / 3_600_000)} jam lalu ({wibTime(observedAt)}).</p>;
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="medify-block">
      <h3 className="text-lg font-medium text-slate-800 m-0 mb-2">{title}</h3>
      {children}
    </div>
  );
}

/**
 * Live aggregate numbers pulled from Medify with their real daily series. Inside the brief this is
 * section 00 (`number`); without a brief it stands alone. Exceptions are plain red-orange text.
 * The finance section is pulled but not shown: on 2026-10-27 it did not match Medify's own Keuangan screen.
 */
export function MedifyLivePanel({ result: published, number: sectionNumber, entryCard }: { result: MedifySnapshotResult; number?: string; entryCard?: React.ReactNode }) {
  // Medify writes names and categories in capitals; nothing on the dashboard is shown that way (display-case.ts).
  const result = displayCaseDeep(published);
  const sections = result.snapshot ? [result.snapshot.bed, result.snapshot.inpatient, result.snapshot.outpatient, result.snapshot.igd, result.snapshot.patients] : [];
  const newest = Math.max(0, ...sections.flatMap((section) => (section?.observedAt ? [Date.parse(section.observedAt)] : [])));
  // "Data kemarin" sits in the strip, without the date: the masthead already carries the day (Director 2026-11-09).
  const heading = <SectionHeading id="section-00" number={sectionNumber} title={TITLE}><span className="melinda-section-meta text-slate-500">{result.status === "previous" && <span role="note">Data kemarin · </span>}{newest > 0 && <span className={Date.parse(result.checkedAt) - newest > MEDIFY_MAX_AGE_MS ? warn : undefined}>Data per {wibTime(new Date(newest).toISOString())} · </span>}<a href={MEDIFY_URL} target="_blank" rel="noreferrer" className="text-[var(--accent)] hover:underline">simrs.melinda.co.id →</a></span></SectionHeading>;
  const failedRun = result.runStatus?.status === "failed"
    ? `Tarikan ${result.runStatus.slot === "morning" ? "pagi" : "sore"} gagal.${result.snapshot ? " Data yang tampil adalah data terakhir valid." : " Belum ada data valid untuk ditampilkan."}`
    : null;
  if (!result.snapshot) {
    return (
      <section className="swiss-section mb-8" aria-labelledby="section-00">
        {heading}
        {failedRun ? <p role="status" className={`text-base m-0 ${warn}`}>{failedRun}</p> : null}
        <p role="status" className={`text-base m-0 ${warn}`}>{result.message}</p>
      </section>
    );
  }
  const { bed, outpatient, igd, inpatient, patients, provenance } = result.snapshot;
  const runWarning = failedRun
    ? failedRun
    : result.runStatus?.status === "degraded"
      ? `Terbit dengan peringatan: ${result.runStatus.unavailableSections.map((issue) => issue.section ?? "sumber Medify").join(", ")} tidak tersedia pada tarikan ${result.runStatus.slot === "morning" ? "pagi" : "sore"}.`
      : result.snapshot.run?.status === "degraded"
        ? "Terbit dengan peringatan: sebagian data Medify tidak tersedia pada tarikan ini."
        : null;
  const lastDay = inpatient?.daily.at(-1);
  const thisMonth = inpatient?.monthly.at(-1);
  const occupied = bed?.wards.reduce((sum, ward) => sum + ward.occupied, 0) ?? 0;
  const capacity = bed?.wards.reduce((sum, ward) => sum + ward.capacity, 0) ?? 0;
  const full = bed?.wards.filter((ward) => ward.capacity > 0 && ward.occupied >= ward.capacity) ?? [];
  const channels = inpatient?.daily.every((day) => day.online !== undefined && day.onsite !== undefined && day.anjungan !== undefined)
    ? inpatient.daily.reduce((sum, day) => ({ online: sum.online + (day.online ?? 0), onsite: sum.onsite + (day.onsite ?? 0), anjungan: sum.anjungan + (day.anjungan ?? 0) }), { online: 0, onsite: 0, anjungan: 0 })
    : null;
  return (
    <section className="swiss-section mb-8" aria-labelledby="section-00">
      {heading}
      {runWarning && <p role="status" className={`text-base m-0 mb-3 ${warn}`}>{runWarning}</p>}
      <div className="medify-live-grid grid">
        <Block title="Sensus bed">
          {bed ? (
            <>
              <div className="medify-headline">
                <ChangedSince className="medify-figure" watchKey={`${result.snapshot.date}:bed`} value={`${occupied}/${capacity}`}>{occupied}/{capacity} terisi</ChangedSince>
                <p className="text-base text-slate-700 m-0">BOR {capacity ? Math.round((occupied / capacity) * 100) : 0}%</p>
              </div>
              {full.length > 0 && <p className={`text-base m-0 mt-2 ${warn}`}>Penuh: {full.map((ward) => `${ward.ward} kelas ${ward.kelas} (${ward.occupied}/${ward.capacity})`).join(", ")}.</p>}
              <WardBars wards={bed.wards} />
            </>
          ) : null}
          <Freshness observedAt={bed?.observedAt ?? null} newest={newest} checkedAt={result.checkedAt} />
        </Block>
        <Block title="Rawat inap">
          {inpatient && lastDay && thisMonth ? (
            <>
              <div className="medify-headline">
                <ChangedSince className="medify-figure" watchKey={`${result.snapshot.date}:bor`} value={String(lastDay.bor)}>BOR {decimal.format(lastDay.bor)}%</ChangedSince>
                <p className="text-base text-slate-700 m-0">{formatUtcDayMonth(lastDay.date)}, {number.format(lastDay.admissions)} pasien masuk</p>
              </div>
              {lastDay.bor > BOR_IDEAL_MAX && <p className={`text-base m-0 mt-2 ${warn}`}>Di atas batas ideal {BOR_IDEAL_MAX}%.</p>}
              <DailyChart kind="line" label="BOR harian" unit="%" reference={BOR_IDEAL_MAX} points={inpatient.daily.map((day) => ({ date: day.date, value: day.bor }))} />
              <p className="text-base text-slate-700 m-0 mt-2">Bulan ini: BOR {decimal.format(thisMonth.bor)}% · TOI {decimal.format(thisMonth.toi)} hari · BTO {decimal.format(thisMonth.bto)} kali · {number.format(thisMonth.admissions)} pasien masuk</p>
              <p className="text-base text-slate-700 m-0">GDR {decimal.format(thisMonth.gdr)}‰ · NDR {decimal.format(thisMonth.ndr)}‰</p>
              {channels && <p className="text-base text-slate-700 m-0 mt-2">Pendaftaran {inpatient.daily.length} hari: onsite {number.format(channels.onsite)} · online {number.format(channels.online)} · anjungan {number.format(channels.anjungan)}</p>}
            </>
          ) : null}
          <Freshness observedAt={inpatient?.observedAt ?? null} newest={newest} checkedAt={result.checkedAt} />
        </Block>
        {entryCard && <Block title="Melinda">{entryCard}</Block>}
        <Block title="Rawat jalan">
          {outpatient ? (
            <>
              <div className="medify-headline">
                <ChangedSince className="medify-figure" watchKey={`${result.snapshot.date}:outpatient`} value={String(outpatient.visitsToday)}>{outpatient.visitsToday === null ? "Belum ada" : number.format(outpatient.visitsToday)}</ChangedSince>
                <p className="text-base text-slate-700 m-0">Kunjungan hari ini</p>
              </div>
              <DailyChart label="Kunjungan rawat jalan harian" points={outpatient.daily.slice(-31).map((day) => ({ date: day.date, value: day.visits }))} />
              <p className="text-base text-slate-700 m-0 mt-2">{outpatient.daily.length} hari terakhir: {outpatient.byPayer.map((payer) => `${payer.name} ${number.format(payer.visits)}`).join(" · ")}</p>
              {outpatient.newPatients !== null && outpatient.returningPatients !== null && <p className="text-base text-slate-700 m-0">Pasien baru {number.format(outpatient.newPatients)} · lama {number.format(outpatient.returningPatients)}</p>}
            </>
          ) : null}
          <Freshness observedAt={outpatient?.observedAt ?? null} newest={newest} checkedAt={result.checkedAt} />
        </Block>
        <Block title="IGD">
          {igd ? (
            <>
              <div className="medify-headline">
                <ChangedSince className="medify-figure" watchKey={`${result.snapshot.date}:igd`} value={String(igd.visitsToday)}>{igd.visitsToday === null ? "Belum ada" : number.format(igd.visitsToday)}</ChangedSince>
                <p className="text-base text-slate-700 m-0">Kunjungan hari ini</p>
              </div>
              <DailyChart label="Kunjungan IGD harian" points={igd.daily.map((day) => ({ date: day.date, value: day.visits }))} />
              <p className="text-base text-slate-700 m-0 mt-2">{igd.daily.length} hari terakhir: {number.format(igd.daily.reduce((sum, day) => sum + day.visits, 0))} kunjungan</p>
              {igd.topDiagnoses.length > 0 && <p className="text-base text-slate-700 m-0">Diagnosis terbanyak bulan ini: {igd.topDiagnoses.slice(0, 3).map((item) => `${item.name} (${number.format(item.visits)})`).join("; ")}</p>}
            </>
          ) : null}
          <Freshness observedAt={igd?.observedAt ?? null} newest={newest} checkedAt={result.checkedAt} />
        </Block>
        {/* Optional section: snapshots from before the patient feed existed simply have no fifth block. */}
        {patients && (
          <Block title="Basis pasien & kunjungan bulanan">
            <div className="medify-headline">
              <ChangedSince className="medify-figure" watchKey={`${result.snapshot.date}:patients`} value={String(patients.total)}>{number.format(patients.total)}</ChangedSince>
              <p className="text-base text-slate-700 m-0">Pasien terdaftar di Medify · Pasien baru hari ini {number.format(patients.newToday)} · transaksi hari ini {number.format(patients.transactionsToday)}</p>
            </div>
            <MonthlyVisitsChart months={patients.monthlyVisits} />
            {patients.newMonthly.length > 0 && <p className="text-base text-slate-700 m-0 mt-2">Pasien baru per bulan: {patients.newMonthly.slice(-6).map((month) => `${formatUtcMonthYear(month.month)}: ${number.format(month.count)}`).join(" · ")}</p>}
            <Freshness observedAt={patients.observedAt} newest={newest} checkedAt={result.checkedAt} />
          </Block>
        )}
      </div>
      <EntranceSeen />
      {/* Inside the brief these lists sit under sections 02 to 05; standing alone there is nowhere else to show them. */}
      {!sectionNumber && (
        <>
          <MedifyServiceBlock snapshot={result.snapshot} />
          <MedifyQualityBlock snapshot={result.snapshot} />
          <MedifyPharmacyBlock snapshot={result.snapshot} />
          <MedifyStaffBlock snapshot={result.snapshot} />
        </>
      )}
      <details className="mt-3 text-base text-slate-600">
        <summary className="inline-flex items-center gap-1 cursor-pointer" aria-label="Sumber data Medify"><Info size={16} aria-hidden="true" /> Sumber</summary>
        <p className="m-0 mt-2">{provenance.sources.map((source) => `${source.name}: ${source.note}`).join(" ")} Diterima dashboard {wibTime(result.receivedAt)} dari {provenance.producer}.</p>
        {provenance.notes && <p className={`m-0 mt-1 ${warn}`}>{provenance.notes}</p>}
      </details>
    </section>
  );
}
