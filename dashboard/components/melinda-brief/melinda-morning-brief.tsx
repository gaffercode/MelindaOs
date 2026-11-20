import type { ReactNode } from "react";
import { ScrollProgress } from "@/components/ui/scroll-progress";
import { formatUtcDayMonth } from "@/lib/date-label";
import { wibTime } from "@/lib/director/director-data";
import { displayCase, displayCaseDeep } from "@/lib/display-case";
import type { MelindaManagementMorningBrief, MelindaServiceIndicator, MelindaSimrsMetric } from "@/lib/melinda/melinda-brief-data";
import type { MedifySnapshot } from "@/lib/medify/medify-snapshot-contract";
import { DirectorInstruction, InstructionProvider } from "../director/director-instruction";
import { SourceInfo } from "../source-info";
import { GapProvider, GapText } from "./gap-resolver";
import { ScheduleTable } from "./schedule-table";
import { EmailTriageTable } from "./email-triage-table";
import { MedifyPharmacyBlock, MedifyQualityBlock, MedifyServiceBlock, MedifyStaffBlock } from "../medify/medify-section-extras";

/*
 * Server component. The brief is read-only text and SVG, so it is rendered on the server and
 * only three islands ship JavaScript: the agenda table (browser notes), the `[ISI]` resolver
 * (browser notes) and "Beri arahan", which uses the real Director instruction pipeline
 * (the Supabase instruction register) instead of a browser-only mock.
 */

function badgeClass(status: string): string {
  if (status === "NORMAL") return "text-[var(--accent)]";
  if (status === "PERHATIAN") return "text-[var(--orange-ink)]";
  if (status === "KRITIS") return "text-[var(--orange-ink)]";
  return "text-[var(--muted)]";
}

/** Fallback when no Medify pull exists: the brief's own census text, shown as text only (no drawn trend). */
function SimrsMetricCard({ metric }: { metric: MelindaSimrsMetric }) {
  return (
    <div className="simrs-chart-card">
      <div className="simrs-chart-header">
        <div>
          <span className="simrs-chart-kicker">{displayCase(metric.kategori)}</span>
          <h3 className="simrs-chart-title">{metric.nilai}</h3>
        </div>
        <span className={`simrs-chart-badge ${badgeClass(metric.statusBadge)}`}>{displayCase(metric.statusBadge)}</span>
      </div>
      <p className="m-0 text-slate-700">{metric.indikator}{metric.catatan ? `. ${metric.catatan}` : ""}</p>
    </div>
  );
}

/** `note` is the section's catatan: it lives behind the info icon in the strip (Director 2026-11-09) so no section grows a row for it. */
export function SectionHeading({ id, number, title, meta, metaClass = "text-slate-500", note, children }: { id: string; number?: string; title: string; meta?: ReactNode; metaClass?: string; note?: string; children?: ReactNode }) {
  return (
    <div className="section-strip flex justify-between items-baseline gap-3 border-b border-slate-200 pb-3 mb-4">
      <h2 id={id} className="swiss-section-heading">{number && <span className="swiss-section-num">{number}</span>} {title}</h2>
      <span className="section-strip-aside">
        {children ?? (meta ? <span className={`melinda-section-meta ${metaClass}`}>{meta}</span> : null)}
        {note && <SourceInfo><p className="m-0 text-slate-700 leading-relaxed">{note}</p></SourceInfo>}
      </span>
    </div>
  );
}

const BRIEF_SECTIONS = [
  { id: "brief-00", label: "Sensus & operasional" }, { id: "brief-01", label: "Jadwal hari ini" }, { id: "brief-02", label: "Ringkasan layanan" },
  { id: "brief-03", label: "Keselamatan & mutu" }, { id: "brief-04", label: "Klaim & keuangan" }, { id: "brief-05", label: "SDM" },
  { id: "brief-06", label: "Triase email" }, { id: "brief-07", label: "Keputusan menunggu" }, { id: "brief-08", label: "Tindak lanjut" },
  { id: "brief-09", label: "Keterbatasan data" }, { id: "brief-10", label: "Temuan administratif" }, { id: "brief-conclusion", label: "Kesimpulan" },
];

