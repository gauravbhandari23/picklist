# Myntra Picklist Panel

Shows your picklist in Chrome's side panel, next to the Myntra pack page, so you
stop switching tabs and retyping 17-character SKUs.

| Document | For |
|---|---|
| **[SETUP.md](SETUP.md)** | Installing it on the packing laptop |
| **[DOCUMENTATION.md](DOCUMENTATION.md)** | Full detail: the PDF format, the barcode decoding, architecture, every decision and why |
| This file | Day-to-day reference |

Click a row → the SKU goes into Myntra's **Scan Myntra/Seller SKL** box and Enter
is pressed → the row ticks off and the next one highlights.

This is a **standalone extension**. It does not touch, import, or depend on the
"Order Alert Session Sync" extension. Both can be installed at the same time.

## Install

1. `chrome://extensions` → turn on **Developer mode** (top right)
2. **Load unpacked** → pick this folder
3. Pin the icon to the toolbar

## Daily use

1. Open `mdirect.myntrainfo.com/PackOrder/Operations`
2. Click the extension icon → panel opens on the right
3. Load the picklist PDF (once per picklist) — click the dashed box to browse
   your laptop, or drag the file onto the panel
4. Click the **Picklist ID chip** in the header to fill Myntra's Scan Picklist ID box
5. For each item: click its row → do the seal tag / PASS / PACK as normal

The panel is a separate window from the page, so it keeps its list and its
progress when Myntra reloads after PACK.

### Buttons

| Button | What it does |
|---|---|
| **Load file** | Opens the normal file picker. The dashed box on the empty panel does the same, and you can drag a PDF anywhere onto the panel. |
| **Reset** | Clears every tick and starts the same picklist fresh. The list, the file and the Picklist ID all stay. One click, with an **Undo** if you hit it by mistake. |
| **Clear** | Removes the list completely, back to the empty drop box. |
| **✕** | Closes the panel. Your progress is kept — reopen and it is still there. |
| **Fill** | Whether a click sends the Myntra SKU (default) or your seller SKU. Myntra's box accepts both. |
| **✓ / ▸** | Click the circle to undo one unit if a row was ticked by mistake. |
| **OP…… chip** | The Picklist ID, read out of the PDF's barcode. Click it to fill the page's Scan Picklist ID box. |
| **Autosave** | Saves the shipping label and the bill by itself after each pack, and stops the two Save dialogs. Off by default. |
| **Page** | Sheet size for those saved files: Letter (default), A4, or Original — Myntra's own 4x6in label and A4 bill. |

Replacing the file or clearing while items are packed asks for a second click
first, so you cannot wipe a half-finished picklist by accident.

## Which page does it fill?

Always the **Myntra pack page**, never the tab you happen to be looking at. You
can have the panel open over Gmail or Google and clicking a row still fills the
pack page in its own tab. Focusing some other input first makes no difference —
the panel finds Myntra's box by name, it does not type into whatever has the
cursor. That is deliberate: it means a stray click can never dump a SKU into the
wrong website.

The pack tab does not need to be in front, and it does not need to have been
open when you installed the extension — the panel injects what it needs.

## The Picklist ID

Myntra prints the Picklist ID **only as a barcode** — it is not text anywhere in
the PDF, and the barcode has no digits printed under it. So the extension decodes
the Code 128 barcode itself, straight from the image inside the PDF.

The ID appears as a chip in the header. Click it and it fills the page's
**Scan Picklist ID** box, so you never scan or type it.

Two safety rules:

- The decode is only accepted if the barcode's own **checksum** matches and at
  least two scan lines agree. A bad read shows
  *"Could not read the Picklist ID barcode — scan or type it yourself"* rather
  than a wrong ID.
- If the PDF's ID and the ID already open on the page disagree, a warning says so.
  That catches loading the wrong picklist file.

## Scrolling

The panel is one fixed-height column. The header, toolbar, messages and warnings
stay put; **only the row list scrolls**. So the buttons never scroll away, and a
status message appearing does not shove the rows around under your hand.

After each fill the list scrolls the next item into view on its own, with a bit
of room above and below it. It moves as little as it can: if the next row is
already visible it does not scroll at all, and an unrelated redraw never moves
the list. Reset and loading a new file both return you to the top.

`test/layout.test.mjs` pins this down, since it is easy to break by accident.

## Finished rows drop to the bottom

