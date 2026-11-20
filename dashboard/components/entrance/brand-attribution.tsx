export const ATTRIBUTION_LINES = ["Sentra Artificial Intelligence 2026"] as const;

export function BrandAttribution() {
  return (
    <footer className="entrance-attribution" data-entrance="attribution" style={{ opacity: 0 }}>
      <p>{ATTRIBUTION_LINES[0]}</p>
    </footer>
  );
}
