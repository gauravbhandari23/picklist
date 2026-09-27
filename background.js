// Opens the side panel, relays panel -> pack-page messages, and — when
// autosave is on — saves the shipping label and invoice itself.
//
// Saving beats printing here: after a packet is packed the page fetches both
// documents from the API, so they can be downloaded directly. There is no
// print dialog to suppress, and the packet id can go in the filename.

import { classifyLabelUrl, labelFilename, idsFromLabelUrl, planSave, describePayload } from './labels.js';

const PACK_URL = '*://mdirect.myntrainfo.com/PackOrder/*';
const FILL_TYPES = new Set(['FILL', 'FILL_PICKLIST']);
const DEDUPE_MS = 60_000;

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (FILL_TYPES.has(msg?.type)) {
    relayToPackTab(msg).then(sendResponse);
    return true; // keep the channel open for the async reply
  }
  if (msg?.type === 'LABEL_DOC') {
    saveLabel(msg).catch(() => {});
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

  const tab =
    tabs.find((t) => t.active) ??
    [...tabs].sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0];

  try {
    return await chrome.tabs.sendMessage(tab.id, msg);
  } catch {
    // no listener there yet
  }

  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    // The page-world watcher has to go in too, or a tab that was already open
    // fills SKUs fine but never reports its labels.
    await chrome.scripting
      .executeScript({ target: { tabId: tab.id }, files: ['inject.js'], world: 'MAIN' })
      .catch(() => {});
    return await chrome.tabs.sendMessage(tab.id, msg);
  } catch {
    return { ok: false, reason: 'no-content-script' };
  }
}

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
    tellPage(kind, '- already handled in the last minute, skipped');
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

    const fromUrl = idsFromLabelUrl(url);
    const filename = labelFilename({
      kind,
      packetId: packet?.packetId,
      orderId: packet?.orderId ?? fromUrl.orderId,
    });

    tellPage(kind, '- saving as', filename, '(', plan.base64.length, 'base64 chars )');

    const downloadId = await chrome.downloads.download({
      url: `data:application/pdf;base64,${plan.base64}`,
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
