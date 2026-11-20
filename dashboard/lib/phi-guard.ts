export type PatientIdentifier = "nik" | "rekam_medis" | "nama_pasien" | "tanggal_lahir";

// Best-effort heuristic: names without an honorific (e.g. "pasien Budi Santoso") are not detected.
const patterns: readonly [PatientIdentifier, readonly RegExp[]][] = [
  ["nik", [/(?<!\d)\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}(?!\d)/]],
  ["rekam_medis", [/\b(?:no\.?\s*(?:rm|mr)|nomor\s*(?:rm|mr)|rm|mrn|mr|rekam\s*medis)\s*[:.\-#]?\s*\d[\d.\- ]{3,}/i]],
  ["nama_pasien", [/\b(?:Ny|Tn|An|By)\.?\s+[A-Z]/, /\b(?:ny|tn|an|by)\.\s*[a-z]/i]],
  ["tanggal_lahir", [
    /\b(?:lahir|ttl)\b[^\d\n]{0,20}\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}/i,
    /\b(?:lahir|ttl)\b[^\d\n]{0,20}\d{1,2}\s+(?:jan|feb|mar|apr|mei|jun|jul|agu|agt|sep|okt|nov|des)[a-z]*\.?\s+\d{2,4}/i,
    /\b(?:lahir|ttl)\b[^\d\n]{0,20}\d{4}-\d{2}-\d{2}/i,
  ]],
];

export const identifierLabels: Record<PatientIdentifier, string> = { nik: "NIK", rekam_medis: "nomor RM", nama_pasien: "nama pasien", tanggal_lahir: "tanggal lahir" };

export function findPatientIdentifiers(text: string): PatientIdentifier[] {
  return patterns.filter(([, regexes]) => regexes.some((pattern) => pattern.test(text))).map(([name]) => name);
}
