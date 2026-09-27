// Pure picklist-PDF -> rows logic.
// No DOM and no chrome.* in here, so test/parse.test.mjs can run it under plain Node.

const SKU_RE = /^[A-Z]{3,}\d{6,}$/;
// Each PDF page restarts its coordinates at the top, so page 2's y values sit
// ABOVE page 1's. Shifting every page down by more than a page height makes y
// decrease continuously in reading order, which is what the row banding below
// assumes. Without this, a picklist that spills onto a second page reads as
// nothing at all.
const PAGE_SPAN = 5000;
// Column headings and the totals line, which must never be read as row content.
const LABEL_RE = /^(myntra sku code|seller sku|code|product description|quantity|expiry|dates|total quantity)$/i;
const X_TOLERANCE = 6;      // cells in one column share an x almost exactly
const EDGE_MARGIN = 2;      // keeps header/total lines out of the first/last band

// Myntra wraps a long cell across several lines. Which ones may be glued back
// together with a space and which may not is the whole trick here.
const JOIN = {
  glue: (parts) => parts.join('').replace(/\s+/g, ''),
  space: (parts) => parts.join(' ').replace(/\s+/g, ' ').trim(),
};

function toCells(textItems) {
  return textItems
    .map((it) => ({
      text: typeof it.str === 'string' ? it.str : String(it.text ?? ''),
      x: it.transform ? it.transform[4] : it.x,
      y: (it.transform ? it.transform[5] : it.y) - ((it.page ?? 1) - 1) * PAGE_SPAN,
    }))
    .filter((c) => c.text.trim() !== '' && Number.isFinite(c.x) && Number.isFinite(c.y));
}

// Group x values that repeat down the page into column centres, left to right.
function columnCentres(cells) {
  const centres = [];
  for (const x of cells.map((c) => c.x).sort((a, b) => a - b)) {
    const last = centres[centres.length - 1];
    if (last && x - last.sum / last.n <= X_TOLERANCE) {
      last.sum += x;
      last.n += 1;
    } else {
      centres.push({ sum: x, n: 1 });
    }
  }
  return centres.map((c) => c.sum / c.n);
}

