import { SourceInfo } from "@/components/source-info";
import { wibTime } from "@/lib/director/director-data";
import type { CountMetric, DocumentProvenance } from "@/lib/publisher-contract";
import { Info } from "lucide-react";
import "./published-report.css";

export function metricText(metric: CountMetric): string {
  return metric.value === null ? "Tidak tersedia" : String(metric.value);
}

export function MetricBlock({ metric }: { metric: CountMetric }) {
  return (
    <div className="publication-stat-cell">
      <p className="publication-stat-label">{metric.definition}</p>
      <p className="publication-stat-value">{metricText(metric)}</p>
    </div>
  );
}

const sourceLine = (metric: CountMetric) => `${metric.source} · ${metric.periodStart}–${metric.periodEnd} · cutoff ${metric.cutoff ?? "tidak berlaku"}`;

/** Label and number only; source, period, and cutoff sit once behind the info icon, since they usually repeat across cells. */
export function MetricGrid({ metrics, empty }: { metrics: CountMetric[]; empty: string }) {
  if (!metrics.length) return <p role="status">Tidak tersedia. {empty}</p>;
  return (
    <div className="flex items-start gap-2">
      <div className="publication-kpi-grid flex-1">{metrics.map((metric, index) => <MetricBlock key={`${metric.definition}-${index}`} metric={metric} />)}</div>
      <SourceInfo>{[...new Set(metrics.map(sourceLine))].map((line) => <p key={line} className="m-0">{line}</p>)}</SourceInfo>
    </div>
  );
}

export function PublicationNote({ provenance, revisionId, payloadHash, receivedAt, producer }: { provenance: DocumentProvenance; revisionId: string; payloadHash: string; receivedAt: string; producer: string }) {
  const who = producer === "file" ? "berkas lokal" : producer;
  return (
    <details className="director-sources published-source">
      <summary><Info size={14} aria-hidden="true" /><span>Sumber laporan</span></summary>
      <p>Revisi {revisionId}. Hash {payloadHash}. Status tersimpan. Diterima {wibTime(receivedAt)} dari {who}.</p>
      <p>Periode {provenance.periodStart}–{provenance.periodEnd}. Cutoff {provenance.cutoff ?? "tidak berlaku"}. Diamati {wibTime(provenance.sourceObservedAt)}.</p>
      <ul>
        {provenance.sources.map((source) => (
          <li key={source.name}>
            <strong>{source.name}</strong>
            {source.url ? <> · <a href={source.url} rel="noreferrer">{source.url}</a></> : null}
            {source.note ? <> · {source.note}</> : null}
          </li>
        ))}
      </ul>
      {provenance.notes ? <p>{provenance.notes}</p> : null}
    </details>
  );
}
