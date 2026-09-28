// Put in by background.js (chrome.scripting.registerContentScripts) at
// document_start in the page's own world, ONLY while autosave is on. It runs
// before any of the page's scripts, so inject.js knows at once that QZ Tray is
// to be refused — the chrome.storage answer relayed by content.js is async and
// could arrive after the page has already contacted QZ Tray. With autosave off
// it isn't registered at all, and the page is left untouched.
window.__picklistAutosaveAtStart = true;
