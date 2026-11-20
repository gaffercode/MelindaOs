/**
 * One real daily series from Medify. The SVG holds only the marks; the scale and dates are HTML,
 * so text stays at the page's 12px floor however wide the card is. Each mark carries a hover title.
 */
import type { ReactNode } from "react";
import { formatUtcDayMonth } from "@/lib/date-label";

export type DailyPoint = { date: string; value: number };

const W = 360;
const H = 96;
const TOP = 4;
const format = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 });

function ceiling(value: number): number {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const scaled = value / power;
  return (scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10) * power;
}

/** First-load reveal for a chart (signature moment, globals.css). Two plain boxes: at rest they change nothing. */
export function ChartReveal({ direction, children }: { direction: "up" | "right"; children: ReactNode }) {
  return <div className="chart-reveal" data-reveal={direction}><div className="chart-reveal-outer"><div className="chart-reveal-inner">{children}</div></div></div>;
}

export function DailyChart({ points, label, unit = "", kind = "bar", reference }: { points: DailyPoint[]; label: string; unit?: string; kind?: "bar" | "line"; reference?: number }) {
  const first = points[0], last = points.at(-1);
  if (!first || !last || points.length < 2) return null;
  const max = ceiling(Math.max(...points.map((point) => point.value), reference ?? 0));
  const y = (value: number) => H - (Math.min(Math.max(value, 0), max) / max) * (H - TOP);
  const step = W / points.length;
  const x = (index: number) => index * step + step / 2;
  const peak = points.reduce((top, point) => (point.value > top.value ? point : top));
  const tone = (point: DailyPoint, index: number) => (reference !== undefined && point.value > reference ? "medify-chart-over" : index === points.length - 1 ? "medify-chart-latest" : "medify-chart-mark");
  const tip = (point: DailyPoint) => `${formatUtcDayMonth(point.date)}: ${format.format(point.value)}${unit}`;
  const summary = `${label}, ${formatUtcDayMonth(first.date)} sampai ${formatUtcDayMonth(last.date)}: tertinggi ${format.format(peak.value)}${unit} (${formatUtcDayMonth(peak.date)}), terakhir ${format.format(last.value)}${unit}.`;
  return (
    <figure className="medify-chart">
      <span className="medify-chart-scale" aria-hidden="true">{format.format(max)}{unit}</span>
      <ChartReveal direction={kind === "bar" ? "up" : "right"}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary}>
        <line x1="0" x2={W} y1={H - 0.5} y2={H - 0.5} className="medify-chart-base" />
        {reference !== undefined && <line x1="0" x2={W} y1={y(reference)} y2={y(reference)} className="medify-chart-reference" />}
        {kind === "bar"
          ? points.map((point, index) => (
            <rect key={point.date} x={index * step + step * 0.15} width={step * 0.7} y={y(point.value)} height={H - y(point.value)} className={tone(point, index)}>
              <title>{tip(point)}</title>
            </rect>
          ))
          : (
            <>
              <polyline points={points.map((point, index) => `${x(index).toFixed(1)},${y(point.value).toFixed(1)}`).join(" ")} className="medify-chart-line" />
              {points.map((point, index) => (
                <circle key={point.date} cx={x(index)} cy={y(point.value)} r="2.5" className={tone(point, index)}>
                  <title>{tip(point)}</title>
                </circle>
              ))}
            </>
          )}
      </svg>
      </ChartReveal>
      <figcaption className="medify-chart-axis">
        <span>{formatUtcDayMonth(first.date)}</span>
        {reference !== undefined && <span>Garis putus: {format.format(reference)}{unit}</span>}
        <span>{formatUtcDayMonth(last.date)}</span>
      </figcaption>
    </figure>
  );
}
