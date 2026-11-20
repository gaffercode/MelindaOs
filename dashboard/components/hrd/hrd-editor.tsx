"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { directorCsrfHeaders } from "@/lib/client-api";
import type { Official } from "@/lib/hrd/hrd-data";
import { STAFF_UNITS, type Staff } from "@/lib/staff-data";

export type HrdEditorProps = {
  officials: readonly Official[];
  staff: readonly Staff[];
  version: string;
  updatedAt: string | null;
  updatedBy: string | null;
};

type Row<T> = T & { key: string };
type Status = { kind: "idle" | "saving" } | { kind: "error" | "saved"; message: string };

let counter = 0;
const nextKey = () => `row-${Date.now().toString(36)}-${(counter += 1)}`;
const withKeys = <T,>(rows: readonly T[]): Row<T>[] => rows.map((row) => ({ ...row, key: nextKey() }));
function strip<T>(row: Row<T>): T {
  const { key, ...rest } = row;
  void key;
  return rest as unknown as T;
}

/** "2026-11-20T05:00:00.000Z" -> "20 November 2026, 12.00 WIB" */
export function formatUpdatedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date)} WIB`;
}

async function errorMessage(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") return body.error;
  return response.status === 401 ? "Sesi berakhir. Silakan masuk lagi." : "Data belum tersimpan. Coba lagi.";
}

/** Inline editor for the officials and staff directory (permission `hrd.edit`). Saves the whole list in one request. */
export function HrdEditor({ officials, staff, version, updatedAt, updatedBy }: HrdEditorProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState(() => withKeys(officials));
  const [members, setMembers] = useState(() => withKeys(staff));
  const [filter, setFilter] = useState("");
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const reset = () => {
    setPeople(withKeys(officials));
    setMembers(withKeys(staff));
    setFilter("");
    setDirty(false);
  };
  const start = () => { reset(); setStatus({ kind: "idle" }); setOpen(true); };
  const cancel = () => {
    if (dirty && !window.confirm("Batalkan semua perubahan yang belum disimpan?")) return;
    reset();
    setStatus({ kind: "idle" });
    setOpen(false);
  };

  const editOfficial = (key: string, patch: Partial<Official>) => {
    setPeople((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
    setDirty(true);
  };
  const editStaff = (key: string, patch: Partial<Staff>) => {
    setMembers((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
    setDirty(true);
  };
  const addOfficial = () => {
    const root = people.find((row) => row.parent === null);
    setPeople((rows) => [...rows, { key: nextKey(), id: `pejabat-${Date.now().toString(36)}`, position: "", name: "", phone: "", parent: root?.id ?? null, unit: "" }]);
    setDirty(true);
  };
  const addStaff = () => {
    setFilter("");
    setMembers((rows) => [...rows, { key: nextKey(), name: "", title: "", position: null, unit: null }]);
    setDirty(true);
  };
  const removeOfficial = (row: Row<Official>) => {
    if (!window.confirm(`Hapus ${row.position || "pejabat ini"} dari daftar?`)) return;
    setPeople((rows) => rows.filter((item) => item.key !== row.key));
    setDirty(true);
  };
  const removeStaff = (row: Row<Staff>) => {
    if (!window.confirm(`Hapus ${row.name || "pegawai ini"} dari daftar?`)) return;
    setMembers((rows) => rows.filter((item) => item.key !== row.key));
    setDirty(true);
  };

  const shownStaff = useMemo(() => {
    const terms = filter.trim().toLocaleLowerCase("id-ID").split(/\s+/).filter(Boolean);
    if (terms.length === 0) return members;
    return members.filter((row) => {
      const text = [row.name, row.title, row.position ?? "", row.unit ?? ""].join(" ").toLocaleLowerCase("id-ID");
      return terms.every((term) => text.includes(term));
    });
  }, [filter, members]);

  const save = async () => {
    setStatus({ kind: "saving" });
    try {
      const response = await fetch("/api/hrd/directory", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...(await directorCsrfHeaders()) },
        body: JSON.stringify({ version, officials: people.map(strip), staff: members.map(strip) }),
      });
      if (!response.ok) {
        setStatus({ kind: "error", message: await errorMessage(response) });
        return;
      }
      setDirty(false);
      setOpen(false);
      setStatus({ kind: "saved", message: "Perubahan tersimpan." });
      router.refresh();
    } catch {
      setStatus({ kind: "error", message: "Koneksi terputus. Data belum tersimpan." });
    }
  };

  const saving = status.kind === "saving";
  const lastChange = updatedAt ? `Terakhir diubah ${formatUpdatedAt(updatedAt)}${updatedBy ? ` oleh ${updatedBy}` : ""}.` : "Belum pernah diubah dari halaman ini.";

  if (!open) {
    return (
      <div className="hrd-edit-bar">
        <p>{lastChange}</p>
        {status.kind === "saved" && <p className="hrd-edit-ok" role="status">{status.message}</p>}
        <button type="button" className="hrd-edit-primary" onClick={start}>
          <Pencil className="size-4" aria-hidden="true" />
          <span>Ubah data SDM</span>
        </button>
      </div>
    );
  }

  return (
    <section className="swiss-section hrd-editor" aria-labelledby="hrd-ubah">
      <div className="hrd-editor-head">
        <h2 id="hrd-ubah">Ubah data SDM</h2>
        <p>Perubahan baru berlaku setelah Anda menekan Simpan. Versi sebelumnya tetap disimpan sebagai cadangan.</p>
      </div>

      <h3 className="staff-group-title">Pejabat struktural <small>{people.length} orang</small></h3>
      <div className="swiss-table-wrap">
        <table className="swiss-table hrd-edit-table">
          <thead>
            <tr>
              <th scope="col" className="text-left">Jabatan</th>
              <th scope="col" className="text-left">Nama</th>
              <th scope="col" className="text-left">Unit</th>
              <th scope="col" className="text-left">Nomor HP</th>
              <th scope="col" className="text-left">Atasan</th>
              <th scope="col" className="text-left"><span className="sr-only">Hapus</span></th>
            </tr>
          </thead>
          <tbody>
            {people.map((row, index) => {
              const label = row.position || `pejabat baris ${index + 1}`;
              const hasReports = people.some((other) => other.parent === row.id);
              return (
                <tr key={row.key}>
                  <td><input aria-label={`Jabatan ${label}`} value={row.position} onChange={(e) => editOfficial(row.key, { position: e.target.value })} /></td>
                  <td><input aria-label={`Nama ${label}`} value={row.name} onChange={(e) => editOfficial(row.key, { name: e.target.value })} /></td>
                  <td><input aria-label={`Unit ${label}`} value={row.unit} onChange={(e) => editOfficial(row.key, { unit: e.target.value })} /></td>
                  <td><input aria-label={`Nomor HP ${label}`} inputMode="tel" placeholder="0812 3456 7890" value={row.phone} onChange={(e) => editOfficial(row.key, { phone: e.target.value })} /></td>
                  <td>
                    <select aria-label={`Atasan ${label}`} value={row.parent ?? ""} onChange={(e) => editOfficial(row.key, { parent: e.target.value || null })}>
                      <option value="">Tidak ada (pimpinan puncak)</option>
                      {people.filter((other) => other.key !== row.key).map((other) => <option key={other.key} value={other.id}>{other.position || "(jabatan belum diisi)"}</option>)}
                    </select>
                  </td>
                  <td>
                    <button type="button" className="hrd-icon-button" onClick={() => removeOfficial(row)} disabled={hasReports} aria-label={`Hapus ${label}`} title={hasReports ? "Pindahkan dulu bawahannya ke atasan lain" : `Hapus ${label}`}>
                      <Trash2 className="size-4" aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button type="button" className="hrd-edit-secondary" onClick={addOfficial}><Plus className="size-4" aria-hidden="true" /><span>Tambah pejabat</span></button>

      <h3 className="staff-group-title">Pegawai <small>{members.length} orang</small></h3>
      <div className="hrd-filters">
        <label>
          Cari di daftar pegawai
          <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Nama, jabatan, atau unit" />
        </label>
      </div>
      {shownStaff.length === 0 && <p>Tidak ada pegawai yang cocok dengan pencarian.</p>}
      {shownStaff.length > 0 && (
        <div className="swiss-table-wrap">
          <table className="swiss-table hrd-edit-table">
            <thead>
              <tr>
                <th scope="col" className="text-left">Nama</th>
                <th scope="col" className="text-left">Gelar</th>
                <th scope="col" className="text-left">Jabatan</th>
                <th scope="col" className="text-left">Unit kerja</th>
                <th scope="col" className="text-left"><span className="sr-only">Hapus</span></th>
              </tr>
            </thead>
            <tbody>
              {shownStaff.map((row, index) => {
                const label = row.name || `pegawai baris ${index + 1}`;
                return (
                  <tr key={row.key}>
                    <td><input aria-label={`Nama ${label}`} value={row.name} onChange={(e) => editStaff(row.key, { name: e.target.value })} /></td>
                    <td><input aria-label={`Gelar ${label}`} value={row.title} onChange={(e) => editStaff(row.key, { title: e.target.value })} /></td>
                    <td><input aria-label={`Jabatan ${label}`} value={row.position ?? ""} onChange={(e) => editStaff(row.key, { position: e.target.value || null })} /></td>
                    <td>
                      <select aria-label={`Unit kerja ${label}`} value={row.unit ?? ""} onChange={(e) => editStaff(row.key, { unit: e.target.value || null })}>
                        <option value="">Perlu verifikasi</option>
                        {STAFF_UNITS.map((unit) => <option key={unit}>{unit}</option>)}
                      </select>
                    </td>
                    <td>
                      <button type="button" className="hrd-icon-button" onClick={() => removeStaff(row)} aria-label={`Hapus ${label}`} title={`Hapus ${label}`}>
                        <Trash2 className="size-4" aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <button type="button" className="hrd-edit-secondary" onClick={addStaff}><Plus className="size-4" aria-hidden="true" /><span>Tambah pegawai</span></button>

      <div className="hrd-edit-actions">
        {status.kind === "error" && <p className="hrd-edit-error" role="alert">{status.message}</p>}
        <button type="button" className="hrd-edit-primary" onClick={save} disabled={saving || !dirty}>{saving ? "Menyimpan…" : "Simpan perubahan"}</button>
        <button type="button" className="hrd-edit-secondary" onClick={cancel} disabled={saving}>Batal</button>
      </div>
    </section>
  );
}
