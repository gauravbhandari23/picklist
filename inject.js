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
  const where =
    window === window.top ? 'top' : `frame<${String(location.href).slice(0, 70)}>`;
  const log = (...a) => console.log('[picklist]', where, ...a);
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
  // Everything below is here to answer one question: what raises the two Save
  // dialogs? Each possible route logs distinctly, so a single packed order
  // shows which one is in use.

  // Fires in whichever document is actually being printed.
  window.addEventListener('beforeprint', () => log('*** BEFOREPRINT — a print is starting in this document'));
  window.addEventListener('afterprint', () => log('*** AFTERPRINT — that print finished'));

  // A PDF turned into a blob: URL is the usual prelude to showing or printing it.
  try {
    const origCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = function (obj) {
      const url = origCreateObjectURL.call(this, obj);
      log('URL.createObjectURL', obj?.type || typeof obj, obj?.size ?? '', '->', String(url).slice(0, 60));
      return url;
    };
  } catch {
    /* best effort */
  }

  // Printing a hidden iframe is the commonest way to print a PDF, and an
  // override on this window would never see it.
  const hookFrame = (frame) => {
    try {
      const w = frame.contentWindow;
      if (!w || w.__myntraFramePrint) return;
      w.__myntraFramePrint = true;
      const framePrint = w.print;
      w.print = function (...args) {
        const fresh = Date.now() - lastCaptureAt < PRINT_GRACE_MS;
        log('*** IFRAME print() called. autosave =', autosaveOn, '| captured recently =', fresh);
        if (autosaveOn && fresh) {
          log('*** iframe print skipped — already saved by autosave');
          return undefined;
        }
        return framePrint.apply(this, args);
      };
      log('hooked print() on an iframe', String(frame.getAttribute('src') || '(no src)').slice(0, 70));
    } catch (err) {
      log('could not hook an iframe (cross-origin):', String(frame.getAttribute('src') || '').slice(0, 70));
    }
  };

  // Nothing in the browser prints these documents — no beforeprint, no
  // window.print, no iframe. The page talks to QZ Tray, a native printing
  // application, over a WebSocket on localhost, and QZ Tray prints through
  // Windows. That is what raises the two Save dialogs.
  //
  // When autosave is on the documents are already saved, so that print is pure
  // duplication. Rather than drop the print job mid-conversation — QZ's client
  // awaits a reply per request and would hang — the connection is refused, so
  // QZ Tray simply looks absent. That is a path the page handles well: with QZ
  // Tray quit, packing completes normally and only these dialogs disappear.
  const QZ_RE = /localhost|127\.0\.0\.1|\.qz\.io/i;

  // Mimics "nothing listening on that port": connecting, then error, then close.
  function refusedSocket(url) {
    const listeners = Object.create(null);
    const fire = (type, event) => {
      try {
        socket['on' + type]?.call(socket, event);
      } catch {
        /* the page's handler threw; not our problem */
      }
      for (const fn of listeners[type] ?? []) {
        try {
          fn.call(socket, event);
        } catch {
          /* same */
        }
      }
    };
    const socket = {
      url: String(url),
      readyState: 0,
      bufferedAmount: 0,
      extensions: '',
      protocol: '',
      binaryType: 'blob',
      onopen: null,
      onerror: null,
      onclose: null,
      onmessage: null,
      send() {},
      close() {
        socket.readyState = 3;
      },
      addEventListener(type, fn) {
        (listeners[type] ??= []).push(fn);
      },
      removeEventListener(type, fn) {
        listeners[type] = (listeners[type] ?? []).filter((f) => f !== fn);
      },
      dispatchEvent() {
        return true;
      },
    };
    setTimeout(() => {
      socket.readyState = 3;
      fire('error', new Event('error'));
      fire('close', typeof CloseEvent === 'function'
        ? new CloseEvent('close', { code: 1006, wasClean: false })
        : new Event('close'));
    }, 5);
    return socket;
  }

  try {
    const OriginalWebSocket = window.WebSocket;
    const PrintServiceSocket = function (url, ...rest) {
      if (QZ_RE.test(String(url))) {
        const fresh = Date.now() - lastCaptureAt < PRINT_GRACE_MS;
        if (autosaveOn) {
          if (!window.__myntraPrintServiceBlocked) {
            window.__myntraPrintServiceBlocked = true;
            log('*** refusing the local print service (QZ Tray) — autosave has the documents');
          }
          return refusedSocket(url);
        }
        if (!window.__myntraPrintServiceSeen) {
          window.__myntraPrintServiceSeen = true;
          log('*** page is contacting a local print service (QZ Tray). autosave off, leaving it alone. captured recently =', fresh);
        }
      }
      const socket = new OriginalWebSocket(url, ...rest);
      if (QZ_RE.test(String(url))) {
        const originalSend = socket.send.bind(socket);
        socket.send = function (data) {
          const body = typeof data === 'string' ? data : `(${typeof data})`;
          log('*** print service <- ', body.slice(0, 200));
          return originalSend(data);
        };
      }
      return socket;
    };
    PrintServiceSocket.prototype = OriginalWebSocket.prototype;
    for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) {
      PrintServiceSocket[k] = OriginalWebSocket[k];
    }
    window.WebSocket = PrintServiceSocket;
  } catch {
    /* leave the page's own socket alone if anything here fails */
  }

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
      const tag = node.tagName;
      const src = node.getAttribute?.('src') || node.getAttribute?.('data') || '';
      // Any frame or embed at all is worth reporting — it may carry a blob: URL
      // rather than the label URL, and would otherwise look like nothing.
      if (tag === 'IFRAME' || tag === 'EMBED' || tag === 'OBJECT') {
        log('*** added', tag, 'src=', String(src).slice(0, 80) || '(none)');
        if (tag === 'IFRAME') {
          hookFrame(node);
          node.addEventListener?.('load', () => hookFrame(node), { once: true });
        }
      } else if (src && LABEL_RE.test(src)) {
        log('element added pointing at a label:', tag, src);
      }
      node.querySelectorAll?.('iframe,embed,object').forEach((el) => {
        log('*** nested', el.tagName, 'src=', String(el.getAttribute('src') || '').slice(0, 80) || '(none)');
        if (el.tagName === 'IFRAME') hookFrame(el);
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
    if (LABEL_RE.test(url)) {
      out.catch((err) => {
        log('*** label request FAILED:', String(err?.message ?? err), '-', absolute(url));
        retryLabel(url);
      });
    }
    return out.then((res) => {
      try {
        if (PACKET_RE.test(url)) {
          res.clone().text().then(notePacket).catch(() => {});
        } else if (LABEL_RE.test(url)) {
          if (!res.ok) {
            log('*** label request returned', res.status, res.statusText, '-', absolute(url));
            retryLabel(url);
            return res;
          }
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

  // Myntra's server sometimes answers a label request with a 500, and the page
  // does not retry — the document is simply missing until someone notices and
  // re-downloads it. One quiet retry costs nothing and saves that.
  const retried = new Set();
  async function retryLabel(url) {
    const absoluteUrl = absolute(url);
    if (retried.has(absoluteUrl)) {
      log('*** already retried that label once, leaving it');
      return;
    }
    retried.add(absoluteUrl);
    await new Promise((r) => setTimeout(r, 1500));
    log('*** retrying the failed label request…');
    try {
      const res = await origFetch(absoluteUrl, { credentials: 'include' });
      if (!res.ok) {
        log('*** retry also failed:', res.status, res.statusText, '— re-download it from Myntra');
        post({ type: 'LABEL_FAILED', url: absoluteUrl, detail: `${res.status} ${res.statusText}` });
        return;
      }
      const buf = await res.arrayBuffer();
      log('*** retry succeeded,', buf.byteLength, 'bytes');
      send(absoluteUrl, toBase64(buf), res.headers.get('content-type') ?? '');
    } catch (err) {
      log('*** retry failed:', String(err?.message ?? err), '— re-download it from Myntra');
      post({ type: 'LABEL_FAILED', url: absoluteUrl, detail: String(err?.message ?? err) });
    }
  }

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
