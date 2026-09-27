# Myntra Picklist Panel — complete documentation

Everything about this extension: why it exists, what was found in the picklist
PDF, how each piece works, what was deliberately left out, and what is still
unproven.

- **[SETUP.md](SETUP.md)** — install it and use it
- **[README.md](README.md)** — day-to-day reference
- This file — the full detail

---

## 1. The problem

Packing a Myntra self-ship order means two tabs: the picklist PDF in one, and
`mdirect.myntrainfo.com/PackOrder/Operations` in the other.

The flow for a single item:

| Step | Who does it |
|---|---|
| 1. Scan or type the Picklist ID | packer |
| 2. Type the Myntra SKU (`RANHKASS146747214`) | packer |
| 3. Scan the security seal tag, or SKIP | packer |
| 4. Click PASS | packer |
| 5. Click PACK | packer |
| 6. Scan the cover / packet barcode | packer |
| 7. Save the shipping label as PDF | packer |
| 8. Save the bill as PDF | packer |

Rough timing before any change: **45–60 seconds per item**. The largest single
cost was steps 7–8 (~25s), then step 2 (~10s, including the tab switch to read
the SKU).

This extension attacks **steps 1 and 2**. Steps 7 and 8 are a printing problem,
not a browser problem — see §10.

---

## 2. What the picklist PDF actually contains

Established by pulling the text layer out of a real picklist with coordinates,
rather than assuming.

### 2.1 The item table is real text

No OCR needed. Columns sit at fixed x positions:

| x | Column |
|---|---|
| ~44 | Myntra Sku Code |
| ~173 | Seller Sku Code |
| ~256 | Product Description |
| ~459 | Quantity |
| ~520 | Expiry Dates |

### 2.2 Seller SKUs wrap mid-hyphen — the one dangerous trap

A seller SKU arrives as three separate text runs:

```
x=173.3  y=595.0   "RRC-012-CO-"
x=173.3  y=581.2   "CI-RED-GRN-"
x=173.3  y=567.3   "F-M"
```

These must be joined with **nothing** between them:

```
RRC-012-CO-CI-RED-GRN-F-M     correct
RRC-012-CO- CI-RED-GRN- F-M   a different SKU — ships the wrong item
```

The description wraps too, but **is** joined with spaces. Two columns, two
opposite rules. `test/parse.test.mjs` pins both.

### 2.3 The header's x is not the data's x

The `Quantity` header sits at x≈417 but its values sit at x≈459 — the column is
right-aligned. So column positions are derived from the **data**, not from the
header row. Quantity is found as the rightmost column whose every value is a
plain integer.

### 2.4 The Picklist ID is not text anywhere

This was the surprise. `OP22355506` appears **only** as a barcode image. There
is no text copy of it in the PDF, and no digits are printed under the barcode.

```
/Subtype /Image  /Filter /DCTDecode  /Width 112  /Height 150
```

A 112×150 JPEG, drawn at 112.5×30pt. See §3.

### 2.5 Pages restart their coordinates — and that broke everything

A picklist longer than about 8 items spills onto a second page. Every PDF page
restarts its coordinate system at the top, so **page 2's y values sit above page
1's**:

```
Page 1:  header y=645.9 ... last item y=74.2
Page 2:  item   y=764.0 ... Total Quantity y=731.0
```

Merging the pages into one list made the row-banding cutoffs read as
"skip anything below y=733 or above y=644" — which is every cell. The grid came
out completely empty, so every row reported *no seller SKU found* and the
quantity column was never located.

The fix has three parts, and none of them assume a page count:

1. **Continuous coordinates.** Callers tag each text item with its page number,
   and `toCells` shifts each page down by the document's own height plus a gap
   — measured, not a constant — so y decreases continuously however many pages
   there are.
2. **Bands clamped to a row height.** A row owns the space up to halfway to its
   neighbours, but never more than one row-height away. Without this the last
   row on a page reaches across the break and swallows whatever sits at the
   foot of the sheet. The row height is the median gap between anchors **on the
   same page** — a picklist with one row per page has nothing but page-break
   gaps, and their median would make the reach enormous.
3. **Labels dropped by text**, so a header repeated on later pages is ignored
   rather than read as a row.

The quantity column is likewise chosen as a column *every* row fills, falling
back to one most rows fill, so a single odd page cannot lose it.

Pinned two ways: `test/multipage.test.mjs` against a real two-page picklist, and
`test/manypages.test.mjs` against synthetic picklists of 1, 2, 3, 4, 5, 10 and
20 pages — with and without repeated headers, with and without page footers,
and the awkward case of one row per page.

### 2.6 The Total Quantity line

A `Total Quantity` line sits in the same x column as the SKUs and must not be
read as one. Row banding is clamped between the header and this line.

---

## 3. Decoding the Picklist ID barcode

