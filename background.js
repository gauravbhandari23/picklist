// Opens the side panel, relays panel -> pack-page messages, and — when
// autosave is on — saves the shipping label and invoice itself.
//
// Saving beats printing here: after a packet is packed the page fetches both
// documents from the API, so they can be downloaded directly. There is no
// print dialog to suppress, and the packet id can go in the filename.

import { classifyLabelUrl, labelFilename, idsFromLabelUrl, planSave, describePayload } from './labels.js';
import { repaginate, SHEETS } from './repaginate.js';

const PACK_URL = '*://mdirect.myntrainfo.com/PackOrder/*';
const PACK_PATTERN = /^https?:\/\/mdirect\.myntrainfo\.com\/PackOrder\//i;
const FILL_TYPES = new Set(['FILL', 'FILL_PICKLIST']);
// Only long enough to ignore the same response being reported twice, which
// happens within milliseconds. A whole minute would silently swallow a
// deliberate re-download from the portal — exactly what someone does when a
// document failed the first time.
const DEDUPE_MS = 5_000;

chrome.runtime.onInstalled.addListener((details) => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  // An update may change the flag script's registration: registered afresh.
  if (details?.reason === 'update') syncAutosaveFlag({ fresh: true });
});
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// The start-of-page autosave flag (autosave-flag.js) is registered exactly while
// autosave is on — kept in step with the setting on every change and whenever
// this worker starts. Calls are chained so a quick on/off/on can't interleave.
const FLAG_SCRIPT_ID = 'autosave-flag';
let flagSync = Promise.resolve();
function syncAutosaveFlag({ fresh = false } = {}) {
  flagSync = flagSync
    .then(async () => {
      const { autosave } = await chrome.storage.local.get('autosave');
      let registered = (await chrome.scripting.getRegisteredContentScripts({ ids: [FLAG_SCRIPT_ID] })).length > 0;
      if (fresh && registered) {
        await chrome.scripting.unregisterContentScripts({ ids: [FLAG_SCRIPT_ID] });
        registered = false;
      }
      if (autosave === true && !registered) {
        await chrome.scripting.registerContentScripts([
          { id: FLAG_SCRIPT_ID, matches: [PACK_URL], js: ['autosave-flag.js'], runAt: 'document_start', world: 'MAIN', persistAcrossSessions: true },
        ]);
      } else if (autosave !== true && registered) {
        await chrome.scripting.unregisterContentScripts({ ids: [FLAG_SCRIPT_ID] });
      }
    })
    .catch((err) => console.warn('[picklist] autosave flag script:', err?.message ?? err));
  return flagSync;
}
syncAutosaveFlag();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.autosave) syncAutosaveFlag();
});

// Documents are only taken from our own content script on a pack page — the
// relay carries whatever the page world posts, so anything else is ignored —
// and at most DOCS_PER_MINUTE of them (a real pack makes two).
const DOCS_PER_MINUTE = 30;
const docTimes = [];
// Any page of the pack site: the app can move off /PackOrder/ (a single-page
// navigation) while a document from the pack is still on its way.
const PACK_SITE = /^https:\/\/mdirect\.myntrainfo\.com\//i;
const fromPackPage = (sender) => sender?.id === chrome.runtime.id && PACK_SITE.test(sender?.tab?.url ?? sender?.url ?? '');
function underDocLimit() {
  const now = Date.now();
  while (docTimes.length && now - docTimes[0] > 60_000) docTimes.shift();
  if (docTimes.length >= DOCS_PER_MINUTE) return false;
  docTimes.push(now);
  return true;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (FILL_TYPES.has(msg?.type)) {
    relayToPackTab(msg).then(sendResponse);
    return true; // keep the channel open for the async reply
  }
  if (msg?.type === 'LABEL_DOC' || msg?.type === 'LABEL_FAILED' || msg?.type === 'LATE_START') {
    if (!fromPackPage(sender)) {
      console.warn('[picklist] ignored a document message not from a pack page:', sender?.tab?.url ?? sender?.url ?? '(no url)');
      return false;
    }
  }
  if (msg?.type === 'LABEL_DOC') {
    saveLabel(msg).catch(() => {});
    return false;
  }
  if (msg?.type === 'LATE_START') {
    chrome.storage.local.get('autosave').then(({ autosave }) => {
      if (autosave === true) tellPanel({ type: 'AUTOSAVE_RESULT', ok: false, kind: 'page', reason: 'late-start' });
    });
    return false;
  }
  if (msg?.type === 'LABEL_FAILED') {
    // Only news while autosave is on — with it off, Myntra prints as usual.
    chrome.storage.local.get('autosave').then(({ autosave }) => {
      if (autosave !== true) return;
      const kind = classifyLabelUrl(msg.url) ?? 'document';
      tellPanel({ type: 'AUTOSAVE_RESULT', ok: false, kind, reason: 'myntra-error', detail: msg.detail });
    });
    return false;
  }
  return false;
});

