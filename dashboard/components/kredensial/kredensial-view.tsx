"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  ExternalLink,
  Download,
  X,
  FileText,
  ArrowLeft,
  Search,
} from "lucide-react";
import type { KredensialCategory, KredensialDocument } from "@/lib/kredensial/kredensial-data";
import { QuickInstructionButton } from "../instruction/quick-instruction-button";
import { GlideList } from "../glide-list";

// Rows glide and fade on a filter change only while the list is short both before and after it; longer lists swap at once.
const GLIDE_MAX_ROWS = 40;

const COLLABORATORS = ["dr. Ferdi Andriska", "dr. Novia Dwi Anggraini", "Oriza Rahmawati", "Tim RSIA Melinda"];

export function KredensialView({ authenticated, allowedPages, categories: KREDENSIAL_CATEGORIES, documents: KREDENSIAL_DOCUMENTS }: { authenticated: boolean; allowedPages?: string[]; categories: KredensialCategory[]; documents: KredensialDocument[] }) {
  const [selectedCat, setSelectedCat] = useState<string>("ALL");
  const [selectedSub, setSelectedSub] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedDocId, setSelectedDocId] = useState<string>(
    KREDENSIAL_DOCUMENTS[0]?.id || ""
  );
  const [viewMode, setViewMode] = useState<"canvas" | "raw">("canvas");

  const filteredDocs = useMemo(() => {
    return KREDENSIAL_DOCUMENTS.filter((doc) => {
      // Category filter
      if (selectedCat !== "ALL") {
        if (doc.cat_id !== selectedCat) return false;
      }

      // Subfolder filter for category 08
      if (selectedCat === "08" && selectedSub !== "ALL") {
        if (doc.subfolder_label !== selectedSub) return false;
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const text = `${doc.title} ${doc.filename} ${doc.doc_num} ${doc.pic} ${doc.badge} ${doc.subfolder_label}`.toLowerCase();
        if (!text.includes(q)) return false;
      }

      return true;
    });
  }, [KREDENSIAL_DOCUMENTS, selectedCat, selectedSub, searchQuery]);

  const [rows, setRows] = useState({ docs: filteredDocs, before: filteredDocs.length });
  if (rows.docs !== filteredDocs) setRows({ docs: filteredDocs, before: rows.docs.length });
  const glide = Math.max(filteredDocs.length, rows.before) <= GLIDE_MAX_ROWS;

  // Currently active selected document
  const currentDoc = useMemo(() => {
    const foundInFiltered = filteredDocs.find((d) => d.id === selectedDocId);
    if (foundInFiltered) return foundInFiltered;
    return filteredDocs[0] || KREDENSIAL_DOCUMENTS[0];
  }, [KREDENSIAL_DOCUMENTS, selectedDocId, filteredDocs]);

  return (
    <div className="h-screen w-full flex flex-col overflow-hidden bg-[var(--background)] text-[var(--text)] antialiased select-none font-sans">
      {/* Minimal executive header: credentials remain subject to independent validation. */}
      <header className="shrink-0 border-b border-[var(--line)] bg-[var(--surface)] px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 xl:flex-nowrap">
          <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
            <Link
              href="/"
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface-soft)] px-3 text-xs font-medium text-[var(--muted)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
              aria-label="Kembali ke dashboard utama"
            >
              <ArrowLeft className="size-4" />
              <span className="hidden sm:inline">Dashboard</span>
            </Link>
            <div className="h-8 w-px shrink-0 bg-[var(--line)]" aria-hidden="true" />
            <div className="min-w-0">
              <h1 className="text-base font-semibold leading-tight tracking-tight text-[var(--text)] sm:text-lg">
                Melinda <span className="text-[var(--accent)]">Credentia</span>
              </h1>
              <p className="mt-0.5 text-xs text-[var(--muted)]">
                Kredensial dan Tata Kelola Klinis
              </p>
            </div>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-3">
            {authenticated && (allowedPages === undefined || allowedPages.includes("/arahan")) && <QuickInstructionButton context="Kredensial BPJS 2026" />}
            <div className="min-w-0">
              <p className="text-xs font-medium text-[var(--muted)]">Kolaborasi</p>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-medium leading-snug text-[var(--text)]">
                {COLLABORATORS.map((name, index) => (
                  <span key={name} className="inline-flex items-center gap-x-2">
                    {index > 0 && (
                      <span className="text-[var(--muted)]" aria-hidden="true">
                        &middot;
                      </span>
                    )}
                    <span>{name}</span>
                  </span>
                ))}
              </p>
            </div>
            <div className="border-l border-[var(--line)] pl-5">
              <p className="text-xs font-medium text-[var(--muted)]">Total Dokumen</p>
              <p className="mt-1 text-base font-semibold leading-snug text-[var(--text)]">
                {KREDENSIAL_DOCUMENTS.length} <span className="text-xs font-normal text-[var(--muted)]">Berkas</span>
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* ── 2. MAIN 3-PANEL MODULAR WORKSPACE ── */}
      <div className="flex-1 flex overflow-hidden">
        {/* PANEL A: KLASIFIKASI KATEGORI (Left Rail, 240px) */}
        <aside className="w-60 border-r border-[var(--line)] bg-[var(--surface-soft)] flex flex-col shrink-0 hidden lg:flex">
          <div className="p-3.5 border-b border-[var(--line)] bg-[var(--surface)]">
            <div className="text-xs font-semibold text-[var(--muted)]">
              Klasifikasi Dokumen
            </div>
            <div className="text-sm font-semibold text-[var(--text)] mt-0.5">
              8 Folder Standar BPJS
            </div>
          </div>

          {/* Categories Vertical Navigation */}
          <nav className="flex-1 overflow-y-auto divide-y divide-[var(--line)]">
            {KREDENSIAL_CATEGORIES.map((cat) => {
              const isSelected = selectedCat === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => {
                    setSelectedCat(cat.id);
                    setSelectedSub("ALL");
                    const firstInCat = KREDENSIAL_DOCUMENTS.find(
                      (d) => cat.id === "ALL" || d.cat_id === cat.id
                    );
                    if (firstInCat) setSelectedDocId(firstInCat.id);
                  }}
                  className={`w-full p-3 text-left transition-colors flex items-start space-x-2.5 group relative ${
                    isSelected
                      ? "bg-[var(--surface)] text-[var(--accent)]"
                      : "hover:bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--text)]"
                  }`}
                >
                  {isSelected && (
                    <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-[var(--accent)]" />
                  )}
                  <span
                    className={`text-xs font-semibold px-1.5 py-0.5 rounded ${
                      isSelected
                        ? "bg-[var(--accent)] text-white"
                        : "bg-[var(--surface)] text-[var(--muted)] border border-[var(--line)] group-hover:text-[var(--accent)]"
                    }`}
                  >
                    {cat.id === "ALL" ? "ALL" : cat.badge}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div
                      className={`text-sm tracking-tight leading-snug truncate ${
                        isSelected
                          ? "text-[var(--accent)] font-semibold"
                          : "text-[var(--text)] font-medium group-hover:text-[var(--accent)]"
                      }`}
                    >
                      {cat.name}
                    </div>
                    <div className="text-xs text-[var(--muted)] mt-0.5">
                      {cat.count} Berkas
                    </div>
                  </div>
                </button>
              );
            })}
          </nav>

          {/* Bottom Footnote */}
          <div className="p-3 border-t border-[var(--line)] bg-[var(--surface)] text-xs text-[var(--muted)] leading-relaxed">
            <span className="text-[var(--good)] font-medium">● Audit substansi belum selesai</span>
            <br />
            Inventaris dokumen; bukan persetujuan BPJS
          </div>
        </aside>

        {/* PANEL B: STREAM DOKUMEN & PENCARIAN (Middle Column, 420px) */}
        <section className="w-full sm:w-[380px] md:w-[420px] border-r border-[var(--line)] bg-[var(--surface)] flex flex-col shrink-0">
          {/* Filter Bar & Search Input */}
          <div className="p-3 border-b border-[var(--line)] bg-[var(--surface-soft)] space-y-2">
            {/* Search Input matching MelindaOS form styles */}
            <div className="relative">
              <Search className="absolute left-3 top-2.5 size-4 text-[var(--muted)]" />
              <input
                type="text"
                placeholder="Cari berkas, kode SPO, DPJP..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[var(--surface)] text-sm font-normal text-[var(--text)] pl-9 pr-8 py-2 border border-[var(--line)] focus:border-[var(--brand-teal)] focus:ring-1 focus:ring-[var(--brand-teal)] focus:outline-none transition-all placeholder:text-[var(--muted)] rounded-lg shadow-2xs"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-2.5 text-[var(--muted)] hover:text-[var(--text)]"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>

            {/* Horizontal Category Strip for Mobile/Tablet (< lg) */}
            <div className="lg:hidden flex space-x-1.5 overflow-x-auto pb-1 text-xs scrollbar-none">
              {KREDENSIAL_CATEGORIES.map((cat) => {
                const isSelected = selectedCat === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => {
                      setSelectedCat(cat.id);
                      setSelectedSub("ALL");
                      const firstInCat = KREDENSIAL_DOCUMENTS.find(
                        (d) => cat.id === "ALL" || d.cat_id === cat.id
                      );
                      if (firstInCat) setSelectedDocId(firstInCat.id);
                    }}
                    className={`px-3 py-1.5 whitespace-nowrap border text-xs font-medium rounded-lg transition ${
                      isSelected
                        ? "bg-[var(--accent)] text-white border-[var(--accent)] font-semibold"
                        : "bg-[var(--surface)] text-[var(--muted)] border-[var(--line)] hover:bg-[var(--surface-soft)]"
                    }`}
                  >
                    {cat.id === "ALL" ? "Semua" : cat.name}
                  </button>
                );
              })}
            </div>

            {/* Sub-filter buttons (Specific to Folder 08 Clinical Pathway) */}
            {(selectedCat === "08" ||
              selectedCat === "CAT-08" ||
              selectedCat === "ALL") && (
              <div className="pt-2 border-t border-[var(--line)] flex items-center space-x-1.5 overflow-x-auto text-xs scrollbar-none">
                {[
                  { id: "ALL", label: "Semua CP" },
                  { id: "12 CP Prioritas", label: "12 CP Prioritas" },
                  { id: "Kebidanan & Kandungan", label: "Kebidanan & Kandungan" },
                  { id: "Penyakit Dalam", label: "Penyakit Dalam" },
                  { id: "MEOWS & PEWS", label: "EWS" },
                  { id: "Asuhan Keperawatan", label: "Keperawatan" },
                ].map((sub) => {
                  const isActive = selectedSub === sub.id;
                  return (
                    <button
                      key={sub.id}
                      type="button"
                      onClick={() => setSelectedSub(sub.id)}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition whitespace-nowrap ${
                        isActive
                          ? "bg-[var(--accent)] text-white font-semibold"
                          : "bg-[var(--surface)] border border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--muted)]"
                      }`}
                    >
                      {sub.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* List Counter Bar */}
          <div className="px-3.5 py-2 bg-[var(--surface-soft)] border-b border-[var(--line)] flex items-center justify-between text-xs text-[var(--muted)]">
            <span className="font-medium">
              Berkas: {filteredDocs.length} dari {KREDENSIAL_DOCUMENTS.length}
            </span>
            <span className="text-xs text-[var(--accent)] font-medium">
              Pilih untuk telaah naskah
            </span>
          </div>

          <div role="status" className="px-3.5 py-2 border-b border-[var(--line)] text-xs text-[var(--muted)]">Seluruh berkas menunggu pemeriksaan substansi, verifikasi bukti, dan pengesahan. Status tidak dapat ditentukan hanya dari keberadaan PDF.</div>
          {/* Stream of Document Cards */}
          <div className="flex-1 overflow-y-auto divide-y divide-[var(--line)] bg-[var(--surface)]">
            <GlideList glide={glide} fadeIn>
            {filteredDocs.map((doc) => {
              const isSelected = doc.id === currentDoc.id;
              return (
                <div
                  key={doc.id}
                  onClick={() => setSelectedDocId(doc.id)}
                  className={`p-3.5 cursor-pointer transition-colors relative select-none ${
                    isSelected
                      ? "bg-[var(--accent-soft)] text-[var(--text)]"
                      : "hover:bg-[var(--surface-soft)] text-[var(--text)]"
                  }`}
                >
                  {isSelected && (
                    <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-[var(--accent)]" />
                  )}
                  <div className="pl-1.5">
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <span
                        className={`text-xs font-semibold ${
                          isSelected ? "text-[var(--accent)]" : "text-[var(--muted)]"
                        }`}
                      >
                        {doc.doc_num}
                      </span>
                      <span className="text-xs px-2 py-0.5 bg-[var(--surface)] text-[var(--muted)] border border-[var(--line)] rounded">
                        {doc.ext} • {doc.size_kb} KB
                      </span>
                    </div>
                    <h4
                      className={`text-sm leading-snug line-clamp-2 ${
                        isSelected
                          ? "text-[var(--accent)] font-semibold"
                          : "text-[var(--text)] font-medium"
                      }`}
                    >
                      {doc.title}
                    </h4>
                    <div className="mt-1.5 flex items-center justify-between gap-1 text-xs text-[var(--muted)]">
                      <span className="truncate max-w-[220px]">
                        {doc.pic.split("(")[0].trim()}
                      </span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded font-medium ${
                          isSelected
                            ? "bg-[var(--accent)] text-white font-semibold"
                            : "bg-[var(--surface-soft)] text-[var(--muted)] border border-[var(--line)]"
                        }`}
                      >
                        Belum diverifikasi
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
            </GlideList>

            {filteredDocs.length === 0 && (
              <div className="p-10 text-center text-[var(--muted)] text-sm space-y-2">
                <div className="font-semibold text-[var(--text)]">Berkas tidak ditemukan</div>
                <div>Tidak ada dokumen yang sesuai dengan kata kunci pencarian.</div>
              </div>
            )}
          </div>
        </section>

        {/* PANEL C: VIEWER DOKUMEN & ACTION DOCK (Right Column, Fluid) */}
        <section className="flex-1 flex flex-col bg-[var(--surface-shell)] overflow-hidden relative">
          {/* Document Control Bar */}
          <div className="p-3.5 border-b border-[var(--line)] bg-[var(--surface)] flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0 shadow-2xs">
            <div className="space-y-1.5 min-w-0">
              <div className="flex items-center space-x-2">
                <span className="text-xs font-semibold px-2.5 py-0.5 bg-[var(--accent)] text-white rounded-md">
                  {currentDoc.doc_num}
                </span>
                <span className="text-xs font-medium px-2.5 py-0.5 bg-[var(--surface-soft)] text-[var(--text)] border border-[var(--line)] rounded-md">
                  {currentDoc.cat_name}
                </span>
                <span className="text-xs font-medium px-2 py-0.5 bg-[var(--surface)] text-[var(--muted)] border border-[var(--line)] rounded-md">
                  Belum diverifikasi
                </span>
              </div>
              <h2 className="text-base sm:text-lg font-semibold text-[var(--text)] tracking-tight truncate">
                {currentDoc.title}
              </h2>
              <div className="flex items-center space-x-3 text-xs text-[var(--muted)]">
                <span>
                  PIC / Penanggung Jawab:{" "}
                  <strong className="text-[var(--text)] font-medium">
                    {currentDoc.pic}
                  </strong>
                </span>
              </div>
            </div>

            {/* Quick Action Dock matching MelindaOS buttons */}
            <div className="flex items-center space-x-2 shrink-0">
              {currentDoc.ext === "PDF" && (
                <div className="flex items-center p-0.5 bg-[var(--surface-soft)] border border-[var(--line)] rounded-lg text-xs font-medium">
                  <button
                    type="button"
                    onClick={() => setViewMode("canvas")}
                    className={`px-3 py-1.5 rounded-md transition ${
                      viewMode === "canvas"
                        ? "bg-[var(--surface)] text-[var(--accent)] font-semibold shadow-2xs"
                        : "text-[var(--muted)] hover:text-[var(--text)]"
                    }`}
                    title="Render Dokumen Canvas (Bebas Crash & Cepat)"
                  >
                    📄 Canvas
                  </button>
                  
                </div>
              )}
              <a
                href={currentDoc.url}
                target="_blank"
                rel="noreferrer"
                className="px-3.5 py-1.5 bg-[var(--surface)] hover:bg-[var(--surface-soft)] text-[var(--text)] border border-[var(--line)] text-xs font-medium flex items-center space-x-1.5 transition rounded-lg"
              >
                <ExternalLink className="size-3.5" />
                <span>Buka Tab Baru</span>
              </a>
              <a
                href={`${currentDoc.url}?unduh=1`}
                className="px-3.5 py-1.5 bg-[var(--accent)] hover:bg-[#056062] text-white text-xs font-medium flex items-center space-x-1.5 transition shadow-2xs rounded-lg"
              >
                <Download className="size-3.5" />
                <span>Unduh Dokumen</span>
              </a>
            </div>
          </div>

          {/* Iframe Viewport Container */}
          <div className="flex-1 bg-[var(--surface-shell)] relative flex items-center justify-center overflow-hidden">
            {currentDoc.ext === "PDF" ? (
              <iframe
                key={`${currentDoc.id}-${viewMode}`}
                src={
                  viewMode === "canvas"
                    ? `/kredensial/pdf-viewer.html?file=${encodeURIComponent(currentDoc.url)}`
                    : `${currentDoc.url}#toolbar=1&navpanes=0&view=FitH`
                }
                className="w-full h-full border-0 bg-white"
                title={currentDoc.title}
              />
            ) : currentDoc.ext === "XLSX" ? (
              <div className="p-8 text-center bg-white rounded-xl border border-[var(--line)] shadow-xs space-y-3 max-w-md mx-4">
                <FileText className="size-14 mx-auto text-[var(--brand-teal)]" />
                <div className="text-sm font-semibold text-[var(--text)]">
                  Berkas Spreadsheet (XLSX)
                </div>
                <div className="text-xs text-[var(--muted)]">
                  {currentDoc.filename}
                </div>
                <a
                  href={`${currentDoc.url}?unduh=1`}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--accent)] hover:bg-[#056062] text-white text-xs font-medium rounded-lg transition"
                >
                  <Download className="size-4" />
                  Unduh Spreadsheet Resmi
                </a>
              </div>
            ) : (
              <div className="p-4 max-h-full max-w-full overflow-auto flex items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={currentDoc.url}
                  alt={currentDoc.title}
                  className="max-h-[85vh] max-w-full object-contain rounded-lg shadow-sm border border-[var(--line)]"
                />
              </div>
            )}
          </div>

          {/* Helper hint for browser compatibility */}
          {currentDoc.ext === "PDF" && (
            <div className="bg-[var(--surface-soft)] border-t border-[var(--line)] px-4 py-2 flex items-center justify-between text-xs text-[var(--muted)] shrink-0">
              <span className="truncate">
                {viewMode === "canvas"
                  ? "Mode: Canvas lokal. Penelaahan dan pengesahan belum terverifikasi."
                  : "Mode: PDF browser lokal."}
              </span>
              <button
                type="button"
                onClick={() => setViewMode(viewMode === "canvas" ? "raw" : "canvas")}
                className="text-[var(--accent)] hover:underline font-medium shrink-0 ml-2"
              >
                {viewMode === "canvas" ? "Ganti ke PDF Browser" : "Ganti ke Canvas"}
              </button>
            </div>
          )}

          {/* Bottom Precision Status Ribbon */}
          <footer className="h-8 border-t border-[var(--line)] bg-[var(--surface)] px-4 flex items-center justify-between shrink-0 text-xs text-[var(--muted)]">
            <div className="truncate max-w-[500px]">
              Berkas: <span className="text-[var(--text)] font-medium">{currentDoc.rel_path}</span>
            </div>
            <div className="flex items-center space-x-3">
              <span className="text-[var(--good)] font-medium">Status: Belum diverifikasi dan disahkan</span>
              <span className="text-[var(--line)]">|</span>
              <span>Versi: Belum diverifikasi</span>
            </div>
          </footer>
        </section>
      </div>
    </div>
  );
}
