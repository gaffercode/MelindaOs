/** Leadership structure of RSIA Melinda DHAI. The names and phone numbers live in the private Supabase bucket `hrd`
 * (lib/hrd/hrd-directory.ts), never in source. `parent` is an assumed reporting line (Wadir to Direktur, Kabag/Kepala to
 * the Wadir over their area) that still needs the Director's confirmation. */
export type Official = { id: string; position: string; name: string; phone: string; parent: string | null; unit: string };

export function childrenOf(officials: readonly Official[], id: string | null): Official[] {
  return officials.filter((o) => o.parent === id);
}

/** wa.me wants digits only. */
export function whatsappHref(phone: string): string {
  return `https://wa.me/${phone.replace(/\D/g, "")}`;
}

/** +6281200000001 -> +62 812-0000-0001 */
export function formatPhone(phone: string): string {
  const d = phone.replace(/\D/g, "").replace(/^62/, "");
  return `+62 ${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
}
