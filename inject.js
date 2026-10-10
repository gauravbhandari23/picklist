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
  if (window.__myntraLabelWatch) {
    // Re-injected into a page that already has it. Say so rather than
    // returning in silence: an unexplained absence of logs is what makes this
    // hard to tell apart from the script never arriving.
    try {
      console.log('[picklist] already watching this page — nothing to do');
    } catch {
      /* no console */
    }
    return;
  }
  window.__myntraLabelWatch = true;

  // Stamped so the console says which build a tab is actually running. A tab
  // that was not reloaded keeps the previous inject.js, and the symptom — some
  // log lines present, others missing — is otherwise very hard to read.
  const BUILD = '2026-09-28a quiet';

  const startedAt = Date.now();
  // Cross-origin frames can make either of these throw. Nothing here is worth
  // losing the whole script over.
  let where = 'page';
  try {
    where = window === window.top ? 'top' : `frame<${String(location.href).slice(0, 70)}>`;
  } catch {
    where = 'frame<cross-origin>';
  }
  // The millisecond offset matters: whether autosave arrives before QZ Tray is
  // contacted decides whether it can be refused at all.
  // `say`: the few lines that matter (build, autosave state, QZ allowed or
  // refused, a label that failed). `log`: the step-by-step detail, only after
  // __picklistDebug() is typed in the page console.
  let debug = false;
  const say = (...a) => console.log(`[picklist +${Date.now() - startedAt}ms]`, where, ...a);
  const log = (...a) => {
    if (debug) say(...a);
  };
  window.__picklistDebug = (on = true) => {
    debug = on !== false;
    say('detailed logging', debug ? 'ON' : 'OFF');
  };
  say('build', BUILD, '— watching for label requests. autosave starts OFF until the panel says otherwise');

  const LABEL_RE = /getShippingLabelForSellerPacket|getPacketInvoice/i;
  const PACKET_RE = /ready-to-ship/i;
  const PRINT_GRACE_MS = 20_000;

  // Set from the extension side; the page world cannot read chrome.storage.
  let autosaveOn = false;
  let lastCaptureAt = 0;
  let qzAttempts = 0;
  let qzRefused = 0;
  let qzConnected = false;

  // Packet ids shown on screen, by the order-release id the label URL carries
  // (its sellerOrderId) — so each file is named after ITS packet, never after
  // whichever packet happened to be packed last.
  const packets = new Map(); // releaseId -> { packetId, orderId }
  const PACKETS_KEPT = 50;
  // Until a document on this page has matched its packet by id, the id link is
  // unconfirmed — then the packet packed in the last FALLBACK_MS is used, as
  // before this matching existed. Once one matched, never guess again.
  let lastPacket = null; // { packetId, orderId, at }
  let idMatched = false;
  const FALLBACK_MS = 2 * 60_000;

  const post = (detail) => {
    try {
      window.postMessage({ __myntraPicklistPanel: true, ...detail }, window.location.origin);
    } catch {
      /* nothing we can do from here */
    }
  };

  const status = () => ({
    build: BUILD,
    autosaveOn: autosaveNow(),
    msSinceCapture: lastCaptureAt ? Date.now() - lastCaptureAt : null,
    webSocketIsOurs: PrintServiceSocket !== null && window.WebSocket === PrintServiceSocket,
    printIsOurs: window.print === wrappedPrint,
    qzAttempts,
    qzRefused,
    qzConnected,
  });
  // Typing __picklistStatus() in the console prints this at any time.
  window.__picklistStatus = () => {
    say('STATUS', status());
    return status();
  };

  const notePacket = (text) => {
    log('packet response seen. STATUS AT PACK TIME:', status());
    try {
      const body = JSON.parse(text);
      const rows = Array.isArray(body?.data) ? body.data : body?.data ? [body.data] : [];
      // The fallback names after the first row, as before this matching existed.
      if (rows[0]?.id) lastPacket = { packetId: rows[0].id, orderId: rows[0].packetItems?.[0]?.portalOrderReleaseId ?? null, at: Date.now() };
      for (const row of rows) {
        if (!row?.id) continue;
        for (const item of row.packetItems ?? []) {
          const releaseId = item?.portalOrderReleaseId;
          if (releaseId == null) continue;
          packets.delete(String(releaseId));
          packets.set(String(releaseId), { packetId: row.id, orderId: String(releaseId) });
        }
      }
      while (packets.size > PACKETS_KEPT) packets.delete(packets.keys().next().value);
    } catch {
      /* not the JSON we expected */
    }
  };

  const packetFor = (url) => {
    let id = null;
    try {
      id = new URL(url, window.location.href).searchParams.get('sellerOrderId');
    } catch {
      /* not a URL */
    }
    const hit = id && packets.get(String(id));
    if (hit) {
      idMatched = true;
      return { ...hit, matched: true };
    }
    if (!idMatched && lastPacket && Date.now() - lastPacket.at < FALLBACK_MS) {
      say('no packet matched order', id, '— naming it after the packet just packed,', lastPacket.packetId);
      return { packetId: lastPacket.packetId, orderId: lastPacket.orderId, matched: false };
    }
    return null;
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
    const packet = packetFor(url);
    log('label document', { url: absolute(url), bytes: body ? body.length : 0, contentType, packet });
    post({ type: 'LABEL_DOC', url: absolute(url), packet, body: body ?? null, contentType });
  };

  // The extension tells us whether autosave is on. Until it has, the flag the
  // extension's own start-of-page script sets (only while autosave is on —
  // autosave-flag.js) answers: it is there before any page script runs, so
  // even a QZ connection made the instant the page loads is judged right.
  let stateKnown = false;
  const autosaveNow = () => (stateKnown ? autosaveOn : window.__picklistAutosaveAtStart === true);
  autosaveOn = window.__picklistAutosaveAtStart === true;
  const liveQz = new Set(); // QZ sockets let through, closed if autosave turns on
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data?.__myntraPicklistPanel !== true || event.data.type !== 'AUTOSAVE_STATE') return;
    const on = event.data.on === true;
    if (on !== autosaveOn || !stateKnown) say('autosave is', on ? 'ON — QZ Tray will be refused' : 'OFF — QZ Tray left alone');
    autosaveOn = on;
    stateKnown = true;
    if (on && liveQz.size) {
      say('autosave is on — closing', liveQz.size, 'QZ Tray connection(s) so nothing prints');
      for (const s of liveQz) {
        try {
          s.close();
        } catch {
          /* already closing */
        }
      }
      liveQz.clear();
    }
  });
  // Ask for it too: when this script is put in after the page loaded (a
  // single-page navigation), the content script's first announcement went
  // out before anyone was listening.
  post({ type: 'HELLO' });
  // Put in after the page loaded (clicked through to the pack page, or the
  // extension was updated): a QZ Tray connection the page opened earlier was
  // never seen, so with autosave on the print dialogs can still appear until
  // the page is reloaded. Say so (the panel shows it when autosave is on).
  if (document.readyState !== 'loading') {
    say('started after the page loaded — reload the pack page so autosave can stop the print dialogs');
    post({ type: 'LATE_START' });
  }

  // Myntra prints the label and the bill after packing, which is what raises
  // the two Save dialogs. When autosave has just captured both documents that
  // print is pure duplication, so it is skipped. If capture did not happen the
  // print goes ahead as normal, so nothing is ever lost silently. (Myntra
  // prints through QZ Tray today — see below — these cover the browser's own
  // print routes should that ever change.)
  const origPrint = window.print;
  const wrappedPrint = function (...args) {
    const fresh = Date.now() - lastCaptureAt < PRINT_GRACE_MS;
    log('window.print called. autosave =', autosaveOn, '| captured recently =', fresh);
    if (autosaveNow() && fresh) {
      log('print skipped — the document was already saved by autosave');
      return undefined;
    }
    log('printing normally', autosaveOn ? '(nothing captured to save)' : '(autosave off)');
    return origPrint.apply(this, args);
  };
  window.print = wrappedPrint;

  window.addEventListener('beforeprint', () => log('a print is starting in this document'));

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
        log('iframe print() called. autosave =', autosaveOn, '| captured recently =', fresh);
        if (autosaveNow() && fresh) {
          log('iframe print skipped — already saved by autosave');
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
  // QZ Tray's own addresses only: localhost / 127.0.0.1 / localhost.qz.io on
  // the ports it walks (8181-8484 secure, 8182-8485 plain). Any other local
  // socket is none of our business.
  const QZ_HOSTS = new Set(['localhost', '127.0.0.1', 'localhost.qz.io']);
  const QZ_PORTS = new Set(['8181', '8282', '8383', '8484', '8182', '8283', '8384', '8485']);
  const isQzUrl = (url) => {
    try {
      const u = new URL(String(url));
      return /^wss?:$/.test(u.protocol) && QZ_HOSTS.has(u.hostname) && QZ_PORTS.has(u.port);
    } catch {
      return false;
    }
  };

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

  // Declared out here so status() can report whether the hook is still in
  // place; assigned inside the try below.
  let PrintServiceSocket = null;

  try {
    const OriginalWebSocket = window.WebSocket;
    PrintServiceSocket = function (url, ...rest) {
      const isQz = isQzUrl(url);
      if (isQz) {
        qzAttempts += 1;
        log(`QZ attempt #${qzAttempts}`, String(url), '| autosave =', autosaveNow());
        if (autosaveNow()) {
          qzRefused += 1;
          say('QZ Tray REFUSED — autosave saves the documents, so nothing should print');
          return refusedSocket(url);
        }
        say('QZ Tray: allowing it through (autosave is off)');
      }
      const socket = new OriginalWebSocket(url, ...rest);
      if (isQz) {
        liveQz.add(socket);
        socket.addEventListener('open', () => {
          qzConnected = true;
          log('QZ Tray connected — it is running, and this is what prints');
        });
        socket.addEventListener('close', (e) => {
          liveQz.delete(socket);
          log('QZ socket closed, code', e?.code);
        });
      }
      return socket;
    };
    PrintServiceSocket.prototype = OriginalWebSocket.prototype;
    for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) {
      PrintServiceSocket[k] = OriginalWebSocket[k];
    }
    window.WebSocket = PrintServiceSocket;

    // A bundle loading later can overwrite these. Check periodically and put
    // them back, saying so, since a silently replaced hook looks identical to
    // a hook that never worked.
    setInterval(() => {
      if (window.WebSocket !== PrintServiceSocket) {
        say('window.WebSocket had been replaced — re-installing');
        window.WebSocket = PrintServiceSocket;
      }
      if (window.print !== wrappedPrint) {
        say('window.print had been replaced — re-installing');
        window.print = wrappedPrint;
      }
    }, 1000);
  } catch (err) {
    say('could not install the WebSocket hook:', String(err?.message ?? err));
  }

  const origWindowOpen = window.open;
  window.open = function (url, ...rest) {
    const target = String(url ?? '');
    log('window.open ->', target || '(no url)');
    const fresh = Date.now() - lastCaptureAt < PRINT_GRACE_MS;
    if (target && LABEL_RE.test(target) && autosaveNow() && fresh) {
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
        log('added', tag, 'src=', String(src).slice(0, 80) || '(none)');
        if (tag === 'IFRAME') {
          hookFrame(node);
          node.addEventListener?.('load', () => hookFrame(node), { once: true });
        }
      } else if (src && LABEL_RE.test(src)) {
        log('element added pointing at a label:', tag, src);
      }
      node.querySelectorAll?.('iframe,embed,object').forEach((el) => {
        log('nested', el.tagName, 'src=', String(el.getAttribute('src') || '').slice(0, 80) || '(none)');
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
    const input = args[0];
    const url = typeof input === 'string' ? input : input?.url ?? (input ? String(input) : '');
    const isLabel = !!url && LABEL_RE.test(url);
    // What a retry needs to repeat THIS request exactly — Myntra's API wants
    // the page's own x-myntra headers, not just the cookie. A Request object
    // can only be read once, so a copy is taken before the page's goes out.
    let again = null;
    if (isLabel) {
      try {
        again = typeof Request !== 'undefined' && input instanceof Request ? { input: input.clone(), init: args[1] } : { input: url, init: args[1] };
      } catch {
        again = { input: url, init: args[1] };
      }
    }
    const out = origFetch.apply(this, args);
    if (!url) return out;
    if (isLabel) {
      log('fetch ->', url);
      out.catch((err) => {
        say('label request FAILED:', String(err?.message ?? err), '-', absolute(url));
        retryLabel(url, again, String(err?.message ?? err));
      });
    }
    return out.then((res) => {
      try {
        if (url.includes('/api/mdirect/packets/') && url.includes('/items?skuCode=')) {
          res.clone().text().then(text => {
            try {
              const data = JSON.parse(text);
              if (data?.status?.statusCode === 86 && data?.status?.statusMessage?.includes('GENIE')) {
                const sku = new URL(url, window.location.href).searchParams.get('skuCode');
                if (sku) post({ type: 'GENIE_ERROR', sku });
              }
            } catch {}
          }).catch(() => {});
        } else if (PACKET_RE.test(url)) {
          res.clone().text().then(notePacket).catch(() => {});
        } else if (isLabel) {
          if (!res.ok) {
            say('label request returned', res.status, res.statusText, '-', absolute(url));
            retryLabel(url, again, `${res.status} ${res.statusText}`);
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
  // re-downloads it. One quiet retry (the same request, headers and all) costs
  // nothing and saves that. Once per document per minute, so a re-download
  // later that fails again gets its own retry.
  const RETRY_AGAIN_AFTER_MS = 60_000;
  const retriedAt = new Map();
  const retrying = new Set(); // a retry still waiting / in flight reports for itself
  async function retryLabel(url, again, why = 'failed') {
    // Autosave off: the page is left exactly as it is — no extra request.
    if (!autosaveNow()) return;
    const absoluteUrl = absolute(url);
    if (retrying.has(absoluteUrl)) return;
    const last = retriedAt.get(absoluteUrl);
    if (last && Date.now() - last < RETRY_AGAIN_AFTER_MS) {
      log('already retried that label just now, leaving it');
      post({ type: 'LABEL_FAILED', url: absoluteUrl, detail: why });
      return;
    }
    retriedAt.set(absoluteUrl, Date.now());
    retrying.add(absoluteUrl);
    try {
      await retryOnce(absoluteUrl, again);
    } finally {
      retrying.delete(absoluteUrl);
    }
  }
  async function retryOnce(absoluteUrl, again) {
    for (const [u, at] of retriedAt) if (Date.now() - at > RETRY_AGAIN_AFTER_MS) retriedAt.delete(u);
    await new Promise((r) => setTimeout(r, 1500));
    say('retrying the failed label request…');
    try {
      // Never the page's own AbortSignal: a page that aborted (or timed out)
      // its request would abort the retry before it went out.
      const res = again ? await origFetch(again.input, { ...(again.init || {}), signal: null }) : await origFetch(absoluteUrl, { credentials: 'include' });
      if (!res.ok) {
        say('retry also failed:', res.status, res.statusText, '— re-download it from Myntra');
        post({ type: 'LABEL_FAILED', url: absoluteUrl, detail: `${res.status} ${res.statusText}` });
        return;
      }
      const buf = await res.arrayBuffer();
      say('retry succeeded,', buf.byteLength, 'bytes');
      send(absoluteUrl, toBase64(buf), res.headers.get('content-type') ?? '');
    } catch (err) {
      say('retry failed:', String(err?.message ?? err), '— re-download it from Myntra');
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
        if (url.includes('/api/mdirect/packets/') && url.includes('/items?skuCode=')) {
          try {
            const data = JSON.parse(this.responseText);
            if (data?.status?.statusCode === 86 && data?.status?.statusMessage?.includes('GENIE')) {
              const sku = new URL(url, window.location.href).searchParams.get('skuCode');
              if (sku) post({ type: 'GENIE_ERROR', sku });
            }
          } catch {}
          return;
        }
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
          // Encode the text as UTF-8 bytes, then convert to Base64 without
          // the deprecated unescape() function.
          const textBytes = new TextEncoder().encode(this.responseText);
          send(url, toBase64(textBytes.buffer), xhrType);
        } else send(url, null, xhrType);
      } catch {
        /* same — stay out of the page's way */
      }
    });
    return origSend.apply(this, args);
  };
})();
