/**
 * Sentence case for publisher text (Director decision 2026-11-08: no all-caps text on the dashboard).
 * Every capitals-only word is rewritten; acronyms, letter-digit codes, agent roster
 * codes and proper nouns keep their form. Keys that are compared or linked elsewhere are never touched.
 */
const ACRONYMS = new Set([
  "RS", "RSIA", "DHAI", "BPJS", "JKN", "FKRTL", "KC", "IGD", "UGD", "ICU", "NICU", "PICU", "HCU", "VK", "OK", "SDM", "SIMRS", "RME",
  "WIB", "KP", "PMKP", "INM", "IKP", "SIP", "STR", "SOP", "SPO", "SK", "PKS", "PO", "BOR", "LOS", "ALOS", "TOI", "BTO", "TTD", "PIC",
  "DPJP", "PPA", "KIA", "KB", "ANC", "PONEK", "USG", "CT", "MRI", "EKG", "CMDC", "HTTP", "API", "PDF", "AI", "ID", "KMK", "IHS",
  "ENS", "BSP", "DN", "PPN", "SPM", "STARKES", "KARS", "INA", "CBG", "CBGS", "HAFIS", "WA", "KATT", "AEGIS", "CREDO", "OVH", "MEM",
  "GRAV", "DIR", "FIN", "OPS", "SYS", "FHIR", "ICD", "BHP", "IOC", "ISI", "MB", "GDR", "NDR", "KRS", "HFIS", "SSOT", "HIV", "AIDS", "ASI", "TB", "IUD", "PK", "PA", "THT", "AURE", "MERIDIAN", "RAVEN", "DUSK", "CAROLINA", "PROMO", "VERCEL", "GITHUB",
]);
const PROPER = new Map([
  ["MELINDA", "Melinda"], ["MEDIFY", "Medify"], ["KEDIRI", "Kediri"], ["ADMEDIKA", "AdMedika"], ["GROKBOT", "GrokBot"], ["SATUSEHAT", "SatuSehat"],
  ["DIREKTUR", "Direktur"], ["SENIN", "Senin"], ["SELASA", "Selasa"], ["RABU", "Rabu"], ["KAMIS", "Kamis"], ["JUMAT", "Jumat"],
  ["SABTU", "Sabtu"], ["MINGGU", "Minggu"], ["JAN", "Jan"], ["FEB", "Feb"], ["MAR", "Mar"], ["APR", "Apr"], ["MEI", "Mei"],
  ["JUN", "Jun"], ["JUL", "Jul"], ["AGU", "Agu"], ["AGS", "Ags"], ["SEP", "Sep"], ["OKT", "Okt"], ["NOV", "Nov"], ["DES", "Des"],
  ["JANUARI", "Januari"], ["FEBRUARI", "Februari"], ["MARET", "Maret"], ["APRIL", "April"], ["JUNI", "Juni"], ["JULI", "Juli"],
  ["AGUSTUS", "Agustus"], ["SEPTEMBER", "September"], ["OKTOBER", "Oktober"], ["NOVEMBER", "November"], ["DESEMBER", "Desember"],
]);

/** Units glued to a number in drug names ("500ML"): lowercased, nothing else with digits is touched. */
const FUSED_UNIT = /^(\d+)(ML|MG|MCG|GR|IU|CC|KG|CM|MM|L|G)$/;
/** Short letter-plus-digit codes (K10, D10, BP9, GDP002) and Roman numerals (VII) are identifiers, not words. */
const CODE = /^\p{Lu}{1,3}\d+$|^[IVX]+$/u;
const capitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/** The converted form of one capitals-only token, or null when it must stay as written. */
function convertToken(token: string, text: string, offset: number, sentence: boolean, first: boolean): string | null {
  if (/\p{Ll}/u.test(token) || [...token].length < 2 || ACRONYMS.has(token) || CODE.test(token)) return null;
  const fused = FUSED_UNIT.exec(token);
  if (fused) return `${fused[1]}${fused[2].toLowerCase()}`;
  if (/\p{N}/u.test(token)) return null;
  // Degree and specialty suffixes written after a dot (Sp.OG, Sp.PD, M.Kn) keep their letters.
  if (offset > 0 && text[offset - 1] === "." && token.length <= 3) return null;
  const word = PROPER.get(token) ?? token.toLowerCase();
  // A phrase in capitals becomes a sentence; capitals inside mixed text (names, codes, status words) become Capitalized.
  return sentence ? (first ? capitalize(word) : word) : capitalize(word);
}

/** Director decision 2026-11-08, reinforced the same day: no word is ever shown in all capitals, except the listed acronyms and codes. */
export function displayCase(text: string): string {
  const sentence = !/\p{Ll}/u.test(text);
  let first = true;
  return text.replace(/[\p{L}\p{N}]+/gu, (token, offset: number) => {
    const isFirst = first;
    first = false;
    return convertToken(token, text, offset, sentence, isFirst) ?? token;
  });
}

const KEEP = new Set(["dateIso", "nomorVersi", "kode", "kategori", "statusBadge", "sourceId", "contentHash", "availability", "systemUrl", "instructionId", "periodDate", "observedAt", "receivedAt"]);

/** Deep copy of publisher data with every all-caps phrase in sentence case, except identifier keys. */
export function displayCaseDeep<T>(value: T, key?: string): T {
  if (key && KEEP.has(key)) return value;
  if (typeof value === "string") return displayCase(value) as T;
  if (Array.isArray(value)) return value.map((item) => displayCaseDeep(item)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entry]) => [entryKey, displayCaseDeep(entry, entryKey)])) as T;
  }
  return value;
}
