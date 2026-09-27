// Page-count independence. A real picklist can run to any number of pages, so
// this builds synthetic ones at the real coordinates and checks 1 through 20 —
// with and without the header repeated, and with a page footer that must never
// be mistaken for row content.
//   node test/manypages.test.mjs
import assert from 'node:assert/strict';
import { parsePicklist, expandUnits } from '../parser.js';

const X = { msku: 44.2, ssku: 173.3, desc: 255.7, qty: 459.0, exp: 520.2, total: 526.9 };
const PITCH = 78.4;
const cell = (str, x, y, page) => ({ str, transform: [1, 0, 0, 1, x, y], page });

function header(items, page, y) {
  items.push(cell('Myntra Sku Code', X.msku, y, page));
  items.push(cell('Seller Sku ', X.ssku, y + 7.2, page));
  items.push(cell('Code', X.ssku, y - 7.1, page));
  items.push(cell('Product Description', X.desc, y, page));
  items.push(cell('Quantity', 417.0, y, page));
  items.push(cell('Expiry', 503.6, y + 7.2, page));
}

// perPage rows on each sheet, laid out the way Myntra lays them out.
function build({ pages, perPage, repeatHeader = false, footer = false, qtyOf = () => 1 }) {
  const items = [];
  const expected = [];
  let n = 0;

  for (let p = 1; p <= pages; p += 1) {
    let y;
    if (p === 1) {
      header(items, 1, 645.9);
      y = 581.2;
    } else if (repeatHeader) {
      header(items, p, 800.0);
      y = 735.0;
    } else {
      y = 764.0;
    }

    for (let i = 0; i < perPage; i += 1, n += 1) {
      const myntraSku = `RANHKTEST${String(n).padStart(6, '0')}`;
      const qty = qtyOf(n);
      items.push(cell(myntraSku, X.msku, y, p));
      items.push(cell('RRC-012-CO-', X.ssku, y + 6.9, p));
      items.push(cell(`T${n}-M`, X.ssku, y - 6.9, p));
      items.push(cell('Rangrooh Women ', X.desc, y + 13.9, p));
      items.push(cell('Pure Cotton Kurta', X.desc, y, p));
      items.push(cell(String(qty), X.qty, y, p));
      items.push(cell('N/A', X.exp, y, p));
      expected.push({ myntraSku, sellerSku: `RRC-012-CO-T${n}-M`, qty });
      y -= PITCH;
    }

    // A page number at the foot of the sheet. The last row on the page must not
    // reach down across the page break and swallow it.
    if (footer) items.push(cell(`Page ${p} of ${pages}`, X.msku, 30.0, p));
  }

  const totalQty = expected.reduce((s, r) => s + r.qty, 0);
  items.push(cell('Total Quantity', X.msku, 60.0, pages));
  items.push(cell(String(totalQty), X.total, 58.5, pages));
  return { items, expected, totalQty };
}

function check(label, opts) {
  const { items, expected, totalQty } = build(opts);
  const { rows, warnings } = parsePicklist(items);

  assert.equal(rows.length, expected.length, `${label}: expected ${expected.length} rows, got ${rows.length}`);
  expected.forEach((want, i) => {
    assert.equal(rows[i].myntraSku, want.myntraSku, `${label}: row ${i} out of order or misread`);
    assert.equal(rows[i].sellerSku, want.sellerSku, `${label}: row ${i} seller SKU`);
    assert.equal(rows[i].qty, want.qty, `${label}: row ${i} quantity`);
    assert.equal(rows[i].size, 'M', `${label}: row ${i} size`);
    assert.ok(!/Page \d+ of/.test(rows[i].desc), `${label}: row ${i} swallowed the page footer`);
    assert.ok(!/Sku Code|Quantity|Expiry/.test(rows[i].desc), `${label}: row ${i} swallowed a header label`);
  });
  assert.deepEqual(warnings, [], `${label}: unexpected warnings: ${warnings.join(' | ')}`);
  assert.equal(rows.reduce((s, r) => s + r.qty, 0), totalQty, `${label}: quantities must match the stated total`);
  assert.equal(expandUnits(rows).length, totalQty, `${label}: expands to one row per unit`);
}

for (const pages of [1, 2, 3, 4, 5, 10, 20]) {
  check(`${pages} page(s), plain`, { pages, perPage: 6 });
}
console.log('PASS  1, 2, 3, 4, 5, 10 and 20 pages all read correctly');

for (const pages of [2, 5, 10]) {
  check(`${pages} pages, header repeated`, { pages, perPage: 6, repeatHeader: true });
}
console.log('PASS  a header repeated on every page is ignored, not read as a row');

for (const pages of [2, 5, 10]) {
  check(`${pages} pages, footer`, { pages, perPage: 6, footer: true });
}
console.log('PASS  a page footer is never swallowed by the last row on the page');

for (const pages of [3, 10]) {
  check(`${pages} pages, mixed quantities`, {
    pages, perPage: 6, repeatHeader: true, footer: true, qtyOf: (n) => (n % 4) + 1,
  });
}
console.log('PASS  repeated headers + footers + mixed quantities together');

// One row per page is the awkward shape: every gap is a page-break gap.
check('10 pages, one row each', { pages: 10, perPage: 1, footer: true });
console.log('PASS  10 pages with a single row each still reads all 10');