// The pack page is usually in a different tab from the one in front of you, and
// often it was already open before this extension was loaded — in which case no
// content script is running in it. Inject one rather than asking for a reload.
async function relayToPackTab(msg) {
  const tabs = await chrome.tabs.query({ url: PACK_URL });
  if (!tabs.length) return { ok: false, reason: 'no-tab' };

  // The pack tab showing in the window you last used, else any showing one,
  // else the one used most recently.
  const focused = await chrome.windows.getLastFocused().catch(() => null);
  const tab =
    tabs.find((t) => t.active && focused && t.windowId === focused.id) ??
    tabs.find((t) => t.active) ??
    [...tabs].sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0];

  try {
    return await chrome.tabs.sendMessage(tab.id, msg);
  } catch {
    // no listener there yet
  }

  await ensureScripts(tab.id);
  try {
    return await chrome.tabs.sendMessage(tab.id, msg);
  } catch {
    return { ok: false, reason: 'no-content-script' };
  }
}

/* ---------- keeping the scripts present on a single-page app ---------- */

// The pack page is a single-page app. Reaching PackOrder by clicking through
// the app changes the URL through the history API without a page load, and
// Chrome does not inject content scripts for that — so nothing runs at all,
// with no error to show for it. Watch for the URL becoming a pack page and put
// the scripts in.

async function ensureScripts(tabId) {
  // Both are guarded against running twice, so re-injecting is harmless.
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  } catch {
    /* the tab may have gone */
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['inject.js'], world: 'MAIN' });
  } catch {
    /* same */
  }
}

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  const url = info.url ?? tab?.url ?? '';
  if (!PACK_PATTERN.test(url)) return;
  if (info.url || info.status === 'complete') ensureScripts(tabId);
});

/* ---------- autosaving the label and invoice ---------- */

const bytesToBase64 = (bytes) => {
  let binary = '';
  const CHUNK = 0x8000; // String.fromCharCode cannot take a whole PDF at once
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
};
const base64ToBytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// Tell the panel how it went. The panel may be closed; that is fine.
const tellPanel = (detail) => chrome.runtime.sendMessage(detail).catch(() => {});

// Also log into the pack page's console. The service worker has a console of
// its own, but it is buried behind chrome://extensions, and this is where
// anyone debugging is already looking.
async function tellPage(...parts) {
  const tabs = await chrome.tabs.query({ url: PACK_URL }).catch(() => []);
  for (const tab of tabs) {
    chrome.tabs.sendMessage(tab.id, { type: 'DIAG', parts }).catch(() => {});
  }
}

const handled = new Map();
function alreadyHandled(url) {
  const now = Date.now();
  for (const [seen, at] of handled) if (now - at > DEDUPE_MS) handled.delete(seen);
  if (handled.has(url)) return true;
  handled.set(url, now);
  return false;
}

// A download can start and then fail — disk full, blocked, cancelled. Without
// this it would look like a silent success.
chrome.downloads.onChanged.addListener((delta) => {
  if (delta.error?.current) tellPage('download', delta.id, 'FAILED:', delta.error.current);
  else if (delta.state?.current === 'complete') tellPage('download', delta.id, 'complete');
});

