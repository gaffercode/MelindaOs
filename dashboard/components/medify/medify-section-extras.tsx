import type { ReactNode } from "react";
import { formatUtcDayMonth } from "@/lib/date-label";
import { wibTime } from "@/lib/director/director-data";
import type { MedifyDiagnosticUnit, MedifyNamedTotal, MedifySnapshot } from "@/lib/medify/medify-snapshot-contract";
import { SourceInfo } from "../source-info";
import { displayCaseDeep } from "@/lib/display-case";

/*
 * Medify numbers placed under the brief's own sections (02 to 05). Section 02 ranks bangsal, DPJP,
 * penjamin, and cara keluar the same way as the diagnosis table. Rawat inap lays those tables in two
 * columns: diagnosis on the left; bangsal, penjamin, then DPJP on the right. IGD lays cara keluar and
 * penjamin side by side at the same height. A missing side does not leave an empty half. Section 04
 * uses the same two-column pairs (depot value beside categories, top by value beside top by quantity),
 * as do section 03 (each unit's top tests beside its response-time groups) and section 05 (staff type
 * beside status). One-figure facts stay single lines. Exceptions are plain red-orange text; sources sit
 * behind the info icon.
 */

const warn = "text-[color:var(--warn)]";
const number = new Intl.NumberFormat("id-ID");
const decimal = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 });
const compact = new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 });
const rupiah = (value: number | null) => (value === null ? "tidak tercatat" : `Rp ${compact.format(value)}`);
const ranked = (items: MedifyNamedTotal[]) => items.map((item) => ({ name: item.name, value: number.format(item.count) }));
/** Medify's own placeholders for an uncategorised drug. */
const UNCATEGORISED = new Set(["off", "tidak berkategori", "-"]);

function Block({ title, period, observedAt, note, children }: { title: string; period?: { periodStart: string; periodEnd: string }; observedAt: string; note?: string; children: ReactNode }) {
  return (
    <div className="medify-extra">
      <div className="medify-extra-head">
        <h3 className="medify-extra-title">{title}{period ? `, ${formatUtcDayMonth(period.periodStart)} sampai ${formatUtcDayMonth(period.periodEnd)}` : ""}</h3>
        <SourceInfo><p className="m-0 text-slate-700">Medify, ditarik {wibTime(observedAt)} dengan akun laporan Direktur. Angka agregat, tanpa data pasien.{note ? ` ${note}` : ""}</p></SourceInfo>
      </div>
      {children}
    </div>
  );
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return <p className="m-0"><span className="text-slate-500">{label}:</span> {children}</p>;
}

/** Rank tables open on their first five rows; the rest sits behind a dropdown (Director 2026-11-09). */
const RANK_VISIBLE = 5;

function RankRows({ rows, start }: { rows: Array<{ name: string; value: string; warn?: boolean }>; start: number }) {
  return <>{rows.map((row, index) => <tr key={row.name}><td className="text-center text-slate-500">{start + index + 1}</td><td className={row.warn ? `text-left ${warn}` : "text-left text-slate-800"}>{row.name}</td><td className={row.warn ? `text-right font-mono ${warn}` : "text-right font-mono"}>{row.value}</td></tr>)}</>;
}

function RankTable({ caption, rows, valueHeading = "Jumlah" }: { caption: string; rows: Array<{ name: string; value: string; warn?: boolean }>; valueHeading?: string }) {
  const shown = rows.slice(0, RANK_VISIBLE), more = rows.slice(RANK_VISIBLE);
  return (
    <div className="swiss-table-wrap">
      <table className="swiss-table">
        <caption className="sr-only">{caption}</caption>
        <thead><tr><th scope="col" className="text-center w-12">#</th><th scope="col" className="text-left">{caption}</th><th scope="col" className="text-right w-32">{valueHeading}</th></tr></thead>
        <tbody><RankRows rows={shown} start={0} /></tbody>
      </table>
      {more.length > 0 && (
        <details className="rank-more">
          <summary>Tampilkan {more.length} lainnya</summary>
          <table className="swiss-table" aria-label={`${caption}, peringkat ${RANK_VISIBLE + 1} sampai ${rows.length}`}>
            <tbody><RankRows rows={more} start={RANK_VISIBLE} /></tbody>
          </table>
        </details>
      )}
    </div>
  );
}

