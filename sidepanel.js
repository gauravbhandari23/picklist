import * as pdfjs from './lib/pdf.min.mjs';
import { parsePicklist, expandUnits } from './parser.js';
import { decodeCode128, extractJpegs } from './barcode.js';

pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.mjs');

const $ = (id) => document.getElementById(id);
const els = {
  subtitle: $('subtitle'), picklistId: $('picklistId'), doneCount: $('doneCount'), totalCount: $('totalCount'),
  close: $('close'), pick: $('pick'), reset: $('reset'), clear: $('clear'),
  fillMode: $('fillMode'), autosave: $('autosave'), pageSize: $('pageSize'),
  status: $('status'), warnings: $('warnings'), drop: $('drop'), rows: $('rows'), file: $('file'),
};

const EMPTY = {
  fileName: null,
  picklistId: null,      // decoded from the barcode in the PDF
  pagePicklistId: null,  // whatever the pack page currently has open
  fillMode: 'myntra', rows: [], warnings: [],
};
let state = { ...EMPTY };

const packed = () => state.rows.reduce((n, r) => n + r.done, 0);
const units = () => state.rows.reduce((n, r) => n + r.qty, 0);
const isDone = (r) => r.done >= r.qty;
const nextIndex = () => state.rows.findIndex((r) => !isDone(r));

const save = () => chrome.storage.local.set({ picklist: state });

// Which row the list was last scrolled to. Declared up here so render() can
// never touch it before initialisation.
let lastScrolled = null;

const REASONS = {
  'no-tab': 'No Myntra pack page is open. Open PackOrder/Operations in a tab.',
  'no-content-script': "Couldn't reach the pack page. Reload that tab and try again.",
  'no-field': "That box isn't on the pack page right now.",
};
const reasonText = (r) => REASONS[r] ?? 'Could not reach the pack page.';

/* ---------- messages ---------- */

function status(text, bad = false, action = null) {
  els.status.replaceChildren();
  if (!text) {
    els.status.hidden = true;
    return;
  }
  els.status.hidden = false;
  els.status.classList.toggle('bad', bad);
  els.status.append(text);
  if (action) {
    const btn = document.createElement('button');
    btn.textContent = action.label;
    btn.style.marginLeft = '8px';
    btn.addEventListener('click', action.run);
    els.status.append(btn);
  }
}

// Used wherever an action would throw away work. No window.confirm, so the
// packer never gets a modal they have to dismiss mid-flow.
function askThen(text, label, run) {
  status(text, false, { label, run: () => { status(''); run(); } });
}

// Loading the wrong picklist PDF is a real mistake, so say so loudly.
function mismatchWarning() {
  const { picklistId: pdf, pagePicklistId: page } = state;
  if (!pdf || !page || pdf === page) return [];
  return [`This PDF is picklist ${pdf} but the page has ${page} open. Wrong file?`];
}

function showWarnings(list) {
  els.warnings.replaceChildren();
  els.warnings.hidden = list.length === 0;
  if (!list.length) return;
  const ul = document.createElement('ul');
  for (const w of list) {
    const li = document.createElement('li');
    li.textContent = w;
    ul.append(li);
  }
  els.warnings.append(ul);
}

/* ---------- render ---------- */

function render() {
  const has = state.rows.length > 0;
  els.drop.hidden = has;
  els.rows.hidden = !has;
  els.doneCount.textContent = packed();
  els.totalCount.textContent = units();
  els.fillMode.value = state.fillMode;
  els.subtitle.textContent = state.fileName ?? 'No file loaded';
  els.picklistId.hidden = !state.picklistId;
  els.picklistId.textContent = state.picklistId ?? '';

  showWarnings([...(state.warnings ?? []), ...mismatchWarning()]);

  const next = nextIndex();
  els.rows.replaceChildren();

  // Finished rows sink to the bottom, so what is still to pack stays under your
  // eyes. Array.sort is stable, so the picklist order survives within each group.
  const order = state.rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => Number(isDone(a.row)) - Number(isDone(b.row)));

  for (const { row, i } of order) {
    const li = document.createElement('li');
    li.className = 'row';
    li.dataset.index = String(i);
    if (isDone(row)) li.classList.add('done');
    else if (i === next) li.classList.add('next');

    const tick = document.createElement('button');
    tick.className = 'tick';
    tick.textContent = isDone(row) ? '✓' : i === next ? '▸' : '';
    tick.title = row.done > 0 ? 'Undo one' : 'Not packed yet';
    tick.addEventListener('click', () => undo(i));

    const body = document.createElement('button');
    body.className = 'body';
    body.title = 'Fill this SKU into the Myntra box';
    body.addEventListener('click', () => fillRow(i));

    const msku = document.createElement('div');
    msku.className = 'msku';
    msku.textContent = row.myntraSku;

    const ssku = document.createElement('div');
    ssku.className = 'ssku';
    ssku.textContent = row.sellerSku || '(no seller SKU)';

    const desc = document.createElement('div');
    desc.className = 'desc';
    if (row.size) {
      const size = document.createElement('span');
      size.className = 'size';
      size.textContent = row.size;
      desc.append(size);
    }
    desc.append(row.desc || '');

    body.append(msku, ssku, desc);

    const qty = document.createElement('span');
    qty.className = row.units > 1 ? 'qty multi' : 'qty';
    qty.textContent = row.units > 1 ? `${row.unit}/${row.units}` : '';

    li.append(tick, body, qty);
    els.rows.append(li);
  }

  scrollToNext();
}

