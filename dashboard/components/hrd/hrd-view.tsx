import type { ReactNode } from "react";
import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { childrenOf, formatPhone, whatsappHref, type Official } from "@/lib/hrd/hrd-data";
import type { HrdDirectory } from "@/lib/hrd/hrd-directory";
import { positionLabel } from "@/lib/hrd/hrd-position-labels";
import { STAFF_UNITS, fullName, type Staff } from "@/lib/staff-data";
import { SectionHeading } from "../melinda-brief/melinda-morning-brief";
import { SourceInfo } from "../source-info";
import "./hrd-crm.css";

function Node({ person, officials, root = false }: { person: Official; officials: readonly Official[]; root?: boolean }) {
  const kids = childrenOf(officials, person.id);
  return (
    <li className={root ? "org-node is-root" : "org-node"}>
      <div className="org-card">
        <span className="org-position">{positionLabel(person.position)}</span>
        <strong className="org-name">{person.name}</strong>
      </div>
      {kids.length > 0 && <ul className="org-level">{kids.map((kid) => <Node key={kid.id} person={kid} officials={officials} />)}</ul>}
    </li>
  );
}

const verificationLabel = "Data Kepegawaian Perlu Verifikasi";
const staffUnits = ["Direksi", "Pendukung Direksi", ...STAFF_UNITS.slice(1)];

function staffUnit(person: Staff) {
  return person.unit === "Direksi" && person.position === "Staf Khusus Direktur"
    ? "Pendukung Direksi"
    : person.unit;
}