function nearestColumn(x, centres) {
  let best = 0;
  let bestDist = Infinity;
  centres.forEach((c, i) => {
    const d = Math.abs(x - c);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}

function findY(cells, re) {
  const hits = cells.filter((c) => re.test(c.text.trim()));
  return hits.length ? hits.map((c) => c.y) : null;
}

// A row owns everything between the midpoint above it and the midpoint below it.
// The first and last bands are clamped to the header and the "Total Quantity"
// line so neither can leak into a row.
function rowBands(anchors, headerFloor, totalCeil) {
  return anchors.map((a, i) => {
    const above = anchors[i - 1];
    const below = anchors[i + 1];
    const pitch = above ? above.y - a.y : below ? a.y - below.y : 80;
    const top = above ? (above.y + a.y) / 2 : Math.min(headerFloor - EDGE_MARGIN, a.y + pitch / 2);
    const bottom = below ? (a.y + below.y) / 2 : Math.max(totalCeil + EDGE_MARGIN, a.y - pitch / 2);
    return { anchor: a, top, bottom };
  });
}

function joinColumn(cells, joiner) {
  const ordered = [...cells].sort((p, q) => q.y - p.y || p.x - q.x);
  return joiner(ordered.map((c) => c.text));
}

export function parsePicklist(textItems) {
  const warnings = [];
  const cells = toCells(textItems);
  if (!cells.length) return { rows: [], warnings: ['The PDF has no readable text (is it a scan?).'] };

  const centres = columnCentres(cells);
  const anchors = cells
    .filter((c) => SKU_RE.test(c.text.trim()) && nearestColumn(c.x, centres) === 0)
    .sort((a, b) => b.y - a.y);

  if (!anchors.length) {
    return { rows: [], warnings: ['No Myntra SKU codes found — this may not be a picklist PDF.'] };
  }

  const headerYs = findY(cells, /^myntra\s*sku/i);
  const totalYs = findY(cells, /^total\s*quantity/i);
  const headerFloor = headerYs ? Math.max(...headerYs) : Infinity;
  const totalCeil = totalYs ? Math.min(...totalYs) : -Infinity;

  const bands = rowBands(anchors, headerFloor, totalCeil);

  // Bucket every cell into [row][column].
  const grid = bands.map(() => centres.map(() => []));
  for (const cell of cells) {
    if (cell.y >= headerFloor - EDGE_MARGIN || cell.y <= totalCeil + EDGE_MARGIN) continue;
    if (LABEL_RE.test(cell.text.trim())) continue; // a header repeated on page 2
    const r = bands.findIndex((b) => cell.y <= b.top && cell.y > b.bottom);
    if (r === -1) continue;
    grid[r][nearestColumn(cell.x, centres)].push(cell);
  }

  // Quantity is the rightmost column whose every value is a plain integer.
  // Deriving it from the data beats trusting the header, whose x is offset
  // from the values it sits above.
  let qtyCol = -1;
  for (let c = 1; c < centres.length; c += 1) {
    const values = grid.map((row) => joinColumn(row[c], JOIN.glue)).filter(Boolean);
    if (values.length === grid.length && values.every((v) => /^\d+$/.test(v))) qtyCol = c;
  }
  if (qtyCol === -1) warnings.push('Could not find the Quantity column — every row was read as qty 1.');

  const descEnd = qtyCol === -1 ? centres.length : qtyCol;
  const rows = grid.map((row, i) => {
    const myntraSku = joinColumn(row[0], JOIN.glue) || anchors[i].text.trim();
    const sellerSku = joinColumn(row[1] ?? [], JOIN.glue);
    const desc = joinColumn(row.slice(2, descEnd).flat(), JOIN.space);
    const qtyRaw = qtyCol === -1 ? '1' : joinColumn(row[qtyCol], JOIN.glue);
    const qty = /^\d+$/.test(qtyRaw) ? parseInt(qtyRaw, 10) : 1;

    if (!sellerSku) warnings.push(`${myntraSku}: no seller SKU found.`);
    if (qtyCol !== -1 && !/^\d+$/.test(qtyRaw)) warnings.push(`${myntraSku}: unreadable quantity "${qtyRaw}", using 1.`);

    return {
      myntraSku,
      sellerSku,
      desc,
      size: sellerSku ? sellerSku.split('-').pop() : '',
      qty,
      done: 0,
    };
  });

  // The PDF states its own total, so disagreeing with it means we mis-read something.
  if (totalYs) {
    const stated = cells
      .filter((c) => c.y >= totalCeil - EDGE_MARGIN && c.y <= totalCeil + EDGE_MARGIN && /^\d+$/.test(c.text.trim()))
      .map((c) => parseInt(c.text.trim(), 10))
      .pop();
    const counted = rows.reduce((sum, r) => sum + r.qty, 0);
    if (Number.isFinite(stated) && stated !== counted) {
      warnings.push(`PDF says ${stated} items in total but ${counted} were read. Check the list.`);
    }
  }

  return { rows, warnings };
}

/**
 * One row per physical item: a picklist line for 3 units becomes 3 rows of 1,
 * each a single click. Any progress already recorded is carried across.
 * Kept here, beside the parser, so it can be tested without the extension host.
 */
export const MAX_UNITS_PER_LINE = 999;

export function expandUnits(rows) {
  return rows.flatMap((row) => {
    // Clamped: a misread quantity should never expand into a list so long it
    // locks up the panel.
    const units = Math.min(MAX_UNITS_PER_LINE, Math.max(1, row.qty ?? 1));
    const alreadyDone = row.done ?? 0;
    return Array.from({ length: units }, (_, i) => ({
      ...row,
      qty: 1,
      done: i < alreadyDone ? 1 : 0,
      unit: i + 1,
      units,
    }));
  });
}
