// Runs parser.js over a real Myntra picklist. No browser, no extension host.
//   node test/parse.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parsePicklist } from '../parser.js';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

const pdfjs = await import('../lib/pdf.min.mjs');
pdfjs.GlobalWorkerOptions.workerSrc = here('../lib/pdf.worker.min.mjs');

const data = new Uint8Array(readFileSync(here('fixtures/picklist-sample.pdf')));
const doc = await pdfjs.getDocument({ data, useWorkerFetch: false, isEvalSupported: false }).promise;

const items = [];
for (let p = 1; p <= doc.numPages; p += 1) {
  const page = await doc.getPage(p);
  items.push(...(await page.getTextContent()).items);
}

const { rows, warnings } = parsePicklist(items);

const expected = [
  { myntraSku: 'RANHKASS146747214', sellerSku: 'RRC-012-CO-CI-RED-GRN-F-M', qty: 1, size: 'M' },
  { myntraSku: 'RANHKASS141600528', sellerSku: 'RRC-012-CO-A-BLU-S', qty: 1, size: 'S' },
];

assert.equal(rows.length, expected.length, `expected ${expected.length} rows, got ${rows.length}`);

expected.forEach((want, i) => {
  const got = rows[i];
  assert.equal(got.myntraSku, want.myntraSku, `row ${i} myntra SKU`);
  // The seller SKU arrives split across three lines mid-hyphen; gluing it back
  // with a space instead of nothing is the one bug that would ship wrong items.
  assert.equal(got.sellerSku, want.sellerSku, `row ${i} seller SKU`);
  assert.equal(got.qty, want.qty, `row ${i} quantity`);
  assert.equal(got.size, want.size, `row ${i} size`);
  assert.ok(!/\s/.test(got.sellerSku), `row ${i} seller SKU must contain no whitespace`);
  assert.match(got.desc, /Palazzos$/, `row ${i} description should be reassembled in order`);
  assert.equal(got.done, 0, `row ${i} starts unpacked`);
});

assert.ok(!rows.some((r) => /total/i.test(r.myntraSku)), 'the Total Quantity line must not become a row');
assert.deepEqual(warnings, [], `expected no warnings, got: ${warnings.join(' | ')}`);

console.log(`PASS  ${rows.length} rows parsed, no warnings`);
for (const r of rows) console.log(`      ${r.myntraSku}  ${r.sellerSku}  size ${r.size}  x${r.qty}  ${r.desc}`);
