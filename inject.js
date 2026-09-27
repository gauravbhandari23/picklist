// Runs in the PAGE's own world, which is the only place the page's fetch and
// XMLHttpRequest can be seen. It watches for the two documents Myntra fetches
// after a packet is packed, and reports their URLs outward. It reads only —
// nothing is blocked, altered or re-sent.

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

  const seen = (url) => {
    if (LABEL_RE.test(url)) post({ type: 'LABEL_URL', url: absolute(url), packet });
  };

  const origFetch = window.fetch;
  window.fetch = function (...args) {
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
    const out = origFetch.apply(this, args);
    if (!url) return out;
    return out.then((res) => {
      try {
        if (PACKET_RE.test(url)) res.clone().text().then(notePacket).catch(() => {});
        else seen(url);
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
        if (PACKET_RE.test(url)) notePacket(this.responseText);
        else seen(url);
      } catch {
        /* same — stay out of the page's way */
      }
    });
    return origSend.apply(this, args);
  };
})();