function StaffGroup({ unit, people }: { unit: string | null; people: Staff[] }) {
  const committee = unit === "Komite Medik";
  return (
    <div className="staff-group">
      <h3 className="staff-group-title">{unit ?? verificationLabel} <small>{people.length} orang</small></h3>
      {unit === null && <p className="staff-note">Gelar, jabatan, dan unit kerja belum tercatat di data induk.</p>}
      <div className="swiss-table-wrap">
        <table className="swiss-table">
          <thead>
            <tr>
              <th scope="col" className="text-left">Nama</th>
              <th scope="col" className="text-left">{committee ? "Penugasan komite" : "Jabatan"}</th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.name}>
                <th scope="row" className="text-left">{fullName(p)}</th>
                <td className="text-left">{p.position ? positionLabel(p.position) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** `editor` is the inline editor (components/hrd/hrd-editor.tsx), passed only to people allowed to change the data. */
export function HrdView({ directory, query = "", unit = "", editor = null }: { directory: HrdDirectory; query?: string; unit?: string; editor?: ReactNode }) {
  const { officials: OFFICIALS, staff: STAFF } = directory;
  const selectedUnit = staffUnits.includes(unit) ? unit : "";
  const terms = query.trim().toLocaleLowerCase("id-ID").split(/\s+/);
  const incomplete = STAFF.filter((person) => person.unit === null);
  const matching = STAFF.filter((person) => {
    const group = staffUnit(person);
    if (!group || (selectedUnit && group !== selectedUnit)) return false;
    const position = person.position ?? "";
    const searchable = [fullName(person), position, positionLabel(position), group].join(" ").toLocaleLowerCase("id-ID");
    return terms.every((term) => searchable.includes(term));
  });
  const root = OFFICIALS.find((o) => o.parent === null);
  return (
    <article className="swiss-report-sheet melinda-management-sheet order-sheet hrd-sheet">
      <header className="swiss-masthead melinda-brief-masthead">
        <div>
          <h1 className="melinda-brief-title">Organisasi &amp; Sumber Daya Manusia</h1>
          <div className="melinda-brief-date">
            Struktur kepemimpinan, direktori pegawai, dan tata kelola jabatan RSIA Melinda DHAI.
            <SourceInfo>
              <p>Daftar jabatan, nama, dan nomor dari Direktur (9 November 2026). Garis pelaporan pada bagan adalah asumsi dari nama jabatan dan belum dikonfirmasi.</p>
              <p>Daftar karyawan: nama dari daftar gaji Oktober 2026 (hanya nama; rekening dan gaji tidak dibawa), dicocokkan ke data induk karyawan 2026 untuk gelar, jabatan, dan departemen. Nama yang tidak ada di data induk ditandai dan menunggu jabatannya.</p>
            </SourceInfo>
          </div>
        </div>
      </header>

      {directory.source === "sample" && <p className="staff-note">Data contoh fiktif, bukan pegawai RSIA Melinda. Data asli tersimpan di penyimpanan privat.</p>}
      {editor}

      <section className="swiss-section" aria-labelledby="hrd-ringkasan">
        <SectionHeading id="hrd-ringkasan" number="01" title="Ringkasan SDM" meta="Oktober 2026" />
        <dl className="swiss-meta-dl melinda-meta-dl melinda-meta-inline">
          <div className="swiss-meta-item"><dt>Pejabat struktural</dt><dd>{OFFICIALS.length}</dd></div>
          <div className="swiss-meta-item"><dt>Pegawai</dt><dd>{STAFF.length}</dd></div>
          <div className="swiss-meta-item"><dt>Perlu verifikasi</dt><dd>{incomplete.length}</dd></div>
        </dl>
      </section>

      <section className="swiss-section" aria-labelledby="hrd-bagan">
        <SectionHeading id="hrd-bagan" number="02" title="Struktur Organisasi" meta="Struktur Organisasi dan Direktori Pejabat" />
        <p className="staff-note">Garis pelaporan pada bagan menunggu konfirmasi Direktur. Label jabatan yang diperbarui masih berupa usulan tampilan dan perlu dicocokkan dengan SK resmi.</p>
        <div className="org-scroll" role="region" aria-label="Bagan struktur pimpinan" tabIndex={0}>
          <ul className="org-tree">{root && <Node person={root} officials={OFFICIALS} root />}</ul>
        </div>
      </section>

      <section className="swiss-section" aria-labelledby="hrd-kontak">
        <SectionHeading id="hrd-kontak" number="03" title="Direktori Pejabat Struktural" meta={`${OFFICIALS.length} pejabat`} />
        <div className="swiss-table-wrap">
          <table className="swiss-table">
            <thead>
              <tr>
                <th scope="col" className="text-left">Jabatan</th>
                <th scope="col" className="text-left">Nama</th>
                <th scope="col" className="text-left">Unit</th>
                <th scope="col" className="text-left">Nomor</th>
                <th scope="col" className="text-left">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {OFFICIALS.map((o) => (
                <tr key={o.id}>
                  <th scope="row" className="text-left">{positionLabel(o.position)}</th>
                  <td className="text-left">{o.name}</td>
                  <td className="text-left">{o.unit}</td>
                  <td className="text-left hrd-phone">{formatPhone(o.phone)}</td>
                  <td className="text-left">
                    <a className="hrd-wa" href={whatsappHref(o.phone)} target="_blank" rel="noreferrer" aria-label={`Kirim WhatsApp ke ${positionLabel(o.position)}`}>
                      <MessageCircle className="size-4" aria-hidden="true" />
                      <span>WhatsApp</span>
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="swiss-section" aria-labelledby="hrd-karyawan">
        <SectionHeading id="hrd-karyawan" number="04" title="Direktori Pegawai per Unit Kerja" meta={`${matching.length} pegawai`} />
        <form action="/hrd#hrd-karyawan" method="get" className="hrd-filters">
          <label>
            Cari pegawai
            <input type="search" name="q" defaultValue={query} placeholder="Nama, jabatan, atau unit" />
          </label>
          <label>
            Unit kerja atau penugasan
            <select name="unit" defaultValue={selectedUnit}>
              <option value="">Semua unit</option>
              {staffUnits.map((group) => <option key={group}>{group}</option>)}
            </select>
          </label>
          <button type="submit">Terapkan</button>
          {(query || selectedUnit) && <Link href="/hrd#hrd-karyawan">Hapus filter</Link>}
        </form>
        {matching.length === 0 && <p>Tidak ada pegawai yang cocok dengan pencarian.</p>}
        {staffUnits.map((group) => {
          const people = matching.filter((person) => staffUnit(person) === group);
          return people.length > 0 && <StaffGroup key={group} unit={group} people={people} />;
        })}
      </section>

      <section className="swiss-section" aria-labelledby="hrd-verifikasi">
        <SectionHeading id="hrd-verifikasi" number="05" title="Data Perlu Verifikasi" meta={`${incomplete.length} pegawai`} />
        <StaffGroup unit={null} people={incomplete} />
      </section>
    </article>
  );
}
