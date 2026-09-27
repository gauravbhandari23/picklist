// A picklist that spills onto a second page. Each PDF page restarts its
// coordinates at the top, so page 2's y values sit ABOVE page 1's — merging the
// pages naively made every row read as empty.
//   node test/multipage.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parsePicklist, expandUnits } from '../parser.js';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const pdfjs = await import('../lib/pdf.min.mjs');
pdfjs.GlobalWorkerOptions.workerSrc = here('../lib/pdf.worker.min.mjs');

const data = new Uint8Array(readFileSync(here('fixtures/picklist-2page.pdf')));
const doc = await pdfjs.getDocument({ data, useWorkerFetch: false, isEvalSupported: false }).promise;
assert.equal(doc.numPages, 2, 'fixture should be the two-page picklist');

const items = [];
for (let p = 1; p <= doc.numPages; p += 1) {
  const page = await doc.getPage(p);
  items.push(...(await page.getTextContent()).items.map((it) => ({ ...it, page: p })));
}

const { rows, warnings } = parsePicklist(items);

const expected = [
  ['RANHKASS145707777', 'RRC-012-CO-HI-GRN-M', 1, 'M'],
  ['RANHKRTI142525957', 'R-007-CO-C-RED-S', 1, 'S'],
  ['RANHKRTI139559194', 'RR-002-CO-C-RED-S', 2, 'S'],
  ['RANHKASS141600528', 'RRC-012-CO-A-BLU-S', 1, 'S'],
  ['RANHKASS145707776', 'RRC-012-CO-HI-GRN-S', 1, 'S'],
  ['RANHKRTI139559193', 'RR-002-CO-C-RED-M', 1, 'M'],
  ['RANHKASS141600537', 'RRC-012-CO-C-RED-S', 1, 'S'],
  ['RANHKASS146747214', 'RRC-012-CO-CI-RED-GRN-F-M', 1, 'M'],
  ['RANHKRTI139559236', 'RR-002-CO-B-BL-S', 1, 'S'], // this one is on page 2
];

assert.equal(rows.length, expected.length, `expected ${expected.length} rows, got ${rows.length}`);

expected.forEach(([myntraSku, sellerSku, qty, size], i) => {
  assert.equal(rows[i].myntraSku, myntraSku, `row ${i} myntra SKU — page order must be kept`);
  assert.equal(rows[i].sellerSku, sellerSku, `row ${i} seller SKU`);
  assert.equal(rows[i].qty, qty, `row ${i} quantity`);
  assert.equal(rows[i].size, size, `row ${i} size`);
  assert.ok(!/\s/.test(rows[i].sellerSku), `row ${i} seller SKU must have no whitespace`);
  assert.ok(rows[i].desc.length > 10, `row ${i} description should be reassembled`);
});

assert.deepEqual(warnings, [], `expected no warnings, got: ${warnings.join(' | ')}`);
console.log(`PASS  two-page picklist -> ${rows.length} rows, page 2's item last, no warnings`);

// The PDF states 10; eight lines of 1 plus one line of 2.
assert.equal(rows.reduce((n, r) => n + r.qty, 0), 10, 'units must add up to the stated total');
assert.equal(expandUnits(rows).length, 10, 'expands to 10 clickable rows');
console.log('PASS  quantities total 10, matching the PDF, and expand to 10 rows');

// Brand prefixes R- / RR- / RRC- must all survive intact.
assert.deepEqual(
  [...new Set(rows.map((r) => r.sellerSku.split('-')[0]))].sort(),
  ['R', 'RR', 'RRC'],
  'all three brand prefixes should be read as-is',
);
console.log('PASS  R- / RR- / RRC- prefixes all preserved');
