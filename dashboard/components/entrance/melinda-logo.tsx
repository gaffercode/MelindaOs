/** MelindaOS mark as inline SVG geometry, traced from the official brandbook PNG (public/brand/melindaos-logo.png,
 * 375 x 382) with potrace on 2026-11-08: mask overlap with the source is 0.995 (orange) and 0.993 (teal).
 * The PNG stays the favicon and the sidebar image; this is the runtime geometry the entrance animates. */
export const LOGO_VIEWBOX = "0 0 375 382";
export const LOGO_ORANGE = "#ff7229";
export const LOGO_TEAL = "#0cb4b6";
/** Point where the two forms meet at the bottom; the formation reveal grows from here. */
export const LOGO_CONVERGENCE = { x: 156, y: 368 } as const;
export const LOGO_PATHS = {
  left: "M153.8 367.0C122.7 332.7 109.2 282.9 115.5 226.0C120.1 184.8 130.3 149.4 148.6 111.1L156.0 95.8L150.1 89.1C131.0 67.8 103.3 47.7 82.5 40.4C75.4 37.9 73.1 37.5 62.0 37.5C49.7 37.5 49.3 37.6 42.6 40.9C8.6 57.6 0.0 112.4 19.9 185.0C26.5 209.0 34.7 229.7 47.1 254.0C73.5 305.8 109.6 346.5 147.5 367.5C153.0 370.5 157.9 373.0 158.3 373.0C158.8 373.0 156.7 370.3 153.8 367.0Z",
  oval: "M190.2 113.7C194.1 109.8 196.8 102.9 197.6 94.5C198.9 81.8 193.7 67.1 186.7 63.7C183.1 61.9 182.9 61.9 179.3 63.7C169.4 68.5 165.1 90.6 171.0 106.3C175.0 117.1 183.6 120.4 190.2 113.7Z",
  dot: "M210.4 68.9C214.0 66.1 214.1 60.0 210.5 56.5C207.8 53.7 206.3 53.5 202.7 55.1C197.5 57.5 196.7 63.8 200.9 68.1C204.4 71.5 206.8 71.7 210.4 68.9Z",
  right: "M156.0 367.8C140.1 344.0 141.1 310.1 158.8 270.0C172.2 239.5 189.8 214.0 213.0 191.1C259.2 145.5 307.7 130.3 332.9 153.5C340.1 160.2 344.4 168.6 346.8 180.7L348.6 189.5L350.2 183.5C361.2 143.5 363.2 108.5 356.3 80.0C354.3 71.4 348.0 58.6 343.0 52.9C337.9 46.8 329.3 41.2 321.8 38.8C283.2 26.8 223.1 71.3 179.7 144.0C163.6 171.1 147.8 208.6 140.0 238.5C133.5 263.6 130.5 295.3 132.9 315.1C135.1 334.2 142.0 352.4 151.5 364.1C157.4 371.4 159.7 373.2 156.0 367.8Z",
} as const;

export function MelindaLogo({ className, title = "MelindaOS" }: { className?: string; title?: string }) {
  return (
    <svg viewBox={LOGO_VIEWBOX} className={className} role="img" aria-label={title} focusable="false">
      <path d={LOGO_PATHS.left} fill={LOGO_ORANGE} />
      <path d={LOGO_PATHS.right} fill={LOGO_TEAL} />
      <path d={LOGO_PATHS.oval} fill={LOGO_ORANGE} />
      <path d={LOGO_PATHS.dot} fill={LOGO_ORANGE} />
    </svg>
  );
}
