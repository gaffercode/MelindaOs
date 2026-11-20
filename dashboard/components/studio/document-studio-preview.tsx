/* Document Studio previews: the official sheet body for each document type, rendered from a draft. */
import { DIRECTOR_SIGNATORY, SK_DIKTUM_LABELS, type FormDraft, type SkDraft, type SpoDraft } from "./document-studio-drafts";
import { OfficialApproval, OfficialFooter, OfficialMeta, OfficialPenetapan, OfficialSection, OfficialTitle } from "../official-sheet";

export function SpoPreview({ draft }: { draft: SpoDraft }) {
  return (
    <>
      <OfficialTitle title={draft.title} subtitle="STANDAR AKREDITASI RUMAH SAKIT (STARKES)" kind={draft.jenis.toUpperCase()} />
      <OfficialMeta rows={[["Nomor dokumen", draft.doc_no], ["Nomor revisi", draft.rev], ["Tanggal terbit", draft.date], ["Tanggal berlaku", draft.date], ["Unit pemilik", draft.unit], ["Status", "DRAF UNTUK KOREKSI"]]} />
      <p className="official-note">Draf untuk koreksi: dokumen belum berlaku sebelum nomor dokumen dan tanda tangan diisi.</p>
      <OfficialSection heading="1. Pengertian">{draft.pengertian}</OfficialSection>
      <OfficialSection heading="2. Tujuan">{draft.tujuan}</OfficialSection>
      <OfficialSection heading="3. Ruang Lingkup">{draft.ruang_lingkup}</OfficialSection>
      <OfficialSection heading="4. Kebijakan">{draft.kebijakan}</OfficialSection>
      <OfficialSection heading="5. Tanggung Jawab">{draft.tanggung_jawab}</OfficialSection>
      <OfficialSection heading="6. Unit Terkait">{draft.unit_terkait}</OfficialSection>
      <OfficialSection heading="7. Prosedur">{draft.prosedur}</OfficialSection>
      <OfficialSection heading="8. Dokumen Terkait">{draft.dokumen_terkait}</OfficialSection>
      <OfficialSection heading="9. Riwayat Revisi">{draft.riwayat_revisi}</OfficialSection>
      <OfficialApproval rows={[
        { role: "Disusun oleh", position: draft.disusun_jabatan, name: draft.disusun_nama },
        { role: "Diperiksa oleh", position: draft.diperiksa_jabatan, name: draft.diperiksa_nama },
        { role: "Disahkan oleh", position: "Direktur", name: DIRECTOR_SIGNATORY },
      ]} />
      <OfficialFooter label="Standar Prosedur Operasional" />
    </>
  );
}

export function SkPreview({ draft }: { draft: SkDraft }) {
  return (
    <>
      <OfficialTitle title="Keputusan Direktur RSIA Melinda DHAI" subtitle={`NOMOR: ${draft.no_sk}`} kind={`TENTANG ${draft.tentang.toUpperCase()}`} />
      <div className="official-sk">
        <p className="official-centred">DIREKTUR RSIA MELINDA DHAI KEDIRI,</p>
        <div className="official-sk-row"><span>Menimbang</span><span>{draft.menimbang}</span></div>
        <div className="official-sk-row"><span>Mengingat</span><span>{draft.mengingat}</span></div>
        <p className="official-centred">MEMUTUSKAN:</p>
        {SK_DIKTUM_LABELS.map((label, index) => (
          <div key={label} className="official-sk-row"><span>{label}</span><span>{draft.diktum[index]}</span></div>
        ))}
      </div>
      <OfficialPenetapan signatory={DIRECTOR_SIGNATORY} />
      <OfficialFooter label="Surat Keputusan Direktur" />
    </>
  );
}

