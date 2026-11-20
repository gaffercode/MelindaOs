import { Check } from "lucide-react";
import type { StudioIssue } from "@/lib/studio/contracts";

// Blockers first, in plain red-orange text; warnings after them. Never printed with the document.
export function StudioQualityPanel({ issues }: { issues: StudioIssue[] }) {
  const distinct = [...new Map(issues.map((i) => [`${i.code}:${i.field}`, i])).values()];
  const blockers = distinct.filter((i) => i.severity === "blocker");
  const warnings = distinct.filter((i) => i.severity !== "blocker");
  return <aside className="studio-card studio-checks print:hidden" aria-label="Pemeriksaan dokumen">
    <h3>Pemeriksaan dokumen</h3>
    {distinct.length === 0 && <p className="studio-ok"><Check size={18} aria-hidden="true" />Isian dan hubungan dokumen lolos pemeriksaan otomatis. Review substansi tetap diperlukan.</p>}
    {blockers.length > 0 && <><h4>Perlu diperbaiki ({blockers.length})</h4><ul>{blockers.map((i) => <li key={`${i.code}:${i.field}`} data-severity="blocker">{i.message}</li>)}</ul></>}
    {warnings.length > 0 && <><h4>Perlu perhatian ({warnings.length})</h4><ul>{warnings.map((i) => <li key={`${i.code}:${i.field}`} data-severity="warning">{i.message}</li>)}</ul></>}
  </aside>;
}
