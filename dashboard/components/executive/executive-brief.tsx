import { Stethoscope, CircleAlert, MonitorCheck } from "lucide-react";
import { longDate, wibDate, wibTime, type ExecutiveBrief } from "@/lib/director/director-data";
import type { DirectorSubmission, SourceProvenance } from "@/lib/director/director-submission";
import { SourceInfo } from "../source-info";

function SourceUpdate({ brief, source }: { brief: ExecutiveBrief; source?: SourceProvenance }) {
  return <SourceInfo><p className="director-update">Diperbarui pukul {wibTime(source?.sourceObservedAt ?? brief.updatedAt)} · {source?.source.label ?? brief.source}{source && <> · pengamatan {longDate(wibDate(new Date(source.sourceObservedAt)))} · periode {longDate(source.periodStart)}–{longDate(source.periodEnd)}</>}</p></SourceInfo>;
}

export function ExecutiveInsights({ brief }: { brief: ExecutiveBrief }) {
  return <section className="executive-insights" aria-label="Temuan eksekutif"><div className="executive-positive"><h2>Yang berjalan baik</h2><ul>{brief.positiveNotes.map((note) => <li key={note}>{note}</li>)}</ul></div><div className="executive-findings"><h2><MonitorCheck size={15} />Sistem & kualitas data</h2><ul>{brief.systems.map((item) => <li key={item.id}><strong>{item.title}</strong> — {item.detail}</li>)}{brief.validationNotes.map((note) => <li key={note}>{note}</li>)}</ul></div></section>;
}

export function ExecutiveBriefView({ brief, provenance }: { brief: ExecutiveBrief; provenance?: DirectorSubmission["provenance"] }) {
  const { inpatient, outpatient, emergency } = brief;
  const occupied = inpatient?.occupied, capacity = inpatient?.capacity;
  const ringPercent = occupied != null && capacity != null && capacity > 0 ? occupied / capacity * 100 : null;
  const zeroPediatrics = outpatient && outpatient.days.length > 0 && outpatient.days.every((day) => day.pediatrics === 0) && (outpatient.pediatricsLast31Days ?? 0) > 0;
  return <section className="chart-grid executive-brief-grid" aria-label="Brief kondisi rumah sakit">
      <article className="chart-panel"><div className="chart-panel-heading"><h2>Rawat inap & kapasitas</h2>{inpatient && <SourceUpdate brief={brief} source={provenance?.inpatient} />}</div><div className="chart-panel-surface executive-brief-surface">
        {inpatient ? <div className="executive-inpatient"><div className="executive-bed-overview"><div className="fleet-ring" role="img" aria-label={ringPercent === null ? "Hunian belum tersedia" : `Hunian ${occupied} dari ${capacity} bed, ${inpatient.occupancyPercent}%`} style={{ background: ringPercent === null ? "var(--brand-lavender)" : `conic-gradient(var(--brand-teal) 0 ${ringPercent}%, var(--brand-lavender) ${ringPercent}% 100%)` }}><div><strong>{inpatient.occupancyPercent === null ? "—" : `${inpatient.occupancyPercent}%`}</strong><span>Hunian bed</span></div></div><div><strong>{occupied ?? "—"} pasien rawat inap</strong><p>Dari {capacity ?? "—"} bed · <b>{inpatient.vacant ?? "—"} bed kosong</b></p>{ringPercent !== null && ringPercent < 100 && <span className="director-urgent-label">Kapasitas belum optimal</span>}</div></div>
        <div className="executive-table-wrap"><table className="executive-table"><caption className="sr-only">Hunian per ruang pada waktu sumber</caption><thead><tr><th>Ruangan</th><th>Terisi</th><th>Bed</th><th>Catatan</th></tr></thead><tbody>{inpatient.wards.map((ward) => <tr key={ward.id}><th scope="row">{ward.name}</th><td>{ward.occupied ?? "—"}</td><td>{ward.capacity ?? "—"}</td><td>{ward.note || "—"}</td></tr>)}</tbody></table></div></div> : <p className="director-empty">Belum tersedia: data rawat inap.</p>}
        <p className="director-report-note">Tanda — berarti kapasitas per ruang tidak disebutkan dalam brief, bukan nol bed.</p>
      </div></article>
      <article className="chart-panel"><div className="chart-panel-heading"><h2>Poli & IGD</h2><Stethoscope size={16} /></div><div className="chart-panel-surface executive-brief-surface">
        <div className="executive-subheading-row"><h3 className="executive-subheading">Poli · periode yang dilaporkan</h3>{outpatient && <SourceUpdate brief={brief} source={provenance?.outpatient} />}</div>
        {outpatient ? <><div className="executive-table-wrap"><table className="executive-table"><thead><tr><th>Tanggal</th><th>Total</th><th>Obgyn</th><th>Anak</th></tr></thead><tbody>{outpatient.days.map((day) => <tr key={day.date}><th scope="row">{longDate(day.date)}</th><td>{day.total ?? "—"}</td><td>{day.obgyn ?? "—"}</td><td>{day.pediatrics ?? "—"}</td></tr>)}</tbody></table></div>
        {zeroPediatrics && <p className="executive-callout"><CircleAlert size={13} />Poli Anak: 0 pada hari yang dilaporkan, tetapi {outpatient.pediatricsLast31Days} kunjungan dalam 31 hari terakhir. Perlu verifikasi pencatatan.</p>}
        <h3 className="executive-subheading">Pembayar poli · periode sumber</h3><dl className="executive-payers"><div><dt>Tunai</dt><dd>{outpatient.payerMix?.cash ?? "—"}</dd></div><div><dt>BPJS</dt><dd>{outpatient.payerMix?.bpjs ?? "—"}</dd></div><div><dt>Asuransi swasta</dt><dd>{outpatient.payerMix?.insurance ?? "—"}</dd></div></dl>
        <p className="director-report-note">Pasien baru: <strong>{outpatient.newPatientsPercent === null ? "Belum tersedia" : `${outpatient.newPatientsPercent}%`}</strong> menurut brief; periode mengikuti sumber.</p></> : <p className="director-empty">Belum tersedia: data poli.</p>}
        <div className="executive-subheading-row"><h3 className="executive-subheading">IGD</h3>{emergency && <SourceUpdate brief={brief} source={provenance?.emergency} />}</div>{emergency ? <ul className="executive-daily-list">{emergency.days.map((day) => <li key={day.date}><span>{longDate(day.date)}{day.cutoff && <small>Sampai {day.cutoff} WIB</small>}</span><strong>{day.visits ?? "—"}<small>pasien</small></strong></li>)}</ul> : <p className="director-empty">Belum tersedia: data IGD.</p>}
      </div></article>
    </section>;
}
