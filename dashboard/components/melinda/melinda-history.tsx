import { Plus, Trash2, X } from "lucide-react";
import { wibTime } from "@/lib/director/director-data";
import type { MelindaConversation } from "@/lib/melinda/store";

const dayOf = (value: string) => new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "short" }).format(new Date(value));

/** Side panel on desktop; below 768px the same panel becomes a full layer, shown only while `open`. */
export function MelindaHistory({ conversations, activeId, open, onOpen, onDelete, onNew, onClose }: { conversations: MelindaConversation[]; activeId: string | null; open: boolean; onOpen: (id: string) => void; onDelete: (id: string) => void; onNew: () => void; onClose: () => void }) {
  return <aside className={`melinda-history${open ? " is-open" : ""}`} aria-label="Riwayat percakapan">
    <div className="melinda-history-head">
      <h2>Riwayat</h2>
      <button type="button" className="melinda-icon-button melinda-history-close" onClick={onClose} aria-label="Tutup riwayat"><X className="size-5" aria-hidden="true" /></button>
    </div>
    <button type="button" className="melinda-new" onClick={onNew}><Plus className="size-4" aria-hidden="true" />Percakapan baru</button>
    {conversations.length === 0 ? <p className="melinda-line melinda-muted">Belum ada percakapan.</p>
      : <ul className="melinda-history-list">{conversations.map((item) => <li key={item.id} className={item.id === activeId ? "is-active" : undefined}>
        <button type="button" className="melinda-history-open" onClick={() => onOpen(item.id)}>
          <span>{item.title}</span>
          <time dateTime={item.updatedAt}>{dayOf(item.updatedAt)}, {wibTime(item.updatedAt)}</time>
        </button>
        <button type="button" className="melinda-icon-button" onClick={() => onDelete(item.id)} aria-label={`Hapus percakapan ${item.title}`}><Trash2 className="size-4" aria-hidden="true" /></button>
      </li>)}</ul>}
  </aside>;
}
