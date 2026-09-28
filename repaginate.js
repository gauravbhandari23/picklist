// Puts Myntra's documents onto a standard sheet.
//
// Myntra serves the shipping label at 4x6 inches and the invoice at A4. Saving
// those as-is is arguably better — they are the originals — but the printing
// workflow here expects letter-sized pages, because the old route re-printed
// everything through Microsoft Print to PDF onto whatever the Windows default
// paper was. Re-paging keeps that habit intact while staying a fraction of the
// size and, unlike a re-print, keeping the text layer.

import { PDFDocument } from './lib/pdf-lib.esm.min.js';

export const SHEETS = {
  original: null,
  letter: { width: 612, height: 792, label: 'Letter 8.5 x 11 in' },
  a4: { width: 595.28, height: 841.89, label: 'A4 210 x 297 mm' },
};

/** Scale to fit while keeping the aspect ratio, then centre. */
export function fitOnSheet(page, sheet) {
  const scale = Math.min(sheet.width / page.width, sheet.height / page.height);
  const width = page.width * scale;
  const height = page.height * scale;
  return { width, height, x: (sheet.width - width) / 2, y: (sheet.height - height) / 2 };
}

/**
 * @param {Uint8Array} bytes a PDF
 * @param {keyof SHEETS} size
 * @returns {Promise<Uint8Array>} the same document on the requested sheet
 */
export async function repaginate(bytes, size) {
  const sheet = SHEETS[size];
  if (!sheet) return bytes; // 'original' — hand back exactly what Myntra sent

  const source = await PDFDocument.load(bytes);
  // A rotated page, one showing only part of its sheet (CropBox), or one whose
  // sheet doesn't start at 0,0 would come out turned, shifted or clipped — such
  // a document is saved exactly as Myntra sent it. (Myntra's label and invoice
  // have none of these.)
  const unusual = source.getPages().some((p) => {
    const m = p.getMediaBox();
    const c = p.getCropBox();
    return (
      p.getRotation().angle % 360 !== 0 ||
      // pdf-lib embeds a page as the box [0 0 w h], so a sheet whose origin
      // isn't 0,0 would come out shifted and clipped.
      Math.abs(m.x) > 0.5 ||
      Math.abs(m.y) > 0.5 ||
      Math.abs(m.x - c.x) > 0.5 ||
      Math.abs(m.y - c.y) > 0.5 ||
      Math.abs(m.width - c.width) > 0.5 ||
      Math.abs(m.height - c.height) > 0.5
    );
  });
  if (unusual) return bytes;
  const out = await PDFDocument.create();
  const pages = await out.embedPdf(source, source.getPageIndices());

  for (const page of pages) {
    const target = out.addPage([sheet.width, sheet.height]);
    target.drawPage(page, fitOnSheet(page, sheet));
  }
  return out.save();
}