Since the ID exists only as an image, the extension decodes it.

### 3.1 Why it is possible at all

The image is 112 pixels wide and the encoding needs exactly 112 modules:

```
Code 128 modules = 11 x (symbols) + 13 (stop)
                 = 11 x 9 + 13
                 = 112
```

So **1 pixel = 1 module** exactly — the minimum that can work, and it does
because the JPEG is crisp (luma runs a clean 0 to 255, no blur at the bar edges).

The nine symbols decode as:

```
211214  StartB
133121  'O'
313121  'P'
113141  CodeC        switch to numeric pairs
223112  22
131321  35
311321  55
122213  06
113321  checksum
2331112 stop

= OP22355506
```

### 3.2 How the image is obtained

Not through pdf.js image internals, which are awkward and version-sensitive.
Instead the JPEG is lifted straight out of the PDF bytes by scanning for the
markers — inside JPEG data a literal `FF` is byte-stuffed as `FF 00`, so a bare
`FF D9` is always the end of the image.

The browser then decodes it natively via `createImageBitmap` → `OffscreenCanvas`
→ `getImageData`. No image library ships with the extension.

### 3.3 Safety rules

A wrong ID is worse than no ID, so a decode is only accepted when:

- the **stop pattern** matches
- the **checksum** matches (`sum mod 103`)
- at least **two of nine scan lines** agree on the same text

Otherwise it returns `null` and the panel tells the user to scan it themselves.
Widths are matched by scaled distance rather than exact strings, so the decoder
also works on an upscaled or mirrored image (both tested).

---

## 4. Design decisions, and why

| Decision | Chosen | Why |
|---|---|---|
| Panel location | Chrome's native side panel | A separate document from the page, so it survives the reload after PACK. An in-page overlay would be destroyed on every single pack. |
| Click behaviour | Fill the box **and** press Enter | One click per item. User's choice over clipboard-copy. |
| When a row ticks | Immediately on click | User's choice. Softened: it does **not** tick when the fill never reached the page, and every tick is reversible. |
| Multi-quantity | One row per physical item | User's choice over one row with a counter. One click = one item, and the list visibly shrinks. |
| Finished rows | Drop to the bottom | What is left to pack stays under your eyes. |
| Splitting location | In the panel, not the parser | The parser stays a faithful reading of the PDF, so the "PDF says 9, I read 2" check still works. |
| Reset confirmation | None — an Undo instead | One click beats a confirm dialog at a packing bench, and a misclick costs one click to take back. |
| Repo | Separate, standalone extension | Explicit requirement. Nothing in `myntra-order-alert-web`, `label-tool` or `stock-manager` is touched or imported. |

---

## 5. Architecture

```
┌────────────── side panel (its own document) ───────────────┐
│  sidepanel.js                                              │
│    loads the PDF, parses it, decodes the barcode,          │
│    renders rows, holds all state                           │
│    uses: parser.js, barcode.js, lib/pdf.min.mjs            │
└──────────────────────────┬─────────────────────────────────┘
                           │ chrome.runtime.sendMessage
                           │   {type: FILL | FILL_PICKLIST, value}
                           ▼
┌────────────── background.js (service worker) ──────────────┐
│  finds the pack tab, injects content.js if needed,         │
│  forwards the message                                      │
└──────────────────────────┬─────────────────────────────────┘
                           │ chrome.tabs.sendMessage
                           ▼
┌────────────── content.js (on the pack page) ───────────────┐
│  finds the input, sets its value, presses Enter,           │
│  reports back whether Myntra cleared the box;              │
│  polls the Picklist ID box and reports changes upward      │
└────────────────────────────────────────────────────────────┘
```

### Files

| File | Job | Pure? |
|---|---|---|
| `manifest.json` | MV3 manifest | — |
| `background.js` | Opens the panel, relays messages, injects on demand | — |
| `sidepanel.html/.css/.js` | The panel itself | — |
| `parser.js` | PDF text items → rows; unit expansion | ✅ no DOM, no `chrome.*` |
| `barcode.js` | Code 128 decoder; JPEG extraction from PDF bytes | ✅ no DOM, no `chrome.*` |
| `content.js` | Fills fields on the pack page | — |
| `lib/` | pdf.js 4.10.38, vendored | — |
| `test/` | Node tests, no browser needed | — |

`parser.js` and `barcode.js` are deliberately pure — that is what makes the
risky logic testable without a browser or a Myntra login.

### Permissions, and why each is needed

| Permission | Why |
|---|---|
| `sidePanel` | Open the panel |
| `storage` | Remember the list and progress across reloads |
| `tabs` | Find the pack tab by URL |
| `scripting` | Inject `content.js` into a tab that was open before the extension loaded |
| `*://mdirect.myntrainfo.com/*` | The only site it touches |

No cookies, no network requests, no other host.

