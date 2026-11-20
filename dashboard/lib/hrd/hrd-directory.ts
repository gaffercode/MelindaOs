import type { Official } from "@/lib/hrd/hrd-data";
import { STAFF_UNITS, type Staff } from "@/lib/staff-data";
import { PEOPLE_BUCKET, loadPrivateJson, savePrivateJson, type PrivateJsonSource } from "@/lib/storage/private-json";

/** The staff and officials directory lives in the private bucket `hrd` (supabase/storage/hrd-bucket.sql). */
export const HRD_BUCKET = PEOPLE_BUCKET;
export const HRD_OBJECT = "directory.json";

export type HrdDirectory = {
  officials: Official[];
  staff: Staff[];
  source: PrivateJsonSource;
  /** SHA-256 of the stored document; a save must send it back. */
  version: string;
  updatedAt: string | null;
  updatedBy: string | null;
};
type DirectoryContent = Pick<HrdDirectory, "officials" | "staff" | "updatedAt" | "updatedBy">;

const text = (value: unknown): value is string => typeof value === "string";
const textOrNull = (value: unknown): value is string | null => value === null || typeof value === "string";
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function official(value: unknown): Official | null {
  if (!record(value)) return null;
  const { id, position, name, phone, parent, unit } = value;
  return text(id) && text(position) && text(name) && text(phone) && textOrNull(parent) && text(unit) ? { id, position, name, phone, parent, unit } : null;
}

function staffMember(value: unknown): Staff | null {
  if (!record(value)) return null;
  const { name, title, position, unit } = value;
  return text(name) && text(title) && textOrNull(position) && textOrNull(unit) ? { name, title, position, unit } : null;
}

/** The directory document, or null when any entry has the wrong shape: a partial list is never shown as complete. */
export function parseDirectory(value: unknown): DirectoryContent | null {
  if (!record(value) || !Array.isArray(value.officials) || !Array.isArray(value.staff)) return null;
  const officials = value.officials.map(official);
  const staff = value.staff.map(staffMember);
  if (officials.some((o) => o === null) || staff.some((s) => s === null)) return null;
  return {
    officials: officials as Official[],
    staff: staff as Staff[],
    updatedAt: text(value.updatedAt) ? value.updatedAt : null,
    updatedBy: text(value.updatedBy) ? value.updatedBy : null,
  };
}

type Options = { env?: NodeJS.ProcessEnv; transport?: typeof fetch; dataDir?: string };

/** The staff and officials directory from the private bucket (see lib/storage/private-json.ts for the source order). */
export async function loadHrdDirectory(options: Options = {}): Promise<HrdDirectory | null> {
  const loaded = await loadPrivateJson({ object: HRD_OBJECT, sample: "hrd-directory.json", parse: parseDirectory, ...options });
  return loaded ? { ...loaded.value, source: loaded.source, version: loaded.version } : null;
}

/** A rejected edit; the message is shown to the editor as it is. */
export class HrdValidationError extends Error {}

const LIMITS = { officials: 30, staff: 500, field: 120, title: 80 } as const;
const fail = (message: string): never => { throw new HrdValidationError(message); };

function field(value: unknown, label: string, max: number = LIMITS.field): string {
  if (typeof value !== "string") return fail(`${label} wajib diisi.`);
  const clean = value.replace(/\s+/g, " ").trim();
  if (!clean) return fail(`${label} wajib diisi.`);
  if (clean.length > max) return fail(`${label} terlalu panjang (maksimal ${max} karakter).`);
  return clean;
}

function optionalField(value: unknown, label: string, max: number = LIMITS.field): string | null {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return null;
  return field(value, label, max);
}

/** 0812..., 62812... or +62812... -> +62812...; anything else is rejected. */
export function normalizePhone(value: unknown, label: string): string {
  const raw = typeof value === "string" ? value.replace(/[\s().-]/g, "") : "";
  const digits = raw.startsWith("+") ? raw.slice(1) : raw;
  if (!/^\d+$/.test(digits)) return fail(`Nomor ${label} hanya boleh berisi angka.`);
  const national = digits.startsWith("62") ? digits.slice(2) : digits.startsWith("0") ? digits.slice(1) : digits;
  if (!/^8\d{8,11}$/.test(national)) return fail(`Nomor ${label} bukan nomor HP Indonesia yang valid (contoh 0812 3456 7890).`);
  return `+62${national}`;
}