const title300 = (value: string) => value.length > 300 ? `${value.slice(0, 297)}…` : value;
const serviceNumber = new Intl.NumberFormat("id-ID");

/** Aggregate Medify counts for section 02. No patient identities; ward-level lists stay in MedifyServiceBlock. */
function medifyServiceRows(snapshot: MedifySnapshot | null | undefined): MelindaServiceIndicator[] {
  if (!snapshot) return [];
  const rows: MelindaServiceIndicator[] = [];
  if (snapshot.bed) {
    const occupied = snapshot.bed.wards.reduce((sum, ward) => sum + ward.occupied, 0);
    const capacity = snapshot.bed.wards.reduce((sum, ward) => sum + ward.capacity, 0);
    const bor = capacity ? Math.round((occupied / capacity) * 100) : 0;
    rows.push({ indikator: "Hunian tempat tidur", nilai: `${serviceNumber.format(occupied)}/${serviceNumber.format(capacity)} terisi · BOR ${bor}%` });
  }
  if (snapshot.outpatient) {
    const visits = snapshot.outpatient.visitsToday;
    rows.push({ indikator: "Kunjungan rawat jalan hari ini", nilai: visits === null ? "Belum ada" : serviceNumber.format(visits) });
  }
  if (snapshot.igd) {
    const visits = snapshot.igd.visitsToday;
    rows.push({ indikator: "Kunjungan IGD hari ini", nilai: visits === null ? "Belum ada" : serviceNumber.format(visits) });
  }
  // The day's BOR is left out: Medify revises it upward for several days, so the newest figure is not final. BOR comes from the bed census above.
  const lastDay = snapshot.inpatient?.daily.at(-1);
  if (lastDay) rows.push({ indikator: "Pasien masuk rawat inap (hari terakhir)", nilai: `${serviceNumber.format(lastDay.admissions)} · ${formatUtcDayMonth(lastDay.date)}` });
  return rows;
}

/** The brief's own rows, else rows derived from Medify; null when neither exists and `content` must stand in as the table. */
function serviceSummaryRows(brief: MelindaManagementMorningBrief, medify: MedifySnapshot | null | undefined): MelindaServiceIndicator[] | null {
  const published = brief.serviceSummary.items;
  if (published && published.length > 0) return published;
  const derived = medifyServiceRows(medify);
  return derived.length > 0 ? derived : null;
}

/** A section's analysis paragraph, shown open under the heading. The source note (`catatan`) stays behind the info icon. */
function SectionAnalysis({ text }: { text?: string }) {
  return text ? <p className="mt-0 mb-4 text-slate-800 leading-relaxed">{text}</p> : null;
}

