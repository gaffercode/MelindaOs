/* Document Studio editors: one form per document type. Each edits a draft and reports changed fields. */
import type { ReactNode } from "react";
import { DIRECTOR_SIGNATORY, SK_DIKTUM_LABELS, type FormDraft, type SkDraft, type SpoDraft } from "./document-studio-drafts";

const INPUT = "w-full px-2.5 py-1 text-xs rounded border border-slate-200";
const CHAPTER = "w-full px-2.5 py-1.5 text-xs rounded border border-slate-200 focus:outline-none";
const CHAPTER_MONO = "w-full px-2.5 py-1.5 text-xs rounded border border-slate-200 font-mono text-[11px] focus:outline-none";

function TextInput({ label, value, onChange, className = INPUT, placeholder }: { label: string; value: string; onChange: (value: string) => void; className?: string; placeholder?: string }) {
  return <input type="text" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={className} placeholder={placeholder} />;
}

function TextArea({ label, rows, value, onChange, className }: { label: string; rows: number; value: string; onChange: (value: string) => void; className: string }) {
  return <textarea rows={rows} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={className} />;
}

function ParameterTable({ head, children }: { head: [string, string]; children: ReactNode }) {
  return (
    <div tabIndex={0} className="swiss-table-wrap">
      <table className="swiss-table">
        <thead>
          <tr>
            <th scope="col" className="text-left w-1/3">{head[0]}</th>
            <th scope="col" className="text-left w-2/3">{head[1]}</th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function ParameterRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <tr>
      <td className="font-semibold text-slate-800">{label}</td>
      <td>{children}</td>
    </tr>
  );
}

function ChartCard({ kicker, title, bodyClassName = "simrs-chart-body", children }: { kicker: ReactNode; title: ReactNode; bodyClassName?: string; children: ReactNode }) {
  return (
    <div className="simrs-chart-card">
      <div className="simrs-chart-header">
        <div className="simrs-chart-kicker">{kicker}</div>
        <div className="simrs-chart-title">{title}</div>
      </div>
      <div className={bodyClassName}>{children}</div>
    </div>
  );
}

type SpoChapter = { field: keyof SpoDraft; title: string; label: string; rows: number; mono?: boolean };

/** The nine STARKES chapters, in order. `label` is the accessible name; `title` is the card heading. */
const SPO_CHAPTERS: SpoChapter[] = [
  { field: "pengertian", title: "1. Pengertian", label: "1. Pengertian", rows: 2 },
  { field: "tujuan", title: "2. Tujuan", label: "2. Tujuan", rows: 2 },
  { field: "ruang_lingkup", title: "3. Ruang Lingkup", label: "3. Ruang lingkup", rows: 2 },
  { field: "kebijakan", title: "4. Kebijakan (Dasar SK Direktur)", label: "4. Kebijakan", rows: 3 },
  { field: "tanggung_jawab", title: "5. Tanggung Jawab", label: "5. Tanggung jawab", rows: 3, mono: true },
  { field: "unit_terkait", title: "6. Unit Terkait", label: "6. Unit terkait", rows: 2 },
  { field: "prosedur", title: "7. Prosedur (Langkah Kerja Teknis)", label: "7. Prosedur", rows: 5 },
  { field: "dokumen_terkait", title: "8. Dokumen Terkait", label: "8. Dokumen terkait", rows: 3 },
  { field: "riwayat_revisi", title: "9. Riwayat Revisi", label: "9. Riwayat revisi", rows: 3, mono: true },
];

