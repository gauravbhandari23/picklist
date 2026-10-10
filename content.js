// Runs on the Myntra pack page. Three jobs:
//   1. fill the Picklist ID or the Product SKU box when the panel asks
//   2. report which picklist the page currently has open
//   3. (when enabled) auto-focus Tag / Cover inputs & auto-click PASS / PACK / Scan Next

// The service worker may inject this file into a tab that already has it, so
// make a second copy a no-op instead of doubling every listener and timer.
if (!window.__myntraPicklistPanel) {
  window.__myntraPicklistPanel = true;

  const TARGETS = {
    FILL: { hints: [/myntra\s*\/?\s*seller/i, /seller\s*sk/i, /scan\s*product/i], label: 'scan product id' },
    FILL_PICKLIST: { hints: [/picklist\s*id/i], label: 'scan picklist id' },
  };
  const SUBMIT_CHECK_MS = 250;

  // ── Helpers ────────────────────────────────────────────────────────────────

  // getClientRects beats offsetParent here: offsetParent is null for anything
  // position:fixed, which is exactly what Myntra's modals are.
  const isVisible = (el) => el.getClientRects().length > 0;
  const isUsable = (el) => el && isVisible(el) && !el.disabled && !el.readOnly;
  const describe = (el) => [el.placeholder, el.getAttribute('aria-label'), el.name, el.id].filter(Boolean).join(' ');

  // The first box matching the hints, in hint order — a visible one before a
  // hidden one under the same hint (a page can keep a hidden copy of the box in
  // an old modal; picking that one reported the box as locked). A visible but
  // locked box is still the answer: that's "locked", never a different box.
  function findInput(hints) {
    const inputs = [...document.querySelectorAll('input')];
    for (const re of hints) {
      const hits = inputs.filter((el) => re.test(describe(el)));
      const hit = hits.find(isVisible) ?? hits[0];
      if (hit) return hit;
    }
    return null;
  }

  // If Myntra ever drops the placeholder, fall back to the first usable input
  // after the matching heading.
  function inputAfterLabel(text) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    let labelNode = null;
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeValue.trim().toLowerCase() === text) {
        labelNode = node.parentNode;
        break;
      }
    }
    if (!labelNode) return null;
    const inputs = document.querySelectorAll('input');
    for (let i = 0; i < inputs.length; i++) {
      if (isUsable(inputs[i]) && (labelNode.compareDocumentPosition(inputs[i]) & Node.DOCUMENT_POSITION_FOLLOWING)) {
        return inputs[i];
      }
    }
    return null;
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

  // ── Fill (panel → page) ────────────────────────────────────────────────────

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
    if (msg?.type === 'DIAG') {
      console.log('[picklist]', ...msg.parts);
      return false;
    }
    const target = TARGETS[msg?.type];
    if (!target) return false;
    fill(target, msg.value, sendResponse);
    return true; // async reply
  });

  // ── Autosave state relay ───────────────────────────────────────────────────

  // The page world cannot read chrome.storage, so push the autosave state in —
  // now, and again whenever it is toggled.
  const pushAutosaveState = (on) =>
    window.postMessage({ __myntraPicklistPanel: true, type: 'AUTOSAVE_STATE', on: on === true }, window.location.origin);

  const announceAutosave = () => chrome.storage.local.get('autosave').then((s) => pushAutosaveState(s.autosave)).catch(() => {});
  announceAutosave();

  // ── Auto-Pack / Auto-Next state ────────────────────────────────────────────

  const localState = { autopack: false, autonext: false, lastActionTime: 0, clickHistory: {}, nextDebounce: false };

  chrome.storage.local.get(['autopack', 'autonext']).then((s) => {
    localState.autopack = s.autopack === true;
    localState.autonext = s.autonext === true;
  }).catch(() => {});

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if (changes.autosave) pushAutosaveState(changes.autosave.newValue);
      if (changes.autopack) localState.autopack = changes.autopack.newValue === true;
      if (changes.autonext) localState.autonext = changes.autonext.newValue === true;
    }
  });

  // ── Auto-Pack / Auto-Next helpers ──────────────────────────────────────────

  function isReallyUsable(el) {
    if (!isUsable(el)) return false;
    if (el.getAttribute('aria-disabled') === 'true') return false;
    if (el.classList.contains('disabled') || el.classList.contains('Mui-disabled')) return false;
    return true;
  }

  function findButtonByText(regex) {
    return [...document.querySelectorAll('button')].find(
      (b) => regex.test(b.textContent.trim()) && isReallyUsable(b),
    );
  }

  // Click a button at most once every 3 seconds (prevents infinite click loops
  // when the user manually closes a modal that automation just opened).
  function safeClick(btn, name) {
    const now = Date.now();
    if (localState.clickHistory[name] && now - localState.clickHistory[name] < 3000) {
      return false;
    }
    btn.click();
    localState.clickHistory[name] = now;
    localState.lastActionTime = now;
    return true;
  }

  // Smart input finder: checks the input's own attributes first, then walks up
  // the DOM looking at surrounding text (catches Myntra's generic "Scan Here"
  // placeholders). Explicitly skips the main SKU / Picklist inputs so we never
  // confuse them with a modal.
  function findSmartInput(keywords) {
    const inputs = [...document.querySelectorAll('input')].filter(isUsable);

    for (const el of inputs) {
      const text = [el.placeholder, el.getAttribute('aria-label'), el.name, el.id].join(' ').toLowerCase();

      // Skip the main page inputs
      if (text.includes('product') || text.includes('sku') || text.includes('picklist') || text.includes('seller')) continue;

      // 1. Direct match on the input itself
      if (keywords.some((k) => text.includes(k))) return el;
      
      // 2. Direct match via Myntra's ARIA label binding (Highly accurate)
      const labelId = el.getAttribute('aria-labelledby');
      if (labelId) {
         const labelEl = document.getElementById(labelId);
         const labelText = labelEl?.textContent?.toLowerCase() || '';
         if (keywords.some((k) => labelText.includes(k))) return el;
      }

      // 3. Contextual match — walk up to 5 parent wrappers.
      // We use textContent instead of innerText because innerText is empty during CSS fade-in animations!
      let container = el.parentElement;
      for (let i = 0; i < 5; i++) {
        if (!container || container === document.body) break;
        const containerText = container.textContent?.toLowerCase() || '';
        if (keywords.some((k) => containerText.includes(k))) return el;
        container = container.parentElement;
      }
    }
    return null;
  }

  function getTagInput() {
    return findSmartInput(['tag', 'security', 'brand']);
  }

  function getPacketInput() {
    return findSmartInput(['cover', 'packet', 'awb', 'bag']);
  }

  // Plain .focus() is ignored by Myntra's React — simulate a real mouse click
  // so the framework registers the input as truly active for barcode scanning.
  function reactFocus(el) {
    el.focus();
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }
  
  // ── The automation loop (200 ms) ───────────────────────────────────────────

  setInterval(() => {
    // Cooldown: enforce a 600ms gap between any automated clicks
    if (Date.now() - localState.lastActionTime < 600) return;

    // Auto-Next: click "Scan Next" and request the next SKU from the panel
    if (localState.autonext) {
      const nextBtn = findButtonByText(/^SCAN NEXT( ITEM| PICKLIST)?$/i) || findButtonByText(/^NEXT$/i);
      if (nextBtn && !localState.nextDebounce) {
        localState.nextDebounce = true;
        localState.lastActionTime = Date.now();
        localState.clickHistory = {}; // fresh item — allow all clicks again
        nextBtn.click();
        chrome.runtime.sendMessage({ type: 'REQUEST_NEXT_SKU' }).catch(() => {});
        setTimeout(() => { localState.nextDebounce = false; }, 2000);
        return;
      }
    }

    if (localState.autopack) {
      // PRIORITY 0: Error banners
      // Handle "Order is packed" (already processed) and "Technical Error" (network retry)
      const errorBanners = [...document.querySelectorAll('[role="alert"], .MuiAlert-message, .MuiSnackbar-root')];
      for (const banner of errorBanners) {
        if (!isVisible(banner)) continue;
        const text = banner.textContent.toLowerCase();
        
        if (text.includes('order is packed') || text.includes('no open orders found') || text.includes('already packed')) {
           const closeBtn = banner.querySelector('button') || banner.parentElement?.querySelector('button') || banner.parentElement?.parentElement?.querySelector('button');
           if (closeBtn && isUsable(closeBtn)) closeBtn.click();
           
           const clearBtn = document.querySelector('.ClearAll');
           if (clearBtn) safeClick(clearBtn, 'CLEAR_ALL_ERROR');
           
           if (localState.autonext) {
              chrome.runtime.sendMessage({ type: 'REQUEST_NEXT_SKU' }).catch(() => {});
              localState.lastActionTime = Date.now();
           }
           return;
        }
        else if (text.includes('technical error') || text.includes('went wrong') || text.includes('failed') || text.includes('try again') || text.includes('timeout')) {
           if (Date.now() - (localState.clickHistory['ERROR_RETRY'] || 0) < 1000) return;
           localState.clickHistory['ERROR_RETRY'] = Date.now();
           
           const closeBtn = banner.querySelector('button') || banner.parentElement?.querySelector('button') || banner.parentElement?.parentElement?.querySelector('button');
           if (closeBtn && isUsable(closeBtn)) closeBtn.click();
           
           const tagInput = getTagInput();
           const packetInput = getPacketInput();
           if (!tagInput && !packetInput) {
               const skuInput = findInput(TARGETS.FILL.hints) ?? inputAfterLabel(TARGETS.FILL.label);
               if (skuInput && isUsable(skuInput) && skuInput.value) {
                   pressEnter(skuInput);
               }
           }
           localState.lastActionTime = Date.now();
           return;
        }
      }

      // PRIORITY 1: Cover ID modal — activate and HALT (never click behind it)
      const packetInput = getPacketInput();
      if (packetInput && isUsable(packetInput)) {
        if (document.activeElement !== packetInput) reactFocus(packetInput);
        return;
      }

      // PRIORITY 2: Tag modal — activate and HALT
      const tagInput = getTagInput();
      const skipBtn = findButtonByText(/^SKIP$/i);
      if ((tagInput && isUsable(tagInput)) || skipBtn) {
        if (tagInput && isUsable(tagInput)) if (document.activeElement !== tagInput) reactFocus(tagInput);
        return;
      }

      // PRIORITY 3: PASS button
      const passBtn = findButtonByText(/^PASS$/i);
      if (passBtn) { if (safeClick(passBtn, 'PASS')) return; }

      // PRIORITY 4: PACK button
      const packBtn = findButtonByText(/^PACK$/i);
      if (packBtn) { if (safeClick(packBtn, 'PACK')) return; }

      // PRIORITY 5: CLEAR ALL button
      // In multi-item orders, Myntra locks the SKU box after an item is loaded.
      // Auto-click CLEAR ALL to unlock it so the user can scan the next item.
      const clearBtn = document.querySelector('.ClearAll');
      const skuInput = findInput(TARGETS.FILL.hints) ?? inputAfterLabel(TARGETS.FILL.label);
      if (clearBtn && skuInput && !isUsable(skuInput)) {
        if (safeClick(clearBtn, 'CLEAR_ALL')) return;
      }
    }
  }, 200);

  // ── Relay inject.js messages to the service worker ─────────────────────────

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (msg?.__myntraPicklistPanel !== true) return;
    // inject.js started after our first announcement (put in after a
    // single-page navigation) and is asking.
    if (msg.type === 'HELLO') {
      announceAutosave();
      return;
    }
    if (msg.type === 'GENIE_ERROR') {
      chrome.runtime.sendMessage({ type: 'GENIE_ERROR', sku: msg.sku }).catch(() => {});
      return;
    }
    if (msg.type === 'LATE_START') {
      chrome.runtime.sendMessage({ type: 'LATE_START' }).catch(() => {});
      return;
    }
    if (msg.type === 'LABEL_FAILED') {
      console.log('[picklist] label request failed for good:', msg.detail);
      chrome.runtime
        .sendMessage({ type: 'LABEL_FAILED', url: msg.url, detail: msg.detail })
        .catch(() => {});
      return;
    }
    if (msg.type !== 'LABEL_DOC') return;
    console.log('[picklist] relaying label document to the extension');
    chrome.runtime
      .sendMessage({
        type: 'LABEL_DOC',
        url: msg.url,
        packet: msg.packet,
        body: msg.body,
        contentType: msg.contentType,
      })
      .catch(() => {});
  });

  // ── Watch for picklist ID changes ──────────────────────────────────────────

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
