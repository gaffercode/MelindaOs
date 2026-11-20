import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
import { DirectorInstruction, InstructionProvider } from "./director-instruction";
import { DirectorShell, DirectorSummary } from "./director-shell";
import { ExecutiveBriefView, ExecutiveInsights } from "../executive/executive-brief";
import { SourceInfo } from "../source-info";
import { longDate, wibDate, wibTime, type ScheduleItem } from "@/lib/director/director-data";
import type { DirectorResult } from "@/lib/director/director-repository";

function Update({ updatedAt, source, date }: { updatedAt: string | null; source: string; date: string }) {
  const outdated = updatedAt && wibDate(new Date(updatedAt)) !== date;
  return <SourceInfo><div className="director-update"><span>Diperbarui pukul {updatedAt ? wibTime(updatedAt) : "— WIB"}{updatedAt && <time dateTime={updatedAt}> • {longDate(wibDate(new Date(updatedAt)))}</time>}</span>
    <span>Sumber: {source}{outdated && " • pembaruan bukan pada tanggal laporan"}</span>
  </div></SourceInfo>;
}
function Panel({ id, title, metadata, date, children }: {
  id: string; title: string; metadata: { updatedAt: string | null; source: string }; date: string; children: ReactNode;
}) {
  return <section className="chart-panel director-panel" aria-labelledby={id}><div className="chart-panel-heading director-panel-heading"><h2 id={id}>{title}</h2><Update {...metadata} date={date} /></div><div className="chart-panel-surface director-panel-surface">{children}</div></section>;
}
const plainPic = (pic: string) => pic.replace(/\b(?:Bapak|Ibu|Pak|Bu)\s+/g, "").split(" · ").join(", ");
function Empty({ updatedAt, label }: { updatedAt: string | null; label: string }) {
  return <p className="director-empty">{updatedAt ? label : "Data belum tersedia. Menunggu sumber resmi."}</p>;
}
function Schedule({ items, updatedAt }: { items: ScheduleItem[]; updatedAt: string | null }) {
  return items.length ? <ul className="director-list director-schedule">{[...items].sort((a, b) => a.start.localeCompare(b.start)).map((item) => <li key={item.id}><span className="director-time">{item.start}–{item.end} WIB</span><span><strong>— {item.title}</strong>{item.note && <span className="director-note"> ({item.note})</span>}</span></li>)}</ul> : <Empty updatedAt={updatedAt} label="Tidak ada agenda tercatat untuk tanggal ini." />;
}

