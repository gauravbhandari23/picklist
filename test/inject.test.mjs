// Runs inject.js in a minimal fake page and checks the QZ Tray behaviour
// directly. This is the logic that decides whether the Save dialogs appear, it
// cannot be checked without a real packed order otherwise, and packed orders
// are scarce.
//   node test/inject.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const source = readFileSync(fileURLToPath(new URL('../inject.js', import.meta.url)), 'utf8');

function makePage() {
  const logs = [];
  const messageListeners = [];
  const realSockets = [];

  class FakeWebSocket {
    constructor(url) {
      this.url = String(url);
      this.readyState = 0;
      realSockets.push(this);
    }
    send() {}
    close() {}
    addEventListener() {}
    removeEventListener() {}
  }
  FakeWebSocket.CONNECTING = 0;
  FakeWebSocket.OPEN = 1;
  FakeWebSocket.CLOSING = 2;
  FakeWebSocket.CLOSED = 3;

  const win = {
    location: { href: 'https://mdirect.myntrainfo.com/PackOrder/Operations', origin: 'https://mdirect.myntrainfo.com' },
    WebSocket: FakeWebSocket,
    print: () => logs.push('REAL PRINT RAN'),
    open: () => ({ real: true }),
    fetch: async () => ({ ok: true, headers: { get: () => '' }, clone: () => ({ arrayBuffer: async () => new ArrayBuffer(0) }) }),
    XMLHttpRequest: function () {},
    MutationObserver: class { observe() {} },
    addEventListener(type, fn) { if (type === 'message') messageListeners.push(fn); },
    // The source must be the window as seen from INSIDE the context. vm gives
    // the script a different global object from the one handed to
    // createContext, and inject.js rightly checks event.source === window.
    postMessage(data) { for (const fn of messageListeners) fn({ source: win.__inner, data }); },
    setTimeout, setInterval: () => 0, clearInterval: () => {},
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    Event: globalThis.Event,
    URL: globalThis.URL,
    console: { log: (...a) => logs.push(a.map(String).join(' ')) },
    document: { documentElement: {}, addEventListener() {}, readyState: 'loading' },
  };
  win.window = win;
  win.top = win;
  win.XMLHttpRequest.prototype = { open() {}, send() {} };
  return { win, logs, realSockets };
}

function run() {
  const page = makePage();
  vm.createContext(page.win);
  page.win.__inner = vm.runInContext('window', page.win);
  vm.runInContext(source, page.win);
  return page;
}

/* 1. It installs its hooks */
{
  const { win, logs } = run();
  assert.notEqual(win.WebSocket.name, 'FakeWebSocket', 'WebSocket must be wrapped');
  // Match the shape, not the name — the stamp changes with every build, and a
  // test that has to be edited alongside it teaches nothing.
  assert.match(logs[0], /build \d{4}-\d{2}-\d{2}/, `build stamp should come first: ${logs[0]}`);
  console.log('PASS  inject.js installs and announces its build');
}

/* 2. Autosave OFF: QZ Tray must be left completely alone */
{
  const { win, logs, realSockets } = run();
  const sock = new win.WebSocket('wss://localhost:8181');
  assert.equal(realSockets.length, 1, 'a real socket must be created when autosave is off');
  assert.equal(sock.url, 'wss://localhost:8181');
  assert.ok(logs.some((l) => l.includes('allowing it through')), 'and it should say so');
  assert.ok(!logs.some((l) => l.includes('REFUSED')), 'nothing may be refused while autosave is off');
  console.log('PASS  autosave off — QZ Tray connects normally, nothing blocked');
}

