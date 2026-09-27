// Opens the side panel and relays panel -> pack-page messages.
// Deliberately does nothing else: no cookies, no network, no page scraping.

const PACK_URL = '*://mdirect.myntrainfo.com/PackOrder/*';
const FILL_TYPES = new Set(['FILL', 'FILL_PICKLIST']);

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!FILL_TYPES.has(msg?.type)) return false;
  relayToPackTab(msg).then(sendResponse);
  return true; // keep the channel open for the async reply
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
    return await chrome.tabs.sendMessage(tab.id, msg);
  } catch {
    return { ok: false, reason: 'no-content-script' };
  }
}
