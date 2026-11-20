export const BRAND_NAME = "Melinda OS";
export const BRAND_TAGLINE = "Institutional Intelligent Layer";
export const BRAND_CREDIT = "Architect and built by dr. Ferdi Andriska.";

/** Text beside the mark, revealed by the entrance timeline. */
export function BrandLockupText() {
  const hidden = { opacity: 0 } as const;
  return (
    <div className="entrance-brand">
      <p className="entrance-brand-name" data-entrance="brand-name" style={hidden}>{BRAND_NAME}</p>
      <p className="entrance-brand-tagline" data-entrance="brand-tagline" style={hidden}>{BRAND_TAGLINE}</p>
      <p className="entrance-brand-credit" data-entrance="brand-credit" style={hidden}>{BRAND_CREDIT}</p>
    </div>
  );
}
