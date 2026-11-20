/**
 * Monthly visits per service line from Medify (rawat jalan, rawat inap, IGD) as three lines on one scale.
 * Like DailyChart, the SVG holds only the marks; the scale, legend and month labels are HTML so text keeps the
 * page's 12px floor. The last month is month to date and is said so in the legend and the summary.
 */
import { formatUtcMonthYear } from "@/lib/date-label";
import type { MedifyMonthlyVisits } from "@/lib/medify/medify-snapshot-contract";
import { ChartReveal } from "./medify-daily-chart";

const W = 360;
const H = 96;
const TOP = 4;
const format = new Intl.NumberFormat("id-ID");
const SERIES = [
  { key: "outpatient", label: "rawat jalan", className: "medify-line-outpatient" },
  { key: "inpatient", label: "rawat inap", className: "medify-line-inpatient" },
  { key: "igd", label: "IGD", className: "medify-line-igd" },
] as const;

function ceiling(value: number): number {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const scaled = value / power;
  return (scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10) * power;
}

export function MonthlyVisitsChart({ months }: { months: MedifyMonthlyVisits[] }) {
  const first = months[0], last = months.at(-1);
  if (!first || !last || months.length < 2) return null;
  const max = ceiling(Math.max(...months.flatMap((month) => SERIES.map((series) => month[series.key]))));
  const y = (value: number) => H - (Math.min(Math.max(value, 0), max) / max) * (H - TOP);
  const step = W / months.length;
  const x = (index: number) => index * step + step / 2;
  const summary = `Kunjungan bulanan per layanan, ${formatUtcMonthYear(first.month)} sampai ${formatUtcMonthYear(last.month)} (bulan berjalan): ${SERIES.map((series, index) => `${index === 0 ? `${series.label} terakhir` : series.label} ${format.format(last[series.key])}`).join(", ")}.`;
  return (
    <figure className="medify-chart">
      <span className="medify-chart-scale" aria-hidden="true">{format.format(max)}</span>
      <ChartReveal direction="right">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary}>
        <line x1="0" x2={W} y1={H - 0.5} y2={H - 0.5} className="medify-chart-base" />
        {SERIES.map((series) => (
          <g key={series.key} className={series.className}>
            <polyline points={months.map((month, index) => `${x(index).toFixed(1)},${y(month[series.key]).toFixed(1)}`).join(" ")} />
            {months.map((month, index) => (
              <circle key={month.month} cx={x(index)} cy={y(month[series.key])} r="2.5">
                <title>{`${formatUtcMonthYear(month.month)}, ${series.label}: ${format.format(month[series.key])}`}</title>
              </circle>
            ))}
          </g>
        ))}
      </svg>
      </ChartReveal>
      <figcaption className="medify-chart-axis">
        <span>{formatUtcMonthYear(first.month)}</span>
        <span className="medify-chart-legend">{SERIES.map((series) => <span key={series.key} className={series.className}>{series.label}</span>)}</span>
        <span>{formatUtcMonthYear(last.month)} (berjalan)</span>
      </figcaption>
    </figure>
  );
}
