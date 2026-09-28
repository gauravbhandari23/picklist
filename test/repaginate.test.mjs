// Re-paging Myntra's real documents onto a standard sheet.
// Myntra serves the label at 4x6in and the invoice at A4; the printing
// workflow here expects letter-sized pages.
//   node test/repaginate.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { repaginate, fitOnSheet, SHEETS } from '../repaginate.js';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const pdfjs = await import('../lib/pdf.min.mjs');
pdfjs.GlobalWorkerOptions.workerSrc = here('../lib/pdf.worker.min.mjs');

async function describe(bytes) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useWorkerFetch: false, isEvalSupported: false }).promise;
  const page = await doc.getPage(1);
  const v = page.getViewport({ scale: 1 });
  const text = (await page.getTextContent()).items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
  return { pages: doc.numPages, w: +(v.width / 72).toFixed(2), h: +(v.height / 72).toFixed(2), text };
}

/* 1. The real 4x6 shipping label onto Letter */
{
  const src = readFileSync(here('fixtures/label-4x6.pdf'));
  const before = await describe(src);
  assert.deepEqual([before.w, before.h], [4, 6], 'fixture should be the 4x6 label');

  const after = await describe(await repaginate(new Uint8Array(src), 'letter'));
  assert.deepEqual([after.w, after.h], [8.5, 11], 'must come out Letter sized');
  assert.equal(after.pages, before.pages, 'page count unchanged');
  assert.ok(after.text.includes('flipkartlogistics'), 'the label content must survive');
  assert.ok(after.text.length > 40, 'and keep a real text layer, unlike a re-print');
  console.log(`PASS  4x6 label -> Letter, text kept (${after.text.slice(0, 40)}…)`);
}

/* 2. The real A4 invoice onto Letter */
{
  const src = readFileSync(here('fixtures/invoice-a4.pdf'));
  const before = await describe(src);
  assert.deepEqual([before.w, before.h], [8.27, 11.69], 'fixture should be the A4 invoice');

  const after = await describe(await repaginate(new Uint8Array(src), 'letter'));
  assert.deepEqual([after.w, after.h], [8.5, 11], 'must come out Letter sized');
  assert.ok(after.text.includes('Tax Invoice'), 'the invoice content must survive');
  console.log('PASS  A4 invoice -> Letter, text kept');
}

/* 3. A4 is offered too, and 'original' means untouched */
{
  const src = new Uint8Array(readFileSync(here('fixtures/label-4x6.pdf')));
  const a4 = await describe(await repaginate(src, 'a4'));
  assert.deepEqual([a4.w, a4.h], [8.27, 11.69], 'A4 option must give A4');

  const untouched = await repaginate(src, 'original');
  assert.equal(untouched, src, 'original must hand back the very same bytes');
  console.log('PASS  A4 option works, and "original" returns the bytes untouched');
}

/* 4. Fitting keeps the aspect ratio and centres — a stretched label is unusable */
{
  const sheet = SHEETS.letter;
  const fit = fitOnSheet({ width: 288, height: 432 }, sheet); // 4x6in in points
  assert.ok(Math.abs(fit.width / fit.height - 288 / 432) < 1e-9, 'aspect ratio must be preserved');
  assert.ok(fit.width <= sheet.width + 1e-9 && fit.height <= sheet.height + 1e-9, 'must fit inside the sheet');
  assert.ok(Math.abs((sheet.width - fit.width) / 2 - fit.x) < 1e-9, 'centred horizontally');
  assert.ok(Math.abs((sheet.height - fit.height) / 2 - fit.y) < 1e-9, 'centred vertically');
  // A 4x6 label is taller in proportion than Letter, so height is the limit.
  assert.ok(Math.abs(fit.height - sheet.height) < 1e-9, 'the long edge should fill the sheet');
  console.log('PASS  content is scaled to fit and centred, never stretched');
}

/* A rotated page is saved exactly as sent, never turned by re-paging */
{
  const { PDFDocument, degrees } = await import('../lib/pdf-lib.esm.min.js');
  const doc = await PDFDocument.load(readFileSync(here('fixtures/label-4x6.pdf')));
  doc.getPage(0).setRotation(degrees(90));
  const rotated = await doc.save();
  const out = await repaginate(rotated, 'letter');
  assert.equal(out, rotated, 'handed back untouched');
  console.log('PASS  a rotated page is left exactly as Myntra sent it');
}

/* A sheet whose origin isn't 0,0 is saved as sent (pdf-lib would shift and clip it) */
{
  const { PDFDocument } = await import('../lib/pdf-lib.esm.min.js');
  const doc = await PDFDocument.load(readFileSync(here('fixtures/label-4x6.pdf')));
  const p = doc.getPage(0);
  p.setMediaBox(100, 100, 288, 432);
  p.setCropBox(100, 100, 288, 432);
  const moved = await doc.save();
  assert.equal(await repaginate(moved, 'letter'), moved, 'handed back untouched');
  console.log('PASS  a sheet not starting at 0,0 is left exactly as sent');
}

/* A page showing only part of its sheet (CropBox smaller than MediaBox) is saved as sent */
{
  const { PDFDocument } = await import('../lib/pdf-lib.esm.min.js');
  const doc = await PDFDocument.load(readFileSync(here('fixtures/label-4x6.pdf')));
  doc.getPage(0).setCropBox(10, 10, 200, 300);
  const cropped = await doc.save();
  assert.equal(await repaginate(cropped, 'letter'), cropped, 'handed back untouched');
  console.log('PASS  a CropBox page is left exactly as sent');
}