---

## 6. Implementation details worth knowing

### 6.1 React ignores `el.value = x`

Myntra's page is React, which keeps its own copy of an input's value. Assigning
`.value` directly is not noticed. The value must go through the prototype setter:

```js
const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
setter.call(el, value);
el.dispatchEvent(new Event('input',  { bubbles: true }));
el.dispatchEvent(new Event('change', { bubbles: true }));
```

**This is the one part not yet proven against the live site.** See §9.

### 6.2 Enter, not requestSubmit

Submission is done by dispatching `keydown`/`keypress`/`keyup` for Enter, the
same events a hardware barcode scanner produces — so the page must already
handle them. `form.requestSubmit()` was considered and rejected: if the page had
already accepted the Enter, it would scan the item twice.

### 6.3 `offsetParent` is the wrong visibility test

`offsetParent` is `null` for anything `position: fixed`, which is exactly what
Myntra's seal-tag and cover-ID modals are. A field inside one would have been
wrongly reported as locked. `getClientRects().length > 0` is used instead.

### 6.4 Injecting into an already-open tab

A content script declared in the manifest only runs in tabs loaded **after** the
extension. Rather than telling the user to reload, `background.js` catches the
failed `sendMessage` and injects `content.js` itself, then retries. `content.js`
guards with a `window.__myntraPicklistPanel` flag so a double injection is a
no-op instead of doubling every listener and timer.

### 6.5 Polling, not observing, the Picklist ID

An input's `value` changes without any DOM mutation, so `MutationObserver` never
fires. A one-second poll is the honest approach.

### 6.6 The scroll layout

The panel is a flex column of `100vh` with `overflow: hidden`, and `.rows` is
the only scroller (`flex: 1; min-height: 0; overflow-y: auto`).

`min-height: 0` is the non-obvious part — without it a flex child refuses to
scroll and the whole body scrolls instead, which made the toolbar scroll away
and let a status message shove the rows around mid-click.

Auto-scroll moves to the next row only when the target actually changes, so an
unrelated redraw never yanks the list.

### 6.7 pdf.js is vendored

MV3's CSP forbids remote scripts, so `pdfjs-dist` 4.10.38 is copied into `lib/`.
No build step and no `node_modules` at runtime.

---

## 7. State

Held in `chrome.storage.local` under `picklist`:

```js
{
  fileName,          // for the subtitle
  loadedAt,
  picklistId,        // decoded from the PDF barcode
  pagePicklistId,    // what the pack page currently has open
  fillMode,          // 'myntra' | 'seller'
  warnings: [],      // from the parse
  rows: [{ myntraSku, sellerSku, desc, size, qty: 1, done, unit, units }]
}
```

The side panel survives page reloads on its own; persisting also covers closing
the panel, switching tabs and restarting Chrome.

Holding both `picklistId` and `pagePicklistId` lets the panel warn when the
loaded PDF is not the picklist actually open on the page — which catches loading
the wrong file.

Older saved state (one row per line with a quantity) is re-split on load.

---

## 8. Tests

```
for f in test/*.test.mjs; do node "$f" || break; done
```

No browser, no Myntra login, no dependencies.

| File | Covers |
|---|---|
| `parse.test.mjs` | A real picklist PDF → exact SKUs, sizes, quantities; the mid-hyphen join |
| `multiqty.test.mjs` | Quantity > 1, the same SKU on two lines, total mismatch warning, unit splitting, the quantity clamp |
| `multipage.test.mjs` | A real two-page picklist: 9 rows in page order, three brand prefixes, quantities totalling the stated 10 |
| `manypages.test.mjs` | 1–20 pages, repeated headers, page footers, mixed quantities, one row per page |
| `barcode.test.mjs` | Barcode → `OP22355506`; mirrored; 4× upscaled; noise and blank → `null`; JPEG extraction from the PDF |
| `layout.test.mjs` | One scrolling area, pinned top section, scroll-margin, element order |

### Why these specific tests

They pin the failure modes that would be **silent and expensive**: a corrupted
seller SKU ships the wrong garment, a mis-decoded barcode opens the wrong
picklist, a second page reads as nothing, a runaway quantity freezes the panel,
and a broken flex chain makes the toolbar unreachable. None of them throw an
error on their own.

---

## 9. Known limits and risks

| Risk | Status |
|---|---|
| **The React fill is unverified on the live site** | The approach is standard, but has not been run against a real packet. If it fails, the fallback is click-to-copy, which needs no page access at all. |
| A ✓ means "clicked", not "Myntra accepted it" | Deliberate, chosen for speed. The panel does not tick if the fill never reached the page, and Myntra's own scanned list remains the source of truth. |
| No check that the garment matches the row | Only scanning the barcode on the physical tag can do this. The panel removes typing and tab-switching, not mis-pick risk. |
| The size badge is inferred | Taken as the last `-` segment of the seller SKU. Verified against Myntra's own page for `RRC-012-CO-CI-RED-GRN-F-M` → `M`. If any SKU does not end with its size, the badge will be wrong. |
| Myntra changing the input placeholder | Fails loudly ("That box isn't on the pack page right now"), never silently. |
| `test/fixtures/*.pdf` are real order data | Fine in a private repo. Remove them before making this public. |

