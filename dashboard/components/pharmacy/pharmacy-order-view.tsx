"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { directorCsrfHeaders } from "@/lib/client-api";
import type { CsvTable } from "@/lib/csv";
import type { OrderDecision, OrderDecisionValue, OrderFile, OrderFileDetail, OrderFileList, ParsedContent } from "@/lib/pharmacy/order-obat-api";
import { checkOrderReading, filterReadSections, type OrderChecks, type OrderReading } from "@/lib/pharmacy/order-obat-reading";
import { SectionHeading } from "../melinda-brief/melinda-morning-brief";
import { SourceInfo } from "../source-info";

export type InitialOrderFile = OrderFileDetail;

const KIND_LABEL: Record<OrderFile["kind"], string> = { csv: "CSV", pdf: "PDF", xlsx: "Excel", other: "Berkas" };
const DECISION_LABEL: Record<OrderDecisionValue, string> = { diterima: "Diterima", ditolak: "Ditolak" };
const idFormat = new Intl.NumberFormat("id-ID");

export function formatRupiah(value: number): string {
  return `Rp${idFormat.format(value)}`;
}
function formatSize(bytes: number): string {
  if (bytes <= 0) return "—";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}
function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" }).format(date);
}
async function readError(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  return body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : `Gagal (HTTP ${response.status}).`;
}
function isReading(parsed: ParsedContent | null): parsed is OrderReading {
  return parsed?.format === "pengajuan-order-obat";
}
/** Which "not read" sentence applies. Nothing until the file's content has loaded: an unloaded file may well have a reading. */
export function notReadNotice({ loaded, parsed, kind }: { loaded: boolean; parsed: ParsedContent | null; kind: OrderFile["kind"] }): string | null {
  if (!loaded || isReading(parsed)) return null;
  if (parsed?.format === "csv") return "Susunan kolom CSV ini tidak dikenali sebagai lembar pengajuan. Pemeriksaan sistem tidak dijalankan.";
  if (kind === "pdf") return "PDF ini tidak terbaca otomatis: tidak ada lapisan teks (misalnya hasil scan) atau tata letaknya berbeda. Pemeriksaan sistem tidak dijalankan. Buka berkasnya untuk membaca langsung.";
  if (kind === "xlsx") return "Susunan kolom XLSX ini tidak dikenali sebagai lembar pengajuan. Pemeriksaan sistem tidak dijalankan. Buka berkasnya untuk membaca langsung.";
  return "Berkas ini tidak dikenali sistem sebagai lembar pengajuan (tanpa lapisan teks, atau tata letak berbeda). Buka berkasnya untuk membaca langsung.";
}
function contentSummary(parsed: ParsedContent | null, order: OrderFile): string {
  if (isReading(parsed)) {
    const checks = checkOrderReading(parsed);
    return `${parsed.sections.length} distributor · ${checks.lineCount} baris · ${parsed.printedGrandTotal === null ? "total tidak terbaca" : formatRupiah(parsed.printedGrandTotal)}`;
  }
  if (parsed?.format === "csv") return `${parsed.table.rows.length} baris · ${parsed.table.header.length} kolom`;
  if (order.parsedFormat === "csv") return "Tabel CSV";
  if (order.parsedFormat === "pengajuan-order-obat") return "Lembar pengajuan";
  return "Tidak terbaca otomatis";
}

/** Order obat: the Director's submission files. The system reads each sheet itself (sections, printed figures,
 * sign-off block) and reports what it finds; the Director accepts or rejects the file. Nothing orders or pays. */