/** Checks a full directory sent by the editor and returns the clean version that will be stored. */
export function validateDirectoryEdit(input: unknown): Pick<HrdDirectory, "officials" | "staff"> {
  if (!record(input) || !Array.isArray(input.officials) || !Array.isArray(input.staff)) return fail("Format data SDM tidak valid.");
  if (input.officials.length < 1 || input.officials.length > LIMITS.officials) return fail(`Jumlah pejabat harus 1 sampai ${LIMITS.officials}.`);
  if (input.staff.length > LIMITS.staff) return fail(`Jumlah pegawai maksimal ${LIMITS.staff}.`);

  const officials = input.officials.map((row, index): Official => {
    if (!record(row)) return fail(`Baris pejabat ${index + 1} tidak valid.`);
    const position = field(row.position, `Jabatan pada baris pejabat ${index + 1}`);
    const id = typeof row.id === "string" && /^[a-z0-9-]{1,40}$/.test(row.id) ? row.id : fail(`Kode pejabat "${position}" tidak valid.`);
    return {
      id,
      position,
      name: field(row.name, `Nama ${position}`),
      phone: normalizePhone(row.phone, position),
      parent: row.parent === null || row.parent === "" || row.parent === undefined ? null : typeof row.parent === "string" ? row.parent : fail(`Atasan ${position} tidak valid.`),
      unit: field(row.unit, `Unit ${position}`),
    };
  });
  const ids = new Set(officials.map((o) => o.id));
  if (ids.size !== officials.length) fail("Ada dua pejabat dengan kode yang sama.");
  for (const o of officials) {
    if (o.parent === o.id) fail(`${o.position} tidak boleh menjadi atasan dirinya sendiri.`);
    if (o.parent !== null && !ids.has(o.parent)) fail(`Atasan ${o.position} tidak ada di daftar pejabat.`);
  }
  if (officials.filter((o) => o.parent === null).length !== 1) fail("Harus ada tepat satu pejabat puncak (tanpa atasan), yaitu Direktur.");
  const parentOf = new Map(officials.map((o) => [o.id, o.parent]));
  for (const o of officials) {
    const seen = new Set<string>();
    for (let at: string | null = o.id; at !== null; at = parentOf.get(at) ?? null) {
      if (seen.has(at)) fail(`Garis pelaporan ${o.position} berputar kembali ke dirinya sendiri.`);
      seen.add(at);
    }
  }

  const units = new Set<string>(STAFF_UNITS);
  const staff = input.staff.map((row, index): Staff => {
    if (!record(row)) return fail(`Baris pegawai ${index + 1} tidak valid.`);
    const name = field(row.name, `Nama pada baris pegawai ${index + 1}`);
    const unit = optionalField(row.unit, `Unit ${name}`);
    if (unit !== null && !units.has(unit)) fail(`Unit ${name} tidak dikenal.`);
    return { name, title: optionalField(row.title, `Gelar ${name}`, LIMITS.title) ?? "", position: optionalField(row.position, `Jabatan ${name}`), unit };
  });
  const names = new Set<string>();
  for (const s of staff) {
    const key = s.name.toLocaleLowerCase("id-ID");
    if (names.has(key)) fail(`Nama ${s.name} tercatat dua kali. Bedakan dengan nama lengkap.`);
    names.add(key);
  }
  return { officials, staff };
}

const NOTE = "Confidential. RSIA Melinda DHAI staff and officials directory. Source of truth: private Supabase bucket hrd.";

/** Validates and stores an edited directory; the previous version is kept under history/ (lib/storage/private-json.ts). */
export async function saveHrdDirectory(
  input: unknown,
  { expectedVersion, actor, now = () => new Date(), ...options }: Options & { expectedVersion: string; actor: { id: string; displayName: string }; now?: () => Date },
): Promise<{ version: string; updatedAt: string; updatedBy: string }> {
  const clean = validateDirectoryEdit(input);
  const updatedAt = now().toISOString();
  const updatedBy = actor.displayName.slice(0, LIMITS.field);
  const { version } = await savePrivateJson({ schemaVersion: 1, note: NOTE, updatedAt, updatedBy, ...clean }, { object: HRD_OBJECT, expectedVersion, actorId: actor.id, now, ...options });
  return { version, updatedAt, updatedBy };
}
