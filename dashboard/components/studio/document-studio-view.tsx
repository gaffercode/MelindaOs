"use client";

import { useState, useEffect } from "react";
import {
  FileText,
  FileSignature,
  ClipboardList,
  Download,
  Loader2,
  Copy,
  Check,
  Printer,
} from "lucide-react";
import { directorCsrfHeaders } from "@/lib/client-api";
import { FORM_PRESETS, SK_PRESETS, SPO_PRESETS } from "./document-studio-presets";
import { StudioPackageWorkspace } from "./studio-package-workspace";
import { OfficialKop } from "../official-sheet";
import { DIRECTOR_SIGNATORY, formDraftFrom, isSpoComplete, skDraftFrom, spoDraftFrom, spoMarkdown, studioPayload, type DocType } from "./document-studio-drafts";
import { FormEditor, SkEditor, SpoEditor } from "./document-studio-editor";
import { FormPreview, SkPreview, SpoPreview } from "./document-studio-preview";
import "./document-studio.css";

export type { FormPreset } from "./document-studio-presets";

const studioTabs = [{ id: "penyusun", name: "Penyusun SPO, SK, formulir" }, { id: "paket", name: "Paket akreditasi" }] as const;

// Both panels stay mounted (the inactive one is hidden), so a half-written draft survives a tab switch.
export function DocumentStudioView({ pdfAvailable = true }: { pdfAvailable?: boolean }) {
  const [tab, setTab] = useState<(typeof studioTabs)[number]["id"]>("penyusun");
  // Set on the first switch: the panel fade (globals.css) answers a tab change, never the page load.
  const [switched, setSwitched] = useState(false);
  return <div className="studio" data-switched={switched || undefined}>
    <header className="studio-head">
      <p className="order-kicker">RSIA Melinda DHAI · Dokumen resmi</p>
      <h1>Studio dokumen</h1>
      <p className="order-lead">Susun SPO, SK Direktur, dan formulir, atau kerjakan paket dokumen akreditasi sampai siap tanda tangan.</p>
    </header>
    <div className="melinda-tool-segment-group" role="tablist" aria-label="Mode studio">{studioTabs.map((t) => <button key={t.id} type="button" role="tab" id={`studio-tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`studio-panel-${t.id}`} className={`melinda-tool-segment ${tab === t.id ? "is-active" : ""}`} onClick={() => { setTab(t.id); setSwitched(true); }}>{t.name}</button>)}</div>
    {studioTabs.map((t) => <div key={t.id} className="studio-panel" role="tabpanel" id={`studio-panel-${t.id}`} aria-labelledby={`studio-tab-${t.id}`} hidden={tab !== t.id}>
      {t.id === "paket" ? <StudioPackageWorkspace /> : <LegacyDocumentStudioView pdfAvailable={pdfAvailable} />}
    </div>)}
  </div>;
}

const DOC_TYPES: Array<{ id: DocType; title: string; icon: typeof FileText; description: string }> = [
  { id: "spo", title: "SPO / Pedoman 9 Elemen", icon: FileText, description: "Format baku 9 elemen STARKES Kemenkes RI dan matriks verifikasi pengesahan 3 peran." },
  { id: "sk", title: "SK Keputusan Direktur", icon: FileSignature, description: "Naskah dinas penetapan kebijakan, konsiderans menimbang/mengingat, dan diktum keputusan." },
  { id: "form", title: "Formulir Rekam Medis (Elemen D)", icon: ClipboardList, description: "Dokumen bukti implementasi klinis/operasional, kotak stiker pasien, dan lembar verifikasi DPJP." },
];

type ViewMode = "stacked" | "editor" | "preview";

const VIEW_MODES: Array<{ id: ViewMode; label: string; hint: string }> = [
  { id: "stacked", label: "Editor & pratinjau", hint: "Menampilkan editor lengkap diikuti lembar pratinjau kanonikal penuh." },
  { id: "editor", label: "Editor naskah", hint: "Fokus layar penuh untuk perumusan 9 bab standar naskah dinas." },
  { id: "preview", label: "Pratinjau dokumen", hint: "Pratinjau lembar cetak kanonikal standar RSIA Melinda DHAI." },
];

function PresetCard({ code, tag, accent = false, name, summary, selected, onSelect }: { code: string; tag: string; accent?: boolean; name: string; summary: string; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" onClick={onSelect} aria-pressed={selected} className={`melinda-tool-choice ${selected ? "is-selected" : ""}`}>
      <div className="mb-1 space-y-0.5">
        <span className="melinda-tool-doc-code text-slate-500">{code}</span>
        <span className={accent ? "melinda-tool-doc-code text-[var(--orange-ink)]" : "melinda-tool-doc-code text-slate-500"}>{tag}</span>
      </div>
      <div className="font-semibold text-xs text-slate-900 mb-1 leading-snug">{name}</div>
      <p className="text-[11px] text-slate-500 line-clamp-2 leading-relaxed">{summary}</p>
    </button>
  );
}

function CopyMarkdownButton({ copied, onCopy }: { copied: boolean; onCopy: () => void }) {
  return (
    <button type="button" onClick={onCopy} className="button-secondary text-xs" title="Salin Naskah Format Markdown Kategori A">
      {copied ? <Check className="size-3.5 text-slate-900" /> : <Copy className="size-3.5 text-slate-500" />}
      <span>{copied ? "Disalin ke Clipboard" : "Salin Markdown"}</span>
    </button>
  );
}

function CompileButton({ loading, disabled, onCompile }: { loading: boolean; disabled: boolean; onCompile: () => void }) {
  return (
    <button type="button" onClick={onCompile} disabled={disabled} className="button-primary text-xs">
      {loading ? <Loader2 className="size-4 animate-spin" /> : <Printer className="size-4" />}
      <span>Kompilasi PDF Resmi</span>
    </button>
  );
}

function LegacyDocumentStudioView({ pdfAvailable = true }: { pdfAvailable?: boolean }) {
  const [docType, setDocType] = useState<DocType>("spo");
  const [viewMode, setViewMode] = useState<ViewMode>("editor");
  const [activeTab, setActiveTab] = useState<"visual" | "pdf">("visual");
  const [loading, setLoading] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedMd, setCopiedMd] = useState(false);
  const [selectedSpoIdx, setSelectedSpoIdx] = useState(0);
  const [selectedSkIdx, setSelectedSkIdx] = useState(0);
  const [selectedFormIdx, setSelectedFormIdx] = useState(0);
  const [spo, setSpo] = useState(() => spoDraftFrom(SPO_PRESETS[0]));
  const [sk, setSk] = useState(() => skDraftFrom(SK_PRESETS[0]));
  const [form, setForm] = useState(() => formDraftFrom(FORM_PRESETS[0]));

  function applySpoPreset(idx: number) {
    setSelectedSpoIdx(idx);
    setSpo(spoDraftFrom(SPO_PRESETS[idx]));
    setPdfUrl(null);
  }

  function applySkPreset(idx: number) {
    setSelectedSkIdx(idx);
    setSk(skDraftFrom(SK_PRESETS[idx]));
    setPdfUrl(null);
  }

  // Unlike the SPO and SK templates, a formulir template keeps an already compiled PDF.
  function applyFormPreset(idx: number) {
    setSelectedFormIdx(idx);
    setForm(formDraftFrom(FORM_PRESETS[idx]));
  }

  // Fast Bridge: Read URL search parameter from STARKES Command
  useEffect(() => {
    if (typeof window === "undefined") return;
    const timer = setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const starkesCode = params.get("starkes");
      const docTypeParam = params.get("type");

      if (docTypeParam === "sk") {
        setDocType("sk");
      } else if (docTypeParam === "form") {
        setDocType("form");
      }

      if (starkesCode) {
        const matchIdx = SPO_PRESETS.findIndex(
          (p) =>
            p.starkesCode === starkesCode ||
            p.doc_no.includes(starkesCode) ||
            p.name.toLowerCase().includes(starkesCode.toLowerCase())
        );
        if (matchIdx !== -1) {
          setDocType("spo");
          applySpoPreset(matchIdx);
        } else {
          const formIdx = FORM_PRESETS.findIndex(
            (f) =>
              f.starkes_ref.toLowerCase().includes(starkesCode.toLowerCase()) ||
              f.name.toLowerCase().includes(starkesCode.toLowerCase())
          );
          if (formIdx !== -1) {
            setDocType("form");
            applyFormPreset(formIdx);
          }
        }
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  function chooseDocType(next: DocType) {
    setDocType(next);
    setPdfUrl(null);
  }

  async function handleCopyMarkdown() {
    await navigator.clipboard.writeText(spoMarkdown(spo));
    setCopiedMd(true);
    setTimeout(() => setCopiedMd(false), 2000);
  }

  async function handleGeneratePdf() {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/studio/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await directorCsrfHeaders()) },
        body: JSON.stringify({ docType, data: studioPayload(docType, { spo, sk, form }) }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || errJson.error || "Gagal mengompilasi PDF");
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setPdfUrl(url);
      setActiveTab("pdf");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Terjadi kesalahan kompilasi dokumen");
    } finally {
      setLoading(false);
    }
  }

  const isSpoValid = isSpoComplete(spo);

  return (
    <article className="swiss-report-sheet melinda-management-sheet tool-workspace tool-studio" aria-label="Studio Dokumen Rumah Sakit">
      {/* The page head (title and tabs) lives in DocumentStudioView; this line keeps the drafting status in view. */}
      <p className="studio-meta" role="status">
        Status tata naskah: <strong className={docType !== "spo" || isSpoValid ? undefined : "studio-unsaved"}>{docType !== "spo" ? "Draf untuk koreksi" : isSpoValid ? "Isian dasar lengkap" : "Masih ada elemen kosong"}</strong>
        {" · "}Pengesah resmi: {DIRECTOR_SIGNATORY}
        {" · "}Format output: {pdfAvailable ? "PDF dan Markdown" : "Markdown; PDF belum tersedia"}
      </p>

      {/* 01 / Document type and ready-made templates */}
      <section className="swiss-section" aria-labelledby="section-studio-01">
        <div className="melinda-tool-section-head">
          <h2 id="section-studio-01" className="swiss-section-heading">
            <span className="swiss-section-num">01</span><span className="swiss-section-title">Jenis dokumen</span>
          </h2>
          <div className="flex items-center gap-2">
            {docType === "spo" && <CopyMarkdownButton copied={copiedMd} onCopy={handleCopyMarkdown} />}
            <CompileButton loading={loading} disabled={loading || !pdfAvailable} onCompile={handleGeneratePdf} />
          </div>
        </div>

        {!pdfAvailable && <p className="tool-status-error" role="status">Ekspor PDF belum tersedia di server ini. Naskah SPO tetap dapat disalin sebagai Markdown.</p>}

        <div className="tool-document-types flex flex-col gap-3 mb-4 sm:flex-row">
          {DOC_TYPES.map(({ id, title, icon: Icon, description }) => (
            <button key={id} type="button" onClick={() => chooseDocType(id)} aria-pressed={docType === id} className={`w-full sm:flex-1 melinda-tool-choice ${docType === id ? "is-selected" : ""}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="font-semibold text-xs text-slate-900">{title}</span>
                <Icon className="size-4 text-slate-600" />
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">{description}</p>
            </button>
          ))}
        </div>

        <details className="tool-presets">
          <summary>Template siap pakai</summary>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {docType === "spo"
              ? SPO_PRESETS.map((p, idx) => <PresetCard key={p.name} code={p.doc_no} tag={p.starkesCode || p.unit} accent name={p.name} summary={p.pengertian} selected={selectedSpoIdx === idx} onSelect={() => applySpoPreset(idx)} />)
              : docType === "sk"
                ? SK_PRESETS.map((p, idx) => <PresetCard key={p.name} code={p.no_sk} tag="SK direktur" name={p.name} summary={p.tentang} selected={selectedSkIdx === idx} onSelect={() => applySkPreset(idx)} />)
                : FORM_PRESETS.map((p, idx) => <PresetCard key={p.name} code={p.form_code} tag={p.starkes_ref} accent name={p.name} summary={p.instructions} selected={selectedFormIdx === idx} onSelect={() => applyFormPreset(idx)} />)}
          </div>
        </details>
      </section>

      <div className="melinda-tool-mode-bar">
        <div className="melinda-tool-segment-group">
          <span className="melinda-tool-segment-label">Mode tampilan</span>
          {VIEW_MODES.map(({ id, label }) => (
            <button key={id} type="button" onClick={() => setViewMode(id)} aria-pressed={viewMode === id} className={`melinda-tool-segment ${viewMode === id ? "is-active" : ""}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="text-[var(--type-ui)] text-slate-600">
          {VIEW_MODES.find((mode) => mode.id === viewMode)?.hint}
        </div>
      </div>

      {/* 02 / Editor */}
      {(viewMode === "stacked" || viewMode === "editor") && (
        <section id="studio-editor" className="swiss-section mb-8" aria-labelledby="section-studio-02">
          <div className="melinda-tool-section-head">
            <h2 id="section-studio-02" className="swiss-section-heading">
              <span className="swiss-section-num">02</span><span className="swiss-section-title">Editor elemen naskah</span>
            </h2>
            <div className="flex items-center gap-3">
              {viewMode === "stacked" && (
                <a href="#studio-preview" className="melinda-tool-ssot-link">
                  Gulir ke Pratinjau Lembar Cetak &darr;
                </a>
              )}
              <span className="melinda-section-meta text-slate-500 font-mono text-xs">
                Format Standar RSIA Melinda DHAI
              </span>
            </div>
          </div>

          <div className="space-y-6">
            {docType === "spo"
              ? <SpoEditor draft={spo} onChange={(patch) => setSpo((draft) => ({ ...draft, ...patch }))} />
              : docType === "sk"
                ? <SkEditor draft={sk} onChange={(patch) => setSk((draft) => ({ ...draft, ...patch }))} />
                : <FormEditor draft={form} onChange={(patch) => setForm((draft) => ({ ...draft, ...patch }))} />}

            <div className="pt-2">
              {docType !== "spo" ? <p className="tool-field-help">Draf untuk koreksi. Periksa kembali isi dan pengesahan sebelum digunakan.</p> : isSpoValid ? (
                <div className="swiss-callout">
                  <strong>Isian dasar lengkap.</strong> Periksa kembali seluruh bagian dan pengesahan sebelum digunakan.
                </div>
              ) : (
                <p className="text-[var(--type-ui)] text-[var(--orange-ink)] m-0 leading-relaxed">
                  Lengkapi seluruh butir pengertian, tujuan, kebijakan, dan prosedur sebelum kompilasi PDF.
                </p>
              )}
            </div>

            {errorMsg && (
              <p role="alert" className="text-xs text-orange-700 pt-1 font-medium">
                {errorMsg}
              </p>
            )}
          </div>
        </section>
      )}

      {/* 03 / Preview and compiled PDF */}
      {(viewMode === "stacked" || viewMode === "preview") && (
        <section id="studio-preview" className="swiss-section mt-10" aria-labelledby="section-studio-03">
          <div className="melinda-tool-section-head">
            <h2 id="section-studio-03" className="swiss-section-heading">
              <span className="swiss-section-num">03</span><span className="swiss-section-title">Pratinjau kanonikal &amp; lembar pengesahan resmi</span>
            </h2>
            <div className="flex items-center gap-3">
              {viewMode === "stacked" && (
                <a href="#studio-editor" className="melinda-tool-ssot-link">
                  &uarr; Kembali ke Editor Naskah
                </a>
              )}
              <span className="melinda-section-meta text-slate-500 font-mono text-xs">
                Standar Tata Naskah Cetak
              </span>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
              <div className="melinda-tool-tab-bar">
                <button
                  type="button"
                  onClick={() => setActiveTab("visual")}
                  aria-pressed={activeTab === "visual"}
                  className={`melinda-tool-tab ${activeTab === "visual" ? "is-active" : ""}`}
                >
                  Pratinjau tata naskah
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("pdf")}
                  aria-pressed={activeTab === "pdf"}
                  disabled={!pdfUrl}
                  className={`melinda-tool-tab ${activeTab === "pdf" ? "is-active" : ""} ${!pdfUrl ? "opacity-40 cursor-not-allowed" : ""}`}
                >
                  Output PDF asli {pdfUrl && "• Siap"}
                </button>
              </div>

              <div className="flex items-center gap-2">
                {docType === "spo" && <CopyMarkdownButton copied={copiedMd} onCopy={handleCopyMarkdown} />}
                <CompileButton loading={loading} disabled={loading} onCompile={handleGeneratePdf} />

                {pdfUrl && (
                  <a
                    href={pdfUrl}
                    download={`${docType.toUpperCase()}_RSIA_Melinda.pdf`}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-900 bg-slate-100 px-3 py-1.5 rounded border border-slate-300 hover:bg-slate-200 transition"
                  >
                    <Download className="size-3.5" />
                    <span>Unduh PDF</span>
                  </a>
                )}
              </div>
            </div>

            {activeTab === "pdf" && pdfUrl ? (
              <div className="bg-white rounded-lg border border-slate-200 overflow-hidden shadow-xs h-[880px]">
                <iframe src={pdfUrl} className="w-full h-full" title="Pratinjau PDF Dokumen" />
              </div>
            ) : (
              <div tabIndex={0} role="region" aria-label="Pratinjau naskah, dapat digulir" className="official-sheet">
                <OfficialKop />
                {docType === "spo" ? <SpoPreview draft={spo} /> : docType === "sk" ? <SkPreview draft={sk} /> : <FormPreview draft={form} />}
              </div>
            )}
          </div>
        </section>
      )}
    </article>
  );
}
