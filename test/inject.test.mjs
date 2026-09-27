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
    document: { documentElement: {}, addEventListener() {} },
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