/* 3. Autosave ON: QZ Tray must be refused, exactly like a closed port */
{
  const { win, logs, realSockets } = run();
  win.postMessage({ __myntraPicklistPanel: true, type: 'AUTOSAVE_STATE', on: true });
  assert.ok(logs.some((l) => l.includes('autosave is ON')), 'the state must be received');

  const before = realSockets.length;
  const sock = new win.WebSocket('wss://localhost:8181');
  assert.equal(realSockets.length, before, 'no real connection may be opened');
  assert.ok(logs.some((l) => l.includes('REFUSED')), 'and it must say it refused');
  assert.equal(sock.readyState, 0, 'starts as CONNECTING, like a real one');

  // It must then fail the way a closed port does, or QZ's client hangs.
  const seen = [];
  sock.onerror = () => seen.push('error');
  sock.onclose = () => seen.push('close');
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(seen, ['error', 'close'], 'must fire error then close');
  assert.equal(sock.readyState, 3, 'and end up CLOSED');
  console.log('PASS  autosave on — QZ Tray refused, failing exactly like a closed port');
}

/* 4. addEventListener must work too — QZ's client uses both styles */
{
  const { win } = run();
  win.postMessage({ __myntraPicklistPanel: true, type: 'AUTOSAVE_STATE', on: true });
  const sock = new win.WebSocket('wss://localhost.qz.io:8282');
  const seen = [];
  sock.addEventListener('error', () => seen.push('error'));
  sock.addEventListener('close', () => seen.push('close'));
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(seen, ['error', 'close'], 'addEventListener handlers must fire as well');
  console.log('PASS  the refused socket works with addEventListener, not just onerror');
}

/* 5. Every port QZ walks must be refused, and nothing else touched */
{
  const { win, logs, realSockets } = run();
  win.postMessage({ __myntraPicklistPanel: true, type: 'AUTOSAVE_STATE', on: true });
  for (const url of [
    'wss://localhost:8181', 'wss://localhost:8282', 'wss://localhost:8383', 'wss://localhost:8484',
    'wss://localhost.qz.io:8181', 'wss://localhost.qz.io:8484', 'wss://127.0.0.1:8181',
  ]) new win.WebSocket(url);
  assert.equal(realSockets.length, 0, 'none of QZ\'s ports may connect');
  assert.equal(logs.filter((l) => l.includes('REFUSED')).length, 7, 'each attempt logged');

  // An unrelated socket must still work — this hook must not break the app.
  new win.WebSocket('wss://api.myntrainfo.com/live');
  assert.equal(realSockets.length, 1, 'a non-QZ socket must connect normally');
  console.log('PASS  all QZ ports refused; unrelated sockets untouched');
}

/* 6. The status line, which is the field diagnostic */
{
  const { win } = run();
  win.postMessage({ __myntraPicklistPanel: true, type: 'AUTOSAVE_STATE', on: true });
  new win.WebSocket('wss://localhost:8181');
  const s = win.__picklistStatus();
  assert.equal(s.autosaveOn, true);
  assert.equal(s.webSocketIsOurs, true, 'must report the hook as installed');
  assert.equal(s.qzAttempts, 1);
  assert.equal(s.qzRefused, 1);
  assert.equal(s.qzConnected, false);
  assert.ok(String(s.build).length > 5, 'and carry the build stamp');
  console.log(`PASS  __picklistStatus() reports truthfully (build ${s.build})`);
}

/* 7. Only QZ Tray's own host + port is refused — another local socket is left alone */
{
  const { win, realSockets } = run();
  win.postMessage({ __myntraPicklistPanel: true, type: 'AUTOSAVE_STATE', on: true });
  new win.WebSocket('ws://localhost:3000/hmr');
  new win.WebSocket('wss://localhost.evil.example:8181');
  assert.equal(realSockets.length, 2, 'non-QZ local sockets must connect');
  new win.WebSocket('ws://localhost:8182');
  assert.equal(realSockets.length, 2, "QZ's plain port is refused too");
  console.log('PASS  only QZ Tray hosts/ports are refused');
}

