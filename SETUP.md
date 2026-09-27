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

## Saving the label and bill automatically (optional)

This is **separate from the extension** — it changes nothing in Chrome's
behaviour on the page, and the extension is not involved. Skip it and everything
still works; you just keep typing filenames.

**What it does:** scan the cover barcode → the shipping label and the bill both
save themselves as PDFs into Documents. No dialog, no typing.

**What it does NOT do:** print on paper. You print later, from the folder.

### Before installing anything — check M-Direct

Look in the M-Direct sidebar for a **Print**, **Manifest** or
**Invoice & Ship Label** section. Many seller portals can download every label
for a picklist in one go. If M-Direct can, use that instead — nothing to install.

### B1. Install PDFCreator

Download from **pdfforge.org** → PDFCreator (the free version).

⚠️ **During install, decline the bundled extras.** The installer offers toolbars
and other software on a couple of screens — untick them. Annoying, not
dangerous.

It is the one with auto-save confirmed for silent print-to-PDF, and it is still
maintained. (clawPDF is a fork of it made to strip the adware — good code, but
no release since May 2023, and a virtual printer installs a system-level driver.
PDF24 is maintained and clean, but its auto-save may live in its Assistant
window rather than at the printer level, which would not be silent.)

PDFCreator is a printer with no paper. Printing to it produces a PDF file.

### B2. Turn on automatic saving

It is **not a checkbox**, and the words "auto save" do not appear on it — it is a
switch with two modes. That is why it is hard to find.

1. Open PDFCreator → click **Profiles**
2. On the left-hand side, open the **Save** tab
3. Set the **switch** to **Automatic** ← this is the setting
4. In the **Filename** field, include a `<DateTime>` token so names never repeat
5. In **target folder** just below it, set
   `C:\Users\<YourName>\Documents\Labels` (or use the **…** button)
6. Go to the **Printer** tab. Find your printer in the list, and in the
   **Profile** column pick your autosave profile from the dropdown.
7. Click **Save**

⚠️ **Step 6 is the one everyone misses.** A profile that is not attached to a
printer is ignored completely — printing carries on prompting and nothing looks
wrong in the settings. If steps 1–5 seem right but the dialog still appears,
this is why.

Also worth setting while you are in the profile: turn **off** opening the
document after saving, under the same Save section.

### B2b. Two fixes that make this reliable without a second Chrome profile

Silent printing has two ways to go quietly wrong on a shared profile. Both are
fixed once, and then never thought about again. The files are in the
`windows/` folder of this repo — copy them to the packing PC.

#### Fix 1 — one icon that turns packing mode on and off

`windows/start-packing-chrome.bat` does four things:

1. Remembers the printer you normally use
2. Switches the Windows default to **PDFCreator**
3. Closes Chrome properly, then starts it with `--kiosk-printing`
4. Waits, and **puts your normal printer back the moment you close Chrome**

So the PDF printer is only in force while you are actually packing. Close
Chrome and ordinary printing on the PC is exactly as it was.

It closes Chrome first because **a flag is only read when Chrome starts a new
process.** Any Chrome still running — including the background process that
survives closing every window — makes the flag be ignored, silently. That is
the single most common reason silent printing "stops working".

**Keep the black window open while you pack.** That window is what puts your
printer back. It also tells you at a glance that packing mode is on.

If it ever gets interrupted — window closed, PC restarted — run
`windows/restore-printer.bat` to put your normal printer back.

#### Fix 2 — make Chrome obey the Windows default at all

Chrome prints to the **last printer it used**, remembered per profile, not the
Windows default. That is why setting PDFCreator as the Windows default does
nothing on its own, and why the script above would not be enough by itself.

`windows/chrome-use-system-default-printer.reg` sets Chrome's
`PrintPreviewUseSystemDefaultPrinter` policy, which makes Chrome follow the
Windows default instead of its own memory:

```
[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Google\Chrome]
"PrintPreviewUseSystemDefaultPrinter"=dword:00000001
```

Double-click it, approve the prompt, restart Chrome. One time only.

**Both are needed.** The `.reg` makes Chrome follow Windows; the `.bat` decides
what Windows points at, and only while you are packing.

#### Together

| | While packing | Rest of the time |
|---|---|---|
| Chrome started by | the .bat | normally |
| Print preview | skipped | appears as usual |
| Goes to | PDFCreator, saved as PDF | your normal printer |
| Word, Excel, anything else | PDFCreator | your normal printer |

The switch lasts exactly as long as the packing Chrome is open. Nothing is left
changed afterwards, so this needs no separate Chrome profile.

### B2a. Prove it works before doing the rest

Ten minutes, and it settles the question with no guessing:

1. Install PDFCreator, auto-save on, folder set (B1, B2)
2. Make it the Windows default printer (B3)
3. Close every Chrome window, relaunch with `--kiosk-printing` (B4, B5)
4. Open **any** web page and press **Ctrl+P**

Did a PDF land in the folder with no dialog?

- **yes** — it works, carry on
- **no** — stop, and report what appeared instead

### B3. Make PDFCreator the Windows default printer

Windows → **Settings → Bluetooth & devices → Printers & scanners**

1. Turn **OFF** "Let Windows manage my default printer"
   ← easy to miss, and Windows will undo your choice if you leave it on
2. Click **PDFCreator** → **Set as default**

### B4. Add the flag to your Chrome shortcut

Right-click your Chrome shortcut → **Properties** → **Target**, add
`--kiosk-printing` to the end:

```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing
```

This is the only way. Chrome's silent printing always goes to the **system
default printer** — it cannot be pointed at Chrome's own "Save as PDF". That is
why a virtual PDF printer is needed rather than a Chrome setting alone.

**The trade-off:** every tab in Chrome now prints silently. Ctrl+P on any site
saves a PDF to the Labels folder instead of showing a preview.

### B5. Make sure the flag actually applies

A Chrome flag only takes effect when Chrome **starts fresh**. If Chrome is
already running, the shortcut opens another window in the existing process and
the flag is ignored.

1. Chrome → **Settings → System** → turn **OFF**
   "Continue running background apps when Chrome is closed"
2. **Close every Chrome window**
3. Open Chrome from that shortcut

Then check: type `chrome://version` in the address bar and read the
**Command Line** row.

- `--kiosk-printing` is in it → active
- not there → Chrome was already running. Close everything and relaunch.

That is a definite answer. Check it before blaming anything else.

### B6. Test — one order only

1. Pack one item and scan the cover barcode
2. **Nothing should pop up**
3. Open `Documents\Labels` — two PDFs should be there
4. Open both and check the shipping label is the right size

Do not run a whole picklist until this passes.

### Printing them later

Open the folder → **Ctrl+A** → right-click → **Print**. The whole lot goes to
the printer in one job.

### Things to know

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
