import type { AiFill } from "@/lib/contracts";

/** The fills of one knowledge document: what the Director answered, apart from what the readiness engine filled by itself. */
export function FillLists({ fills }: { fills: AiFill[] }) {
  const director = fills.filter((fill) => fill.method === "director");
  const automatic = fills.filter((fill) => fill.method !== "director");
  if (fills.length === 0) return null;
  return <>
    {automatic.length > 0 && <>
      <p className="m-0 font-semibold">Diisi otomatis ({automatic.length})</p>
      {automatic.map((fill, index) => (
        <p key={`${fill.placeholder}-${index}`} className="m-0 mt-1 text-sm">
          {fill.placeholder} → {fill.value || "(dikonfirmasi)"} · sumber {fill.sourceRef} ({fill.method})
        </p>
      ))}
    </>}
    {director.length > 0 && <>
      <p className={`m-0 font-semibold${automatic.length > 0 ? " mt-3" : ""}`}>Dijawab Direktur ({director.length})</p>
      {director.map((fill, index) => (
        <p key={`${fill.placeholder}-${index}`} className="m-0 mt-1 text-sm">
          {fill.placeholder} → {fill.value || "(dikonfirmasi)"}
        </p>
      ))}
    </>}
  </>;
}
