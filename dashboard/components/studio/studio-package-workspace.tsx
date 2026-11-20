"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, Download, FileText, Plus } from "lucide-react";
import type { DocumentBlock, StudioDocument, StudioPackage } from "@/lib/studio/contracts";
import { directorCsrfHeaders } from "@/lib/client-api";
import { SourceInfo } from "../source-info";
import { StudioQualityPanel } from "./studio-quality-panel";
import "./document-studio.css";

type Status = StudioPackage["status"];
const label: Record<Status, string> = { draft: "Dalam penyusunan", in_review: "Sudah direview", ready_for_signature: "Siap tanda tangan", signed: "Pengesahan tercatat", superseded: "Digantikan revisi baru" };
const steps = [{ name: "Penyusunan", hint: "Isi dan simpan" }, { name: "Review", hint: "Substansi dicatat" }, { name: "Tanda tangan", hint: "PDF final" }, { name: "Pengesahan", hint: "Arsip dicatat" }];
const stepOf: Record<Status, number> = { draft: 0, in_review: 1, ready_for_signature: 2, signed: 3, superseded: -1 };
const next: Record<Status, string> = {
  draft: "Isi dan perbaiki dokumen, simpan, lalu catat review substansi.",
  in_review: "Review tercatat. Direktur menetapkan tanggal, lalu menyiapkan dokumen untuk tanda tangan.",
  ready_for_signature: "Unduh PDF final, tanda tangani, lalu catat pengesahan.",
  signed: "Pengesahan sudah tercatat. Dokumen final tetap dapat diunduh.",
  superseded: "Paket ini sudah digantikan revisi yang lebih baru.",
};

