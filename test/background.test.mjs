// Loads the real background.js with a fake chrome.* and checks what it does
// with the page's messages and the autosave setting.
//   node test/background.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const store = { autosave: true, pageSize: 'original' };
const registered = new Map();
const listeners = { msg: [], storage: [], installed: [] };
const toPanel = [];
const downloads = [];
const tick = () => new Promise((r) => setTimeout(r, 20));

globalThis.chrome = {
  runtime: {
    id: 'EXT',
    onInstalled: { addListener: (f) => listeners.installed.push(f) },
    onMessage: { addListener: (f) => listeners.msg.push(f) },
    sendMessage: async (m) => { toPanel.push(m); },
  },
  sidePanel: { setPanelBehavior: async () => {} },
  storage: {
    local: { get: async (k) => (typeof k === 'string' ? { [k]: store[k] } : Object.fromEntries(k.map((x) => [x, store[x]]))), set: async (o) => Object.assign(store, o) },
    onChanged: { addListener: (f) => listeners.storage.push(f) },
  },
  scripting: {
    getRegisteredContentScripts: async ({ ids }) => ids.filter((id) => registered.has(id)).map((id) => registered.get(id)),
    registerContentScripts: async (list) => { for (const s of list) { if (registered.has(s.id)) throw new Error('Duplicate script ID'); registered.set(s.id, s); } },
    unregisterContentScripts: async ({ ids }) => { for (const id of ids) registered.delete(id); },
    executeScript: async () => {},
  },
  tabs: { query: async () => [], sendMessage: async () => {}, onUpdated: { addListener() {} } },
  windows: { getLastFocused: async () => null },
  downloads: { download: async (o) => { downloads.push(o.filename); return downloads.length; }, onChanged: { addListener() {} } },
};

await import('../background.js');
const send = (msg, url = 'https://mdirect.myntrainfo.com/PackOrder/Operations') => {
  for (const f of listeners.msg) f(msg, { id: 'EXT', tab: { url } }, () => {});
};
const setAutosave = async (on) => {
  const old = store.autosave;
  store.autosave = on;
  for (const f of listeners.storage) f({ autosave: { oldValue: old, newValue: on } }, 'local');
  await tick();
};
const pdf = readFileSync(here('fixtures/invoice-a4.pdf')).toString('base64');
const doc = (n) => ({ type: 'LABEL_DOC', url: `https://partnersapi.myntrainfo.com/api/mdirect/orders/getPacketInvoice/2297?sellerOrderId=${n}`, packet: null, body: pdf, contentType: 'application/pdf' });

/* 1. The start-of-page flag script is registered exactly while autosave is on */
await tick();
assert.ok(registered.has('autosave-flag'), 'registered at start (autosave on)');
assert.equal(registered.get('autosave-flag').world, 'MAIN');
await setAutosave(false); assert.ok(!registered.has('autosave-flag'), 'removed when autosave goes off');
await setAutosave(true); await setAutosave(true); assert.ok(registered.has('autosave-flag'), 'back on, no duplicate error');
for (const f of listeners.installed) f({ reason: 'update' });
await tick(); assert.ok(registered.has('autosave-flag'), 're-registered afresh on update');
console.log('PASS  the autosave flag script follows the setting (and survives an update)');

/* 2. Documents: only from the pack site; a later route on the same site still counts */
send(doc(1), 'https://evil.example/PackOrder/');
await tick(); assert.equal(downloads.length, 0, 'not from the pack site: ignored');
send(doc(2), 'https://mdirect.myntrainfo.com/Dashboard');
await tick(); assert.equal(downloads.length, 1, 'same site, another route: saved');
console.log('PASS  documents only from the pack site, any route');

/* 3. Over 30 a minute: the rest reported in the panel, not dropped silently */
for (let i = 0; i < 31; i++) send(doc(100 + i));
await new Promise((r) => setTimeout(r, 300));
assert.equal(downloads.length, 30, 'the limit holds (one was saved in 2)');
assert.ok(toPanel.some((m) => m.type === 'AUTOSAVE_RESULT' && m.reason === 'rate-limited'));
console.log('PASS  over the limit is reported in the panel');

/* 4. A failed label and a late start are news only while autosave is on */
toPanel.length = 0;
send({ type: 'LABEL_FAILED', url: doc(9).url, detail: '500' });
send({ type: 'LATE_START' });
await tick();
assert.ok(toPanel.some((m) => m.reason === 'myntra-error')); assert.ok(toPanel.some((m) => m.reason === 'late-start'));
await setAutosave(false); toPanel.length = 0;
send({ type: 'LABEL_FAILED', url: doc(9).url, detail: '500' });
send({ type: 'LATE_START' });
await tick();
assert.equal(toPanel.length, 0, 'autosave off: nothing to report');
console.log('PASS  failures and late starts are reported only while autosave is on');
