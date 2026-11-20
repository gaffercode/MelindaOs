import { CRM_STAGES, NETWORK_TOTAL, PARTNER_KIND_LABEL, PARTNER_NETWORK, countByStage, daysSince, initials, type CrmPartner } from "@/lib/crm/crm-data";
import { SectionHeading } from "../melinda-brief/melinda-morning-brief";
import { SourceInfo } from "../source-info";
import "../hrd/hrd-crm.css";

/** Follow-up threshold in days: a partner not contacted for this long moves to the top of "Tindak lanjut". */
const FOLLOW_UP_DAYS = 30;

function trend(now: number, before: number): string {
  if (now === before) return "Tetap";
  return now > before ? `Naik ${now - before}` : `Turun ${before - now}`;
}

/** CRM rujukan dan mitra: the question it answers is "siapa yang perlu dihubungi sekarang". Design only; the partner list
 * stays empty until a data source is chosen. */
export function CrmView({ partners = [], today = new Date() }: { partners?: CrmPartner[]; today?: Date }) {
  const counts = countByStage(partners);
  const rows = partners
    .map((p) => ({ p, idle: daysSince(p.lastContact, today) }))
    .sort((a, b) => (b.idle ?? Infinity) - (a.idle ?? Infinity));
  const due = rows.filter(({ idle }) => idle === null || idle >= FOLLOW_UP_DAYS);
  return (
    <article className="swiss-report-sheet melinda-management-sheet order-sheet crm-sheet">
      <header className="swiss-masthead melinda-brief-masthead">
        <div>
          <h1 className="melinda-brief-title">CRM</h1>
          <div className="melinda-brief-date">
            Rujukan dan mitra RSIA Melinda DHAI
            <SourceInfo>
              <p>Daftar jaringan mitra diambil dari dokumen Daftar Bidan dan Pihak-Pihak yang Bekerja Sama (nama saja). Tahap kerja sama, penanggung jawab, dan rujukan belum dicatat, jadi bagian itu kosong dan tidak ada angka contoh.</p>
              <p>Susunan mengikuti praktik dashboard CRM: satu pertanyaan per halaman (siapa yang perlu dihubungi sekarang), tahap dengan jumlah, ambang waktu untuk tindak lanjut, dan arah tren bulan ini terhadap bulan lalu.</p>
            </SourceInfo>
          </div>
        </div>
        <dl className="swiss-meta-dl melinda-meta-dl melinda-meta-inline">
          <div className="swiss-meta-item"><dt>Jaringan mitra</dt><dd>{NETWORK_TOTAL}</dd></div>
          <div className="swiss-meta-item"><dt>Mitra dilacak</dt><dd>{partners.length}</dd></div>
          <div className="swiss-meta-item"><dt>Perlu tindak lanjut</dt><dd className={due.length ? "text-[var(--orange-ink)]" : undefined}>{due.length}</dd></div>
        </dl>
      </header>

      <section className="swiss-section" aria-labelledby="crm-jaringan">
        <SectionHeading id="crm-jaringan" number="01" title="Jaringan mitra" meta={`${NETWORK_TOTAL} mitra dalam ${PARTNER_NETWORK.length} kelompok`} />
        <div className="crm-share" aria-hidden="true">
          {PARTNER_NETWORK.map((g, i) => (
            <div key={g.id} className={`crm-share-seg crm-tone-${i}`} style={{ flexGrow: g.names.length }} />
          ))}
        </div>
        <div className="crm-groups">
          {PARTNER_NETWORK.map((g, i) => (
            <article key={g.id} className={`crm-group crm-tone-${i}`}>
              <header className="crm-group-head">
                <strong className="crm-group-count">{g.names.length}</strong>
                <div>
                  <h3 className="crm-group-title">{g.label}</h3>
                  <p className="crm-group-note">{g.note} · {Math.round((g.names.length / NETWORK_TOTAL) * 100)}% dari jaringan</p>
                </div>
              </header>
              <ul className="crm-chips">
                {g.names.map((name) => (
                  <li key={name} className="crm-chip">
                    {g.id === "bidan" && <span className="crm-avatar" aria-hidden="true">{initials(name)}</span>}
                    <span>{name}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="swiss-section" aria-labelledby="crm-tahap">
        <SectionHeading id="crm-tahap" number="02" title="Tahap kerja sama" meta="Dari kenalan sampai merujuk rutin" />
        {partners.length === 0 ? (
          <p className="crm-empty">{`Tahap kerja sama belum dicatat untuk ${NETWORK_TOTAL} mitra.`}</p>
        ) : (
        <ol className="crm-stages">
          {CRM_STAGES.map((stage) => (
            <li key={stage.id} className="crm-stage">
              <span className="crm-stage-name">{stage.label}</span>
              <strong className="crm-stage-count">{counts[stage.id]}</strong>
              <span className="crm-stage-hint">{stage.hint}</span>
            </li>
          ))}
        </ol>
        )}
      </section>

      <section className="swiss-section" aria-labelledby="crm-tindak">
        <SectionHeading id="crm-tindak" number="03" title="Tindak lanjut" meta={`Belum dihubungi ${FOLLOW_UP_DAYS} hari atau lebih`} />
        {due.length === 0 ? (
          <p className="crm-empty">{partners.length === 0 ? "Belum ada mitra yang dilacak." : "Semua mitra sudah dihubungi dalam 30 hari terakhir."}</p>
        ) : (
          <div className="swiss-table-wrap">
            <table className="swiss-table">
              <thead>
                <tr>
                  <th scope="col" className="text-left">Mitra</th>
                  <th scope="col" className="text-left">Penanggung jawab</th>
                  <th scope="col" className="text-left">Terakhir dihubungi</th>
                  <th scope="col" className="text-left">Langkah berikutnya</th>
                </tr>
              </thead>
              <tbody>
                {due.map(({ p, idle }) => (
                  <tr key={p.id}>
                    <th scope="row" className="text-left">{p.name}<br /><small>{PARTNER_KIND_LABEL[p.kind]}</small></th>
                    <td className="text-left">{p.owner}</td>
                    <td className="text-left crm-late">{idle === null ? "Belum pernah" : `${idle} hari lalu`}</td>
                    <td className="text-left">{p.nextAction ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="swiss-section" aria-labelledby="crm-rujukan">
        <SectionHeading id="crm-rujukan" number="04" title="Volume rujukan" meta="Bulan ini dibanding bulan lalu" />
        {rows.length === 0 ? (
          <p className="crm-empty">Belum ada data rujukan.</p>
        ) : (
          <div className="swiss-table-wrap">
            <table className="swiss-table">
              <thead>
                <tr>
                  <th scope="col" className="text-left">Mitra</th>
                  <th scope="col" className="text-right">Bulan ini</th>
                  <th scope="col" className="text-right">Bulan lalu</th>
                  <th scope="col" className="text-left">Arah</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ p }) => (
                  <tr key={p.id}>
                    <th scope="row" className="text-left">{p.name}</th>
                    <td className="text-right">{p.referralsThisMonth}</td>
                    <td className="text-right">{p.referralsLastMonth}</td>
                    <td className={`text-left${p.referralsThisMonth < p.referralsLastMonth ? " crm-late" : ""}`}>{trend(p.referralsThisMonth, p.referralsLastMonth)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </article>
  );
}
