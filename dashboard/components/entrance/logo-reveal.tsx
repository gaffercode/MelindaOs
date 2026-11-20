import { LOGO_CONVERGENCE, LOGO_ORANGE, LOGO_PATHS, LOGO_TEAL, LOGO_VIEWBOX } from "./melinda-logo";

/** Radius that covers the whole mark from the convergence point (farthest corner is ~385 away). */
export const REVEAL_RADIUS = 420;

/** The mark laid out for the formation sequence. Every animated part carries a `data-reveal` hook and starts
 * invisible (inline opacity 0, so the server-rendered frame is pure white); the timeline in
 * entrance-sequence.tsx reveals each one. The two forms grow out of their convergence point through a circular
 * clip, the oval and dot pop in last, and the gleam band sweeps across once, masked to the mark. */
export function LogoReveal() {
  const hidden = { opacity: 0 } as const;
  return (
    <svg viewBox={LOGO_VIEWBOX} className="entrance-logo-svg" role="img" aria-label="MelindaOS" focusable="false">
      <defs>
        <clipPath id="entrance-clip-left"><circle data-reveal="clip-left" cx={LOGO_CONVERGENCE.x} cy={LOGO_CONVERGENCE.y} r={0} /></clipPath>
        <clipPath id="entrance-clip-right"><circle data-reveal="clip-right" cx={LOGO_CONVERGENCE.x} cy={LOGO_CONVERGENCE.y} r={0} /></clipPath>
        <clipPath id="entrance-clip-mark">
          <path d={LOGO_PATHS.left} /><path d={LOGO_PATHS.right} /><path d={LOGO_PATHS.oval} /><path d={LOGO_PATHS.dot} />
        </clipPath>
        <linearGradient id="entrance-gleam" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.5" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g clipPath="url(#entrance-clip-left)"><path data-reveal="left" d={LOGO_PATHS.left} fill={LOGO_ORANGE} style={hidden} /></g>
      <g clipPath="url(#entrance-clip-right)"><path data-reveal="right" d={LOGO_PATHS.right} fill={LOGO_TEAL} style={hidden} /></g>
      <path data-reveal="oval" d={LOGO_PATHS.oval} fill={LOGO_ORANGE} style={hidden} />
      <path data-reveal="dot" d={LOGO_PATHS.dot} fill={LOGO_ORANGE} style={hidden} />
      <g clipPath="url(#entrance-clip-mark)">
        <g transform="skewX(-18)">
          <rect data-reveal="gleam" x={-170} y={-40} width={150} height={470} fill="url(#entrance-gleam)" style={hidden} />
        </g>
      </g>
    </svg>
  );
}