export function SpoEditor({ draft, onChange }: { draft: SpoDraft; onChange: (patch: Partial<SpoDraft>) => void }) {
  const chapter = (index: number) => {
    const { field, title, label, rows, mono } = SPO_CHAPTERS[index];
    return (
      <ChartCard key={field} kicker={`Elemen 0${index + 1}`} title={title}>
        <TextArea rows={rows} label={label} value={draft[field]} onChange={(value) => onChange({ [field]: value })} className={mono ? CHAPTER_MONO : CHAPTER} />
      </ChartCard>
    );
  };
  return (
    <>
      <ParameterTable head={["Identitas naskah", "Parameter kanonikal"]}>
        <ParameterRow label="Judul SPO">
          <TextInput label="Judul SPO" value={draft.title} onChange={(title) => onChange({ title })} className="melinda-tool-input font-medium" />
        </ParameterRow>
        <ParameterRow label="Jenis Dokumen">
          <TextInput label="Jenis dokumen" value={draft.jenis} onChange={(jenis) => onChange({ jenis })} />
        </ParameterRow>
        <ParameterRow label="Nomor Dokumen">
          <TextInput label="Nomor dokumen" value={draft.doc_no} onChange={(doc_no) => onChange({ doc_no })} className={`${INPUT} font-mono font-bold`} />
        </ParameterRow>
        <ParameterRow label={<>No. Revisi &amp; Tanggal</>}>
          <div className="flex gap-2">
            <TextInput label="Nomor revisi" value={draft.rev} onChange={(rev) => onChange({ rev })} className="w-20 px-2.5 py-1 text-xs rounded border border-slate-200 font-mono" placeholder="Rev" />
            <TextInput label="Tanggal dokumen" value={draft.date} onChange={(date) => onChange({ date })} className="flex-1 px-2.5 py-1 text-xs rounded border border-slate-200" placeholder="Tanggal terbit" />
          </div>
        </ParameterRow>
        <ParameterRow label="Unit Pengusul">
          <TextInput label="Unit pemilik SPO" value={draft.unit} onChange={(unit) => onChange({ unit })} />
        </ParameterRow>
      </ParameterTable>

      <div className="space-y-3">
        <div className="flex items-center justify-between border-b border-[var(--line)] pb-1 mb-2">
          <span className="text-[var(--type-ui)] font-medium text-slate-800">
            9 Bab Baku Standar Akreditasi STARKES
          </span>
          <span className="font-mono text-[var(--type-micro)] text-slate-500">Bab 1–9</span>
        </div>
        {[0, 1, 2, 3, 4, 5, 6].map(chapter)}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[7, 8].map(chapter)}
        </div>
      </div>

      <div tabIndex={0} className="swiss-table-wrap">
        <table className="swiss-table">
          <thead>
            <tr>
              <th scope="col" className="text-left w-1/4">Peran pengesahan</th>
              <th scope="col" className="text-left w-1/3">Jabatan</th>
              <th scope="col" className="text-left w-5/12">Nama pejabat</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="font-semibold text-slate-800">Disusun Oleh</td>
              <td><TextInput label="Jabatan penyusun" value={draft.disusun_jabatan} onChange={(disusun_jabatan) => onChange({ disusun_jabatan })} /></td>
              <td><TextInput label="Nama penyusun" value={draft.disusun_nama} onChange={(disusun_nama) => onChange({ disusun_nama })} /></td>
            </tr>
            <tr>
              <td className="font-semibold text-slate-800">Diperiksa Oleh</td>
              <td><TextInput label="Jabatan pemeriksa" value={draft.diperiksa_jabatan} onChange={(diperiksa_jabatan) => onChange({ diperiksa_jabatan })} /></td>
              <td><TextInput label="Nama pemeriksa" value={draft.diperiksa_nama} onChange={(diperiksa_nama) => onChange({ diperiksa_nama })} /></td>
            </tr>
            <tr className="bg-slate-50/70 font-medium border-t border-[var(--line)]">
              <td className="text-slate-900">Disahkan Oleh</td>
              <td className="text-slate-900">Direktur</td>
              <td className="text-slate-900 font-bold">{DIRECTOR_SIGNATORY}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

const SK_DIKTUM_NAMES = ["Diktum kesatu", "Diktum kedua", "Diktum ketiga", "Diktum keempat"];

export function SkEditor({ draft, onChange }: { draft: SkDraft; onChange: (patch: Partial<SkDraft>) => void }) {
  const setDiktum = (index: number, value: string) => {
    const diktum: SkDraft["diktum"] = [...draft.diktum];
    diktum[index] = value;
    onChange({ diktum });
  };
  return (
    <div className="space-y-4">
      <ParameterTable head={["Parameter keputusan", "Input naskah dinas"]}>
        <ParameterRow label="Nomor SK Direktur">
          <TextInput label="Nomor SK" value={draft.no_sk} onChange={(no_sk) => onChange({ no_sk })} className={`${INPUT} font-mono font-bold`} />
        </ParameterRow>
        <ParameterRow label="Tentang (Perihal)">
          <TextInput label="Tentang keputusan" value={draft.tentang} onChange={(tentang) => onChange({ tentang })} className="melinda-tool-input font-medium" />
        </ParameterRow>
      </ParameterTable>

      <ChartCard kicker="Konsiderans hukum" title="Menimbang (Pertimbangan Keputusan)">
        <TextArea rows={3} label="Menimbang" value={draft.menimbang} onChange={(menimbang) => onChange({ menimbang })} className={CHAPTER} />
      </ChartCard>

      <ChartCard kicker="Konsiderans hukum" title="Mengingat (Dasar Peraturan & Undang-Undang)">
        <TextArea rows={4} label="Mengingat" value={draft.mengingat} onChange={(mengingat) => onChange({ mengingat })} className={CHAPTER} />
      </ChartCard>

      <ChartCard kicker="Diktum keputusan direktur" title="MEMUTUSKAN (Diktum KESATU - KEEMPAT)" bodyClassName="simrs-chart-body space-y-2">
        {SK_DIKTUM_LABELS.map((label, index) => (
          <div key={label} className="flex gap-2 items-start">
            <span className="font-bold text-xs text-slate-800 w-16 pt-1">{label}</span>
            <TextArea rows={2} label={SK_DIKTUM_NAMES[index]} value={draft.diktum[index]} onChange={(value) => setDiktum(index, value)} className="flex-1 px-2.5 py-1 text-xs rounded border border-slate-200" />
          </div>
        ))}
      </ChartCard>
    </div>
  );
}

export function FormEditor({ draft, onChange }: { draft: FormDraft; onChange: (patch: Partial<FormDraft>) => void }) {
  return (
    <div className="space-y-4">
      <ParameterTable head={["Parameter formulir", "Identitas rekam medis & akreditasi"]}>
        <ParameterRow label="Nama Formulir">
          <TextInput label="Judul formulir" value={draft.title} onChange={(title) => onChange({ title })} className={`${INPUT} font-semibold`} />
        </ParameterRow>
        <ParameterRow label="Kode Formulir">
          <TextInput label="Kode formulir" value={draft.form_code} onChange={(form_code) => onChange({ form_code })} className={`${INPUT} font-mono font-bold`} />
        </ParameterRow>
        <ParameterRow label="Referensi Elemen STARKES">
          <TextInput label="Referensi STARKES" value={draft.starkes_ref} onChange={(starkes_ref) => onChange({ starkes_ref })} className={`${INPUT} font-mono text-orange-700 font-bold`} />
        </ParameterRow>
        <ParameterRow label="Unit Pemilik / Penanggung Jawab">
          <TextInput label="Unit pemilik formulir" value={draft.unit} onChange={(unit) => onChange({ unit })} />
        </ParameterRow>
        <ParameterRow label="Petunjuk Pengisian Petugas">
          <TextArea rows={2} label="Petunjuk pengisian" value={draft.instructions} onChange={(instructions) => onChange({ instructions })} className={INPUT} />
        </ParameterRow>
      </ParameterTable>

      <div className="space-y-3">
        <div className="flex items-center justify-between border-b border-[var(--line)] pb-1 mb-2">
          <span className="text-[var(--type-ui)] font-medium text-slate-800">
            Checklist &amp; Komponen Pemeriksaan Klinis (Elemen D)
          </span>
          <span className="font-mono text-[var(--type-micro)] text-slate-500">{draft.sections.length} bagian formulir</span>
        </div>

        {draft.sections.map((sec, sIdx) => (
          <ChartCard key={sec.title} kicker={<>Bagian 0{sIdx + 1} formulir</>} title={sec.title} bodyClassName="simrs-chart-body space-y-2">
            {sec.rows.map((row, rIdx) => (
              <div key={row.item} className="p-2.5 bg-slate-50 rounded border border-slate-200 text-xs">
                <div className="font-semibold text-slate-900 mb-0.5">{rIdx + 1}. {row.item}</div>
                <div className="text-[11px] text-slate-600 mb-1">{row.desc}</div>
                <div className="font-mono text-[11px] font-semibold text-slate-800">{row.options}</div>
              </div>
            ))}
          </ChartCard>
        ))}
      </div>
    </div>
  );
}