export function DirectorCenter({ result, today, authenticated = false, embedded = false, followLatest = false }: {
  result: DirectorResult; today: string; authenticated?: boolean; embedded?: boolean; followLatest?: boolean;
}) {
  const { data, status, message } = result;
  const historic = data.date !== today;
  const urgent = data.priorities.items.filter((item) => item.urgent).length;
  const brief = data.brief;
  const todayEmergency = brief?.emergency?.days.find((day) => day.date === data.date);
  const metrics = [
    { label: "Kunjungan", value: data.dailyReport.visits, unit: "kunjungan" },
    { label: "Klaim BPJS diajukan", value: data.dailyReport.bpjsSubmitted, unit: "berkas" },
    { label: "Klaim BPJS tertunda", value: data.dailyReport.bpjsPending, unit: "berkas" },
    { label: "Penerimaan", value: data.dailyReport.revenue, unit: "rupiah" },
    { label: "Pengeluaran", value: data.dailyReport.expenses, unit: "rupiah" },
  ];
  const sourceNote = brief && <p className="executive-source-note"><strong className={brief.example ? "executive-source-warning" : undefined}>{brief.example ? "Contoh pertama · bukan data live" : "Brief sumber"}</strong><span>{brief.source} · data pukul {wibTime(brief.updatedAt)}. Tidak ditarik otomatis dari Medify.</span></p>;
  const withInstructions = (children: ReactNode) => embedded ? children : <InstructionProvider date={data.date}>{children}</InstructionProvider>;
  const content = <div className="page-content director-page">
    <header className="page-heading director-header">
      <div>
        <h1>Integrated Operations Center (IOC)</h1>
        <p>RSIA Melinda DHAI Kediri · ringkasan harian direktur · <time dateTime={data.date}>{longDate(data.date)}</time></p>
      </div>
      <Link className="director-knowledge" href="/overview" prefetch={false}>Dashboard pengetahuan<ArrowUpRight size={14} aria-hidden="true" /></Link>
    </header>
    {historic && <p className="director-notice">{followLatest && "Menampilkan laporan terbaru yang tersedia. "}Ini bukan laporan hari ini. <Link href="/" prefetch={false}>Lihat laporan terbaru</Link></p>}
    {message && <p role="status" className={status === "invalid" ? "director-notice director-error" : "director-notice"}>{message}</p>}

    {brief?.example && sourceNote}
      <DirectorSummary metrics={brief ? [
        { label: "Rawat inap", value: brief.inpatient?.occupied == null || brief.inpatient.capacity == null ? null : `${brief.inpatient.occupied} / ${brief.inpatient.capacity}`, note: "Terisi / kapasitas bed", icon: "beds" },
        { label: "Hunian bed", value: brief.inpatient?.occupancyPercent == null ? null : `${brief.inpatient.occupancyPercent}%`, note: "Kapasitas yang terpakai", icon: "occupancy" },
        { label: "Bed kosong", value: brief.inpatient?.vacant ?? null, note: "Bed belum terisi pada waktu sumber", icon: "vacant" },
        { label: "IGD hari ini", value: todayEmergency?.visits ?? null, note: todayEmergency?.cutoff ? `Sampai ${todayEmergency.cutoff} WIB` : "Cutoff mengikuti sumber", icon: "visits" },
      ] : [
        { label: "Kunjungan", value: data.dailyReport.visits, note: "Agregat laporan harian", icon: "visits" },
        { label: "Klaim BPJS tertunda", value: data.dailyReport.bpjsPending, note: "Berkas pada waktu pembaruan", icon: "claims" },
        { label: "Keputusan menunggu", value: data.decisions.updatedAt ? data.decisions.items.length : null, note: "Memerlukan pilihan direksi", icon: "decisions" },
        { label: "Prioritas mendesak", value: data.priorities.updatedAt ? urgent : null, note: "Perlu perhatian direktur", icon: "urgent" },
      ]} />
      {brief && <ExecutiveBriefView brief={brief} provenance={result.provenance} />}
      {withInstructions(<>
      <div className="director-grid">
      <Panel id="prioritas" title="Prioritas" metadata={data.priorities} date={data.date}>
        {data.priorities.items.length ? <ol className="director-list director-numbered">{data.priorities.items.map((item) => <li key={item.id} className={item.urgent ? "director-urgent" : undefined}><div>{item.urgent && <span className="director-urgent-label">Mendesak</span>}<strong>{item.title}</strong>{item.note && <p className="director-note">{item.note}</p>}{!embedded && <DirectorInstruction date={data.date} section="priorities" item={item} />}</div></li>)}</ol> : <Empty updatedAt={data.priorities.updatedAt} label="Tidak ada prioritas tercatat." />}
      </Panel>
      <Panel id="keputusan-direksi" title="Keputusan yang menunggu direksi" metadata={data.decisions} date={data.date}>
        {data.decisions.items.length ? <ol className="director-list director-numbered">{data.decisions.items.map((item) => <li key={item.id}><div><strong>{item.title}</strong>{item.note && <p className="director-note">{item.note}</p>}{item.options.length > 0 && <p className="director-note">Opsi: {item.options.map((option) => option.label).join(" · ")}</p>}{!embedded && <DirectorInstruction date={data.date} section="decisions" item={item} decisionOptions={item.options} />}</div></li>)}</ol> : <Empty updatedAt={data.decisions.updatedAt} label="Tidak ada keputusan menunggu yang tercatat." />}
      </Panel>
      </div>
      <div className="director-grid director-grid-even">
      <Panel id="jadwal-direktur" title="Jadwal Direktur" metadata={data.schedule} date={data.date}>{brief && !data.schedule.items.length ? <p className="director-empty">Jadwal direktur belum dicantumkan dalam brief. Tidak ada jam agenda yang diasumsikan.</p> : <Schedule items={data.schedule.items} updatedAt={data.schedule.updatedAt} />}</Panel>
      <Panel id="agenda-hari-ini" title="Agenda hari ini" metadata={data.agenda} date={data.date}>{brief && !data.agenda.items.length ? <p className="director-empty">Agenda operasional terjadwal belum dicantumkan. Usulan pembahasan ada pada prioritas dan keputusan direksi.</p> : <Schedule items={data.agenda.items} updatedAt={data.agenda.updatedAt} />}</Panel>
      </div>
      <div className="director-grid">
      <Panel id="tindak-lanjut" title="Tindak lanjut berjalan" metadata={data.followUps} date={data.date}>
        {data.followUps.items.length ? <div className="executive-table-wrap"><table className="director-followup-table"><thead><tr><th scope="col">Tindak lanjut</th><th scope="col">PIC</th><th scope="col">Status</th><th scope="col">Tenggat</th></tr></thead><tbody>{data.followUps.items.map((item) => { const [state, ...due] = item.status.split(" · tenggat "); return <tr key={item.id}><th scope="row">{item.title}{!embedded && <DirectorInstruction date={data.date} section="followUps" item={item} />}</th><td>{plainPic(item.pic)}</td><td className={state.startsWith("Lewat") ? "director-overdue" : undefined}>{state}</td><td>{due.join(" · tenggat ") || "—"}</td></tr>; })}</tbody></table></div> : <Empty updatedAt={data.followUps.updatedAt} label={brief ? "Belum ada tindak lanjut berjalan yang dilaporkan. Penugasan menunggu keputusan direksi." : "Tidak ada tindak lanjut tercatat."} />}
      </Panel>
      <Panel id="laporan-harian" title="Laporan harian" metadata={data.dailyReport} date={data.date}>
        <dl className="director-metrics">{metrics.map((metric) => <div key={metric.label}><dt>{metric.label}</dt><dd>{metric.value === null ? <span className="director-metric-missing">Belum tersedia</span> : <><strong>{metric.unit === "rupiah" ? new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(metric.value) : new Intl.NumberFormat("id-ID").format(metric.value)}</strong>{metric.unit !== "rupiah" && <small>{metric.unit}</small>}</>}</dd></div>)}</dl>
        <p className="director-report-note">Agregat pada tanggal laporan, sesuai waktu pembaruan sumber. Bukan data pasien individual.</p>
      </Panel>
      </div>
      </>)}
      {brief && <ExecutiveInsights brief={brief} />}
      {((brief && !brief.example) || result.submission || result.publication || result.provenance) && <details className="director-review-diff director-sources"><summary>Sumber data, periode, dan waktu pengamatan</summary>
        {brief && !brief.example && sourceNote}
        {result.submission ? <p className="director-report-note">Kiriman {result.submission.revisionId.slice(0, 8)} · diterima <time dateTime={result.submission.receivedAt}>{longDate(wibDate(new Date(result.submission.receivedAt)))} pukul {wibTime(result.submission.receivedAt)}</time> · {result.submission.reviewStatus === "published" ? "sudah diperiksa" : "belum ditinjau — laporan tetap tampil di dashboard; ini bukan persetujuan keputusan"}. Waktu diterima server bukan waktu pengamatan sumber.</p> : result.publication && <p className="director-report-note">Versi terbit {result.publication.revisionId.slice(0, 8)} · waktu diterima server {wibTime(result.publication.receivedAt)} bukan waktu pengamatan sumber.</p>}
        {result.provenance && <ul className="director-list">{Object.entries(result.provenance).map(([group, source]) => <li key={group}><strong>{source.source.label}</strong><p>Periode {source.periodStart}–{source.periodEnd} · diperbarui pukul {wibTime(source.sourceObservedAt)}{source.cutoff && ` · cutoff ${source.cutoff} WIB`}</p><span className="director-note">{source.source.reference}</span></li>)}</ul>}
      </details>}
    <footer className="director-footer">MelindaOS · satu ringkasan, satu arah.<br />Sumber dibaca saja. Arahan direktur tercatat di buku besar arahan.</footer>
  </div>;
  return embedded ? content : <DirectorShell date={data.date} pending={data.decisions.updatedAt ? data.decisions.items.length : null} authenticated={authenticated} followLatest={followLatest} activeSection="melinda">{content}</DirectorShell>;
}
