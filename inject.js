// Runs in the PAGE's own world, which is the only place the page's fetch and
// XMLHttpRequest can be seen. It watches for the two documents Myntra fetches
// after a packet is packed, and hands them outward.
//
// It passes the RESPONSE BODY, not just the URL. Myntra's API needs custom
// headers (x-myntra-app-name and friends) as well as the session cookie, so
// re-requesting the URL from the extension would just earn a 401. The page has
// already fetched it correctly — copying that response is both simpler and
// more reliable. Nothing is blocked, altered or re-sent.

(() => {
  if (window.__myntraLabelWatch) return;
  window.__myntraLabelWatch = true;

  // Deliberately noisy: when autosave does not fire, these lines in the page
  // console are the fastest way to see whether this script ran at all, whether
  // it saw the request, and how the response came back.
  const log = (...a) => console.log('[picklist]', ...a);
  log('watching for label requests');

  const LABEL_RE = /getShippingLabelForSellerPacket|getPacketInvoice/i;
  const PACKET_RE = /ready-to-ship/i;
  const PRINT_GRACE_MS = 20_000;

  // Set from the extension side; the page world cannot read chrome.storage.
  let autosaveOn = false;
  let lastCaptureAt = 0;

  // The packet id shown on screen, kept for naming the files.
  let packet = null;

  const post = (detail) => {
    try {
      window.postMessage({ __myntraPicklistPanel: true, ...detail }, window.location.origin);
    } catch {
      /* nothing we can do from here */
    }
  };

  const notePacket = (text) => {
    log('packet response seen');
    try {
      const body = JSON.parse(text);
      const row = Array.isArray(body?.data) ? body.data[0] : body?.data;
      if (row?.id) {
        packet = {
          packetId: row.id,
          orderId: row.packetItems?.[0]?.portalOrderReleaseId ?? null,
        };
      }
    } catch {
      /* not the JSON we expected */
    }
  };

  const absolute = (url) => {
    try {
      return new URL(url, window.location.href).href;
    } catch {
      return String(url);
    }
  };

  const toBase64 = (buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const CHUNK = 0x8000; // String.fromCharCode cannot take a whole PDF at once
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  };

  const send = (url, body, contentType = '') => {
    if (body) lastCaptureAt = Date.now();
    log('label document', { url: absolute(url), bytes: body ? body.length : 0, contentType, packet });
    post({ type: 'LABEL_DOC', url: absolute(url), packet, body: body ?? null, contentType });
  };

  // The extension tells us whether autosave is on.
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data?.__myntraPicklistPanel !== true || event.data.type !== 'AUTOSAVE_STATE') return;
    autosaveOn = event.data.on === true;
    log('autosave is', autosaveOn ? 'ON' : 'OFF');
  });

  // Myntra prints the label and the bill after packing, which is what raises
  // the two Save dialogs. When autosave has just captured both documents that
  // print is pure duplication, so it is skipped. If capture did not happen the
  // print goes ahead as normal, so nothing is ever lost silently.
  const origPrint = window.print;
  window.print = function (...args) {
    const fresh = Date.now() - lastCaptureAt < PRINT_GRACE_MS;
    log('window.print called. autosave =', autosaveOn, '| captured recently =', fresh);
    if (autosaveOn && fresh) {
      log('print skipped — the document was already saved by autosave');
      return undefined;
    }
    log('printing normally', autosaveOn ? '(nothing captured to save)' : '(autosave off)');
    return origPrint.apply(this, args);
  };

  // The two Save dialogs did not come from window.print() in this page, so the
  // document must be opened somewhere else to be printed. Watch for that, and
  // once autosave has the document, do not open it at all.
  const origWindowOpen = window.open;
  window.open = function (url, ...rest) {
    const target = String(url ?? '');
    log('window.open ->', target || '(no url)');
    const fresh = Date.now() - lastCaptureAt < PRINT_GRACE_MS;
    if (target && LABEL_RE.test(target) && autosaveOn && fresh) {
      log('window.open skipped — that document was already saved by autosave');
      // A stub, so page code calling .print() or .close() on the result does
      // not throw. Returning null outright breaks some callers.
      return {
        closed: false,
        close() {},
        focus() {},
        blur() {},
        print() {
          log('print() on the skipped window ignored');
        },
        document: { write() {}, close() {}, open() {} },
      };
    }
    return origWindowOpen.call(this, url, ...rest);
  };

  // And report anything embedded that points at a label, so we can see whether
  // an iframe or an embed is being used instead.
  try {
    const watchNode = (node) => {
      const src = node.getAttribute?.('src') || node.getAttribute?.('data') || '';
      if (src && LABEL_RE.test(src)) log('element added pointing at a label:', node.tagName, src);
      node.querySelectorAll?.('[src],[data]').forEach((el) => {
        const s2 = el.getAttribute('src') || el.getAttribute('data') || '';
        if (s2 && LABEL_RE.test(s2)) log('nested element pointing at a label:', el.tagName, s2);
      });
    };
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) if (node.nodeType === 1) watchNode(node);
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  } catch {
    /* observing is best effort */
  }

  const origFetch = window.fetch;
  window.fetch = function (...args) {
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
    const out = origFetch.apply(this, args);
    if (!url) return out;
    if (LABEL_RE.test(url)) log('fetch ->', url);
    return out.then((res) => {
      try {
        if (PACKET_RE.test(url)) {
          res.clone().text().then(notePacket).catch(() => {});
        } else if (LABEL_RE.test(url)) {
          // clone() so the page still reads its own response normally
          const contentType = res.headers.get('content-type') ?? '';
          res
            .clone()
            .arrayBuffer()
            .then((buf) => send(url, toBase64(buf), contentType))
            .catch(() => send(url, null, contentType));
        }
      } catch {
        /* never let this break the page's own request */
      }
      return res;
    });
  };

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__myntraUrl = url;
    return origOpen.call(this, method, url, ...rest);
  };

  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('load', () => {
      try {
        const url = this.__myntraUrl;
        if (!url) return;
        if (LABEL_RE.test(url)) log('xhr ->', url);
        if (PACKET_RE.test(url)) {
          notePacket(this.responseText);
          return;
        }
        if (!LABEL_RE.test(url)) return;
        // responseType decides what is readable; cover the usual three.
        const xhrType = this.getResponseHeader('content-type') ?? '';
        if (this.response instanceof ArrayBuffer) send(url, toBase64(this.response), xhrType);
        else if (typeof Blob !== 'undefined' && this.response instanceof Blob) {
          this.response
            .arrayBuffer()
            .then((buf) => send(url, toBase64(buf), xhrType))
            .catch(() => send(url, null, xhrType));
        }
        else if (typeof this.responseText === 'string') {
          send(url, btoa(unescape(encodeURIComponent(this.responseText))), xhrType);
        } else send(url, null, xhrType);
      } catch {
        /* same — stay out of the page's way */
      }
    });
    return origSend.apply(this, args);
  };
})();