/* 8. It asks for the autosave state (re-injected after a single-page navigation) */
{
  const page = makePage();
  const posted = [];
  const origPost = page.win.postMessage;
  page.win.postMessage = (data, origin) => { posted.push(data); origPost(data, origin); };
  vm.createContext(page.win);
  page.win.__inner = vm.runInContext('window', page.win);
  vm.runInContext(source, page.win);
  assert.ok(posted.some((m) => m.__myntraPicklistPanel && m.type === 'HELLO'), 'HELLO posted');
  console.log('PASS  asks the content script for the autosave state');
}

/* 9. Each file is named after its own packet (matched by the label's order id) */
{
  const page = makePage();
  const posted = [];
  const origPost = page.win.postMessage;
  page.win.postMessage = (data, origin) => { posted.push(data); origPost(data, origin); };
  const bodies = {
    'ready-to-ship': JSON.stringify({ data: [{ id: 111, packetItems: [{ portalOrderReleaseId: 1001 }] }, { id: 222, packetItems: [{ portalOrderReleaseId: 1002 }] }] }),
  };
  page.win.fetch = async (u) => {
    const url = String(u);
    const text = bodies[Object.keys(bodies).find((k) => url.includes(k))] ?? '%PDF-1.4';
    return { ok: true, status: 200, headers: { get: () => 'application/pdf' }, clone: () => ({ text: async () => text, arrayBuffer: async () => new TextEncoder().encode(text).buffer }) };
  };
  vm.createContext(page.win);
  page.win.__inner = vm.runInContext('window', page.win);
  vm.runInContext(source, page.win);
  await page.win.fetch('https://partnersapi.myntrainfo.com/api/mdirect/orders/ready-to-ship');
  await new Promise((r) => setTimeout(r, 10));
  await page.win.fetch('https://partnersapi.myntrainfo.com/api/mdirect/orders/getPacketInvoice/2297?sellerOrderId=1001');
  await page.win.fetch('https://partnersapi.myntrainfo.com/api/mdirect/orders/getShippingLabelForSellerPacketV2/2297?sellerOrderId=1002');
  await page.win.fetch('https://partnersapi.myntrainfo.com/api/mdirect/orders/getPacketInvoice/2297?sellerOrderId=9999');
  await new Promise((r) => setTimeout(r, 10));
  const docs = posted.filter((m) => m.type === 'LABEL_DOC');
  assert.equal(docs.length, 3);
  assert.equal(docs[0].packet.packetId, 111); assert.equal(docs[1].packet.packetId, 222);
  assert.equal(docs[2].packet, null, 'an order with no packet seen gets no (wrong) packet');
  console.log('PASS  files are named after their own packet');
}

/* 10. A failed label is retried with the page's own request (its headers, never its abort signal),
       once per minute — a second failure inside that minute is reported, not retried */
{
  const page = makePage();
  const posted = [];
  const origPost = page.win.postMessage;
  page.win.postMessage = (data, origin) => { posted.push(data); origPost(data, origin); };
  const calls = [];
  page.win.fetch = async (u, init) => {
    calls.push({ url: String(u), init });
    return { ok: false, status: 500, statusText: 'err', headers: { get: () => '' }, clone: () => ({}) };
  };
  vm.createContext(page.win);
  page.win.__inner = vm.runInContext('window', page.win);
  vm.runInContext(source, page.win);
  page.win.postMessage({ __myntraPicklistPanel: true, type: 'AUTOSAVE_STATE', on: true });
  const aborted = { aborted: true };
  const init = { headers: { 'x-myntra-app-name': 'mdirect' }, credentials: 'include', signal: aborted };
  const url = 'https://partnersapi.myntrainfo.com/api/mdirect/orders/getPacketInvoice/1?sellerOrderId=5';
  await page.win.fetch(url, init);
  await new Promise((r) => setTimeout(r, 1700));
  assert.equal(calls.length, 2, 'one retry');
  assert.deepEqual(calls[1].init.headers, init.headers, 'the retry carries the original headers');
  assert.equal(calls[1].init.signal, null, "and not the page's abort signal");
  assert.equal(posted.filter((m) => m.type === 'LABEL_FAILED').length, 1, 'retry failed → reported');
  await page.win.fetch(url, init);
  await new Promise((r) => setTimeout(r, 1700));
  assert.equal(calls.length, 3, 'no second retry within the minute');
  assert.equal(posted.filter((m) => m.type === 'LABEL_FAILED').length, 2, 'but that failure is reported too');
  console.log('PASS  a failed label is retried with its own headers (no abort signal), once per minute, every failure reported');
}

