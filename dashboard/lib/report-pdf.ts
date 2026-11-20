/** Slug aman untuk nama berkas PDF yang disarankan browser. */
export function reportPdfFileName(parts: {
  facility: string;
  title: string;
  dateIso?: string;
}): string {
  const raw = [parts.facility, parts.title, parts.dateIso].filter(Boolean).join(" ");
  const slug = raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return `${slug || "laporan-melindaos"}.pdf`;
}

/**
 * Export laporan yang tampil di layar lewat dialog cetak browser (Save as PDF).
 * Desain mengikuti CSS halaman + @media print — tanpa regenerasi layout terpisah.
 */
export function exportReportPdf(options: { fileName: string }): void {
  if (typeof window === "undefined") return;

  const previousTitle = document.title;
  const suggested = options.fileName.replace(/\.pdf$/i, "");
  document.title = suggested;

  const restore = () => {
    document.title = previousTitle;
    window.removeEventListener("afterprint", restore);
  };
  window.addEventListener("afterprint", restore);

  window.print();

  // Cadangan bila afterprint tidak dipanggil di beberapa browser.
  window.setTimeout(restore, 1500);
}
