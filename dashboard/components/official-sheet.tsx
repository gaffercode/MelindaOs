import Image from "next/image";
import type { ReactNode } from "react";
import "./official-sheet.css";

// Building blocks of the RSIA Melinda DHAI official document (the layout of the SPO and the BPJS credentialing letters:
// kop with logo, heavy rule, centred title, 2x3 identity table, numbered sections, approval table, footer).
// Printed-format text keeps its capitals, so this file is covered by the same exemption as document-studio-view.tsx.

export function OfficialKop() {
  return <header className="official-kop">
    <Image className="official-kop-logo" src="/branding/rsia-melinda-logo-official.png" alt="Logo RSIA Melinda DHAI" width={96} height={96} unoptimized />
    <div className="official-kop-text">
      <p className="official-kop-line">RUMAH SAKIT IBU DAN ANAK</p>
      <p className="official-kop-name">RSIA MELINDA DHAI</p>
      <p className="official-kop-city">Kota Kediri</p>
      <p className="official-kop-contact">Jl. Balowerti II No. 59, Balowerti, Kota Kediri, Jawa Timur 64129</p>
      <p className="official-kop-contact">Telp. (0354) 691016 | info.melinda@melinda.co.id</p>
    </div>
  </header>;
}

export function OfficialTitle({ title, subtitle, kind }: { title: string; subtitle?: string; kind: string }) {
  return <div className="official-title">
    <h2>{title}</h2>
    {subtitle && <p className="official-subtitle">{subtitle}</p>}
    <p className="official-kind">{kind}</p>
  </div>;
}

/** The 2-column identity table under the title; rows are filled left to right ("Label: value"). */
export function OfficialMeta({ rows }: { rows: Array<[string, string]> }) {
  const pairs: Array<Array<[string, string]>> = [];
  for (let i = 0; i < rows.length; i += 2) pairs.push(rows.slice(i, i + 2));
  return <table className="official-meta"><tbody>{pairs.map((pair, i) => <tr key={i}>{pair.map(([label, value]) => <td key={label}>{label}: {value}</td>)}</tr>)}</tbody></table>;
}

export function OfficialSection({ heading, children, plain = false }: { heading: string; children: ReactNode; plain?: boolean }) {
  return <section className="official-section"><h3>{heading}</h3><div className={plain ? "official-body" : "official-body official-lines"}>{children}</div></section>;
}

export type SignRow = { role: string; position: string; name: string };

/** Approval table: black header row, one row per role, an empty cell for the signature and date. */
export function OfficialApproval({ rows }: { rows: SignRow[] }) {
  return <section className="official-section"><h3>Pengesahan Dokumen</h3>
    <div className="official-table-wrap" role="region" aria-label="Lembar pengesahan" tabIndex={0}><table className="official-approval">
      <thead><tr><th scope="col">Peran</th><th scope="col">Jabatan</th><th scope="col">Nama</th><th scope="col">Tanda tangan dan tanggal</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.role}><th scope="row">{row.role}</th><td>{row.position}</td><td>{row.name}</td><td /></tr>)}</tbody>
    </table></div></section>;
}

/** "Pengesahan dan Penetapan" block, set on the right half like the letter. */
export function OfficialPenetapan({ place = "Kediri", date, signatory }: { place?: string; date?: string; signatory: string }) {
  return <section className="official-section"><h3>Pengesahan dan Penetapan</h3>
    <div className="official-penetapan">
      <p>Ditetapkan di: {place}</p>
      <p>Pada tanggal: {date ?? "[ISI]"}</p>
      <p className="official-strong">Direktur RSIA Melinda DHAI</p>
      <p className="official-signspace" aria-hidden="true" />
      <p className="official-signatory">{signatory}</p>
      <p>SIP/NIP: Definitif Direksi RSIA Melinda DHAI</p>
    </div>
  </section>;
}

export function OfficialFooter({ label }: { label: string }) {
  return <footer className="official-footer"><span>{label}</span><span>Pratinjau tata naskah</span></footer>;
}