/* 11. Autosave OFF: a failed label is left alone — no extra request, nothing reported */
{
  const page = makePage();
  const posted = [];
  const origPost = page.win.postMessage;
  page.win.postMessage = (data, origin) => { posted.push(data); origPost(data, origin); };
  const calls = [];
  page.win.fetch = async (u) => { calls.push(String(u)); return { ok: false, status: 500, statusText: 'err', headers: { get: () => '' }, clone: () => ({}) }; };
  vm.createContext(page.win);
  page.win.__inner = vm.runInContext('window', page.win);
  vm.runInContext(source, page.win);
  page.win.postMessage({ __myntraPicklistPanel: true, type: 'AUTOSAVE_STATE', on: false });
  await page.win.fetch('https://partnersapi.myntrainfo.com/api/mdirect/orders/getPacketInvoice/1?sellerOrderId=5');
  await new Promise((r) => setTimeout(r, 1700));
  assert.equal(calls.length, 1, 'no retry'); assert.equal(posted.filter((m) => m.type === 'LABEL_FAILED').length, 0);
  console.log('PASS  autosave off — a failed label is left to the page, no extra request');
}

/* 12. The start-of-page flag refuses QZ before the state message arrives; a QZ socket let
       through before autosave was known is closed when it turns ON */
{
  const page = makePage();
  page.win.__picklistAutosaveAtStart = true;
  vm.createContext(page.win);
  page.win.__inner = vm.runInContext('window', page.win);
  vm.runInContext(source, page.win);
  new page.win.WebSocket('wss://localhost:8181');
  assert.equal(page.realSockets.length, 0, 'refused on the flag alone');
  const p2 = makePage();
  vm.createContext(p2.win);
  p2.win.__inner = vm.runInContext('window', p2.win);
  vm.runInContext(source, p2.win);
  let closed = 0;
  new p2.win.WebSocket('wss://localhost:8181');
  p2.realSockets[0].close = () => { closed++; };
  p2.win.postMessage({ __myntraPicklistPanel: true, type: 'AUTOSAVE_STATE', on: true });
  assert.equal(closed, 1, 'the early connection is closed');
  console.log('PASS  start-of-page flag refuses QZ at once; an early QZ connection is closed when autosave turns on');
}

/* 13. Before any document matched its packet by id, the packet just packed names it (as before) */
{
  const page = makePage();
  const posted = [];
  const origPost = page.win.postMessage;
  page.win.postMessage = (data, origin) => { posted.push(data); origPost(data, origin); };
  page.win.fetch = async (u) => {
    const url = String(u);
    const text = url.includes('ready-to-ship') ? JSON.stringify({ data: { id: 777, packetItems: [{ portalOrderReleaseId: 55 }] } }) : '%PDF-1.4';
    return { ok: true, status: 200, headers: { get: () => 'application/pdf' }, clone: () => ({ text: async () => text, arrayBuffer: async () => new TextEncoder().encode(text).buffer }) };
  };
  vm.createContext(page.win);
  page.win.__inner = vm.runInContext('window', page.win);
  vm.runInContext(source, page.win);
  await page.win.fetch('https://partnersapi.myntrainfo.com/api/mdirect/orders/packets/777/ready-to-ship');
  await new Promise((r) => setTimeout(r, 10));
  await page.win.fetch('https://partnersapi.myntrainfo.com/api/mdirect/orders/getPacketInvoice/2297?sellerOrderId=OTHER');
  await new Promise((r) => setTimeout(r, 10));
  const doc = posted.find((m) => m.type === 'LABEL_DOC');
  assert.equal(doc.packet.packetId, 777); assert.equal(doc.packet.matched, false);
  console.log('PASS  until ids are seen to match, the packet just packed names the file');
}