function ServiceSummaryTable({ rows }: { rows: MelindaServiceIndicator[] }) {
  return (
    <div className="swiss-table-wrap">
      <table className="swiss-table">
        <thead>
          <tr>
            <th scope="col" className="text-left w-[58%]">Indikator</th>
            <th scope="col" className="text-left w-[42%]">Nilai</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.indikator}-${index}`}>
              <td className="text-left font-medium text-slate-900">{row.indikator}</td>
              <td className="text-left font-mono text-slate-800">{row.nilai}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Wraps children in the instruction store only for roles that may use /arahan; elsewhere nothing fetches the Director-only instruction API. */
function InstructionScope({ enabled, date, linkedIds, children }: { enabled: boolean; date: string; linkedIds: string[]; children: ReactNode }) {
  return enabled ? <InstructionProvider date={date} linkedIds={linkedIds}>{children}</InstructionProvider> : <>{children}</>;
}

/**
 * `live` is the Medify panel rendered as section 00; without it, `liveMessage` says why and the brief's census text stands in.
 * `medify` adds Medify's monthly lists under sections 02 to 05.
 */
export function MelindaMorningBriefView({ brief: publishedBrief, live, liveMessage, medify, scheduleDate, scheduleScope, scheduleNotice, scheduleEmpty, entryCard, allowedPages }: {
  brief: MelindaManagementMorningBrief; live?: ReactNode; liveMessage?: string | null; medify?: MedifySnapshot | null; entryCard?: ReactNode;
  /** Home schedule override: exact-date Dash rows render with namespaced browser notes. */
  scheduleDate?: string; scheduleScope?: string; scheduleNotice?: string; scheduleEmpty?: boolean;
  /** Undefined renders "Beri arahan" as before roles existed; otherwise only when the role may open /arahan. */
  allowedPages?: string[];
}) {
  const canInstruct = allowedPages === undefined || allowedPages.includes("/arahan");
  const composer = publishedBrief.composer;
  const brief = displayCaseDeep(publishedBrief);
  const { docType, facility, title, date, dateIso, status, catatanStatus, untuk, disiapkanOleh, nomorVersi, systemDoctrine, simrsPulse, schedule, safetyQuality, claimsFinance, staffing, systemFindings, emailTriage, decisions, dataLimitations, followUps, conclusion, runningFooter } = brief;
  const decisionOptions = [{ id: "setuju", label: "Setuju sesuai rekomendasi" }, { id: "setuju-catatan", label: "Setuju dengan catatan" }];
  const linkedIds = followUps.items.flatMap((row) => row.instructionId ? [row.instructionId] : []);
  const serviceRows = serviceSummaryRows(brief, medify);

  return (
    <InstructionScope enabled={canInstruct} date={dateIso} linkedIds={linkedIds}>
      <GapProvider date={dateIso}>
        <article className="swiss-report-sheet melinda-management-sheet" aria-label={`${title} ${date}`}>
          <div className="melinda-running-header flex justify-between items-center text-slate-500 border-b border-slate-200 pb-3 mb-6">
            <div className="flex items-center gap-2"><span className="inline-block w-2 h-2 rounded-full bg-[var(--accent)]" /><span>{facility}</span></div>
            <span>{docType} · {dateIso}</span>
          </div>

          <header className="swiss-masthead melinda-brief-masthead">
            <div className="swiss-masthead-left">
              <h1 className="swiss-title melinda-brief-title">{title}</h1>
              <p className="swiss-date melinda-brief-date">{date}</p>
            </div>
            <div className="swiss-masthead-right melinda-brief-meta">
              <dl className="swiss-meta-dl melinda-meta-dl melinda-meta-inline">
                <div className="swiss-meta-item"><dt>Nomor</dt><dd className="font-mono">{displayCase(nomorVersi)}</dd></div>
                <div className="swiss-meta-item"><dt>Disiapkan</dt><dd>{disiapkanOleh}</dd></div>
                <div className="swiss-meta-item"><dt>Untuk</dt><dd>{untuk}</dd></div>
                <div className="swiss-meta-item"><dt>Status</dt><dd className="text-[var(--orange-ink)]" title={catatanStatus || undefined}>{status}</dd></div>
              </dl>
            </div>
          </header>

          {composer && (
            <p className="melinda-composer-stamp text-slate-500 text-sm m-0">
              Brief otomatis · {composer.facts} fakta · {composer.decisions} keputusan · {wibTime(composer.at)} · {composer.modelCalled ? "model dipanggil" : "model tidak dipanggil"}
            </p>
          )}

          {systemDoctrine && <div className="melinda-doctrine-bar my-5 py-3 px-4 rounded-lg border border-slate-200 text-slate-600 text-left">{systemDoctrine}</div>}

          {live ?? ((simrsPulse || liveMessage) && (
            <section id="brief-00" className="swiss-section" aria-labelledby="section-00">
              <SectionHeading id="section-00" number="00" title="Sensus & operasional (Medify)">
                <div className="flex items-center gap-3">
                  <a href={simrsPulse?.systemUrl ?? "https://simrs.melinda.co.id"} target="_blank" rel="noreferrer" className="text-xs text-[var(--accent)] hover:underline">simrs.melinda.co.id →</a>
                  {simrsPulse && <span className="melinda-section-meta text-slate-500">{simrsPulse.headerRight}</span>}
                </div>
              </SectionHeading>
              {liveMessage && <p role="status" className="m-0 text-[color:var(--warn)]">{liveMessage}</p>}
              {simrsPulse && (
                <div className="simrs-chart-grid">
                  {simrsPulse.metrics.filter((metric) => metric.kategori !== "KAMAR BERSALIN" && metric.kategori !== "INTEGRASI MEDIFY").flatMap((metric, index) => {
                    const card = <SimrsMetricCard key={metric.indikator} metric={metric} />;
                    return index === 1 && entryCard ? [card, <div key="melinda-entry" className="simrs-chart-card">{entryCard}</div>] : [card];
                  })}
                </div>
              )}
              {simrsPulse?.syncStatus === "Bukan sensus live" && <p className="swiss-footnote mt-4 pt-2 border-t border-slate-100"><strong>Sumber SIMRS:</strong> {simrsPulse.platformVersion} · {simrsPulse.syncStatus}. {simrsPulse.catatan}</p>}
            </section>
          ))}

          <section id="brief-01" className="swiss-section" aria-labelledby="section-01">
            <SectionHeading id="section-01" number="01" title="Jadwal hari ini" meta={schedule.headerRight} note={schedule.catatan} />
            {scheduleNotice ? <p className="director-notice">{scheduleNotice}</p> : null}
            {scheduleEmpty
              ? <p className="director-empty">Jadwal hari ini belum dikirim Dash.</p>
              : <ScheduleTable date={scheduleDate ?? dateIso} scope={scheduleScope} items={schedule.items} />}
          </section>

          <section id="brief-02" className="swiss-section mt-8" aria-labelledby="section-02">
            <SectionHeading id="section-02" number="02" title={serviceTitle(brief)} meta={brief.serviceSummary.sourceLabel} note={brief.serviceSummary.catatan} />
            {serviceRows && <SectionAnalysis text={brief.serviceSummary.content} />}
            <ServiceSummaryTable rows={serviceRows ?? [{ indikator: "Status", nilai: title300(brief.serviceSummary.content) }]} />
            <MedifyServiceBlock snapshot={medify} />
          </section>

          <section id="brief-03" className="swiss-section mt-8" aria-labelledby="section-03">
            <SectionHeading id="section-03" number="03" title="Keselamatan & mutu" meta={safetyQuality.headerRight} metaClass="text-[var(--orange-ink)]" note={safetyQuality.catatan} />
            <SectionAnalysis text={safetyQuality.analisis} />
            <div className="swiss-table-wrap">
              <table className="swiss-table">
                <thead><tr><th scope="col" className="text-center w-12">#</th><th scope="col" className="text-left w-[40%]">Eksepsi</th><th scope="col" className="text-left w-[58%]">Tindak lanjut</th></tr></thead>
                <tbody>
                  {safetyQuality.exceptions.map((exc) => (
                    <tr key={exc.no}>
                      <td className="text-center font-medium text-[var(--orange-ink)]">{exc.no}</td>
                      <td className="text-left font-medium text-slate-900">{exc.eksepsi}</td>
                      <td className="text-left text-slate-700 leading-relaxed"><GapText text={exc.tindakLanjut} id={`safety-${exc.no}`} title={exc.eksepsi} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <MedifyQualityBlock snapshot={medify} />
          </section>

          <section id="brief-04" className="swiss-section mt-8" aria-labelledby="section-04">
            <SectionHeading id="section-04" number="04" title="Klaim & keuangan" meta={claimsFinance.headerRight} note={claimsFinance.catatan} />
            <SectionAnalysis text={claimsFinance.analisis} />
            <div className="swiss-table-wrap">
              <table className="swiss-table">
                <thead><tr><th scope="col" className="text-left w-[30%]">Pos</th><th scope="col" className="text-left w-[28%]">Nilai / status</th><th scope="col" className="text-left w-[42%]">Catatan</th></tr></thead>
                <tbody>
                  {claimsFinance.items.map((item, index) => (
                    <tr key={index}>
                      <td className="text-left font-medium text-slate-900">{item.pos}</td>
                      <td className="text-left font-mono text-slate-800"><GapText text={item.nilaiStatus} id={`claims-status-${index}`} title={`${item.pos} (Nilai / Status)`} /></td>
                      <td className="text-left text-slate-600"><GapText text={item.catatan} id={`claims-note-${index}`} title={`${item.pos} (Catatan)`} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <MedifyPharmacyBlock snapshot={medify} />
          </section>

          <section id="brief-05" className="swiss-section mt-8" aria-labelledby="section-05">
            <SectionHeading id="section-05" number="05" title="SDM" meta={staffing.headerRight} note={staffing.catatan} />
            <SectionAnalysis text={staffing.analisis} />
            <div className="swiss-table-wrap">
              <table className="swiss-table">
                <thead><tr><th scope="col" className="text-left w-[32%]">Pos</th><th scope="col" className="text-left w-[68%]">Status</th></tr></thead>
                <tbody>
                  {staffing.items.map((item, index) => (
                    <tr key={index}>
                      <td className="text-left font-medium text-slate-900">{item.pos}</td>
                      <td className="text-left text-slate-700 leading-relaxed"><GapText text={item.status} id={`staffing-status-${index}`} title={item.pos} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <MedifyStaffBlock snapshot={medify} />
          </section>

          <section id="brief-06" className="swiss-section mt-8" aria-labelledby="section-06">
            <SectionHeading id="section-06" number="06" title="Triase email 24 jam" meta={emailTriage.headerRight} note={emailTriage.data?.catatan} />
            {emailTriage.data === null ? <p className="text-slate-700 leading-relaxed m-0">{emailTriage.unavailableReason}</p> : <>
            <EmailTriageTable date={dateIso} accounts={emailTriage.data.accounts} />
            <div className="melinda-triage-details mt-4 grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
              <div className="space-y-2">
                <strong className="text-slate-900 block font-medium">Perlu tindakan Gaffer</strong>
                <p className="text-slate-700 leading-relaxed m-0">{emailTriage.data.perluTindakanText || "Tidak ada."}</p>
                {canInstruct && <DirectorInstruction date={dateIso} section="priorities" item={{ id: "EMAIL-TRIAGE", title: "Triase email 24 jam" }} />}
              </div>
              <div className="space-y-1.5 lg:border-l lg:border-slate-200 lg:pl-6">
                <strong className="text-slate-900 block font-medium">Info</strong>
                <ul className="list-disc pl-4 space-y-1 text-slate-600 leading-relaxed">{emailTriage.data.fyiItems.map((fyi, index) => <li key={index}>{fyi}</li>)}</ul>
              </div>
            </div>
            </>}
          </section>

          <section id="brief-07" className="swiss-section mt-8" aria-labelledby="section-07">
            <SectionHeading id="section-07" number="07" title="Keputusan menunggu Gaffer" meta={decisions.headerRight || undefined} metaClass="text-[var(--orange-ink)]" note={decisions.catatan} />
            <div className="swiss-table-wrap">
              <table className="swiss-table">
                <thead>
                  <tr>
                    <th scope="col" className="text-left w-20 whitespace-nowrap">Kode</th>
                    <th scope="col" className="text-left w-[34%]">Keputusan</th>
                    <th scope="col" className="text-left w-[26%]">Rekomendasi</th>
                    <th scope="col" className="text-left w-36 whitespace-nowrap">Batas</th>
                    {canInstruct && <th scope="col" className="text-left w-56">Aksi direktur</th>}
                  </tr>
                </thead>
                <tbody>
                  {decisions.items.map((dec) => (
                    <tr key={dec.kode}>
                      <td className="text-left font-mono font-medium text-[var(--orange-ink)] whitespace-nowrap">{dec.kode}</td>
                      <td className="text-left font-medium text-slate-900 leading-relaxed">{dec.keputusan}</td>
                      <td className="text-left text-slate-700 leading-relaxed">{dec.rekomendasi}</td>
                      <td className="text-left font-medium text-[var(--orange-ink)] whitespace-nowrap">{dec.batas}</td>
                      {canInstruct && <td className="text-left"><DirectorInstruction date={dateIso} section="decisions" item={{ id: dec.kode, title: title300(dec.keputusan), urgent: dec.urgent }} decisionOptions={decisionOptions} /></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section id="brief-08" className="swiss-section mt-8" aria-labelledby="section-08">
            <SectionHeading id="section-08" number="08" title="Tindak lanjut" meta={followUps.headerRight} />
            <ol className="swiss-ordered-list grid grid-cols-1 lg:grid-cols-2 gap-x-10 gap-y-3.5">
              {followUps.items.map((row) => (
                <li key={row.no} className="text-slate-800">
                  {row.instructionId && <span className="font-mono text-slate-500">{row.instructionId} · </span>}
                  <span>{row.item}</span>{" "}
                  <strong className="text-slate-900 font-medium">— {row.pemilikAgent}</strong>
                  {canInstruct && <DirectorInstruction date={dateIso} section="followUps" item={{ id: `FU-${row.no}`, title: title300(row.item) }} linkedId={row.instructionId} />}
                </li>
              ))}
            </ol>
          </section>

          <section id="brief-09" className="swiss-section mt-8" aria-labelledby="section-09">
            <SectionHeading id="section-09" number="09" title="Keterbatasan data" meta={dataLimitations.headerRight} />
            <ul className="swiss-bullet-list grid grid-cols-1 lg:grid-cols-2 gap-x-10 gap-y-3">
              {dataLimitations.items.map((item, index) => <li key={index} className="text-slate-700"><GapText text={item} id={`limitation-${index}`} title="Keterbatasan data operasional" /></li>)}
            </ul>
          </section>

          <section id="brief-10" className="swiss-section mt-8" aria-labelledby="section-10">
            <SectionHeading id="section-10" number="10" title="Temuan administratif / gangguan sistem" meta={systemFindings.headerRight} />
            <div className="swiss-table-wrap">
              <table className="swiss-table">
                <thead><tr><th scope="col" className="text-left w-[34%]">Temuan</th><th scope="col" className="text-left w-[66%]">Keterangan</th></tr></thead>
                <tbody>
                  {systemFindings.items.map((row, index) => (
                    <tr key={index}>
                      <td className="text-left font-medium text-slate-900">{row.temuan}</td>
                      <td className="text-left text-slate-700 leading-relaxed"><GapText text={row.keterangan} id={`finding-${index}`} title={row.temuan} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section id="brief-conclusion" className="swiss-section swiss-conclusion-section mt-10" aria-labelledby="section-conclusion">
            <SectionHeading id="section-conclusion" title="Kesimpulan" meta={conclusion.headerRight} note={conclusion.metadataRule} />
            <div className="swiss-conclusion-body">{conclusion.paragraphs.map((paragraph, index) => <p key={index} className="text-slate-800">{paragraph}</p>)}</div>
          </section>

          <footer className="melinda-running-footer flex justify-between items-center text-slate-400 pt-4 mt-6 border-t border-slate-200">
            <span>{runningFooter.docNumber}</span>
            <span>{runningFooter.notice}</span>
          </footer>
        </article>
        <ScrollProgress sections={BRIEF_SECTIONS} className="z-40 print:hidden" />
      </GapProvider>
    </InstructionScope>
  );
}

function serviceTitle(brief: MelindaManagementMorningBrief): string {
  return brief.serviceSummary.dateLabel || "Ringkasan layanan";
}
