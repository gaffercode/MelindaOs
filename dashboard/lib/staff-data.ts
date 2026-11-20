/** RSIA Melinda DHAI staff. The list itself lives in the private Supabase bucket `hrd` (lib/hrd/hrd-directory.ts), never in
 * source: names from the October 2026 payroll list (name column only; accounts and pay are not carried), matched to the 2026
 * staff master data for titles, positions and departments. `unit: null` = not yet in the master data. */
export type Staff = { name: string; title: string; position: string | null; unit: string | null };

export const STAFF_UNITS = ["Direksi", "Komite Medik", "Pelayanan", "Penunjang", "Farmasi", "Umum & SDM", "Keuangan"] as const;

/** "dr., Sp.OG, M.Ked.Klin." + "Contoh Nama" -> "dr. Contoh Nama, Sp.OG, M.Ked.Klin." */
export function fullName(s: Staff): string {
  const m = s.title.match(/^(dr\.)(?:,\s*)?(.*)$/);
  const prefix = m ? `${m[1]} ` : "";
  const suffix = (m ? m[2] : s.title).trim();
  return `${prefix}${s.name}${suffix ? `, ${suffix}` : ""}`;
}