/** Section 02: rawat inap diagnoses, wards, DPJP and payer mix; how IGD patients left; the all-time payer base. */
export function MedifyServiceBlock({ snapshot: published }: { snapshot: MedifySnapshot | null | undefined }) {
  const snapshot = published ? displayCaseDeep(published) : published;
  const mix = snapshot?.inpatientMix, igd = snapshot?.igdMix, patients = snapshot?.patients;
  if (!mix && !igd && !patients) return null;
  return (
    <>
      {patients && patients.byPayer.length > 0 && (
        <Block title="Basis pasien di Medify" observedAt={patients.observedAt} note="Komposisi penjamin dihitung Medify atas seluruh basis sejak awal, bukan periode berjalan; jumlahnya tidak harus sama dengan pasien terdaftar di bagian 00.">
          <div className="medify-extra-col min-w-0">
            <RankTable caption="Penjamin, seluruh basis pasien" rows={ranked(patients.byPayer)} />
          </div>
        </Block>
      )}
      {mix && (
        <Block title="Rawat inap di Medify" period={mix} observedAt={mix.observedAt} note="Baru/lama dan jenis kelamin dalam persen, sesuai tampilan Medify.">
          {(mix.topDiagnoses.length > 0 || mix.byWard.length > 0 || mix.byPayer.length > 0 || mix.byDpjp.length > 0) && (
            <div className="medify-extra-split grid grid-cols-1 items-stretch gap-4 md:grid-cols-2">
              {(mix.topDiagnoses.length > 0 || mix.byPayer.length > 0) && (
                <div className="medify-extra-stack grid min-w-0 h-full content-start gap-3">
                  {mix.topDiagnoses.length > 0 && <RankTable caption="Diagnosis terbanyak" rows={ranked(mix.topDiagnoses)} />}
                  {mix.byPayer.length > 0 && <RankTable caption="Penjamin" rows={ranked(mix.byPayer)} />}
                </div>
              )}
              {(mix.byWard.length > 0 || mix.byDpjp.length > 0) && (
                <div className="medify-extra-stack grid min-w-0 h-full content-start gap-3 md:col-start-2">
                  {mix.byWard.length > 0 && <RankTable caption="Bangsal" rows={ranked(mix.byWard)} />}
                  {mix.byDpjp.length > 0 && <RankTable caption="DPJP" rows={ranked(mix.byDpjp)} />}
                </div>
              )}
            </div>
          )}
          {(mix.byStatus.length > 0 || mix.byGender.length > 0) && <Line label="Komposisi">{[...mix.byStatus, ...mix.byGender].map((item) => `${item.name} ${decimal.format(item.percent)}%`).join(" · ")}</Line>}
        </Block>
      )}
      {igd && (
        <Block title="IGD di Medify" period={igd} observedAt={igd.observedAt}>
          {(igd.byDischarge.length > 0 || igd.byPayer.length > 0) && (
            <div className={`medify-extra-split grid grid-cols-1 items-stretch gap-4 ${igd.byDischarge.length > 0 && igd.byPayer.length > 0 ? "md:grid-cols-2" : ""}`}>
              {igd.byDischarge.length > 0 && (
                <div className="medify-extra-col min-w-0 h-full">
                  <RankTable caption="Cara keluar" rows={ranked(igd.byDischarge)} />
                </div>
              )}
              {igd.byPayer.length > 0 && (
                <div className="medify-extra-col min-w-0 h-full">
                  <RankTable caption="Penjamin" rows={ranked(igd.byPayer)} />
                </div>
              )}
            </div>
          )}
        </Block>
      )}
    </>
  );
}