/** `canDecide` (Terima, Tolak, Batalkan) and `canRemove` (Hapus) follow the API permissions `pharmacy.decide` and `director.only`; both default to true, as before roles existed. */
export function PharmacyOrderView({ initialFiles, initialDecisions = {}, uploadsEnabled = false, canDecide = true, canRemove = true }: { initialFiles: InitialOrderFile[]; initialDecisions?: Record<string, OrderDecision>; uploadsEnabled?: boolean; canDecide?: boolean; canRemove?: boolean }) {
  const [files, setFiles] = useState<OrderFile[]>(initialFiles.map((file) => file.order));
  const [contents, setContents] = useState<Record<string, ParsedContent | null>>(() => Object.fromEntries(initialFiles.map((file) => [file.order.key, file.parsed])));
  const [decisions, setDecisions] = useState<Record<string, OrderDecision>>(initialDecisions);
  const [selectedKey, setSelectedKey] = useState<string | null>(initialFiles[0]?.order.key ?? null);
  const [status, setStatus] = useState<{ tone: "info" | "warn"; text: string } | null>(uploadsEnabled ? null : { tone: "warn", text: "Penyimpanan berkas belum diaktifkan di lingkungan ini; unggahan dimatikan." });
  const [busy, setBusy] = useState<string | null>(null);
  const [failedKeys, setFailedKeys] = useState<Record<string, true>>({});
  const requestedKeys = useRef(new Set<string>());
  const [decisionsAvailable, setDecisionsAvailable] = useState(true);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/director/order-obat/berkas", { cache: "no-store" }).catch(() => null);
    if (!response) return;
    if (!response.ok) { setStatus({ tone: "warn", text: `Daftar berkas belum bisa dibaca: ${await readError(response)}` }); return; }
    const body = (await response.json()) as OrderFileList;
    setFiles(body.orders);
    setDecisions(body.decisions);
    setSelectedKey((current) => (current && body.orders.some((file) => file.key === current) ? current : body.orders[0]?.key ?? null));
    setDecisionsAvailable(body.storeNotice === null);
    if (body.storeNotice) setStatus({ tone: "warn", text: body.storeNotice });
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const selected = files.find((file) => file.key === selectedKey) ?? null;
  const parsed = selected ? contents[selected.key] ?? null : null;

  const fetchContent = useCallback(async (file: OrderFile) => {
    const response = await fetch(`/api/director/order-obat/berkas/${file.id}`, { cache: "no-store" }).catch(() => null);
    if (!response?.ok) {
      setFailedKeys((current) => ({ ...current, [file.key]: true }));
      setStatus({ tone: "warn", text: "Isi berkas tidak bisa dibaca." });
      return;
    }
    const body = (await response.json()) as OrderFileDetail;
    setContents((current) => ({ ...current, [file.key]: body.parsed }));
  }, []);
  // However the selection moved (a click, or the list after a removal), content that is not here yet is fetched once.
  useEffect(() => {
    if (!selected || selected.key in contents || requestedKeys.current.has(selected.key)) return;
    requestedKeys.current.add(selected.key);
    void fetchContent(selected);
  }, [selected, contents, fetchContent]);

  function select(file: OrderFile) {
    setSelectedKey(file.key);
    setQuery("");
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = inputRef.current?.files?.[0];
    if (!file) { setStatus({ tone: "warn", text: "Pilih satu berkas CSV, PDF, atau XLSX." }); return; }
    setBusy("upload"); setStatus({ tone: "info", text: `Mengunggah dan membaca ${file.name}…` });
    const response = await fetch("/api/director/order-obat/berkas", { method: "POST", headers: await directorCsrfHeaders(), body: new FormData(form) }).catch(() => null);
    setBusy(null);
    if (!response) { setStatus({ tone: "warn", text: "Jaringan terputus. Coba lagi." }); return; }
    if (!response.ok) { setStatus({ tone: "warn", text: await readError(response) }); return; }
    const result = (await response.json()) as OrderFileDetail & { replayed: boolean };
    setContents((current) => ({ ...current, [result.order.key]: result.parsed }));
    setStatus({ tone: "info", text: result.replayed ? `${result.order.fileName} sudah ada sebelumnya.` : isReading(result.parsed) ? `${result.order.fileName} tersimpan dan terbaca.` : `${result.order.fileName} tersimpan; isinya tidak dikenali sebagai lembar pengajuan.` });
    form.reset();
    await load();
    setSelectedKey(result.order.key);
  }

  async function decide(file: OrderFile, decision: OrderDecisionValue | null) {
    setBusy(file.key);
    const response = await fetch(`/api/director/order-obat/berkas/${file.id}/keputusan`, { method: "POST", headers: { "Content-Type": "application/json", ...(await directorCsrfHeaders()) }, body: JSON.stringify({ keputusan: decision }) }).catch(() => null);
    setBusy(null);
    if (!response) { setStatus({ tone: "warn", text: "Jaringan terputus. Coba lagi." }); return; }
    if (!response.ok) { setStatus({ tone: "warn", text: await readError(response) }); return; }
    const body = (await response.json()) as { orderKey: string; decision: OrderDecision | null };
    setDecisions((current) => {
      const next = { ...current };
      if (body.decision) next[body.orderKey] = body.decision; else delete next[body.orderKey];
      return next;
    });
    setStatus({ tone: "info", text: decision ? `${file.fileName}: ${DECISION_LABEL[decision].toLowerCase()}.` : `Keputusan untuk ${file.fileName} dibatalkan.` });
  }

  async function remove(file: OrderFile) {
    const confirmed = typeof window === "undefined" ? true : window.confirm(`Hapus ${file.fileName} dari daftar pengajuan? Keputusan untuk berkas ini ikut dihapus.`);
    if (!confirmed) return;
    setBusy(file.key);
    const response = await fetch(`/api/director/order-obat/berkas/${file.id}`, { method: "DELETE", headers: await directorCsrfHeaders() }).catch(() => null);
    setBusy(null);
    if (!response) { setStatus({ tone: "warn", text: "Jaringan terputus. Coba lagi." }); return; }
    if (!response.ok) { setStatus({ tone: "warn", text: await readError(response) }); return; }
    setStatus({ tone: "info", text: `${file.fileName} dihapus dari daftar.` });
    await load();
  }

  const selectedDecision = selected ? decisions[selected.key] ?? null : null;

  return (
    <article className="swiss-report-sheet melinda-management-sheet order-sheet">
      <header className="swiss-masthead melinda-brief-masthead">
        <div>
          <h1 className="melinda-brief-title">Order obat</h1>
          <p className="melinda-brief-date">Pengadaan farmasi · berkas pengajuan dibaca sistem, diputuskan Direktur</p>
        </div>
        <dl className="swiss-meta-dl melinda-meta-dl melinda-meta-inline">
          <div className="swiss-meta-item"><dt>Berkas</dt><dd>{files.length}</dd></div>
          <div className="swiss-meta-item"><dt>Diputuskan</dt><dd>{Object.keys(decisions).length} dari {files.length}</dd></div>
          <div className="swiss-meta-item"><dt>Batas halaman</dt><dd className="text-[var(--orange-ink)]">Tanpa pesanan, penerimaan, faktur, atau pembayaran</dd></div>
        </dl>
      </header>

      <section id="order-01" className="swiss-section" aria-labelledby="order-section-01">
        <SectionHeading id="order-section-01" number="01" title="Unggah pengajuan" meta="CSV, PDF, atau XLSX · maks 15 MB" />
        <form className="order-upload" onSubmit={submit} aria-label="Unggah berkas pengajuan">
          <label className="order-upload-drop">
            <input ref={inputRef} type="file" name="berkas" accept=".csv,.pdf,.xlsx,.xls,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={!uploadsEnabled || busy === "upload"} aria-label="Pilih berkas pengajuan" />
            <span>Pilih atau seret berkas ke sini. Lembar pengajuan PDF, XLSX, dan CSV langsung dibaca sistem; berkas yang tidak terbaca tetap disimpan dan diberi catatan.</span>
          </label>
          <label className="order-upload-note">
            <span>Catatan (opsional)</span>
            <input type="text" name="catatan" maxLength={280} placeholder="Misal: pengajuan Desember dari Aegis" disabled={!uploadsEnabled || busy === "upload"} />
          </label>
          <div className="order-upload-actions">
            <button type="submit" className="director-button" disabled={!uploadsEnabled || busy === "upload"}>{busy === "upload" ? "Mengunggah…" : "Unggah"}</button>
            {status && <p role="status" className={status.tone === "warn" ? "order-check m-0" : "m-0 text-slate-600"}>{status.text}</p>}
          </div>
        </form>
      </section>

      <section id="order-02" className="swiss-section" aria-labelledby="order-section-02">
        <SectionHeading id="order-section-02" number="02" title="Berkas pengajuan" meta={`${files.length} berkas`} />
        <div className="swiss-table-wrap">
          <table className="swiss-table">
            <thead>
              <tr>
                <th scope="col" className="text-left">Berkas</th>
                <th scope="col" className="text-left w-28">Diterima</th>
                <th scope="col" className="text-left">Isi terbaca</th>
                <th scope="col" className="text-left w-56">Keputusan Direktur</th>
                <th scope="col" className="text-left w-32">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {files.map((file) => {
                const decision = decisions[file.key] ?? null;
                const active = file.key === selectedKey;
                return (
                  <tr key={file.key} className={active ? "order-row-active" : undefined} aria-current={active ? "true" : undefined}>
                    <td className="text-left">
                      <button type="button" className="order-link font-mono" onClick={() => select(file)} aria-pressed={active}>{file.fileName}</button>
                      <p className="m-0 mt-1 text-slate-500">{KIND_LABEL[file.kind]} · {formatSize(file.byteSize)}{file.note ? ` · ${file.note}` : ""}</p>
                    </td>
                    <td className="text-left">{formatDate(file.uploadedAt)}</td>
                    <td className="text-left">{contentSummary(contents[file.key] ?? null, file)}</td>
                    <td className="text-left">
                      <span className="order-decision">
                        <span className={decision ? `order-decision-chip is-${decision.decision}` : "order-decision-chip is-belum"}>{decision ? DECISION_LABEL[decision.decision] : "Belum diputuskan"}</span>
                        {decision ? (
                          <>
                            <span className="text-slate-500">{formatDate(decision.decidedAt)}</span>
                            {canDecide && <button type="button" className="order-link" disabled={busy === file.key} onClick={() => void decide(file, null)}>Batalkan</button>}
                          </>
                        ) : canDecide && (
                          <>
                            <button type="button" className="order-decide is-terima" disabled={busy === file.key || !decisionsAvailable} title={decisionsAvailable ? undefined : "Tabel keputusan belum tersedia di Supabase."} onClick={() => void decide(file, "diterima")}>Terima</button>
                            <button type="button" className="order-decide is-tolak" disabled={busy === file.key || !decisionsAvailable} title={decisionsAvailable ? undefined : "Tabel keputusan belum tersedia di Supabase."} onClick={() => void decide(file, "ditolak")}>Tolak</button>
                          </>
                        )}
                      </span>
                    </td>
                    <td className="text-left">
                      <span className="order-actions">
                        <a className="order-link" href={`/api/director/order-obat/berkas/${file.id}?buka=1`} target="_blank" rel="noopener noreferrer">Buka</a>
                        {canRemove && <button type="button" className="order-link is-danger" disabled={busy === file.key || !decisionsAvailable} title={decisionsAvailable ? undefined : "Tabel berkas belum tersedia di Supabase."} onClick={() => void remove(file)}>Hapus</button>}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {selected && (
        <ReadingPanel key={selected.key} file={selected} parsed={parsed} loaded={selected.key in contents} failed={selected.key in failedKeys} decision={selectedDecision} query={query} onQuery={setQuery} />
      )}
    </article>
  );
}

function ReadingPanel({ file, parsed, loaded, failed, decision, query, onQuery }: { file: OrderFile; parsed: ParsedContent | null; loaded: boolean; failed: boolean; decision: OrderDecision | null; query: string; onQuery: (value: string) => void }) {
  const reading = isReading(parsed) ? parsed : null;
  const notice = notReadNotice({ loaded, parsed, kind: file.kind });
  const accepted = decision?.decision === "diterima";
  const checks = useMemo(() => (reading ? checkOrderReading(reading) : null), [reading]);
  const visible = useMemo(() => (reading ? filterReadSections(reading.sections, query) : []), [reading, query]);
  return (
    <>
      <section id="order-03" className="swiss-section" aria-labelledby="order-section-03">
        <SectionHeading id="order-section-03" number="03" title="Isi pengajuan">
          <span className="section-strip-aside">
            <span className="melinda-section-meta text-slate-500 font-mono">{file.fileName}</span>
            <SourceInfo>
              <p>Dibaca sistem dari {file.kind === "pdf" ? "lapisan teks berkas" : "isi berkas"}: judul, tanggal tercetak, bagian distributor, baris barang, total, dan blok tanda tangan. Angka ditampilkan seperti tercetak; selisih dilaporkan, tidak dikoreksi.</p>
              {reading && <p>Judul tercetak: {reading.title ?? "tidak terbaca"}. Tanggal tercetak: {reading.datePrinted ?? "tidak terbaca"}.{file.kind === "pdf" && ` ${reading.pages} halaman.`}</p>}
              <p><a className="order-link" href={`/api/director/order-obat/berkas/${file.id}?buka=1`} target="_blank" rel="noopener noreferrer">Buka berkas</a></p>
            </SourceInfo>
          </span>
        </SectionHeading>
        {reading && checks ? (
          <>
            <div className="order-figures" aria-label="Ringkasan pengajuan">
              <div className="order-figure"><span>Total tercetak</span><strong>{reading.printedGrandTotal === null ? "Tidak terbaca" : formatRupiah(reading.printedGrandTotal)}</strong></div>
              <div className="order-figure"><span>Bagian distributor</span><strong>{reading.sections.length}</strong></div>
              <div className="order-figure"><span>Baris barang</span><strong>{checks.lineCount}</strong></div>
              <div className="order-figure"><span>Keputusan Direktur</span><strong className={decision ? `order-decision-text is-${decision.decision}` : undefined}>{decision ? `${DECISION_LABEL[decision.decision]} · ${formatDate(decision.decidedAt)}` : "Belum diputuskan"}</strong></div>
            </div>
            <ChecksList checks={checks} reading={reading} />
            {accepted ? (
              <>
                <label className="order-search">
                  <span>Cari barang atau distributor</span>
                  <input value={query} onChange={(event) => onQuery(event.target.value)} maxLength={80} aria-label="Cari barang atau distributor" placeholder="Nama barang atau distributor" />
                </label>
                {visible.length === 0 && <p className="order-check">Tidak ada barang yang cocok.</p>}
              </>
            ) : (
              <p className="order-gate m-0">{decision?.decision === "ditolak" ? "Berkas ditolak; rincian per distributor tidak ditampilkan." : "Rincian per distributor tampil setelah berkas diterima."}</p>
            )}
          </>
        ) : parsed?.format === "csv" ? (
          <>
            <p className="order-check m-0 px-3 pb-3">{notice}</p>
            <CsvPreview table={parsed.table} />
          </>
        ) : notice ? (
          <p className="order-check m-0 px-3 pb-3">{notice}</p>
        ) : failed ? (
          <p className="order-check m-0 px-3 pb-3">Isi berkas gagal dimuat. Muat ulang halaman untuk mencoba lagi.</p>
        ) : !loaded ? (
          <p className="order-check m-0 px-3 pb-3">Memuat isi berkas…</p>
        ) : null}
      </section>

      {reading && checks && accepted && visible.map((section) => {
        const gap = checks.sectionGaps.find((item) => item.sectionNumber === section.number);
        return (
          <section className="swiss-section" key={section.number} aria-labelledby={`order-distributor-${section.number}`}>
            <SectionHeading id={`order-distributor-${section.number}`} number={String(section.number).padStart(2, "0")} title={section.distributor || "Distributor tidak terbaca"} meta={section.printedTotal === null ? "Total bagian tidak terbaca" : `Total tercetak ${formatRupiah(section.printedTotal)}`} />
            <div className="swiss-table-wrap">
              <table className="swiss-table">
                <thead>
                  <tr>
                    <th scope="col" className="text-left">Barang</th>
                    <th scope="col" className="text-right w-20">Jumlah</th>
                    <th scope="col" className="text-left w-24">Satuan</th>
                    <th scope="col" className="text-right w-32">Harga satuan</th>
                    <th scope="col" className="text-right w-36">Total tercetak</th>
                  </tr>
                </thead>
                <tbody>
                  {section.lines.map((line, index) => {
                    const lineGap = checks.lineGaps.find((item) => item.sectionNumber === section.number && item.lineName === line.name && item.printedLineTotal === line.printedLineTotal && item.quantity === line.quantity);
                    const incomplete = checks.incompleteLines.find((item) => item.sectionNumber === section.number && item.lineName === line.name);
                    const unreadPrice = line.unitPrice === null && line.unitPricePrinted ? line.unitPricePrinted : null;
                    const empty = incomplete ? incomplete.missing.filter((item) => !(unreadPrice && item === "harga satuan")) : [];
                    return (
                      <tr key={`${section.number}-${index}-${line.name}`}>
                        <td className="text-left">
                          {line.name || "(nama tidak terbaca)"}
                          {lineGap && <p className="order-line-note">Hasil kali {lineGap.quantity} × {formatRupiah(lineGap.unitPrice)} = {formatRupiah(lineGap.product)}. Total baris tercetak {formatRupiah(lineGap.printedLineTotal)}. Selisih {formatRupiah(Math.abs(lineGap.difference))}.</p>}
                          {empty.length > 0 && <p className="order-line-note">Tidak lengkap: {empty.join(", ")} kosong di lembar.</p>}
                          {unreadPrice && <p className="order-line-note">Harga satuan tercetak {unreadPrice}; tidak terbaca sebagai angka.</p>}
                          {line.unitPricePrinted && !/\./.test(line.unitPricePrinted) && line.unitPrice !== null && line.unitPrice >= 1000 && <p className="order-line-note">Harga satuan tercetak {line.unitPricePrinted}, tanpa pemisah ribuan.</p>}
                        </td>
                        <td className="text-right font-mono">{line.quantity ?? "—"}</td>
                        <td className="text-left">{line.unit || "—"}</td>
                        <td className="text-right font-mono">{line.unitPrice === null ? unreadPrice ?? "—" : formatRupiah(line.unitPrice)}</td>
                        <td className="text-right font-mono">{line.printedLineTotal === null ? "—" : formatRupiah(line.printedLineTotal)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {gap && <p className="order-check">Jumlah total baris tercetak {formatRupiah(gap.sumOfPrintedLineTotals)}. Total bagian tercetak {formatRupiah(gap.printedSectionTotal)}. Selisih {formatRupiah(Math.abs(gap.difference))}.</p>}
          </section>
        );
      })}
    </>
  );
}

/** Findings the system computed from the sheet. Wording states what was read, never what should be true. */
function ChecksList({ checks, reading }: { checks: OrderChecks; reading: OrderReading }) {
  const { grand } = checks;
  const incomplete = (line: OrderChecks["incompleteLines"][number]) => {
    const unreadPrice = reading.sections.find((section) => section.number === line.sectionNumber)?.lines.some((item) => item.name === line.lineName && item.unitPrice === null && item.unitPricePrinted) ?? false;
    const empty = line.missing.filter((item) => !(unreadPrice && item === "harga satuan"));
    return [empty.length > 0 ? `${empty.join(", ")} kosong` : "", unreadPrice ? "harga satuan tidak terbaca" : ""].filter(Boolean).join(", ");
  };
  return (
    <div className="order-conformity" aria-label="Pemeriksaan sistem">
      <ul className="order-status">
        <li>
          Selisih hitung: {checks.lineGaps.length === 0 ? "tidak ada pada baris" : `${checks.lineGaps.length} baris (hasil kali tidak sama dengan total baris tercetak)`}; {checks.sectionGaps.length === 0 ? "total bagian cocok" : `${checks.sectionGaps.length} bagian tidak cocok dengan jumlah barisnya`}
          {checks.sectionsWithoutTotal.length > 0 && `; total bagian tidak terbaca: ${checks.sectionsWithoutTotal.join(", ")}`}.
        </li>
        <li>
          Total keseluruhan: {grand.printedGrandTotal === null ? `tidak tercetak atau tidak terbaca; jumlah total bagian ${formatRupiah(grand.sumOfPrintedSectionTotals)}.` : grand.difference === 0 ? `${formatRupiah(grand.printedGrandTotal)}, sama dengan jumlah ${formatRupiah(grand.sumOfPrintedSectionTotals)} dari total bagian.` : `${formatRupiah(grand.printedGrandTotal)} tercetak; jumlah total bagian ${formatRupiah(grand.sumOfPrintedSectionTotals)}; selisih ${formatRupiah(Math.abs(grand.difference ?? 0))}${grand.matchingSection ? `, sama dengan total tercetak bagian ${grand.matchingSection.number} (${grand.matchingSection.distributor})` : ""}.`}
        </li>
        <li>Baris tidak lengkap: {checks.incompleteLines.length === 0 ? "tidak ada." : checks.incompleteLines.map((line) => `${line.lineName} (${line.distributor}: ${incomplete(line)})`).join("; ") + "."}{checks.linesWithoutUnit > 0 && ` Satuan kosong pada ${checks.linesWithoutUnit} baris.`}</li>
        <li>Nomor SP: {checks.spNumber.status === "ada" ? `terbaca "${checks.spNumber.reference}".` : "tidak ada pada lembar; SP bernomor masih menunggu."}</li>
        <li>Faktur: {checks.invoice.status === "ada" ? `terbaca "${checks.invoice.reference}".` : "tidak ada pada lembar. Penerimaan barang dan pembayaran belum diketahui dari berkas ini."}</li>
        <li>
          Blok tanda tangan: {checks.signOff.status === "tidak-ada" ? "tidak terbaca pada lembar." : checks.signOff.lines.map((line) => `${line.caption}: ${line.name || "nama tidak terbaca"}`).join("; ") + ". Tercetak, keabsahan belum diverifikasi."}
          {" "}Tanda persetujuan tercetak: {checks.approvalMark.status === "ada" ? `"${checks.approvalMark.reference}".` : "tidak ada."}
        </li>
      </ul>
      <p className="order-check">Tidak ada pengiriman pesan ke distributor, persetujuan otomatis, atau pembayaran dari halaman ini.</p>
    </div>
  );
}

function CsvPreview({ table }: { table: CsvTable }) {
  return (
    <div className="swiss-table-wrap" aria-label="Isi CSV">
      <p className="m-0 px-3 pt-3 text-slate-600">{table.rows.length} baris, {table.header.length} kolom, pemisah &quot;{table.delimiter}&quot;.</p>
      <table className="swiss-table">
        <thead><tr>{table.header.map((cell, index) => <th scope="col" key={index} className="text-left">{cell || `Kolom ${index + 1}`}</th>)}</tr></thead>
        <tbody>{table.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex} className="text-left">{cell}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