---

## 10. Deliberately not done

- **Auto-clicking SKIP / PASS / PACK.** PASS is a QC step and SKIP on a seal tag
  is a compliance matter. Saving two seconds is not worth either.
- **Auto-skipping seal tags.** Same reason.
- **Naming saved PDFs by order ID.** Possible only from inside the extension,
  and `chrome.downloads` can write only to the Downloads folder — never to
  Documents. Rejected as worse than the alternative.
- **Packing history / CSV export.** Sounds useful, would never be opened.

---

## 10a. Autosaving the label and invoice

The two Save dialogs were first attacked as a printing problem —
`--kiosk-printing` plus an auto-saving PDF printer. That failed, and the reasons
are worth keeping:

- The dialog is a **print**, not a download ("Save Print Output As").
- A Chrome flag is only read when a **new browser process** starts. Chrome runs
  one browser process per user-data-dir and profiles share it, so
  `--profile-directory` joins the running Chrome and the flag is silently
  dropped; `--user-data-dir` does not. `chrome://version`'s **Command Line** row
  is the only reliable check.
- Chrome prints to the **last printer that instance used**, not the Windows
  default.
- A destination set via Ctrl+P did **not** carry over to Myntra's own label
  print, which kept Chrome's built-in "Save as PDF" — and with
  `--kiosk-printing` active, that combination **discards the job silently**. No
  dialog, no file, and Myntra still reports "packed successfully".

The network log then showed the real answer. After a packet is packed, the page
fetches both documents from the API:

```
GET .../api/mdirect/orders/getShippingLabelForSellerPacketV2/<store>?...&sellerOrderId=<id>
GET .../api/mdirect/orders/getPacketInvoice/<store>?...&sellerOrderId=<id>
```

So there is no need to print at all. `inject.js` runs in the page's world — the
only place the page's own `fetch`/`XHR` can be seen — clones each of those two
responses and passes **the body** out. `background.js` verifies it is a PDF and
saves it with `chrome.downloads`.

**The body, not the URL.** Re-requesting the URL from the service worker looks
tidier but fails: Myntra's API wants `x-myntra-app-name`, `x-myntra-client-id`
and `x-myntra-mdirect-service` headers as well as the `erp.at` cookie, and an
extension fetch sends none of them — it would earn a 401 and save nothing. The
page has already fetched it correctly, so its response is copied instead.

This is better than the printing route in every way that matters: no dialog to
suppress, no software to install, no machine-wide printer change, and the packet
id is known so the files can be named `1974014045-label.pdf` instead of a
counter.

Constraints worth remembering:

- `chrome.downloads` can only write **inside the download folder**. Absolute
  paths and `..` are rejected, so `Documents` is reachable only by changing
  Chrome's own download location.
- The response is **verified to be a PDF** before saving. Anything else is
  refused with a reason rather than written under a `.pdf` name.
- **The two documents do not arrive in the same shape.** The invoice comes back
  as a bare PDF; the shipping label is wrapped in a MIME multipart (MTOM)
  envelope, despite both being served as `content-type: application/pdf`:

  ```
  --uuid:29af39c7-fdd3-416c-9914-a00d74880081
  Content-Type: application/octet-stream
  Content-Transfer-Encoding: binary
  Content-ID: <1>

  %PDF-1.5 …
  ```

  Rather than parse MIME, the bytes are cut from the `%PDF` header to the last
  `%%EOF`. Every PDF ends with that marker, and taking the last one is correct
  even for an incrementally updated file. A base64 PDF inside a JSON wrapper is
  handled too, in case a third shape turns up.
- It is **off by default** and gated by the Autosave tick-box. Off means the
  page behaves exactly as it always did.
- A tab opened *before* the extension loaded needs **both** scripts injected on
  demand — `content.js` and `inject.js` in the MAIN world. Injecting only the
  first fills SKUs fine but never sees a label, which would look like autosave
  silently not working.

## 11. Ideas not yet built

1. **Reconcile ticks against Myntra's own scanned list.** `content.js` is already
   on the page; reading the left-hand list would turn a ✓ from a claim into a
   fact. The single most valuable addition.
2. **A keyboard shortcut to fill the next row.** Would remove the mouse entirely.
3. **A search box in the panel**, doubling as a scanner target — scan a garment
   tag and jump to its row. Only worth it once picklists get long.
4. **Tighten the size badge** to only show recognised sizes.