/** One unit of section 03: top tests beside the response-time groups; no transactions stays a single line. */
function DiagnosticTables({ name, unit }: { name: string; unit: MedifyDiagnosticUnit }) {
  const total = unit.responseTime.reduce((sum, item) => sum + item.count, 0);
  if (unit.topTests.length === 0 && total === 0) return <Line label={name}><span className="text-slate-500">Tidak ada transaksi tercatat di Medify.</span></Line>;
  return (
    <Pair
      left={unit.topTests.length > 0 && <RankTable caption={`${name}, pemeriksaan terbanyak`} rows={ranked(unit.topTests)} />}
      right={total > 0 && <RankTable caption={`${name}, response time`} rows={ranked(unit.responseTime)} />}
    />
  );
}

/** Resources at or above this share are listed in one line; the rest get the table, weakest first. */
const SATUSEHAT_OK_PERCENT = 95;
const percent = (sent: number, expected: number) => (sent / expected) * 100;
/** Always one decimal, as Medify's SATUSEHAT dashboard prints it (0,0% and 100,0% included). */
const share = new Intl.NumberFormat("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Section 03: SATUSEHAT submissions month to date, then lab and radiology volume and Medify's response-time groups. */
export function MedifyQualityBlock({ snapshot: published }: { snapshot: MedifySnapshot | null | undefined }) {
  const snapshot = published ? displayCaseDeep(published) : published;
  const satusehat = snapshot?.satusehat, diagnostics = snapshot?.diagnostics;
  if (!satusehat && !diagnostics) return null;
  // A resource Medify expected nothing of this month has no share to rate; it is left out instead of counting as 100%.
  const rated = satusehat?.resources.filter((resource) => resource.expected > 0).map((resource) => ({ ...resource, percent: percent(resource.sent, resource.expected) })) ?? [];
  const weak = rated.filter((resource) => resource.percent < SATUSEHAT_OK_PERCENT).sort((a, b) => a.percent - b.percent);
  const fine = rated.filter((resource) => resource.percent >= SATUSEHAT_OK_PERCENT);
  return (
    <>
      {satusehat && (
        <Block title="SatuSehat di Medify" period={satusehat} observedAt={satusehat.observedAt} note={`Pembaruan Medify ${satusehat.lastUpdate}. Persentase berdasarkan tanggal KRS pasien, sesuai dashboard SatuSehat Medify.`}>
          <p className="medify-figure">{share.format(satusehat.globalPercent)}%</p>
          <p className={`m-0 ${satusehat.globalPercent < SATUSEHAT_OK_PERCENT ? warn : "text-slate-700"}`}>{number.format(satusehat.sent)} dari {number.format(satusehat.expected)} resource terkirim · {number.format(satusehat.failed)} gagal · {number.format(satusehat.notSent)} belum dikirim</p>
          {weak.length > 0 && <RankTable caption="Resource FHIR di bawah 95%" valueHeading="Terkirim" rows={weak.map((resource) => ({ name: resource.name, value: `${share.format(resource.percent)}%`, warn: resource.percent < 50 }))} />}
          {fine.length > 0 && <Line label={`${SATUSEHAT_OK_PERCENT}% ke atas`}>{fine.map((resource) => `${resource.name} ${share.format(resource.percent)}%`).join(" · ")}</Line>}
        </Block>
      )}
      {diagnostics && (
        <Block title="Penunjang di Medify" period={diagnostics} observedAt={diagnostics.observedAt} note={'Kelompok response time memakai label Medify apa adanya; Lab PK menulis "Hari" di kelompok yang pada radiologi tertulis "Jam".'}>
          <DiagnosticTables name="Lab PK" unit={diagnostics.labPk} />
          <DiagnosticTables name="Lab PA" unit={diagnostics.labPa} />
          <DiagnosticTables name="Radiologi" unit={diagnostics.radiology} />
        </Block>
      )}
    </>
  );
}

/** Two rank tables side by side, as section 02 lays them; a missing side gives the other the full width. */
function Pair({ left, right }: { left: ReactNode; right: ReactNode }) {
  if (!left && !right) return null;
  return (
    <div className={`medify-extra-split grid grid-cols-1 items-stretch gap-4 ${left && right ? "md:grid-cols-2" : ""}`}>
      {left && <div className="medify-extra-col min-w-0 h-full">{left}</div>}
      {right && <div className="medify-extra-col min-w-0 h-full">{right}</div>}
    </div>
  );
}

/** Section 04: stock value per depot beside drug categories, then top items by value beside top items by quantity; uncategorised items called out. */
export function MedifyPharmacyBlock({ snapshot: published }: { snapshot: MedifySnapshot | null | undefined }) {
  const snapshot = published ? displayCaseDeep(published) : published;
  const pharmacy = snapshot?.pharmacy;
  if (!pharmacy) return null;
  const isUncategorised = (item: MedifyNamedTotal) => UNCATEGORISED.has(item.name.trim().toLowerCase());
  const uncategorised = pharmacy.byCategory.filter(isUncategorised).reduce((sum, item) => sum + item.count, 0);
  const all = pharmacy.byCategory.reduce((sum, item) => sum + item.count, 0);
  return (
    <Block title="Farmasi di Medify" period={pharmacy} observedAt={pharmacy.observedAt} note="Nilai rupiah persediaan belum dicocokkan dengan laporan Keuangan.">
      <Pair
        left={pharmacy.stockByUnit.length > 0 && <RankTable caption="Nilai stok per depo" valueHeading="Nilai" rows={pharmacy.stockByUnit.map((item) => ({ name: item.name, value: rupiah(item.rupiah) }))} />}
        right={pharmacy.byCategory.length > 0 && <RankTable caption="Kategori" rows={pharmacy.byCategory.map((item) => ({ name: item.name, value: number.format(item.count), warn: isUncategorised(item) }))} />}
      />
      <Pair
        left={pharmacy.topByValue.length > 0 && <RankTable caption="Obat dan BHP terbesar menurut nilai" valueHeading="Nilai" rows={pharmacy.topByValue.map((item) => ({ name: item.name, value: rupiah(item.rupiah) }))} />}
        right={pharmacy.topByQuantity.length > 0 && <RankTable caption="Terbanyak menurut jumlah" rows={ranked(pharmacy.topByQuantity)} />}
      />
      {uncategorised > 0 && <p className={`m-0 ${warn}`}>{number.format(uncategorised)} dari {number.format(all)} item belum terkategori di Medify (off, tidak berkategori, atau -).</p>}
    </Block>
  );
}

/** Section 05: staff per type and status, and Medify's monthly active and leaving counts. */
export function MedifyStaffBlock({ snapshot: published }: { snapshot: MedifySnapshot | null | undefined }) {
  const snapshot = published ? displayCaseDeep(published) : published;
  const staff = snapshot?.staff;
  if (!staff) return null;
  const total = staff.byType.reduce((sum, item) => sum + item.count, 0);
  const active = staff.byStatus.find((item) => item.name.toLowerCase() === "aktif")?.count;
  const lastActive = staff.activeMonthly.at(-1);
  const left = staff.leftMonthly.reduce((sum, item) => sum + item.count, 0);
  return (
    <Block title="Kepegawaian di Medify" observedAt={staff.observedAt}>
      <Pair
        left={staff.byType.length > 0 && <RankTable caption={`Jenis pegawai, total ${number.format(total)}`} rows={ranked(staff.byType.filter((item) => item.count > 0))} />}
        right={staff.byStatus.length > 0 && <RankTable caption="Status" rows={ranked(staff.byStatus.filter((item) => item.count > 0))} />}
      />
      {staff.leftMonthly.length > 0 && <Line label="Keluar">{number.format(left)} pegawai dalam {staff.leftMonthly.length} bulan terakhir</Line>}
      {lastActive && active !== undefined && lastActive.count !== active && <p className={`m-0 ${warn}`}>Grafik pegawai aktif bulanan Medify menunjukkan {number.format(lastActive.count)}, sedangkan status aktif {number.format(active)}.</p>}
    </Block>
  );
}
