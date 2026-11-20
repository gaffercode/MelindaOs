"use client";

import { useMemo, useState } from "react";
import { checkFormularium, crossedRows, filterFormulariumRows, formatNumberRanges, type FormulariumReading, type FormulariumTable } from "@/lib/pharmacy/formularium";
import { SectionHeading } from "../melinda-brief/melinda-morning-brief";
import { SourceInfo } from "../source-info";

const VISIBLE_ROWS = 10;

function columnClass(title: string): string {
  if (/^no\b/i.test(title)) return "col-num";
  if (/^(kategori|status tanda|kelompok)$/i.test(title)) return "col-code";
  return "";
}

/** What the system found in one list, shown behind the info icon of its section strip. */
function sectionNote(table: FormulariumTable, crossedCount: number): string | undefined {
  const checks = checkFormularium(table);
  const lines: string[] = [];
  if (checks.numbering) {
    const { missing, duplicated, unnumbered } = checks.numbering;
    if (missing.length) lines.push(`Nomor sumber yang tidak ada: ${formatNumberRanges(missing)}.`);
    if (duplicated.length) lines.push(`Nomor sumber yang dipakai dua kali: ${formatNumberRanges(duplicated)}.`);
    if (unnumbered) lines.push(`${unnumbered} baris tanpa nomor sumber.`);
  }
  if (crossedCount) lines.push(`${crossedCount} baris dicoret DPJP dan tidak ditampilkan.`);
  return lines.length ? lines.join(" ") : undefined;
}

function TableRows({ table, indexes }: { table: FormulariumTable; indexes: number[] }) {
  const flagged = new Set(table.flaggedRows);
  const nameColumn = table.columns.findIndex((title) => /^nama|^item/i.test(title));
  return (
    <>
      {indexes.map((index) => (
        <tr key={index}>
          {table.rows[index].map((cell, cellIndex) => (
            <td key={cellIndex} className={`text-left ${columnClass(table.columns[cellIndex])}`.trim()}>
              {cellIndex === nameColumn ? <span className="formularium-name">{cell || "—"}</span> : cell || <span className="formularium-empty">—</span>}
              {cellIndex === nameColumn && flagged.has(index) && <span className="formularium-confirm">Perlu konfirmasi</span>}
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function FormulariumSection({ table, number, query }: { table: FormulariumTable; number: string; query: string }) {
  const crossed = useMemo(() => crossedRows(table), [table]);
  const shown = useMemo(() => filterFormulariumRows(table, query).filter((index) => !crossed.has(index)), [table, query, crossed]);
  const total = table.rows.length - crossed.size;
  const flagged = table.flaggedRows.filter((index) => !crossed.has(index)).length;
  const searching = query.trim() !== "";
  if (searching && shown.length === 0) return null;
  const head = shown.slice(0, searching ? shown.length : VISIBLE_ROWS);
  const rest = searching ? [] : shown.slice(VISIBLE_ROWS);
  const meta = `${searching ? `${shown.length} dari ${total}` : total} baris${flagged ? ` · ${flagged} perlu konfirmasi` : ""}`;

  return (
    <section id={`formularium-${table.id}`} className="swiss-section" aria-labelledby={`formularium-heading-${table.id}`}>
      <SectionHeading id={`formularium-heading-${table.id}`} number={number} title={table.sheet} meta={meta} note={sectionNote(table, crossed.size)} />
      <div className="swiss-table-wrap">
        <table className="swiss-table formularium-table">
          <thead><tr>{table.columns.map((title) => <th scope="col" key={title} className={`text-left ${columnClass(title)}`.trim()}>{title}</th>)}</tr></thead>
          <tbody><TableRows table={table} indexes={head} /></tbody>
        </table>
        {rest.length > 0 && (
          <details className="rank-more">
            <summary>Tampilkan {rest.length} lainnya…</summary>
            <table className="swiss-table formularium-table"><tbody><TableRows table={table} indexes={rest} /></tbody></table>
          </details>
        )}
      </div>
    </section>
  );
}

/** Formularium DPJP: the drug lists the DPJPs agreed, read by the system from the workbook. Rows the DPJP struck out
 * are not in use and are left out. Not a procurement submission (that lives on Order obat), not verified against
 * official preparations, not a therapy recommendation. */
export function FormulariumView({ fileName, byteSize, reading }: { fileName: string; byteSize: number; reading: FormulariumReading }) {
  const [query, setQuery] = useState("");
  const counts = useMemo(() => reading.tables.map((table) => {
    const crossed = crossedRows(table);
    return { rows: table.rows.length - crossed.size, flagged: table.flaggedRows.filter((index) => !crossed.has(index)).length };
  }), [reading]);
  const rows = counts.reduce((sum, item) => sum + item.rows, 0);
  const flagged = counts.reduce((sum, item) => sum + item.flagged, 0);
  return (
    <article className="swiss-report-sheet melinda-management-sheet order-sheet">
      <header className="swiss-masthead melinda-brief-masthead">
        <div>
          <h1 className="melinda-brief-title">Formularium DPJP</h1>
          <div className="melinda-brief-date">
            Daftar obat dan BHP dari DPJP
            <SourceInfo>
              <p>Berkas {fileName} ({Math.max(1, Math.round(byteSize / 1024))} KB), dibaca sistem dari sheet-nya. Sheet ringkasan, masukan distributor, daftar A-Z, dan daftar konfirmasi tidak ditampilkan. Baris yang dicoret DPJP tidak dipakai dan tidak ditampilkan.</p>
              {reading.notes.map((line) => <p key={line}>{line}</p>)}
            </SourceInfo>
          </div>
        </div>
        <dl className="swiss-meta-dl melinda-meta-dl melinda-meta-inline">
          <div className="swiss-meta-item"><dt>Daftar</dt><dd>{reading.tables.length}</dd></div>
          <div className="swiss-meta-item"><dt>Baris</dt><dd>{rows}</dd></div>
          <div className="swiss-meta-item"><dt>Perlu konfirmasi</dt><dd className={flagged ? "text-[var(--orange-ink)]" : undefined}>{flagged}</dd></div>
        </dl>
      </header>

      <div className="formularium-notes">
        <p className="formularium-caveat">Draf kerja. Nama dan kekuatan belum diverifikasi terhadap sediaan resmi.</p>
        <label className="order-search formularium-search">
          <span className="sr-only">Cari obat atau BHP</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} maxLength={80} aria-label="Cari obat atau BHP" placeholder="Cari obat atau BHP" />
        </label>
      </div>

      {reading.tables.map((table, index) => <FormulariumSection key={table.id} table={table} number={String(index + 1).padStart(2, "0")} query={query} />)}
    </article>
  );
}