// A text field that grows with its content, so the page scrolls instead of the field.
function AutoText({ value, onChange, name, disabled, cell = false }: { value: string; onChange: (value: string) => void; name: string; disabled: boolean; cell?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // Refit when the text changes and when the column width changes (a table settles its widths after the first paint).
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const fit = () => { el.style.height = "auto"; el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`; };
    fit();
    let width = el.offsetWidth;
    const watch = new ResizeObserver(() => { if (el.offsetWidth !== width) { width = el.offsetWidth; fit(); } });
    watch.observe(el);
    return () => watch.disconnect();
  }, [value]);
  return <textarea ref={ref} rows={1} aria-label={name} className={cell ? "studio-cell" : "studio-text"} disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} />;
}

function Sources({ doc }: { doc: StudioDocument }) {
  return <SourceInfo><ul className="studio-sources">{doc.sources.map((x) => <li key={x.id}>{x.path}<small>{x.locator} · {x.status === "verified" ? "Sumber diperiksa" : "Perlu review sumber"}</small></li>)}</ul></SourceInfo>;
}

function Block({ block, heading, disabled, onChange }: { block: DocumentBlock; heading: string; disabled: boolean; onChange: (block: DocumentBlock) => void }) {
  if (block.type === "text") return <AutoText name={heading} disabled={disabled} value={block.text} onChange={(text) => onChange({ ...block, text })} />;
  if (block.type === "list") return <AutoText name={heading} disabled={disabled} value={block.items.join("\n")} onChange={(text) => onChange({ ...block, items: text.split("\n") })} />;
  if (block.type === "input") return <p className="studio-line">{block.label}</p>;
  return <div className="studio-tablewrap" role="region" aria-label={`Tabel ${heading}`} tabIndex={0}><table>
    <thead><tr>{block.headers.map((h, i) => <th key={i} scope="col" data-narrow={h.length <= 4 || undefined}>{h}</th>)}</tr></thead>
    <tbody>{block.rows.map((cells, ri) => <tr key={ri}>{cells.map((value, ci) => <td key={ci} data-narrow={block.headers[ci].length <= 4 || undefined}><AutoText cell disabled={disabled} name={`${block.headers[ci]} baris ${ri + 1}`} value={value} onChange={(text) => { const copy = structuredClone(block); copy.rows[ri][ci] = text; onChange(copy); }} /></td>)}</tr>)}</tbody>
  </table></div>;
}

export function StudioPackageWorkspace() {
  const [packages, setPackages] = useState<StudioPackage[]>([]);
  const [pkg, setPackage] = useState<StudioPackage | null>(null);
  const [role, setRole] = useState<"mutu" | "director" | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [dirty, setDirty] = useState(false);
  const [evidenceRef, setEvidenceRef] = useState("");
  const [signedAt, setSignedAt] = useState("");
  const [issueDate, setIssueDate] = useState(""); const [documentId, setDocumentId] = useState("spo-identifikasi");
  useEffect(() => {
    let active = true;
    void fetch("/api/studio/packages", { cache: "no-store" }).then(async (response) => {
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "Paket belum dapat dimuat.");
      if (active) { setPackages(body.packages); setRole(body.role); }
    }).catch((e: unknown) => { if (active) setError(e instanceof Error ? e.message : "Paket belum dapat dimuat."); });
    return () => { active = false; };
  }, []);
  async function command(path: string, data: object) {
    setBusy(true); setError("");
    try {
      const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", ...(await directorCsrfHeaders()) }, body: JSON.stringify(data) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "Paket belum dapat disimpan.");
      const saved = body.package as StudioPackage; setPackage(saved); setDirty(false);
      if (saved.status === "signed") { setEvidenceRef(""); setSignedAt(""); }
      setPackages((rows) => [saved, ...rows.filter((p) => p.id !== saved.id)]);
    } catch (e) { setError(e instanceof Error ? e.message : "Permintaan gagal."); }
    finally { setBusy(false); }
  }
  const activeId = pkg?.documents.some((d) => d.id === documentId) ? documentId : pkg?.documents[0]?.id ?? documentId;
  const doc = pkg?.documents.find((d) => d.id === activeId);
  function editBlock(sectionIndex: number, blockIndex: number, block: DocumentBlock) {
    if (!pkg) return;
    const copy = structuredClone(pkg);
    const target = copy.documents.find((d) => d.id === activeId); if (!target) return;
    target.sections[sectionIndex].blocks[blockIndex] = block; setPackage(copy); setDirty(true);
  }
  async function download(format: "pdf" | "markdown", mode: "preview" | "final") {
    if (!pkg) return; setBusy(true); setError("");
    try {
      const response = await fetch(`/api/studio/packages/${pkg.id}/export`, { method: "POST", headers: { "Content-Type": "application/json", ...(await directorCsrfHeaders()) }, body: JSON.stringify({ documentId: activeId, mode, format, expectedRevision: pkg.revision }) });
      if (!response.ok) { const body = await response.json(); throw new Error(body.error || "Ekspor gagal."); }
      const url = URL.createObjectURL(await response.blob()); const a = document.createElement("a"); a.href = url;
      a.download = response.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] || `dokumen.${format === "pdf" ? "pdf" : "md"}`;
      a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError(e instanceof Error ? e.message : "Ekspor gagal."); } finally { setBusy(false); }
  }
  const editable = pkg?.status === "draft" || pkg?.status === "in_review";
  const blockers = pkg?.issues.filter((i) => i.severity === "blocker" && !(i.code === "publication_missing" && ["number", "issueDate"].includes(i.field))) ?? [];
  const current = pkg ? stepOf[pkg.status] : -1;
  const open = (id: string) => { setPackage(packages.find((p) => p.id === id) ?? null); setDirty(false); setEvidenceRef(""); setSignedAt(""); };
  const issuesOf = (id: string) => new Set(pkg?.issues.filter((i) => i.documentId === id && i.severity === "blocker").map((i) => `${i.code}:${i.field}`)).size;

  return <section className="studio-package print:hidden" aria-label="Paket dokumen akreditasi">
    <header className="studio-bar">
      <label className="studio-field-label"><span>Pilih paket</span>
        <select className="studio-select" disabled={busy} value={pkg?.id ?? ""} onChange={(e) => open(e.target.value)}><option value="">Paket tersimpan</option>{packages.map((p) => <option key={p.id} value={p.id}>Identifikasi pasien · Revisi {p.revision}</option>)}</select>
      </label>
      <button className={pkg ? "button-secondary" : "button-primary"} disabled={busy} onClick={() => void command("/api/studio/packages", { packageKey: "identifikasi-pasien" })}><Plus size={18} aria-hidden="true" />Buat paket identifikasi pasien</button>
    </header>
    <h2 className="sr-only">Paket dokumen</h2>
    <p className="studio-meta">Susun, periksa, review, lalu siapkan dokumen untuk tanda tangan. Pengesahan dicatat setelah dokumen ditandatangani.</p>
    {error && <p role="alert" className="studio-error">{error}</p>}

    {!pkg && <div className="studio-empty"><FileText size={28} aria-hidden="true" /><p>Mulai dengan paket identifikasi pasien. Dokumen siap tanda tangan diterbitkan setelah pemeriksaan dan review selesai.</p></div>}

    {pkg && <>
      <p className="studio-meta" role="status"><strong>{label[pkg.status]}</strong> · Revisi {pkg.revision}{dirty && <span className="studio-unsaved"> · Perubahan belum disimpan</span>}</p>
      <ol className="studio-steps" aria-label="Tahap paket">{steps.map((s, i) => <li key={s.name} data-state={i < current || pkg.status === "signed" ? "done" : i === current ? "current" : "todo"} aria-current={i === current ? "step" : undefined}><span>{s.name}</span><small>{s.hint}</small></li>)}</ol>

      <div className="studio-bench">
        <nav className="studio-rail" aria-label="Dokumen dalam paket">
          <div><h3>Dokumen dalam paket</h3>
            <ul className="studio-docs">{pkg.documents.map((d) => { const n = issuesOf(d.id); return <li key={d.id}><button type="button" aria-current={d.id === activeId ? "true" : undefined} onClick={() => setDocumentId(d.id)}><span>{d.title}</span>{n > 0 && <small>{n} perlu diperbaiki</small>}</button></li>; })}</ul>
          </div>
          {doc && <div><h3>Bagian</h3><ul className="studio-outline">{doc.sections.map((s) => <li key={s.id}><a href={`#studio-sec-${s.id}`}>{s.heading}</a></li>)}</ul></div>}
        </nav>

        {doc && <article className="studio-sheet" aria-label={doc.title}>
          <div className="studio-kop"><span><strong>RSIA Melinda DHAI</strong> · Kediri</span><Sources doc={doc} /></div>
          <h2>{doc.title}</h2>
          <p className="studio-docmeta"><span>{doc.unit}</span><span>Revisi {doc.revision}</span><span>{doc.number ?? "Nomor belum ditetapkan"}</span></p>
          {doc.sections.map((section, si) => <section key={section.id} id={`studio-sec-${section.id}`} className="studio-section"><h3>{section.heading}</h3>
            <div className="studio-blocks">{section.blocks.map((block, bi) => <Block key={bi} block={block} heading={section.heading} disabled={!editable || busy} onChange={(next) => editBlock(si, bi, next)} />)}</div>
          </section>)}
        </article>}

        <div className="studio-aside">
          <div className="studio-card"><h3>Langkah berikutnya</h3><p>{next[pkg.status]}</p>
            <div className="studio-actions">
              {editable && <>
                <button className={dirty ? "button-primary" : "button-secondary"} disabled={busy || !dirty} onClick={() => void command(`/api/studio/packages/${pkg.id}`, { command: "save", expectedRevision: pkg.revision, documents: pkg.documents })}>Simpan perubahan</button>
                <button className={!dirty && pkg.status === "draft" ? "button-primary" : "button-secondary"} disabled={busy || dirty} onClick={() => void command(`/api/studio/packages/${pkg.id}`, { command: "review", expectedRevision: pkg.revision })}><Check size={18} aria-hidden="true" />Catat review substansi</button>
              </>}
              <button className="button-secondary" disabled={busy || dirty || !doc} onClick={() => void download("pdf", "preview")}><Download size={18} aria-hidden="true" />Unduh pratinjau PDF</button>
            </div>
          </div>

          {editable && <div className="studio-card"><h3>Penetapan</h3>
            <label className="studio-field-label"><span>Tanggal penetapan</span><input className="studio-input" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} /></label>
            <button className="button-primary" disabled={busy || dirty || role !== "director" || pkg.status !== "in_review" || blockers.length > 0 || !issueDate} onClick={() => void command(`/api/studio/packages/${pkg.id}`, { command: "finalize", expectedRevision: pkg.revision, requestId: crypto.randomUUID(), issueDate })}>Siapkan untuk tanda tangan</button>
            {role !== "director" && <p>Hanya Direktur yang dapat menyiapkan dokumen untuk tanda tangan.</p>}
          </div>}

          {["ready_for_signature", "signed"].includes(pkg.status) && <div className="studio-card"><h3>Dokumen final</h3>
            <div className="studio-actions">
              <button className="button-primary" disabled={busy} onClick={() => void download("pdf", "final")}><Download size={18} aria-hidden="true" />Unduh PDF final</button>
              <button className="button-secondary" disabled={busy} onClick={() => void download("markdown", "final")}><Download size={18} aria-hidden="true" />Unduh Markdown final</button>
            </div>
          </div>}

          {pkg.status === "ready_for_signature" && role === "director" && <form className="studio-card" onSubmit={(event) => {
            event.preventDefault();
            void command(`/api/studio/packages/${pkg.id}`, { command: "confirm_signed", expectedRevision: pkg.revision, evidenceRef: evidenceRef.trim(), signedAt });
          }}><h3>Catat pengesahan</h3>
            <label className="studio-field-label"><span>Referensi arsip pengesahan</span><input className="studio-input" required maxLength={1000} value={evidenceRef} onChange={(event) => setEvidenceRef(event.target.value)} /></label>
            <label className="studio-field-label"><span>Tanggal tanda tangan</span><input className="studio-input" required type="date" min={pkg.finalization?.issueDate} value={signedAt} onChange={(event) => setSignedAt(event.target.value)} /></label>
            <button className="button-primary" disabled={busy || !evidenceRef.trim() || !signedAt}>Catat pengesahan</button>
          </form>}

          <StudioQualityPanel issues={pkg.issues} />
        </div>
      </div>
    </>}
  </section>;
}
