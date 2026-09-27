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

  const LABEL_RE = /getShippingLabelForSellerPacket|getPacketInvoice/i;
  const PACKET_RE = /ready-to-ship/i;

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

  const send = (url, body) =>
    post({ type: 'LABEL_DOC', url: absolute(url), packet, body: body ?? null });

  const origFetch = window.fetch;
  window.fetch = function (...args) {
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
    const out = origFetch.apply(this, args);
    if (!url) return out;
    return out.then((res) => {
      try {
        if (PACKET_RE.test(url)) {
          res.clone().text().then(notePacket).catch(() => {});
        } else if (LABEL_RE.test(url)) {
          // clone() so the page still reads its own response normally
          res
            .clone()
            .arrayBuffer()
            .then((buf) => send(url, toBase64(buf)))
            .catch(() => send(url, null));
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
        if (PACKET_RE.test(url)) {
          notePacket(this.responseText);
          return;
        }
        if (!LABEL_RE.test(url)) return;
        // responseType decides what is readable; cover the usual three.
        if (this.response instanceof ArrayBuffer) send(url, toBase64(this.response));
        else if (typeof Blob !== 'undefined' && this.response instanceof Blob) {
          this.response
            .arrayBuffer()
            .then((buf) => send(url, toBase64(buf)))
            .catch(() => send(url, null));
        }
        else if (typeof this.responseText === 'string') {
          send(url, btoa(unescape(encodeURIComponent(this.responseText))));
        } else send(url, null);
      } catch {
        /* same — stay out of the page's way */
      }
    });
    return origSend.apply(this, args);
  };
})();
