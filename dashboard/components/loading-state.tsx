"use client";

import { useEffect, useState } from "react";

/* Status memuat bergerak (arahan Direktur 2026-11-08): grid piksel 3×3 dengan gelombang chevron
 * (drive/dots) atau komet keliling (orbit), label berkilau, dan penghitung waktu berjalan.
 * Keyframes pixel-on dan shimmer-text ada di globals.css; blok reduced-motion global membekukan
 * grid ke keadaan redup, timer tetap berjalan. */

const CHEVRON = Array.from({ length: 9 }, (_, i) => ((i % 3) + Math.abs(Math.floor(i / 3) - 1)) * 90);
const ORBIT_ORDER = [0, 1, 2, 5, 8, 7, 6, 3];
const ORBIT = Array.from({ length: 9 }, (_, i) => (ORBIT_ORDER.includes(i) ? ORBIT_ORDER.indexOf(i) * 110 : null));

const PATTERNS: Record<"drive" | "dots" | "orbit", { delays: (number | null)[]; dur: number; round: boolean }> = {
  drive: { delays: CHEVRON, dur: 650, round: false },
  dots: { delays: CHEVRON, dur: 650, round: true },
  orbit: { delays: ORBIT, dur: 950, round: false },
};

function useElapsed(): string {
  const [tenths, setTenths] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTenths((current) => current + 1), 100);
    return () => clearInterval(timer);
  }, []);
  const total = tenths / 10;
  return total < 60 ? `${total.toFixed(1)}s` : `${Math.floor(total / 60)}m ${(total % 60).toFixed(1)}s`;
}

/** Root <span> supaya sah dipakai di dalam <p> yang sudah ada. */
export function LoadingState({ label = "Memuat", variant = "drive", className }: { label?: string; variant?: keyof typeof PATTERNS; className?: string }) {
  const { delays, dur, round } = PATTERNS[variant];
  const elapsed = useElapsed();
  return <span role="status" data-loading="" className={`inline-flex w-fit items-center gap-2.5 ${className ?? ""}`.trim()}>
    <span aria-hidden="true" className="grid shrink-0 grid-cols-[repeat(3,4px)] gap-[1.5px]">
      {delays.map((delay, index) => <span
        key={index}
        className={round ? "size-[4px] rounded-full" : "size-[4px] rounded-[1px]"}
        style={{
          background: "var(--foreground)",
          opacity: delay === null ? 0.07 : 0.15,
          animation: delay === null ? "none" : `pixel-on ${dur}ms ease-in-out ${delay}ms infinite`,
        }}
      />)}
    </span>
    <span
      className="bg-clip-text text-[length:var(--type-ui)] font-medium text-transparent"
      style={{
        backgroundImage: "linear-gradient(90deg, var(--muted) 35%, var(--foreground) 50%, var(--muted) 65%)",
        backgroundSize: "200% 100%",
        animation: "shimmer-text 1.4s linear infinite",
      }}
    >{label}</span>
    <span className="font-mono text-[length:var(--type-meta)] text-[var(--muted)] tabular-nums">{elapsed}</span>
  </span>;
}
