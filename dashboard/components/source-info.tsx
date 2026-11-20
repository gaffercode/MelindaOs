import { Info } from "lucide-react";
import type { ReactNode } from "react";

export function SourceInfo({ children }: { children: ReactNode }) {
  return <details className="source-info"><summary aria-label="Lihat sumber dan waktu pembaruan" title="Sumber data"><Info size={16} aria-hidden="true" /></summary><div className="source-info-panel">{children}</div></details>;
}
