"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Copy, RefreshCw } from "lucide-react";
import { directorCsrfHeaders } from "@/lib/client-api";
import type { MedifySnapshotResult } from "@/lib/medify/medify-snapshot-store";
import {
  SATUSEHAT_CATEGORY_OPTIONS,
  SATUSEHAT_DIRECTOR_ACTIONS,
  SATUSEHAT_FAILURE_DIAGNOSTICS,
  SATUSEHAT_MODULE_READINESS,
  buildSatuSehatExecutiveAnalysis,
  extractMedifySatusehat,
  filterSatuSehatResources,
  formatSatuSehatInstructionText,
  resolveSatuSehatDashboardData,
  type SatuSehatClinicalFunnel,
  type SatuSehatResourceCategory,
  type SatuSehatSeverity,
} from "@/lib/satusehat/satu-sehat-data";
import type { SatusehatSnapshot } from "@/lib/satusehat/satusehat-snapshot-contract";
import type { SatusehatSnapshotResult } from "@/lib/satusehat/satusehat-snapshot-store";
import { ChartReveal } from "../medify/medify-daily-chart";
import { EntranceSeen } from "../motion";
import { ToolPageHeader } from "../tool-page-header";

const numberFormat = new Intl.NumberFormat("id-ID");
const percentFormat = new Intl.NumberFormat("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const CHART_W = 480;
const CHART_H = 128;
const CHART_TOP = 12;

const clampY = (value: number) => Math.min(CHART_H, Math.max(CHART_TOP, value));

function buildSmoothCurvePath(points: ReadonlyArray<{ x: number; y: number }>): string {
  const count = points.length;
  if (count === 0) return "";
  if (count === 1) return `M ${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;

  const deltas: number[] = [];
  const dxs: number[] = [];
  for (let i = 0; i < count - 1; i += 1) {
    const dx = Math.max(1, points[i + 1].x - points[i].x);
    dxs.push(dx);
    deltas.push((points[i + 1].y - points[i].y) / dx);
  }

  const tangents = new Array<number>(count).fill(0);
  tangents[0] = deltas[0] * 0.6;
  tangents[count - 1] = deltas[count - 2] * 0.4;
  for (let i = 1; i < count - 1; i += 1) {
    const d0 = deltas[i - 1];
    const d1 = deltas[i];
    if (d0 * d1 <= 0) {
      tangents[i] = 0;
    } else {
      const avg = (d0 + d1) / 2;
      const cap = Math.min(2.5 * Math.abs(d0), 2.5 * Math.abs(d1));
      tangents[i] = Math.sign(d0) * Math.min(Math.abs(avg), cap);
    }
  }

  const commands = [`M ${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`];
  for (let i = 0; i < count - 1; i += 1) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const thirdDx = dxs[i] / 3;
    const cp1x = p0.x + thirdDx;
    const cp1y = clampY(p0.y + tangents[i] * thirdDx);
    const cp2x = p1.x - thirdDx;
    const cp2y = clampY(p1.y - tangents[i + 1] * thirdDx);
    commands.push(
      `C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p1.x.toFixed(1)},${p1.y.toFixed(1)}`,
    );
  }
  return commands.join(" ");
}

function buildSmoothAreaPath(points: ReadonlyArray<{ x: number; y: number }>, baselineY: number): string {
  if (points.length === 0) return "";
  const first = points[0];
  const last = points[points.length - 1];
  return `${buildSmoothCurvePath(points)} L ${last.x.toFixed(1)},${baselineY.toFixed(1)} L ${first.x.toFixed(1)},${baselineY.toFixed(1)} Z`;
}

function CareFlowChart({ funnel }: { funnel: SatuSehatClinicalFunnel }) {
  const stepCount = funnel.steps.length;
  if (stepCount === 0) return null;
  const maxStep = Math.max(1, ...funnel.steps.map((step) => step.count));
  const targetValue = Math.round((funnel.steps[0]?.count ?? 0) * 0.95);
  const scaleMax = Math.max(maxStep, targetValue, 1);
  const y = (value: number) => CHART_H - (Math.min(Math.max(value, 0), scaleMax) / scaleMax) * (CHART_H - CHART_TOP);
  const colWidth = CHART_W / stepCount;
  const barWidth = colWidth * 0.44;
  const cx = (index: number) => index * colWidth + colWidth / 2;
  const barTone = (count: number, index: number) =>
    index === 0
      ? "medify-chart-mark"
      : count === 0 || (funnel.severity === "kritis" && index > 0)
        ? "medify-chart-over"
        : "medify-chart-latest";
  const curvePoints = funnel.steps.map((step, index) => ({ x: cx(index), y: y(step.count) }));
  const curvePath = buildSmoothCurvePath(curvePoints);
  const areaPath = buildSmoothAreaPath(curvePoints, CHART_H);
  const gradientId = `flow-grad-${funnel.id}`;
  const accentColor = funnel.severity === "kritis" ? "var(--orange-ink)" : "var(--accent)";
  const ariaSummary = `${funnel.title}: ${funnel.steps.map((step) => `${step.label} ${numberFormat.format(step.count)}`).join(", ")}. Target 95%: ${numberFormat.format(targetValue)}.`;

  return (
    <figure className="medify-chart">
      <span className="medify-chart-scale" aria-hidden="true">
        Skala maks: {numberFormat.format(scaleMax)} catatan · garis putus target 95% ({numberFormat.format(targetValue)})
      </span>
      <ChartReveal direction="up">
        <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} shapeRendering="geometricPrecision" role="img" aria-label={ariaSummary}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={accentColor} stopOpacity="0.18" />
              <stop offset="100%" stopColor={accentColor} stopOpacity="0.01" />
            </linearGradient>
          </defs>
          <line x1="0" x2={CHART_W} y1={CHART_H - 0.5} y2={CHART_H - 0.5} className="medify-chart-base" />
          <line x1="0" x2={CHART_W} y1={y(targetValue)} y2={y(targetValue)} className="medify-chart-reference" />
          <path d={areaPath} fill={`url(#${gradientId})`} className="satusehat-curve-area" />
          {funnel.steps.map((step, index) => {
            const barY = y(step.count);
            const barHeight = Math.max(0, CHART_H - barY);
            return (
              <rect
                key={step.resource}
                x={index * colWidth + (colWidth - barWidth) / 2}
                width={barWidth}
                y={barY}
                height={barHeight}
                rx="5"
                fillOpacity={0.26}
                style={{ animationDelay: `${index * 90}ms` }}
                className={`${barTone(step.count, index)} satusehat-bar`}
              >
                <title>{`${step.label}: ${numberFormat.format(step.count)} (${step.note})`}</title>
              </rect>
            );
          })}
          <path
            d={curvePath}
            fill="none"
            stroke={accentColor}
            strokeOpacity="0.18"
            style={{ strokeWidth: 6, strokeLinecap: "round", strokeLinejoin: "round" }}
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={curvePath}
            pathLength={1}
            className="medify-chart-line satusehat-curve-main"
            style={{ stroke: accentColor, strokeWidth: 2.5, strokeLinecap: "round", strokeLinejoin: "round" }}
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={curvePath}
            pathLength={1}
            fill="none"
            stroke="#ffffff"
            strokeOpacity="0.85"
            style={{ strokeWidth: 2.25, strokeLinecap: "round", strokeLinejoin: "round" }}
            vectorEffect="non-scaling-stroke"
            className="satusehat-curve-pulse"
          />
          {funnel.steps.map((step, index) => {
            const pointY = y(step.count);
            const pointX = cx(index);
            return (
              <g key={`${step.resource}-node`}>
                <circle
                  cx={pointX}
                  cy={pointY}
                  r="7"
                  fill={accentColor}
                  style={{ animationDelay: `${index * 220}ms` }}
                  className="satusehat-node-halo"
                />
                <circle
                  cx={pointX}
                  cy={pointY}
                  r="3.75"
                  stroke="#ffffff"
                  strokeWidth="2"
                  className={barTone(step.count, index)}
                >
                  <title>{`${step.label}: ${numberFormat.format(step.count)} (${step.note})`}</title>
                </circle>
              </g>
            );
          })}
        </svg>
      </ChartReveal>
      <figcaption className="medify-chart-axis">
        {funnel.steps.map((step, index) => (
          <div key={step.resource} className="flex-1 min-w-0 text-center">
            <span>{index + 1}. {step.label}</span>
            <span>{numberFormat.format(step.count)} · {step.note}</span>
          </div>
        ))}
      </figcaption>
    </figure>
  );
}

function severityClass(severity: SatuSehatSeverity): string {
  return severity === "ok" ? "text-[var(--accent)]" : "text-[color:var(--warn)]";
}

function severityText(severity: SatuSehatSeverity): string {
  if (severity === "kritis") return "Perlu tindakan segera";
  if (severity === "perhatian") return "Perlu perbaikan";
  return "Berjalan baik";
}

export function SatuSehatView({
  date,
  medifyResult = null,
  satusehatResult = null,
  oauthConfigured = false,
}: {
  date: string;
  medifyResult?: MedifySnapshotResult | null;
  satusehatResult?: SatusehatSnapshotResult | null;
  oauthConfigured?: boolean;
}) {
  const [resourceFilter, setResourceFilter] = useState<"semua" | "perhatian" | SatuSehatResourceCategory>("semua");
  const [copiedInstruction, setCopiedInstruction] = useState(false);
  const [liveSnapshot, setLiveSnapshot] = useState<SatusehatSnapshot | null>(satusehatResult?.snapshot ?? null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);

  const { isLive, sourceBanner, portal, resources, funnels } = resolveSatuSehatDashboardData(liveSnapshot);
  const maxResourceCount = Math.max(1, ...resources.map((item) => item.count));
  const medifySatusehat = extractMedifySatusehat(medifyResult);
  const analysisLines = buildSatuSehatExecutiveAnalysis(medifySatusehat, liveSnapshot);
  const filteredResources = filterSatuSehatResources(resourceFilter, resources);
  const totalFhirObjects = resources.reduce((sum, item) => sum + item.count, 0);
  const activeResourceTypes = resources.filter((item) => item.count > 0).length;
  const criticalResourcesCount = resources.filter((item) => item.severity === "kritis").length;

  const categoryCounts: Record<"semua" | "perhatian" | SatuSehatResourceCategory, number> = {
    semua: resources.length,
    perhatian: resources.filter((item) => item.severity !== "ok").length,
    kunjungan: resources.filter((item) => item.category === "kunjungan").length,
    klinis: resources.filter((item) => item.category === "klinis").length,
    farmasi: resources.filter((item) => item.category === "farmasi").length,
    penunjang: resources.filter((item) => item.category === "penunjang").length,
  };

  async function copyInstruction() {
    const text = formatSatuSehatInstructionText(medifySatusehat, liveSnapshot);
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    }
    setCopiedInstruction(true);
    window.setTimeout(() => setCopiedInstruction(false), 2000);
  }

  async function syncNow() {
    if (syncing) return;
    setSyncing(true);
    setSyncMessage(null);
    try {
      const response = await fetch("/api/director/satusehat/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await directorCsrfHeaders()) },
        body: "{}",
      });
      const body = (await response.json().catch(() => null)) as { snapshot?: SatusehatSnapshot; error?: string } | null;
      if (!response.ok || !body?.snapshot) {
        setSyncMessage({
          tone: "warn",
          text: body?.error || "Belum dapat menarik data terbaru dari Kemenkes saat ini.",
        });
        return;
      }
      setLiveSnapshot(body.snapshot);
      setSyncMessage({
        tone: "ok",
        text: "Data terbaru langsung dari sistem Kemenkes berhasil diperbarui tanpa CAPTCHA.",
      });
    } catch {
      setSyncMessage({
        tone: "warn",
        text: "Gagal terhubung ke server untuk menarik data Satu Sehat.",
      });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <article
      className="swiss-report-sheet melinda-management-sheet tool-workspace tool-satusehat"
      aria-label="Ringkasan pengiriman data Satu Sehat RSIA Melinda DHAI"
    >
      <div className="melinda-running-header flex items-center justify-between border-b border-slate-200 pb-2 mb-6 text-slate-500">
        <div className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-[var(--accent)]" />
          <span>RSIA Melinda DHAI Kediri</span>
        </div>
        <span className="text-[var(--type-ui)]">Satu Sehat</span>
      </div>

      <ToolPageHeader
        title="Satu Sehat"
        description="Ringkasan pengiriman catatan medis rumah sakit ke Kemenkes, perbandingan dengan Medify, dan saran perbaikan untuk Direktur."
      >
        <div className="swiss-masthead-right melinda-brief-meta">
          <dl className="swiss-meta-dl melinda-meta-dl">
            <div className="swiss-meta-item">
              <dt>Fasilitas kesehatan</dt>
              <dd>{portal.facilityName}</dd>
            </div>
            <div className="swiss-meta-item">
              <dt>Kode rumah sakit Kemenkes</dt>
              <dd>{portal.facilityCode} ({portal.verificationStatus})</dd>
            </div>
            <div className="swiss-meta-item">
              <dt>ID organisasi utama</dt>
              <dd>{portal.productionOrgId}</dd>
            </div>
            <div className="swiss-meta-item">
              <dt>ID organisasi uji coba</dt>
              <dd>{portal.sandboxOrgId}</dd>
            </div>
            <div className="swiss-meta-item">
              <dt>Pembaruan data Kemenkes</dt>
              <dd>{portal.lastUpdated}</dd>
            </div>
            <div className="swiss-meta-item">
              <dt>Sambungan otomatis</dt>
              <dd>{oauthConfigured ? "Kunci tersambung di server" : "Belum diisi di server"} (kunci portal {portal.apiKeyLastUpdated})</dd>
            </div>
            <div className="swiss-meta-item">
              <dt>Tanggal laporan dashboard</dt>
              <dd>{date}</dd>
            </div>
          </dl>
        </div>
      </ToolPageHeader>

      <p className="tool-page-notice">{sourceBanner}</p>
      {syncMessage && (
        <p role="status" className={`m-0 mb-4 text-base ${syncMessage.tone === "ok" ? "text-[var(--accent)]" : "text-[color:var(--warn)]"}`}>
          {syncMessage.text}
        </p>
      )}

      {/* 01 / Ringkasan pengiriman & analisis Direktur */}
      <section className="swiss-section" aria-labelledby="section-satusehat-01">
        <div className="melinda-tool-section-head">
          <h2 id="section-satusehat-01" className="swiss-section-heading">
            <span className="swiss-section-num">01</span>
            <span className="swiss-section-title">Ringkasan pengiriman &amp; analisis Direktur</span>
          </h2>
          <div className="flex items-center gap-2">
            <button type="button" onClick={syncNow} disabled={syncing} className="button-secondary">
              <RefreshCw className={`size-4 text-slate-600 ${syncing ? "animate-spin" : ""}`} aria-hidden="true" />
              <span>{syncing ? "Menarik dari Kemenkes…" : "Tarik data terbaru Kemenkes"}</span>
            </button>
            <button type="button" onClick={copyInstruction} className="button-secondary">
              {copiedInstruction ? <Check className="size-4 text-slate-900" aria-hidden="true" /> : <Copy className="size-4 text-slate-500" aria-hidden="true" />}
              <span>{copiedInstruction ? "Arahan disalin" : "Salin ringkasan arahan"}</span>
            </button>
            <Link href="/arahan" className="button-secondary">
              Buka halaman arahan
            </Link>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3 mb-6">
          {portal.logSummary ? (
            <>
              <div className="simrs-chart-card">
                <div className="simrs-chart-header">
                  <div className="simrs-chart-kicker">Data diterima Kemenkes</div>
                  <div className="simrs-chart-title">Tingkat keberhasilan (30 hari)</div>
                  <span className="melinda-tool-plain-status text-[color:var(--warn)]">
                    Di bawah target {portal.targetSuccessPercent}%
                  </span>
                </div>
                <div className="simrs-chart-body mt-3 space-y-2">
                  <p className="m-0 text-3xl font-medium text-slate-900">{percentFormat.format(portal.logSummary.successRatePercent)}%</p>
                  <p className="m-0 text-slate-600">
                    {numberFormat.format(portal.logSummary.successfulTransactions)} berhasil masuk dari {numberFormat.format(portal.logSummary.totalTransactions)} kali pengiriman.
                  </p>
                  <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden" aria-hidden="true">
                    <div className="h-full bg-[var(--accent)]" style={{ width: `${portal.logSummary.successRatePercent}%` }} />
                  </div>
                </div>
              </div>

              <div className="simrs-chart-card">
                <div className="simrs-chart-header">
                  <div className="simrs-chart-kicker">Pengiriman ditolak pusat</div>
                  <div className="simrs-chart-title">Kiriman gagal diproses</div>
                  <span className="melinda-tool-plain-status text-[color:var(--warn)]">
                    {percentFormat.format(portal.logSummary.failureRatePercent)}% gagal
                  </span>
                </div>
                <div className="simrs-chart-body mt-3 space-y-2">
                  <p className="m-0 text-3xl font-medium text-[color:var(--warn)]">{numberFormat.format(portal.logSummary.failedTransactions)}</p>
                  <p className="m-0 text-slate-600">
                    Terutama karena data kunjungan belum lengkap (Rule 10118) dan identitas pasien belum cocok.
                  </p>
                  <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden" aria-hidden="true">
                    <div className="h-full bg-[color:var(--warn)]" style={{ width: `${portal.logSummary.failureRatePercent}%` }} />
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="simrs-chart-card">
                <div className="simrs-chart-header">
                  <div className="simrs-chart-kicker">Sambungan otomatis Kemenkes</div>
                  <div className="simrs-chart-title">Penarikan langsung aktif</div>
                  <span className="melinda-tool-plain-status text-[var(--accent)]">
                    Tanpa perlu CAPTCHA
                  </span>
                </div>
                <div className="simrs-chart-body mt-3 space-y-2">
                  <p className="m-0 text-3xl font-medium text-slate-900">Otomatis</p>
                  <p className="m-0 text-slate-600">
                    Terhubung ke sistem resmi Kemenkes ({portal.periodLabel}). Diperbarui {portal.lastUpdated}.
                  </p>
                  <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden" aria-hidden="true">
                    <div className="h-full bg-[var(--accent)]" style={{ width: "100%" }} />
                  </div>
                </div>
              </div>

              <div className="simrs-chart-card">
                <div className="simrs-chart-header">
                  <div className="simrs-chart-kicker">Catatan berhasil disimpan pusat</div>
                  <div className="simrs-chart-title">Total seluruh catatan medis</div>
                  <span className="melinda-tool-plain-status text-slate-600">
                    Periode berjalan
                  </span>
                </div>
                <div className="simrs-chart-body mt-3 space-y-2">
                  <p className="m-0 text-3xl font-medium text-slate-900">{numberFormat.format(totalFhirObjects)}</p>
                  <p className="m-0 text-slate-600">
                    Jumlah catatan tersimpan dari 19 jenis layanan di server Kemenkes.
                  </p>
                  <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden" aria-hidden="true">
                    <div className="h-full bg-[var(--accent)]" style={{ width: "100%" }} />
                  </div>
                </div>
              </div>
            </>
          )}

          <div className="simrs-chart-card">
            <div className="simrs-chart-header">
              <div className="simrs-chart-kicker">Kelengkapan 19 jenis laporan</div>
              <div className="simrs-chart-title">Catatan medis tersimpan</div>
              <span className="melinda-tool-plain-status text-[color:var(--warn)]">
                {criticalResourcesCount} bagian masih kosong/minim
              </span>
            </div>
            <div className="simrs-chart-body mt-3 space-y-2">
              <p className="m-0 text-3xl font-medium text-slate-900">{activeResourceTypes} dari {resources.length}</p>
              <p className="m-0 text-slate-600">
                Total {numberFormat.format(totalFhirObjects)} catatan berhasil masuk. Cek USG, Imunisasi, dan Hasil Lab pada grafik di bawah.
              </p>
              <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden" aria-hidden="true">
                <div className="h-full bg-[var(--accent)]" style={{ width: `${Math.round((activeResourceTypes / resources.length) * 100)}%` }} />
              </div>
            </div>
          </div>
        </div>

        <div className="swiss-callout mb-5 space-y-2">
          <p className="m-0 font-medium text-slate-900">Kesimpulan untuk Direktur</p>
          <ul className="m-0 pl-5 space-y-1.5 text-slate-700">
            {analysisLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>

        <div tabIndex={0} className="swiss-table-wrap">
          <table className="swiss-table">
            <caption className="sr-only">Perbandingan catatan Satu Sehat Kemenkes dengan laporan Medify</caption>
            <thead>
              <tr>
                <th scope="col" className="text-left">Sumber laporan</th>
                <th scope="col" className="text-left">Periode &amp; cara hitung</th>
                <th scope="col" className="text-right whitespace-nowrap">Sudah terkirim</th>
                <th scope="col" className="text-right whitespace-nowrap">Gagal / belum dikirim</th>
                <th scope="col" className="text-left">Penjelasan sederhana</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="font-medium text-slate-900">
                  {isLive ? "Kemenkes Satu Sehat (tarikan otomatis)" : "Portal Satu Sehat Kemenkes"}
                </td>
                <td className="text-slate-600">{portal.periodLabel} · Catatan server pusat</td>
                <td className={`text-right whitespace-nowrap ${portal.logSummary ? severityClass("perhatian") : "text-[var(--accent)]"}`}>
                  {portal.logSummary
                    ? `${percentFormat.format(portal.logSummary.successRatePercent)}% (${numberFormat.format(portal.logSummary.successfulTransactions)})`
                    : `${numberFormat.format(totalFhirObjects)} catatan (${activeResourceTypes}/19 jenis)`}
                </td>
                <td className="text-right whitespace-nowrap text-[color:var(--warn)]">
                  {portal.logSummary
                    ? `${numberFormat.format(portal.logSummary.failedTransactions)} gagal`
                    : liveSnapshot?.unavailableResources.length
                      ? `${liveSnapshot.unavailableResources.length} belum terbaca`
                      : "Lihat tabel kendala"}
                </td>
                <td className="text-slate-700">
                  {portal.logSummary
                    ? "Hanya menghitung kiriman yang benar-benar diterima Kemenkes; ruang uji coba masih kosong (0 data)."
                    : "Ditarik otomatis melalui sambungan resmi Kemenkes tanpa CAPTCHA."}
                </td>
              </tr>
              <tr>
                <td className="font-medium text-slate-900">Catatan internal SIMRS Medify</td>
                <td className="text-slate-600">
                  {medifySatusehat ? `${medifySatusehat.periodStart} s.d. ${medifySatusehat.periodEnd} · Tanggal pasien pulang` : "Laporan Medify belum tersedia"}
                </td>
                <td className={`text-right whitespace-nowrap ${medifySatusehat && medifySatusehat.globalPercent < portal.targetSuccessPercent ? "text-[color:var(--warn)]" : "text-slate-700"}`}>
                  {medifySatusehat
                    ? `${percentFormat.format(medifySatusehat.globalPercent)}% (${numberFormat.format(medifySatusehat.sent)}/${numberFormat.format(medifySatusehat.expected)})`
                    : "Belum ada tarikan"}
                </td>
                <td className="text-right whitespace-nowrap text-slate-700">
                  {medifySatusehat
                    ? `${numberFormat.format(medifySatusehat.failed)} gagal · ${numberFormat.format(medifySatusehat.notSent)} belum`
                    : "—"}
                </td>
                <td className="text-slate-700">
                  {medifySatusehat
                    ? `Pembaruan Medify: ${medifySatusehat.lastUpdate}. Catatan Medify ini tidak menampilkan ribuan percobaan ulang yang ditolak pusat.`
                    : "Laporan harian Medify dapat dipakai sebagai pembanding antrean pasien pulang."}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* 02 / Kelengkapan 19 jenis data layanan & alur rekam medis */}
      <section className="swiss-section" aria-labelledby="section-satusehat-02">
        <div className="melinda-tool-section-head">
          <h2 id="section-satusehat-02" className="swiss-section-heading">
            <span className="swiss-section-num">02</span>
            <span className="swiss-section-title">Kelengkapan 19 jenis data layanan &amp; alur rekam medis</span>
          </h2>
          <span className="melinda-section-meta text-slate-500">
            Data berhasil masuk · {portal.lastUpdated}
          </span>
        </div>

        <div className="grid gap-4 md:grid-cols-2 mb-6">
          {funnels.map((funnel) => (
            <div key={funnel.id} className="simrs-chart-card">
              <div>
                <div className="medify-headline">
                  <p className="medify-figure">{percentFormat.format(funnel.conversionPercent)}%</p>
                  <p className="text-base font-medium text-slate-800 m-0">{funnel.title}</p>
                </div>
                <p className={`text-base m-0 mt-1 ${severityClass(funnel.severity)}`}>
                  {funnel.statusLabel} — {funnel.summary}
                </p>
              </div>
              <CareFlowChart funnel={funnel} />
            </div>
          ))}
        </div>
        <EntranceSeen />

        <div className="melinda-tool-segment-group flex flex-wrap gap-2 mb-4" role="group" aria-label="Saring jenis data layanan">
          {SATUSEHAT_CATEGORY_OPTIONS.map((option) => {
            const labelBase = option.label.replace(/\s*\(\d+\)$/, "");
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setResourceFilter(option.id)}
                aria-pressed={resourceFilter === option.id}
                className={`melinda-tool-segment px-3 py-1.5 rounded border text-left ${resourceFilter === option.id ? "is-active" : ""}`}
              >
                {labelBase} ({categoryCounts[option.id]})
              </button>
            );
          })}
        </div>

        <div tabIndex={0} className="swiss-table-wrap">
          <table className="swiss-table">
            <caption className="sr-only">Rincian 19 jenis data layanan di Portal Satu Sehat Kemenkes</caption>
            <thead>
              <tr>
                <th scope="col" className="text-left">Jenis data layanan</th>
                <th scope="col" className="text-left whitespace-nowrap">Kelompok layanan</th>
                <th scope="col" className="text-right whitespace-nowrap">Jumlah terkirim</th>
                <th scope="col" className="text-left min-w-[9rem] whitespace-nowrap">Status kelengkapan</th>
                <th scope="col" className="text-left">Penjelasan untuk Direktur</th>
              </tr>
            </thead>
            <tbody>
              {filteredResources.map((item) => {
                const ratio = Math.round((item.count / maxResourceCount) * 100);
                return (
                  <tr key={item.id}>
                    <td className="font-medium text-slate-900">
                      <div>{item.plainTitle}</div>
                      <div className="font-normal text-slate-500">Kode Kemenkes: {item.name} · {item.clinicalRole}</div>
                    </td>
                    <td className="text-slate-600">{item.categoryLabel}</td>
                    <td className={`text-right whitespace-nowrap ${item.severity === "kritis" ? "text-[color:var(--warn)] font-medium" : "text-slate-900"}`}>
                      {item.status === "unavailable" ? "Belum terbaca" : item.count === 0 ? "0 (-)" : numberFormat.format(item.count)}
                    </td>
                    <td>
                      <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden" aria-hidden="true">
                        <div
                          className={`h-full ${item.severity === "kritis" ? "bg-[color:var(--warn)]" : "bg-[var(--accent)]"}`}
                          style={{ width: `${item.count > 0 ? Math.max(3, ratio) : 0}%` }}
                        />
                      </div>
                      <span className={`block mt-1 ${severityClass(item.severity)}`}>{severityText(item.severity)}</span>
                    </td>
                    <td className={item.severity === "ok" ? "text-slate-700" : "text-[color:var(--warn)]"}>
                      {item.evaluation}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* 03 / Penyebab pengiriman gagal & cara memperbaikinya */}
      <section className="swiss-section" aria-labelledby="section-satusehat-03">
        <div className="melinda-tool-section-head">
          <h2 id="section-satusehat-03" className="swiss-section-heading">
            <span className="swiss-section-num">03</span>
            <span className="swiss-section-title">Penyebab pengiriman gagal &amp; cara memperbaikinya</span>
          </h2>
          <span className="melinda-section-meta text-slate-500">
            Temuan catatan kegagalan portal Kemenkes
          </span>
        </div>

        <div tabIndex={0} className="swiss-table-wrap">
          <table className="swiss-table">
            <caption className="sr-only">Daftar penyebab data gagal terkirim ke Satu Sehat</caption>
            <thead>
              <tr>
                <th scope="col" className="text-left">Bagian yang terkendala</th>
                <th scope="col" className="text-left">Tanda penolakan</th>
                <th scope="col" className="text-left">Dampak ke rumah sakit</th>
                <th scope="col" className="text-left">Penyebab &amp; langkah perbaikan</th>
              </tr>
            </thead>
            <tbody>
              {SATUSEHAT_FAILURE_DIAGNOSTICS.map((diag) => (
                <tr key={diag.id}>
                  <td className="font-medium text-slate-900">{diag.resourceOrEndpoint}</td>
                  <td className="text-[color:var(--warn)]">
                    <div>{diag.httpOrPattern}</div>
                    <div className="text-slate-600">{diag.ruleNumber}</div>
                  </td>
                  <td className="text-slate-700">{diag.impact}</td>
                  <td className="text-slate-700">
                    <div>{diag.rootCause}</div>
                    <div className="mt-1 font-medium text-slate-900">Langkah perbaikan: {diag.remediation}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 04 / Kelengkapan fitur Satu Sehat rumah sakit */}
      <section className="swiss-section" aria-labelledby="section-satusehat-04">
        <div className="melinda-tool-section-head">
          <h2 id="section-satusehat-04" className="swiss-section-heading">
            <span className="swiss-section-num">04</span>
            <span className="swiss-section-title">Kelengkapan fitur Satu Sehat rumah sakit</span>
          </h2>
          <span className="melinda-section-meta text-slate-500">
            Status kelengkapan fitur di portal Kemenkes
          </span>
        </div>

        <div tabIndex={0} className="swiss-table-wrap">
          <table className="swiss-table">
            <caption className="sr-only">Status kelengkapan tujuh fitur Satu Sehat rumah sakit</caption>
            <thead>
              <tr>
                <th scope="col" className="text-left">Nama fitur &amp; layanan</th>
                <th scope="col" className="text-left">Status saat ini</th>
                <th scope="col" className="text-left">Arti bagi rumah sakit</th>
              </tr>
            </thead>
            <tbody>
              {SATUSEHAT_MODULE_READINESS.map((mod) => (
                <tr key={mod.id}>
                  <td className="font-medium text-slate-900">{mod.moduleName}</td>
                  <td className={severityClass(mod.severity)}>{mod.statusLabel}</td>
                  <td className="text-slate-700">{mod.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 05 / Langkah prioritas untuk arahan Direktur */}
      <section className="swiss-section" aria-labelledby="section-satusehat-05">
        <div className="melinda-tool-section-head">
          <h2 id="section-satusehat-05" className="swiss-section-heading">
            <span className="swiss-section-num">05</span>
            <span className="swiss-section-title">Langkah prioritas untuk arahan Direktur</span>
          </h2>
          <span className="melinda-section-meta text-slate-500">
            Urutan pekerjaan yang disarankan
          </span>
        </div>

        <div tabIndex={0} className="swiss-table-wrap">
          <table className="swiss-table">
            <caption className="sr-only">Langkah prioritas perbaikan pengiriman Satu Sehat</caption>
            <thead>
              <tr>
                <th scope="col" className="text-center w-12">#</th>
                <th scope="col" className="text-left">Fokus perbaikan</th>
                <th scope="col" className="text-left">Tindakan yang disarankan</th>
                <th scope="col" className="text-left">Penanggung jawab</th>
                <th scope="col" className="text-left">Target hasil</th>
              </tr>
            </thead>
            <tbody>
              {SATUSEHAT_DIRECTOR_ACTIONS.map((item) => (
                <tr key={item.priority}>
                  <td className="text-center text-slate-500">{item.priority}</td>
                  <td className="font-medium text-slate-900">{item.area}</td>
                  <td className="text-slate-700">{item.action}</td>
                  <td className="text-slate-700">{item.pic}</td>
                  <td className="text-[var(--accent)] font-medium">{item.target}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </article>
  );
}
