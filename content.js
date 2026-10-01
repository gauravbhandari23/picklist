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
    if (msg?.type === 'DIAG') {
      console.log('[picklist]', ...msg.parts);
      return false;
    }
    const target = TARGETS[msg?.type];
    if (!target) return false;
    fill(target, msg.value, sendResponse);
    return true; // async reply
  });

  // The page world cannot read chrome.storage, so push the autosave state in —
  // now, and again whenever it is toggled.
  const pushAutosaveState = (on) =>
    window.postMessage({ __myntraPicklistPanel: true, type: 'AUTOSAVE_STATE', on: on === true }, window.location.origin);

  const announceAutosave = () => chrome.storage.local.get('autosave').then((s) => pushAutosaveState(s.autosave)).catch(() => {});
  announceAutosave();

  let localState = { autopack: false, autonext: false, lastActionTime: 0 };

  // Robust input finder that checks both hints and nearby labels
  function getTagInput() {
    return findInput([/tag/i, /security/i]) || 
           inputAfterLabel('scan security tag') || 
           inputAfterLabel('security tag') || 
           inputAfterLabel('tag');
  }

  function getPacketInput() {
    return findInput([/cover/i, /packet/i, /awb/i]) || 
           inputAfterLabel('scan cover id') || 
           inputAfterLabel('scan packet id') || 
           inputAfterLabel('packet') || 
           inputAfterLabel('cover');
  }
  chrome.storage.local.get(['autopack', 'autonext']).then(s => {
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

  // Watcher for Auto-Pack and Auto-Next
  function isReallyUsable(el) {
    if (!isUsable(el)) return false;
    if (el.getAttribute('aria-disabled') === 'true') return false;
    if (el.classList.contains('disabled') || el.classList.contains('Mui-disabled')) return false;
    return true;
  }

  function findButtonByText(regex) {
    return [...document.querySelectorAll('button')].find(
      b => regex.test(b.textContent.trim()) && isReallyUsable(b)
    );
  }

  setInterval(() => {
    // Cooldown: enforce a 600ms gap between any automated clicks
    if (Date.now() - localState.lastActionTime < 600) return;

    if (localState.autopack) {
      const tagInput = getTagInput();
      const skipBtn = findButtonByText(/^SKIP$/i);
      
      // Phase 1: Tag Step
      if ((tagInput && isUsable(tagInput)) || skipBtn) {
        if (tagInput && isUsable(tagInput) && document.activeElement !== tagInput) {
          tagInput.focus(); // Force focus continuously if Myntra steals it
        }
        return; // Halt until tag is handled
      }

      // Phase 2: PASS
      const passBtn = findButtonByText(/^PASS$/i);
      if (passBtn) {
        passBtn.click();
        localState.lastActionTime = Date.now();
        return; 
      }

      // Phase 3: PACK
      const packBtn = findButtonByText(/^PACK$/i);
      if (packBtn) {
        packBtn.click();
        localState.lastActionTime = Date.now();
        return;
      }

      // Phase 4: Scan Cover ID / Packet
      const packetInput = getPacketInput();
      if (packetInput && isUsable(packetInput) && document.activeElement !== packetInput) {
        packetInput.focus();
      }
    }

    if (localState.autonext) {
      // Phase 5: Auto-Next
      const nextBtn = findButtonByText(/^SCAN NEXT( ITEM| PICKLIST)?$/i) || findButtonByText(/^NEXT$/i);
      if (nextBtn && !localState.nextDebounce) {
        localState.nextDebounce = true;
        localState.lastActionTime = Date.now();
        nextBtn.click();
        chrome.runtime.sendMessage({ type: 'REQUEST_NEXT_SKU' }).catch(() => {});
        setTimeout(() => { localState.nextDebounce = false; }, 2000);
      }
    }
  }, 200);


  // inject.js runs in the page's own world and reports the label and invoice
  // URLs it sees. Relay them to the service worker, which does the saving.
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
