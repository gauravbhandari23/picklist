// Pure picklist-PDF -> rows logic.
// No DOM and no chrome.* in here, so test/parse.test.mjs can run it under plain Node.

const SKU_RE = /^[A-Z]{3,}\d{6,}$/;
// Each PDF page restarts its coordinates at the top, so page 2's y values sit
// ABOVE page 1's. Every page is shifted down by more than one page height, so y
// decreases continuously in reading order however many pages there are — which
// is what the row banding below assumes. Without this, a picklist that spills
// past page 1 reads as nothing at all.
const PAGE_GAP = 1000;
// How far a row may reach from its anchor when there is no same-page neighbour
// to measure against. Comfortably covers a long wrapped description, and
// nowhere near the foot of a sheet.
const DEFAULT_REACH = 60;
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
  const raw = textItems
    .map((it) => ({
      text: typeof it.str === 'string' ? it.str : String(it.text ?? ''),
      x: it.transform ? it.transform[4] : it.x,
      y: it.transform ? it.transform[5] : it.y,
      page: Math.max(1, Math.trunc(it.page ?? 1)),
    }))
    .filter((c) => c.text.trim() !== '' && Number.isFinite(c.x) && Number.isFinite(c.y));

  if (!raw.length) return raw;
  // Measured from the document rather than assumed, so an unusual page size
  // cannot make two pages overlap.
  const span = Math.max(...raw.map((c) => c.y)) + PAGE_GAP;
  return raw.map((c) => ({ ...c, y: c.y - (c.page - 1) * span }));
}

// Typical distance between rows, used to stop a row reaching across a page
// break and picking up a footer. Only gaps between rows on the SAME page count:
// a picklist with one row per page has nothing but page-break gaps, and taking
// their median would make the reach enormous.
function rowReach(anchors) {
  const gaps = [];
  for (let i = 1; i < anchors.length; i += 1) {
    if (anchors[i].page !== anchors[i - 1].page) continue;
    gaps.push(anchors[i - 1].y - anchors[i].y);
  }
  if (!gaps.length) return DEFAULT_REACH;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
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
  const reach = rowReach(anchors);
  return anchors.map((a, i) => {
    const above = anchors[i - 1];
    const below = anchors[i + 1];
    // A row owns the space up to halfway to its neighbours, but never more than
    // one row-height away — otherwise the last row on a page would reach across
    // the break and pick up anything at the bottom of the sheet.
    const tops = [a.y + reach, headerFloor - EDGE_MARGIN];
    const bottoms = [a.y - reach, totalCeil + EDGE_MARGIN];
    if (above) tops.push((above.y + a.y) / 2);
    if (below) bottoms.push((a.y + below.y) / 2);
    return { anchor: a, top: Math.min(...tops), bottom: Math.max(...bottoms) };
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
  const digitCols = [];
  for (let c = 1; c < centres.length; c += 1) {
    const filled = grid.map((row) => joinColumn(row[c], JOIN.glue)).filter(Boolean);
    if (!filled.length || !filled.every((v) => /^\d+$/.test(v))) continue;
    digitCols.push({ c, coverage: filled.length / grid.length });
  }
  // A column every row fills is the quantity; only if none exists do we settle
  // for one most rows fill. Rightmost wins, since Expiry sits further right and
  // is never all digits.
  const whole = digitCols.filter((d) => d.coverage === 1);
  const chosen = (whole.length ? whole : digitCols.filter((d) => d.coverage >= 0.5)).pop();
  const qtyCol = chosen ? chosen.c : -1;
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