// Helper: a page with a controllable clock and a message log.
function clockPage({ fetchImpl, now = { t: 1_700_000_000_000 } } = {}) {
  const page = makePage();
  const posted = [];
  const origPost = page.win.postMessage;
  page.win.postMessage = (data, origin) => { posted.push(data); origPost(data, origin); };
  if (fetchImpl) page.win.fetch = fetchImpl;
  const RealDate = Date;
  page.win.Date = class extends RealDate { static now() { return now.t; } };
  vm.createContext(page.win);
  page.win.__inner = vm.runInContext('window', page.win);
  vm.runInContext(source, page.win);
  return { page, posted, now };
}
const fail500 = async () => ({ ok: false, status: 500, statusText: 'err', headers: { get: () => '' }, clone: () => ({}) });

/* 14. Loaded with the start flag, then the relayed state says OFF → QZ is let through again */
{
  const page = makePage();
  page.win.__picklistAutosaveAtStart = true;
  vm.createContext(page.win);
  page.win.__inner = vm.runInContext('window', page.win);
  vm.runInContext(source, page.win);
  page.win.postMessage({ __myntraPicklistPanel: true, type: 'AUTOSAVE_STATE', on: false });
  new page.win.WebSocket('wss://localhost:8181');
  assert.equal(page.realSockets.length, 1, 'the relayed OFF wins over the start flag');
  console.log('PASS  a relayed OFF wins over the start-of-page flag');
}

/* 15. A live QZ connection is NOT closed when the state says OFF */
{
  const page = makePage();
  vm.createContext(page.win);
  page.win.__inner = vm.runInContext('window', page.win);
  vm.runInContext(source, page.win);
  let closed = 0;
  new page.win.WebSocket('wss://localhost:8181');
  page.realSockets[0].close = () => { closed++; };
  page.win.postMessage({ __myntraPicklistPanel: true, type: 'AUTOSAVE_STATE', on: false });
  assert.equal(closed, 0);
  console.log('PASS  autosave OFF never closes a QZ Tray connection');
}

/* 16. A Request input is retried as a copy of that Request (headers kept), without its signal */
{
  const calls = [];
  class FakeRequest {
    constructor(url, init = {}) { this.url = url; this.headers = init.headers; this.signal = init.signal; }
    clone() { return new FakeRequest(this.url, { headers: this.headers, signal: this.signal }); }
  }
  const page = makePage();
  page.win.Request = FakeRequest;
  page.win.fetch = async (input, init) => { calls.push({ input, init }); return fail500(); };
  vm.createContext(page.win);
  page.win.__inner = vm.runInContext('window', page.win);
  vm.runInContext(source, page.win);
  page.win.postMessage({ __myntraPicklistPanel: true, type: 'AUTOSAVE_STATE', on: true });
  const req = new FakeRequest('https://partnersapi.myntrainfo.com/api/mdirect/orders/getPacketInvoice/1?sellerOrderId=5', { headers: { 'x-myntra-app-name': 'mdirect' }, signal: { aborted: true } });
  await page.win.fetch(req);
  await new Promise((r) => setTimeout(r, 1700));
  assert.equal(calls.length, 2);
  assert.notEqual(calls[1].input, req, 'a copy, not the consumed original');
  assert.deepEqual(calls[1].input.headers, req.headers); assert.equal(calls[1].init.signal, null);
  console.log('PASS  a Request input is retried as a copy, headers kept, signal dropped');
}

