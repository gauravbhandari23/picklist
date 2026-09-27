# Myntra Picklist Panel — setup

Installs the browser extension that shows your picklist beside the Myntra pack
page. Click a row and the SKU fills itself in — no tab switching, no typing.

About 5 minutes.

---

## 1. Copy the folder to the packing laptop

Copy the whole folder:

```
myntra-picklist-panel
```

USB stick, Google Drive, anything. Put it somewhere permanent.

The Desktop is fine — **but check it is not the OneDrive Desktop.** Open the
folder and read the address bar:

```
C:\Users\You\Desktop\myntra-picklist-panel            OK, use it
C:\Users\You\OneDrive\Desktop\myntra-picklist-panel   move it
```

If OneDrive is in the path, move the folder to `C:\myntra-picklist-panel`
instead. OneDrive can turn synced files into cloud-only placeholders, and Chrome
then cannot load the extension — it works for weeks, then breaks for no visible
reason.

⚠️ **Once installed, do not move or rename this folder.** Chrome reads it from
that exact path every time it starts. If you do move it, go to
`chrome://extensions`, remove the old entry, and Load unpacked again from the
new location.

---

## 2. Install it in Chrome

1. Open Chrome
2. Type `chrome://extensions` in the address bar, press Enter
3. Turn on **Developer mode** (switch, top right)
4. Click **Load unpacked**
5. Select the `myntra-picklist-panel` folder
6. Click the puzzle-piece icon in the toolbar → pin **Myntra Picklist Panel**

---

## 3. Test it — one order only

1. Open `mdirect.myntrainfo.com/PackOrder/Operations`
2. Click the extension icon → the panel opens on the right
3. Click the dashed box → choose your picklist PDF
4. The list appears, and the Picklist ID chip shows at the top
5. **Click the chip** → does it fill Myntra's Scan Picklist ID box?
6. **Click one row** → does the SKU land in Myntra's SKU box?

If 5 and 6 work, you are done. If not, report what the panel said.

---

## Daily use

1. Open the Myntra pack page, click the extension icon
2. Drop the picklist PDF onto the panel — once per picklist
3. Click the **Picklist ID chip**
4. For each item: click its row → seal tag / PASS / PACK → scan cover
5. Save the label and bill as you do now

Finished rows turn green and drop to the bottom, so what is left stays on top.

### Buttons

| Button | What it does |
|---|---|
| **Load file** | Opens the file picker. Clicking the dashed box or dragging a PDF onto the panel does the same. |
| **Reset** | Clears every tick, keeps the list. One click, with an Undo. |
| **Clear** | Removes the list completely. |
| **✕** | Closes the panel. Progress is kept — reopen and it is still there. |
| **Fill** | Whether a click sends the Myntra SKU (default) or your seller SKU. Myntra's box takes both. |
| **OP…… chip** | The Picklist ID, read from the PDF's barcode. Click it to fill the page's box. |
| **✓** | Click a green tick to put that item back on the list. |

---

## Saving the label and bill — Autosave

There is an **Autosave** tick-box in the panel toolbar.

```
Load file   Reset   Clear    [x] Autosave    Fill [Myntra SKU]
```

**Autosave ON** — after you scan the cover barcode, the shipping label and the
bill save themselves:

```
Downloads\myntra-labels\2026-09-27\
   1974014045-label.pdf
   1974014045-invoice.pdf
```

Named by **packet id**, in a folder per day. No dialogs, no typing. If a name
ever repeats, Chrome adds `(1)` rather than overwriting.

**Autosave OFF** — nothing changes. Myntra prints as it always did and you save
by hand. Off is the default.

### How it works

Nothing is printed. After a packet is packed, Myntra's own page fetches the two
documents from its API. The extension sees those two requests, fetches the same
documents with your session, and saves them.

That is why it works where the printing approach did not: there is no print
dialog in the way, and the packet id is known, so the files can be named
properly.

### Where the files go

Chrome only lets an extension write **inside your download folder** — absolute
paths and `..` are rejected. So they land in
`<your downloads>\myntra-labels\<date>\`.

To have them somewhere else, change Chrome's own download location:
**Settings → Downloads → Location**. The `myntra-labels` folder follows it.

Also make sure **"Ask where to save each file before downloading"** is **off**,
or Chrome will prompt for every file.

The two documents do not arrive in the same shape — the bill is a plain PDF
while the label comes wrapped in a MIME envelope — so the label is unwrapped
before saving. Both end up as ordinary PDFs.

### If a document cannot be saved

The panel says so and never saves a non-PDF under a `.pdf` name — for example
*"Shipping label not saved. Myntra returned a web page, not a PDF."* Save that
one by hand; nothing is lost.

## Things to know

- **PDFCreator becomes your default printer.** Printing from Word or Excel
  without looking will make a PDF instead of paper. The dialog still appears in
  normal programs so you can pick a different printer — you just have to notice.
  If that becomes a nuisance, switch the Windows default back when you are not
  packing; it is two clicks.
- **Downloads are unaffected.** Only printing changes.
  `Save Print Output As` is a print; `Save As` is a download.
- **There is no confirmation any more.** Glance at the folder every 10 orders
  and check the file count matches what you packed.
- **The order ID cannot be in the filename.** A Windows setting cannot read it
  off a web page.

### If you keep saving by hand instead

Do it entirely on the keyboard:

```
Alt + N      cursor jumps to the File name box
<type name>  e.g. 8105
Enter        saved
```

**Alt + N** works wherever focus landed. **Alt + S** is Save if Enter does not
trigger it. The last 4 digits of the **Seller Packet ID** make a short, unique,
still-meaningful name.

---

## Things to know

- A green ✓ means **you clicked that row**, not that Myntra accepted it.
  Myntra's own scanned list on the left is still the source of truth.
- The panel does **not** check the garment in your hand matches the row. Only
  scanning the barcode on the physical tag does that.
- It never clicks **SKIP**, **PASS** or **PACK**. Those stay yours.
- A yellow warning bar means the PDF did not read cleanly. Check the list
  before packing.

---

## If something goes wrong

| Problem | Fix |
|---|---|
| Panel empty / icon missing | The folder moved or was deleted. Re-add it at `chrome://extensions`. |
| "No Myntra pack page is open" | Literally that — open the pack page in a tab. |
| "Couldn't reach the pack page" | Reload the Myntra tab. |
| "That box isn't on the pack page right now" | Myntra changed the field, or that step is not on screen yet. Type by hand and report it. |
| Clicking a row does nothing at all | Report it — the page may have changed how it reads typed input. |
| "Could not read the Picklist ID barcode" | Scan or type the Picklist ID yourself, as before. The item list still works. |
| Warning about two different picklist IDs | The PDF you loaded is not the picklist open on the page. Check the file. |
