// Runs content.js in a fake page: which box does a fill go into?
//   node test/content.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const source = readFileSync(fileURLToPath(new URL('../content.js', import.meta.url)), 'utf8');

class HTMLInputElement {}
class FakeInput extends HTMLInputElement {
  constructor(placeholder, { disabled = false, visible = true } = {}) {
    super();
    Object.assign(this, { placeholder, disabled, readOnly: false, visible, value: '', name: '', id: '', isConnected: true });
  }
  getAttribute() { return null; }
  getClientRects() { return this.visible ? [1] : []; }
  focus() {}
  dispatchEvent() {}
}

function page(inputs) {
  let listener;
  const posted = [];
  const pageListeners = [];
  const ctx = {
    document: { querySelectorAll: (s) => (s === 'input' ? inputs : []) },
    HTMLInputElement, HTMLTextAreaElement: class {},
    Event: class { constructor(t) { this.type = t; } },
    KeyboardEvent: class { constructor(t) { this.type = t; } },
    Node: { DOCUMENT_POSITION_FOLLOWING: 4 },
    setTimeout, setInterval: () => 0, console,
    chrome: {
      runtime: { onMessage: { addListener: (f) => { listener = f; } }, sendMessage: async () => {} },
      storage: { local: { get: async () => ({ autosave: true }) }, onChanged: { addListener() {} } },
    },
  };
  ctx.window = {
    location: { origin: 'https://mdirect.myntrainfo.com' },
    postMessage: (data) => { posted.push(data); for (const f of pageListeners) f({ source: ctx.window, data }); },
    addEventListener: (t, f) => { if (t === 'message') pageListeners.push(f); },
  };
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  const fill = (value) => new Promise((resolve) => listener({ type: 'FILL', value }, {}, resolve));
  return { fill, posted, ctx };
}

/* 1. The real scan box is locked mid-item and another box also matches a hint: "locked", nothing typed anywhere */
{
  const real = new FakeInput('Scan Myntra/Seller SKU', { disabled: true });
  const search = new FakeInput('Search by Seller SKU');
  const { fill } = page([real, search]);
  const res = await fill('RANHK123');
  assert.equal(res.reason, 'locked'); assert.equal(search.value, ''); assert.equal(real.value, '');
  console.log('PASS  a locked scan box reports "locked" — the SKU never goes into another box');
}

/* 2. A hidden copy of the box (an old modal) is skipped for the visible one */
{
  const stale = new FakeInput('Scan Myntra/Seller SKU', { visible: false });
  const real = new FakeInput('Scan Myntra/Seller SKU');
  const { fill } = page([stale, real]);
  const res = await fill('RANHK123');
  assert.equal(res.ok, true); assert.equal(stale.value, ''); assert.notEqual(real.value, '');
  console.log('PASS  a hidden copy of the box is skipped for the visible one');
}

/* 3. HELLO from inject.js is answered with the autosave state */
{
  const { posted, ctx } = page([]);
  await new Promise((r) => setTimeout(r, 5));
  const before = posted.filter((m) => m.type === 'AUTOSAVE_STATE').length;
  ctx.window.postMessage({ __myntraPicklistPanel: true, type: 'HELLO' });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(posted.filter((m) => m.type === 'AUTOSAVE_STATE' && m.on === true).length, before + 1);
  console.log('PASS  HELLO is answered with the autosave state');
}
