/** Indonesian function words dropped from both indexed text and questions. */
export const STOPWORDS_ID = new Set([
  "dan", "yang", "di", "ke", "dari", "untuk", "pada", "dengan", "adalah", "ini", "itu", "atau",
  "apa", "bagaimana", "berapa", "siapa", "kapan",
  // Question filler: without these, long staff questions match too few content words to pass the gate.
  "apakah", "bagaimanakah", "gimana", "cara", "saya", "kami", "kita", "bisa", "boleh", "harus", "tolong", "mohon",
  "jelaskan", "dijelaskan", "kalau", "jika", "bila", "ada", "saja", "sekarang", "saat", "sudah", "akan", "juga",
  "menurut", "tentang", "dalam", "seperti", "info", "dong", "ya", "nya",
]);