/* 17. The one-minute retry window ends: a failure after it is retried again */
{
  const calls = [];
  const { page, now } = clockPage({ fetchImpl: async (u) => { calls.push(String(u)); return fail500(); } });
  page.win.postMessage({ __myntraPicklistPanel: true, type: 'AUTOSAVE_STATE', on: true });
  const url = 'https://partnersapi.myntrainfo.com/api/mdirect/orders/getPacketInvoice/1?sellerOrderId=5';
  await page.win.fetch(url); await new Promise((r) => setTimeout(r, 1700));
  assert.equal(calls.length, 2);
  now.t += 61_000;
  await page.win.fetch(url); await new Promise((r) => setTimeout(r, 1700));
  assert.equal(calls.length, 4, 'retried again after the minute');
  console.log('PASS  the retry window is one minute, then a failure is retried again');
}

/* 18. A second failure while the first retry is still waiting stays quiet — the retry reports for itself */
{
  let n = 0;
  const { page, posted } = clockPage({
    fetchImpl: async () => (++n <= 2 ? fail500() : { ok: true, status: 200, headers: { get: () => 'application/pdf' }, arrayBuffer: async () => new ArrayBuffer(4), clone: () => ({ arrayBuffer: async () => new ArrayBuffer(4) }) }),
  });
  page.win.postMessage({ __myntraPicklistPanel: true, type: 'AUTOSAVE_STATE', on: true });
  const url = 'https://partnersapi.myntrainfo.com/api/mdirect/orders/getPacketInvoice/1?sellerOrderId=7';
  await page.win.fetch(url); await page.win.fetch(url);
  await new Promise((r) => setTimeout(r, 1700));
  assert.equal(posted.filter((m) => m.type === 'LABEL_FAILED').length, 0, 'no "not saved" for a document that then saved');
  assert.equal(posted.filter((m) => m.type === 'LABEL_DOC').length, 1);
  console.log('PASS  a failure during a pending retry is not reported as "not saved"');
}

/* 19. The naming fallback lasts 2 minutes and takes the FIRST row of a multi-row answer */
{
  const text = JSON.stringify({ data: [{ id: 901, packetItems: [{ portalOrderReleaseId: 1 }] }, { id: 902, packetItems: [{ portalOrderReleaseId: 2 }] }] });
  const { page, posted, now } = clockPage({
    fetchImpl: async (u) => {
      const t = String(u).includes('ready-to-ship') ? text : '%PDF-1.4';
      return { ok: true, status: 200, headers: { get: () => 'application/pdf' }, clone: () => ({ text: async () => t, arrayBuffer: async () => new TextEncoder().encode(t).buffer }) };
    },
  });
  await page.win.fetch('https://partnersapi.myntrainfo.com/api/mdirect/orders/packets/901/ready-to-ship');
  await new Promise((r) => setTimeout(r, 10));
  await page.win.fetch('https://partnersapi.myntrainfo.com/api/mdirect/orders/getPacketInvoice/1?sellerOrderId=X');
  await new Promise((r) => setTimeout(r, 10));
  now.t += 121_000;
  await page.win.fetch('https://partnersapi.myntrainfo.com/api/mdirect/orders/getPacketInvoice/1?sellerOrderId=Y');
  await new Promise((r) => setTimeout(r, 10));
  const docs = posted.filter((m) => m.type === 'LABEL_DOC');
  assert.equal(docs[0].packet.packetId, 901, 'first row, as before');
  assert.equal(docs[1].packet, null, 'no fallback after 2 minutes');
  console.log('PASS  the naming fallback takes the first row and lasts 2 minutes');
}

/* 20. Put in after the page loaded → says so (reload needed) */
{
  const page = makePage();
  page.win.document.readyState = 'complete';
  const posted = [];
  const origPost = page.win.postMessage;
  page.win.postMessage = (data, origin) => { posted.push(data); origPost(data, origin); };
  vm.createContext(page.win);
  page.win.__inner = vm.runInContext('window', page.win);
  vm.runInContext(source, page.win);
  assert.ok(posted.some((m) => m.type === 'LATE_START'));
  console.log('PASS  a late start (after the page loaded) is reported');
}