// Bring the next item into view, but only when it has actually changed. An
// unrelated re-render — a status line, the page reporting its picklist ID —
// must never yank the list out from under the packer's hand.
function scrollToNext() {
  const el = els.rows.querySelector('.row.next');
  if (!el) {
    lastScrolled = null;
    return;
  }
  if (el.dataset.index === lastScrolled) return;
  lastScrolled = el.dataset.index;
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ block: 'nearest', behavior: still ? 'auto' : 'smooth' });
}

/* ---------- actions ---------- */

async function fillRow(i) {
  const row = state.rows[i];
  if (isDone(row)) {
    status('Already packed. Use the ✓ to undo.');
    return;
  }
  const value = state.fillMode === 'seller' ? row.sellerSku : row.myntraSku;
  if (!value) {
    status(`That row has no ${state.fillMode === 'seller' ? 'seller' : 'Myntra'} SKU.`, true);
    return;
  }

  const res = await chrome.runtime.sendMessage({ type: 'FILL', value }).catch(() => null);

  // Tick as soon as the SKU actually went into the box. If we never reached the
  // page at all, the click did nothing, so ticking would be a lie.
  if (!res?.ok) {
    status(reasonText(res?.reason), true);
    return;
  }

  row.done += 1;
  save();
  render();

  const sameLeft = state.rows.filter((r, j) => j !== i && r.myntraSku === row.myntraSku && !isDone(r)).length;
  if (!res.submitted) status(`Filled ${value}, but Myntra did not clear the box — check the page.`, true);
  else if (sameLeft > 0) status(`Same SKU again: ${sameLeft} more to go.`);
  else status('');
}

async function fillPicklistId() {
  if (!state.picklistId) return;
  const res = await chrome.runtime
    .sendMessage({ type: 'FILL_PICKLIST', value: state.picklistId })
    .catch(() => null);

  if (res?.ok) {
    status(res.submitted ? '' : 'Filled the Picklist ID, but the page did not move on.', !res.submitted);
    return;
  }
  if (res?.reason === 'locked') {
    status(
      res.current && res.current !== state.picklistId
        ? `The page already has picklist ${res.current} open.`
        : 'The Picklist ID box is already set.',
      res.current != null && res.current !== state.picklistId,
    );
    return;
  }
  status(reasonText(res?.reason), true);
}

// Start the same picklist over. One click rather than a confirm, because the
// undo below makes a misclick cheap to take back.
function resetTicks() {
  const before = state.rows.map((r) => r.done);
  if (!before.some((d) => d > 0)) {
    status('Nothing to reset — no rows are ticked.');
    return;
  }
  for (const row of state.rows) row.done = 0;
  lastScrolled = null;
  save();
  render();
  status(`Cleared ${before.reduce((a, b) => a + b, 0)} tick(s).`, false, {
    label: 'Undo',
    run: () => {
      state.rows.forEach((row, i) => { row.done = before[i] ?? 0; });
      lastScrolled = null;
      save();
      render();
      status('');
    },
  });
}

function undo(i) {
  const row = state.rows[i];
  if (row.done === 0) return;
  row.done -= 1;
  save();
  render();
  status('');
}

/* ---------- loading ---------- */

const PICKLIST_ID_SHAPE = /^[A-Z]{2,4}\d{6,}$/;

async function readPicklistId(bytes) {
  const decoded = [];
  for (const jpeg of extractJpegs(bytes)) {
    try {
      const bitmap = await createImageBitmap(new Blob([jpeg], { type: 'image/jpeg' }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bitmap, 0, 0);
      const id = decodeCode128(ctx.getImageData(0, 0, bitmap.width, bitmap.height));
      bitmap.close();
      if (id) decoded.push(id);
    } catch {
      // not an image we can read — try the next one
    }
  }
  // Should a picklist ever carry a second barcode, take the one shaped like an
  // ID (OP22355506) rather than whichever happened to decode first.
  return decoded.find((id) => PICKLIST_ID_SHAPE.test(id)) ?? decoded[0] ?? null;
}

async function parsePdf(bytes) {
  const doc = await pdfjs.getDocument({ data: bytes, useWorkerFetch: false, isEvalSupported: false }).promise;
  const items = [];
  for (let p = 1; p <= doc.numPages; p += 1) {
    const page = await doc.getPage(p);
    // The page number matters: the parser uses it to stop page 2's coordinates
    // colliding with page 1's.
    items.push(...(await page.getTextContent()).items.map((it) => ({ ...it, page: p })));
  }
  return parsePicklist(items);
}

async function loadFile(file) {
  if (!file) return;
  if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
    status('That is not a PDF file.', true);
    return;
  }
  status('Reading PDF…');
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const picklistId = await readPicklistId(bytes);
    // pdf.js transfers the buffer it is given, so hand it a copy.
    const { rows: lines, warnings } = await parsePdf(bytes.slice());
    const rows = expandUnits(lines);

    if (!lines.length) {
      // Leave whatever is already loaded alone — a bad file should not wipe
      // or half-overwrite a picklist that is mid-pack.
      status(`No items found in that PDF. ${warnings.join(' ')}`.trim(), true);
      return;
    }

    const all = [...warnings];
    if (!picklistId) all.push('Could not read the Picklist ID barcode — scan or type it yourself.');

    state = { ...state, fileName: file.name, picklistId, rows, warnings: all };
    lastScrolled = null;
    save();
    render();
    status(all.length ? '' : `Loaded ${rows.length} item${rows.length > 1 ? 's' : ''}.`);
  } catch (err) {
    status(`Could not read that PDF: ${err.message}`, true);
  }
}

