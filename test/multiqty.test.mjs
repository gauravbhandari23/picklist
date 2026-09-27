// Multi-quantity and duplicate-SKU handling, driven by synthetic text items laid
// out at the same coordinates the real Myntra picklist uses.
//   node test/multiqty.test.mjs
import assert from 'node:assert/strict';
import { parsePicklist } from '../parser.js';

const X = { msku: 44.2, ssku: 173.3, desc: 255.7, qty: 459.0, exp: 520.2, total: 533.6 };
const cell = (str, x, y) => ({ str, transform: [1, 0, 0, 1, x, y] });

const HEADER = [
  cell('Myntra Sku Code', X.msku, 645.9),
  cell('Seller Sku ', X.ssku, 653.1),
  cell('Code', X.ssku, 638.8),
  cell('Product Description', X.desc, 645.9),
  cell('Quantity', 417.0, 645.9),
  cell('Expiry', 503.6, 653.1),
];

// Builds a picklist the way Myntra lays one out: rows 78.4pt apart, seller SKU
// wrapped mid-hyphen, and a Total Quantity line at the bottom.
function build(entries, statedTotal) {
  const items = [...HEADER];
  let y = 581.2;
  for (const e of entries) {
    items.push(cell(e.msku, X.msku, y));
    e.sskuLines.forEach((line, i) => items.push(cell(line, X.ssku, y + 13.8 - i * 13.8)));
    items.push(cell(e.desc, X.desc, y));
    items.push(cell(String(e.qty), X.qty, y));
    items.push(cell('N/A', X.exp, y));
    y -= 78.4;
  }
  const totalY = y + 40;
  items.push(cell('Total Quantity', X.msku, totalY));
  items.push(cell(String(statedTotal), X.total, totalY - 1.5));
  return items;
}

/* 1. One SKU, quantity 3 */
{
  const { rows, warnings } = parsePicklist(
    build([{ msku: 'RANHKASS146747214', sskuLines: ['RRC-012-CO-', 'CI-RED-GRN-', 'F-M'], desc: 'Kurta', qty: 3 }], 3),
  );
  assert.equal(rows.length, 1, 'one picklist line stays one row');
  assert.equal(rows[0].qty, 3, 'quantity 3 is read');
  assert.equal(rows[0].sellerSku, 'RRC-012-CO-CI-RED-GRN-F-M');
  assert.equal(rows[0].done, 0);
  assert.deepEqual(warnings, [], `unexpected warnings: ${warnings.join(' | ')}`);
  console.log('PASS  qty 3 on one line -> one row, qty=3');
}

/* 2. Same SKU listed twice (one line per packet) */
{
  const { rows, warnings } = parsePicklist(
    build(
      [
        { msku: 'RANHKASS146747214', sskuLines: ['RRC-012-CO-', 'CI-RED-GRN-', 'F-M'], desc: 'Kurta', qty: 1 },
        { msku: 'RANHKASS146747214', sskuLines: ['RRC-012-CO-', 'CI-RED-GRN-', 'F-M'], desc: 'Kurta', qty: 1 },
      ],
      2,
    ),
  );
  assert.equal(rows.length, 2, 'duplicate SKUs stay as two independent rows, not merged');
  assert.equal(rows[0].myntraSku, rows[1].myntraSku);
  assert.ok(rows.every((r) => r.qty === 1 && r.done === 0));
  assert.deepEqual(warnings, [], `unexpected warnings: ${warnings.join(' | ')}`);
  console.log('PASS  same SKU twice -> two rows tracked separately');
}

/* 3. Mixed quantities across rows */
{
  const { rows } = parsePicklist(
    build(
      [
        { msku: 'RANHKASS146747214', sskuLines: ['RRC-012-CO-', 'A-BLU-S'], desc: 'Kurta', qty: 2 },
        { msku: 'RANHKASS141600528', sskuLines: ['RRC-012-CO-', 'CI-RED-GRN-', 'F-M'], desc: 'Kurta', qty: 5 },
      ],
      7,
    ),
  );
  assert.deepEqual(rows.map((r) => r.qty), [2, 5], 'per-row quantities are independent');
  assert.deepEqual(rows.map((r) => r.sellerSku), ['RRC-012-CO-A-BLU-S', 'RRC-012-CO-CI-RED-GRN-F-M']);
  console.log('PASS  mixed quantities 2 and 5 read per row');
}