async function saveLabel({ url, packet, body, contentType = '' }) {
  const kind = classifyLabelUrl(url);
  if (!kind) {
    tellPage('ignored, not a label URL:', url);
    return;
  }

  const { autosave } = await chrome.storage.local.get('autosave');
  tellPage(kind, 'seen. autosave =', autosave === true, '| body =', body ? `${body.length} base64 chars` : 'MISSING');
  if (!autosave) {
    tellPage(kind, '- autosave is OFF, nothing saved. Tick Autosave in the panel.');
    return;
  }

  if (alreadyHandled(url)) {
    tellPage(kind, '- already handled in the last few seconds, skipped');
    return;
  }
  if (!underDocLimit()) {
    tellPage(kind, '- more than', DOCS_PER_MINUTE, 'documents in a minute, not saved:', url);
    tellPanel({ type: 'AUTOSAVE_RESULT', ok: false, kind, reason: 'rate-limited' });
    return;
  }

  try {
    // The page's own response, copied. Re-requesting the URL from here would
    // fail: Myntra's API wants custom headers the page sends and we do not.
    if (!body) {
      tellPanel({ type: 'AUTOSAVE_RESULT', ok: false, kind, reason: 'no-body' });
      return;
    }
    const bytes = base64ToBytes(body);
    // Only worth decoding as text if it might be JSON or HTML.
    const text = bytes.length < 4_000_000 ? new TextDecoder().decode(bytes) : '';
    tellPage(kind, 'payload:', describePayload({ bytes, text, contentType, fromBase64: base64ToBytes }));
    tellPage(kind, 'packet info:', packet ?? '(none captured)', '| url ids:', idsFromLabelUrl(url));

    const plan = planSave({
      contentType,
      bytes,
      text,
      toBase64: bytesToBase64,
      fromBase64: base64ToBytes,
    });

    if (!plan.ok) {
      // Never save something that is not a PDF under a .pdf name.
      tellPage(kind, '- NOT SAVED, reason:', plan.reason);
      tellPanel({ type: 'AUTOSAVE_RESULT', ok: false, kind, reason: plan.reason, contentType });
      return;
    }

    // Myntra serves the label at 4x6in and the invoice at A4. Put both on one
    // sheet size so they print the way the old route did.
    let outBytes = base64ToBytes(plan.base64);
    const { pageSize = 'letter' } = await chrome.storage.local.get('pageSize');
    if (SHEETS[pageSize]) {
      try {
        const before = outBytes;
        outBytes = await repaginate(outBytes, pageSize);
        tellPage(kind, outBytes === before ? '- kept as Myntra sent it (an unusual page)' : `- re-paged onto ${SHEETS[pageSize].label}`);
      } catch (err) {
        tellPage(kind, '- could not re-page, saving the original:', err?.message ?? err);
      }
    }

    // inject.js sends the packet that is this document's own (matched by the
    // order id in its URL — or, until one has matched on that page, the packet
    // just packed); none, and the URL's own order id names the file.
    const fromUrl = idsFromLabelUrl(url);
    const filename = labelFilename({
      kind,
      packetId: packet?.packetId ?? null,
      orderId: fromUrl.orderId ?? packet?.orderId,
    });

    tellPage(kind, '- saving as', filename,
      plan.unwrapped ? '(unwrapped from its MIME envelope)' : '(bare PDF)');

    const downloadId = await chrome.downloads.download({
      url: `data:application/pdf;base64,${bytesToBase64(outBytes)}`,
      filename,
      conflictAction: 'uniquify', // Chrome appends (1), (2)… so nothing is lost
      saveAs: false,
    });

    tellPage(kind, '- SAVED, download id', downloadId, '->', filename);
    tellPanel({ type: 'AUTOSAVE_RESULT', ok: true, kind, filename });
  } catch (err) {
    tellPage(kind, '- FAILED:', err?.message ?? String(err));
    tellPanel({ type: 'AUTOSAVE_RESULT', ok: false, kind, reason: err?.message ?? 'failed' });
  }
}
