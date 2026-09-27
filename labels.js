// Recognising Myntra's label/invoice endpoints and turning a response into a
// file. Pure: no DOM, no chrome.*, so test/labels.test.mjs runs it under Node.
//
// After a packet is marked ready-to-ship, the pack page fetches two documents:
//   .../api/mdirect/orders/getShippingLabelForSellerPacketV2/<store>?...
//   .../api/mdirect/orders/getPacketInvoice/<store>?...
// Saving those directly is far better than printing the page: no print dialog
// exists to suppress, and the packet id can go in the filename.

const ENDPOINTS = [
  { kind: 'label', re: /\/getShippingLabelForSellerPacket/i },
  { kind: 'invoice', re: /\/getPacketInvoice/i },
];

export const DOWNLOAD_FOLDER = 'myntra-labels';

/** @returns {'label'|'invoice'|null} */
export function classifyLabelUrl(url) {
  if (typeof url !== 'string' || !/myntrainfo\.com/i.test(url)) return null;
  return ENDPOINTS.find((e) => e.re.test(url))?.kind ?? null;
}

/**
 * The label URL carries the order id in its query string. Reading it from there
 * means a file can always be named properly, even if the packet response that
 * carries the packet id has not been seen yet.
 */
export function idsFromLabelUrl(url) {
  try {
    const q = new URL(url).searchParams;
    return { orderId: q.get('sellerOrderId') || null, sellerId: q.get('sellerId') || null };
  } catch {
    return { orderId: null, sellerId: null };
  }
}

/** The packet id is what Myntra shows on screen, so it is the useful name. */
export function labelFilename({ kind, packetId, orderId, at = new Date() }) {
  const stamp = [
    at.getFullYear(),
    String(at.getMonth() + 1).padStart(2, '0'),
    String(at.getDate()).padStart(2, '0'),
  ].join('-');
  // Letters, digits, _ and - only. Keeping dots would let "../.." survive as
  // "..", and Chrome rejects any filename containing it.
  const id = String(packetId || orderId || '').replace(/[^A-Za-z0-9_-]/g, '') || 'unknown';
  return `${DOWNLOAD_FOLDER}/${stamp}/${id}-${kind}.pdf`;
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // %PDF

export function looksLikePdf(bytes) {
  return PDF_MAGIC.every((b, i) => bytes[i] === b);
}

// Some Myntra endpoints wrap the document as base64 inside JSON rather than
// returning the bytes. Rather than guess a field name, take the longest string
// in the payload and see whether it decodes to a PDF.
export function findBase64Pdf(text, decode) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const strings = [];
  const walk = (node) => {
    if (typeof node === 'string') strings.push(node);
    else if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === 'object') Object.values(node).forEach(walk);
  };
  walk(parsed);

  for (const s of strings.sort((a, b) => b.length - a.length)) {
    if (s.length < 100 || /[^A-Za-z0-9+/=\s]/.test(s)) continue;
    try {
      const bytes = decode(s.replace(/\s+/g, ''));
      if (looksLikePdf(bytes)) return s.replace(/\s+/g, '');
    } catch {
      // not base64 — try the next one
    }
  }
  return null;
}

/**
 * Decide what to do with a fetched response.
 * @returns {{ok:true, base64:string} | {ok:false, reason:string}}
 */
export function planSave({ contentType = '', bytes, text, toBase64, fromBase64 }) {
  if (bytes?.length && looksLikePdf(bytes)) return { ok: true, base64: toBase64(bytes) };

  if (typeof text === 'string' && text.trim().startsWith('{')) {
    const found = findBase64Pdf(text, fromBase64);
    if (found) return { ok: true, base64: found };
    return { ok: false, reason: 'json-without-pdf' };
  }

  if (/html/i.test(contentType) || /^\s*<(!doctype|html)/i.test(text ?? '')) {
    return { ok: false, reason: 'html' };
  }
  return { ok: false, reason: 'not-a-pdf' };
}

/**
 * A full description of what a response actually contains, for diagnosing a
 * save that did not happen. Deliberately thorough: a real packet is expensive
 * to spend on a test, so one attempt should reveal everything.
 */
export function describePayload({ bytes, text = '', contentType = '', fromBase64 }) {
  const head = [...bytes.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join(' ');
  const ascii = String.fromCharCode(...bytes.slice(0, 8)).replace(/[^\x20-\x7e]/g, '.');
  const out = { contentType: contentType || '(none)', bytes: bytes.length, head, ascii };

  if (looksLikePdf(bytes)) {
    out.verdict = 'raw PDF';
    return out;
  }

  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* not JSON */
  }

  if (parsed && typeof parsed === 'object') {
    out.verdict = 'JSON';
    out.topLevelKeys = Object.keys(parsed);
    const fields = [];
    const walk = (node, path) => {
      if (typeof node === 'string') {
        const clean = node.replace(/\s+/g, '');
        let isPdf = false;
        try {
          isPdf = clean.length > 8 && looksLikePdf(fromBase64(clean));
        } catch {
          /* not base64 */
        }
        fields.push({
          field: path || '(root)',
          length: node.length,
          base64ish: clean.length > 100 && !/[^A-Za-z0-9+/=]/.test(clean),
          decodesToPdf: isPdf,
        });
      } else if (Array.isArray(node)) node.forEach((v, i) => walk(v, `${path}[${i}]`));
      else if (node && typeof node === 'object') {
        Object.entries(node).forEach(([k, v]) => walk(v, path ? `${path}.${k}` : k));
      }
    };
    walk(parsed, '');
    // The long ones are the only plausible carriers of a document.
    out.longStrings = fields.filter((f) => f.length > 40).sort((a, b) => b.length - a.length).slice(0, 8);
    if (!out.longStrings.length) out.preview = text.slice(0, 300);
    return out;
  }

  out.verdict = /^\s*<(!doctype|html|\?xml)/i.test(text) ? 'HTML/XML' : 'unknown';
  out.preview = text.slice(0, 300);
  return out;
}