export function FormPreview({ draft }: { draft: FormDraft }) {
  return (
    <div className="space-y-4 pt-1 font-sans text-xs">
      {/* Form Header Matrix */}
      <div className="grid grid-cols-12 border-2 border-slate-900 rounded overflow-hidden">
        <div className="col-span-4 p-3 border-r border-slate-300 flex flex-col justify-center">
          <div className="font-bold text-xs text-slate-900">RSIA MELINDA DHAI KEDIRI</div>
          <div className="text-[10px] text-slate-500">Jl. Balowerti II No. 59 Kediri</div>
          <div className="text-[10px] text-slate-500">Telp. (0354) 691016</div>
        </div>
        <div className="col-span-5 p-3 border-r border-slate-300 text-center flex flex-col justify-center">
          <div className="font-bold text-xs uppercase text-slate-900">{draft.title}</div>
          <div className="text-[10.5px] font-mono text-orange-700 font-bold mt-0.5">{draft.form_code} | {draft.starkes_ref}</div>
          <div className="text-[10px] text-slate-500">Unit: {draft.unit}</div>
        </div>
        <div className="col-span-3 p-2 bg-slate-50/80 text-[10px] space-y-0.5">
          <div className="font-bold text-slate-800 border-b border-slate-200 pb-0.5">LABEL IDENTITAS PASIEN</div>
          <div>Nama: [........................................]</div>
          <div>No. RM: [..................] L / P</div>
          <div>Tgl Lahir: [......./......./.......]</div>
        </div>
      </div>

      {/* Petunjuk Box */}
      {draft.instructions && (
        <div className="p-2.5 bg-slate-50 rounded border border-slate-300 text-[11px] text-slate-700">
          <strong>Petunjuk Pengisian:</strong> {draft.instructions}
        </div>
      )}

      {/* Form Sections */}
      <div className="space-y-3">
        {draft.sections.map((sec) => (
          <div key={sec.title} className="border border-slate-900 rounded overflow-hidden">
            <div className="bg-slate-900 text-white px-3 py-1 text-xs font-bold uppercase tracking-wide">
              {sec.title}
            </div>
            <table className="w-full text-[11px] border-collapse">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-300 text-slate-800 font-semibold text-left">
                  <th className="py-1 px-2.5 w-10 text-center">NO</th>
                  <th className="py-1 px-2.5">ITEM / INDIKATOR PEMERIKSAAN</th>
                  <th className="py-1 px-2.5 w-44">STATUS / PILIHAN</th>
                  <th className="py-1 px-2.5 w-32 text-center">PARAF PETUGAS</th>
                </tr>
              </thead>
              <tbody>
                {sec.rows.map((row, rIdx) => (
                  <tr key={row.item} className="border-b border-slate-200 hover:bg-slate-50/50">
                    <td className="py-1.5 px-2.5 text-center font-bold text-slate-700 align-top">{rIdx + 1}</td>
                    <td className="py-1.5 px-2.5 align-top">
                      <div className="font-semibold text-slate-900">{row.item}</div>
                      {row.desc && <div className="text-[10px] text-slate-500 leading-snug">{row.desc}</div>}
                    </td>
                    <td className="py-1.5 px-2.5 font-mono text-[10.5px] font-semibold text-slate-800 align-top whitespace-pre-wrap">
                      {row.options}
                    </td>
                    <td className="py-1.5 px-2.5 text-center text-slate-400 font-mono text-[10px] align-top">
                      [ Paraf &amp; Jam ]
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {/* Sign-off Matrix */}
      <div className="grid grid-cols-3 gap-3 border border-slate-300 rounded p-3 text-center text-xs">
        <div className="space-y-1">
          <div className="font-bold text-slate-800">Tanggal &amp; Waktu</div>
          <div className="text-slate-500 text-[11px] pt-4">Tgl: ..... / ..... / 2026<br/>Jam: ...... : ...... WIB</div>
        </div>
        <div className="space-y-1">
          <div className="font-bold text-slate-800">Petugas Pelaksana</div>
          <div className="h-8" />
          <div className="text-slate-500 text-[11px]">( ............................................ )<br/>Nama Terang &amp; Tanda Tangan</div>
        </div>
        <div className="space-y-1">
          <div className="font-bold text-slate-800">DPJP / Dokter Jawab</div>
          <div className="h-8" />
          <div className="text-slate-500 text-[11px]">( ............................................ )<br/>Nama Terang &amp; SIP</div>
        </div>
      </div>

      <div className="text-center text-[10px] text-slate-500 font-mono pt-1">
        DOKUMEN REKAM MEDIS RAHASIA — RSIA MELINDA DHAI KEDIRI · STANDAR AKREDITASI STARKES KEMENKES RI
      </div>
      <OfficialFooter label="Formulir Rekam Medis" />
    </div>
  );
}