function requestLoad(file) {
  if (packed() > 0) {
    askThen(`Replace the list? ${packed()} of ${units()} already packed.`, 'Replace', () => loadFile(file));
    return;
  }
  loadFile(file);
}

function clearAll() {
  state = { ...EMPTY, fillMode: state.fillMode, pagePicklistId: state.pagePicklistId };
  save();
  status('');
  render();
}

/* ---------- wiring ---------- */

// Both the toolbar button and the empty-state box open the normal file picker.
for (const el of [els.pick, els.drop]) el.addEventListener('click', () => els.file.click());
els.file.addEventListener('change', () => {
  requestLoad(els.file.files[0]);
  els.file.value = '';
});
els.picklistId.addEventListener('click', fillPicklistId);
els.reset.addEventListener('click', () => {
  if (state.rows.length) resetTicks();
});
els.clear.addEventListener('click', () => {
  if (!state.rows.length) return;
  if (packed() > 0) askThen(`Clear everything? ${packed()} of ${units()} packed.`, 'Clear', clearAll);
  else clearAll();
});
els.close.addEventListener('click', () => window.close());
els.fillMode.addEventListener('change', () => {
  state.fillMode = els.fillMode.value;
  save();
});

// Kept as its own storage key, not part of the picklist: the service worker
// reads it directly, and it must survive Clear.
els.pageSize.addEventListener('change', () => {
  chrome.storage.local.set({ pageSize: els.pageSize.value });
  status(
    els.pageSize.value === 'original'
      ? 'Saving at Myntra\'s own size — label 4x6in, bill A4.'
      : `Saving on ${els.pageSize.value === 'a4' ? 'A4' : 'Letter'} pages.`,
  );
});

els.autosave.addEventListener('change', () => {
  const on = els.autosave.checked;
  chrome.storage.local.set({ autosave: on });
  status(
    on
      ? 'Autosave on — the label and bill save themselves, and the print dialogs are skipped.'
      : 'Autosave off — Myntra prints as usual and you save by hand.',
  );
});

for (const type of ['dragenter', 'dragover']) {
  document.addEventListener(type, (e) => {
    e.preventDefault();
    els.drop.classList.add('over');
  });
}
document.addEventListener('dragleave', () => els.drop.classList.remove('over'));
document.addEventListener('drop', (e) => {
  e.preventDefault();
  els.drop.classList.remove('over');
  requestLoad(e.dataTransfer?.files?.[0]);
});

const AUTOSAVE_PROBLEMS = {
  'myntra-error': "Myntra's server would not send it. Re-download it from the portal.",
  'no-body': 'Could not read that document from the page — save it by hand.',
  html: 'Myntra returned a web page, not a PDF — save that one by hand.',
  'json-without-pdf': 'Myntra returned data, not a PDF — save that one by hand.',
  'not-a-pdf': 'That download was not a PDF — save it by hand.',
};

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'PAGE_PICKLIST_ID') {
    state.pagePicklistId = msg.value;
    save();
    render();
    return;
  }
  if (msg?.type === 'AUTOSAVE_RESULT') {
    const what = msg.kind === 'invoice' ? 'Bill' : 'Shipping label';
    if (msg.ok) status(`${what} saved: ${msg.filename.split('/').pop()}`);
    else {
      const why = AUTOSAVE_PROBLEMS[msg.reason] ?? msg.reason;
      status(`${what} not saved. ${why}${msg.detail ? ` (${msg.detail})` : ''}`, true);
    }
  }
});

const stored = await chrome.storage.local.get(['picklist', 'autosave', 'pageSize']);
els.autosave.checked = stored.autosave === true;
els.pageSize.value = stored.pageSize ?? 'letter';
state = { ...EMPTY, ...(stored.picklist ?? {}) };
// Older saved state kept a line per SKU with a quantity; split it into units.
if (state.rows.some((r) => (r.qty ?? 1) > 1 || r.units === undefined)) state.rows = expandUnits(state.rows);
render();
