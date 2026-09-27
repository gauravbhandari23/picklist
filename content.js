// Runs on the Myntra pack page. Two jobs only:
//   1. fill the Picklist ID or the Product SKU box when the panel asks
//   2. report which picklist the page currently has open
// It never clicks SKIP, PASS or PACK.

// The service worker may inject this file into a tab that already has it, so
// make a second copy a no-op instead of doubling every listener and timer.
if (!window.__myntraPicklistPanel) {
  window.__myntraPicklistPanel = true;

  const TARGETS = {
    FILL: { hints: [/myntra\s*\/?\s*seller/i, /seller\s*sk/i, /scan\s*product/i], label: 'scan product id' },
    FILL_PICKLIST: { hints: [/picklist\s*id/i], label: 'scan picklist id' },
  };
  const SUBMIT_CHECK_MS = 250;

  // getClientRects beats offsetParent here: offsetParent is null for anything
  // position:fixed, which is exactly what Myntra's modals are.
  const isVisible = (el) => el.getClientRects().length > 0;
  const isUsable = (el) => el && isVisible(el) && !el.disabled && !el.readOnly;
  const describe = (el) => [el.placeholder, el.getAttribute('aria-label'), el.name, el.id].filter(Boolean).join(' ');

  function findInput(hints) {
    const inputs = [...document.querySelectorAll('input')];
    for (const re of hints) {
      const hit = inputs.find((el) => re.test(describe(el)));
      if (hit) return hit;
    }
    return null;
  }

  // If Myntra ever drops the placeholder, fall back to the first usable input
  // after the matching heading.
  function inputAfterLabel(text) {
    const label = [...document.querySelectorAll('*')].find(
      (el) => el.children.length === 0 && el.textContent.trim().toLowerCase() === text,
    );
    if (!label) return null;
    return (
      [...document.querySelectorAll('input')]
        .filter(isUsable)
        .find((el) => label.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) ?? null
    );
  }

  // React keeps its own copy of the value, so a plain `el.value = x` is ignored.
  // Going through the prototype setter makes React see a real change.
  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // A hardware scanner submits by typing Enter, so the page already handles these
  // events. We send the same ones rather than forcing a form submit, which could
  // scan the item twice.
  function pressEnter(el) {
    const init = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    for (const type of ['keydown', 'keypress', 'keyup']) el.dispatchEvent(new KeyboardEvent(type, init));
  }

  function fill({ hints, label }, value, sendResponse) {
    const el = findInput(hints) ?? inputAfterLabel(label);
    if (!el) {
      sendResponse({ ok: false, reason: 'no-field' });
      return;
    }
    // The box exists but the page has locked it — usually already filled in.
    if (!isUsable(el)) {
      sendResponse({ ok: false, reason: 'locked', current: el.value?.trim() || null });
      return;
    }
    el.focus();
    setNativeValue(el, value);
    pressEnter(el);

    // On a successful scan Myntra clears the box. If the text is still sitting
    // there, say so instead of pretending it worked.
    setTimeout(() => {
      sendResponse({ ok: true, submitted: !(el.isConnected && el.value === value) });
    }, SUBMIT_CHECK_MS);
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    const target = TARGETS[msg?.type];
    if (!target) return false;
    fill(target, msg.value, sendResponse);
    return true; // async reply
  });

  // inject.js runs in the page's own world and reports the label and invoice
  // URLs it sees. Relay them to the service worker, which does the saving.
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (msg?.__myntraPicklistPanel !== true || msg.type !== 'LABEL_URL') return;
    chrome.runtime.sendMessage({ type: 'LABEL_URL', url: msg.url, packet: msg.packet }).catch(() => {});
  });

  // An input's value changes without any DOM mutation, so polling is the honest
  // way to watch it. Once a second costs nothing.
  let lastSeen = null;
  setInterval(() => {
    const id = findInput(TARGETS.FILL_PICKLIST.hints)?.value?.trim() || null;
    if (id === lastSeen) return;
    lastSeen = id;
    chrome.runtime.sendMessage({ type: 'PAGE_PICKLIST_ID', value: id }).catch(() => {});
  }, 1000);
}
