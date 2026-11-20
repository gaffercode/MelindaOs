export type PdfTextCell = { x: number; text: string };
export type PdfTextRow = { page: number; y: number; cells: PdfTextCell[] };

const ROW_TOLERANCE = 5;

/** Positioned text rows of a PDF with a text layer (not OCR): cells left to right, rows top to bottom per page.
 * Cells whose baselines differ by at most 5 points are one row, which rejoins spreadsheet exports that
 * print a label and its figures on slightly different baselines. A scanned PDF yields no rows. */
export async function extractPdfTextRows(bytes: Uint8Array): Promise<PdfTextRow[]> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // pdfjs takes ownership of the buffer it is given (it may transfer or detach it), so it gets its own copy.
  const task = getDocument({ data: bytes.slice(), disableFontFace: true, useSystemFonts: false });
  const document = await task.promise;
  const rows: PdfTextRow[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const items = content.items
        .flatMap((item) => ("str" in item && item.str.trim() ? [{ x: item.transform[4], y: item.transform[5], text: item.str.trim() }] : []))
        .sort((a, b) => b.y - a.y || a.x - b.x);
      let current: PdfTextRow | null = null;
      for (const item of items) {
        if (!current || Math.abs(current.y - item.y) > ROW_TOLERANCE) {
          current = { page: pageNumber, y: item.y, cells: [] };
          rows.push(current);
        }
        current.cells.push({ x: item.x, text: item.text });
      }
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  for (const row of rows) row.cells.sort((a, b) => a.x - b.x);
  return rows;
}
