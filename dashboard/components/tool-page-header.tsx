import type { ReactNode } from "react";
import { Info } from "lucide-react";
import "./tool-workspace.css";

export function ToolPageHeader({ title, description, children }: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <header className="tool-page-header">
      <div>
        <h1>{title}</h1>
        <p className="tool-page-description">{description}</p>
      </div>
      <details className="tool-page-info">
        <summary><Info size={18} aria-hidden="true" /><span>Informasi halaman</span></summary>
        <div className="tool-page-info-content">{children}</div>
      </details>
    </header>
  );
}