/* 4. A miscount must not pass silently */
{
  const { rows, warnings } = parsePicklist(
    build([{ msku: 'RANHKASS146747214', sskuLines: ['RRC-012-CO-', 'A-BLU-S'], desc: 'Kurta', qty: 2 }], 9),
  );
  assert.equal(rows[0].qty, 2);
  assert.ok(
    warnings.some((w) => /9 items in total but 2 were read/.test(w)),
    `expected a total-mismatch warning, got: ${warnings.join(' | ') || '(none)'}`,
  );
  console.log('PASS  stated total 9 vs counted 2 raises a warning');
}

/* 5. A quantity becomes one clickable row per physical item */
{
  const { expandUnits } = await import('../parser.js');

  const rows = expandUnits([
    { myntraSku: 'RANHKASS146747214', sellerSku: 'RRC-012-CO-A-BLU-S', desc: 'Kurta', size: 'S', qty: 3, done: 0 },
  ]);
  assert.equal(rows.length, 3, 'quantity 3 becomes 3 rows');
  assert.deepEqual(rows.map((r) => r.qty), [1, 1, 1], 'every row is a single unit');
  assert.deepEqual(rows.map((r) => r.unit), [1, 2, 3], 'rows are numbered 1..3');
  assert.deepEqual(rows.map((r) => r.units), [3, 3, 3], 'each row knows the line total');
  assert.ok(rows.every((r) => r.sellerSku === 'RRC-012-CO-A-BLU-S' && r.size === 'S'), 'details are copied to each row');
  assert.ok(rows.every((r) => r.done === 0));
  console.log('PASS  qty 3 -> 3 single-unit rows numbered 1/3, 2/3, 3/3');
}
{
  const { expandUnits } = await import('../parser.js');

  assert.equal(expandUnits([{ myntraSku: 'A1234567', qty: 1, done: 0 }]).length, 1, 'qty 1 stays one row');
  assert.equal(expandUnits([{ myntraSku: 'A1234567', qty: 1, done: 0 }])[0].units, 1);

  const mixed = expandUnits([
    { myntraSku: 'A1234567', qty: 2, done: 0 },
    { myntraSku: 'B1234567', qty: 5, done: 0 },
  ]);
  assert.equal(mixed.length, 7, 'quantities 2 and 5 become 7 rows');
  assert.deepEqual(mixed.map((r) => r.myntraSku), ['A1234567', 'A1234567', 'B1234567', 'B1234567', 'B1234567', 'B1234567', 'B1234567'],
    'units of the same line stay next to each other, in picklist order');

  // Progress saved under the old one-row-per-line shape must survive the split.
  const carried = expandUnits([{ myntraSku: 'A1234567', qty: 3, done: 2 }]);
  assert.deepEqual(carried.map((r) => r.done), [1, 1, 0], 'two units already packed stay packed');
  console.log('PASS  qty 1 unchanged, 2+5 -> 7 rows in order, existing progress carried over');
}

/* 6. A misread quantity must not expand into a list that locks up the panel */
{
  const { expandUnits, MAX_UNITS_PER_LINE } = await import('../parser.js');
  const huge = expandUnits([{ myntraSku: 'A1234567', qty: 250000, done: 0 }]);
  assert.equal(huge.length, MAX_UNITS_PER_LINE, `clamped to ${MAX_UNITS_PER_LINE} rows`);
  // A real bulk order still passes through untouched.
  assert.equal(expandUnits([{ myntraSku: 'A1234567', qty: 120, done: 0 }]).length, 120);
  assert.equal(expandUnits([{ myntraSku: 'A1234567', qty: 0, done: 0 }]).length, 1, 'qty 0 still gives one row');
  console.log(`PASS  quantity clamped at ${MAX_UNITS_PER_LINE}; real quantities (120) unaffected`);
}
