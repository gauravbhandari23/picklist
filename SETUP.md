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

## Saving the label and bill

Unchanged — you still type a name and click Save, twice per order.

One thing that helps with no setup at all — do it entirely on the keyboard:

```
Alt + N      cursor jumps to the File name box
<type name>  e.g. 8105
Enter        saved
```

**Alt + N** is the shortcut for the File name box in any Windows Save dialog. Use
it rather than relying on the cursor already being there — sometimes focus lands
on the file list instead, and then whatever you type goes nowhere.

If Enter ever does not trigger Save, **Alt + S** is the Save button.

For the name, the last 4 digits of the **Seller Packet ID** shown on the pack
page work well — short, unique, and still meaningful later.

If you ever want those two dialogs gone entirely, it can be done, but it needs
software installed on the PC. Ask and I will write it up again.

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