As soon as a row is fully packed it moves to the end of the list, so what is
still left to pack stays at the top under your eyes. Order within each group is
the picklist's own order. Undo moves a row back up.

## Same SKU, more than one unit

Two different things, both handled:

**One line, quantity 2+** — the picklist aggregates, e.g. `RANHKASS146747214 ... 3`.
The panel splits that into **3 separate rows**, one per physical item, each
badged `1/3`, `2/3`, `3/3`. Click each one once. As each is filled it turns green
and drops to the bottom, so the list still to pack visibly shrinks. After a click
the panel says how many rows with that same SKU are still waiting.

**The same SKU on two separate lines** — happens when it spans two packets. They
stay as two independent rows and are never merged, so packet 1's unit cannot be
ticked off against packet 2's.

The counter in the header counts **units, not lines**. A picklist of two lines
with quantities 2 and 5 reads `0/7`, not `0/2` — and there really are 7 rows.

Undo is per row: click a green ✓ and that one item comes back to the list.

## Autosave

With **Autosave** ticked, scanning the cover barcode saves both documents on
its own:

```
Downloads\myntra-labels\2026-09-27\
   1974014045-label.pdf
   1974014045-invoice.pdf
```

Named by packet id, a folder per day, and **no Save dialogs**.

Nothing is printed. After a packet is packed Myntra's page fetches both
documents from its API, and the extension saves those directly — so there is
no print to suppress and the packet id is known, which is why the files can be
named properly.

The dialogs themselves come from **QZ Tray**, a printing application on the PC,
not from the browser. While autosave is on the extension refuses its
connection, so it looks absent and nothing prints. You do not need to quit it;
with autosave off it is left completely alone.

If Myntra's server refuses a document — it sometimes answers a label request
with a 500 — the request is retried once, and if that also fails the panel says
so rather than leaving you a file short without a word.

## What it deliberately does not do

- It never clicks **SKIP**, **PASS** or **PACK**. Those stay yours.
- A ✓ means "I clicked this row", not "Myntra accepted it". Myntra's own scanned
  list on the left is still the source of truth.
- It does not check that the garment in your hand matches the row. Only scanning
  the barcode on the physical tag does that.

## Messages you might see

| Message | Meaning |
|---|---|
| No Myntra pack page is open. | Nothing matches `PackOrder/*`. Open the pack page in any tab. |
| Couldn't reach the pack page. | Rare — the tab refused injection. Reload that tab. |
| That box isn't on the pack page right now. | Myntra changed the field, or that step isn't on screen yet. Type by hand and report it. |
| Filled …, but Myntra did not clear the box | The SKU went in but was not accepted. Check the page. |
| A yellow warning bar | The PDF did not parse cleanly. Check the list before packing. |

## Tests

```
for f in test/*.test.mjs; do node "$f" || break; done
```

| Test | Covers |
|---|---|
| `parse.test.mjs` | The real picklist PDF → exact SKUs, sizes, quantities |
| `multiqty.test.mjs` | Quantity > 1, the same SKU on two lines, total mismatch warning, splitting a quantity into one row per item |
| `barcode.test.mjs` | Picklist ID barcode → `OP22355506`, mirrored, upscaled, and noise → `null` |
| `layout.test.mjs` | The panel scrolls in exactly one place, and the top section stays pinned |

No browser needed for any of them.

The two `Warning:` lines Node prints are pdf.js noise (it prefers its `legacy`
build outside the browser and wants font data it does not need for text). They
do not affect the result.

### Why the parser has a test

Myntra wraps long seller SKUs across three lines, mid-hyphen:

```
RRC-012-CO-
CI-RED-GRN-
F-M
```

These must be glued back with **nothing** between them. Joining with a space
gives `RRC-012-CO- CI-RED-GRN- F-M`, which is a different SKU — that is how you
ship the wrong item. The test pins this.

## Layout

| File | Purpose |
|---|---|
| `manifest.json` | MV3 manifest |
| `background.js` | Opens the panel, relays panel → page messages |
| `sidepanel.html/.css/.js` | The panel |
| `parser.js` | PDF text → rows. Pure, no DOM, no `chrome.*` |
| `barcode.js` | Code 128 decoder + JPEG extraction. Pure, no DOM, no `chrome.*` |
| `content.js` | Runs on the pack page: fills the box, reports the Picklist ID |
| `lib/` | pdf.js 4.10.38, vendored (MV3 blocks remote scripts) |
| `test/` | Parser test + a real picklist fixture |
