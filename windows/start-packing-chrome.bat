@echo off
setlocal enabledelayedexpansion

REM ===================================================================
REM  Packing mode
REM
REM  While this window is open:  Chrome prints labels silently to PDF
REM  When you close Chrome:      your normal printer comes straight back
REM
REM  Nothing is left switched over afterwards, so ordinary printing on
REM  this PC is unaffected once you are done packing.
REM ===================================================================

set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
set "PACKPRINTER=PDFCreator"

if not exist "%CHROME%" set "CHROME=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" (
  echo Could not find chrome.exe. Edit the CHROME line in this file.
  pause
  exit /b 1
)

REM --- remember the printer you normally use -------------------------
set "OLD="
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "(Get-CimInstance Win32_Printer -Filter 'Default=True').Name" 2^>nul`) do set "OLD=%%P"

if defined OLD (
  echo Normal printer: !OLD!
  > "%TEMP%\packing_old_printer.txt" echo !OLD!
) else (
  echo No default printer found - nothing will be restored afterwards.
)

REM --- switch to the PDF printer for the packing session -------------
echo Switching to %PACKPRINTER% ...
rundll32 printui.dll,PrintUIEntry /y /n "%PACKPRINTER%"
if errorlevel 1 (
  echo.
  echo Could not select "%PACKPRINTER%".
  echo Check the exact printer name in:  Win+R  ^>  control printers
  pause
)

REM --- a flag is only read when Chrome starts a NEW process ----------
REM Any Chrome still running, including the background process that
REM survives closing every window, makes the flag be ignored silently.
echo Closing Chrome ...
taskkill /F /IM chrome.exe >nul 2>&1
timeout /t 2 /nobreak >nul

echo Starting Chrome with silent printing ...
start "" "%CHROME%" --kiosk-printing

echo.
echo ===================================================================
echo   PACKING MODE IS ON
echo.
echo   Labels save straight to PDF. No dialogs.
echo   KEEP THIS WINDOW OPEN.
echo.
echo   Close Chrome when you finish and your normal printer
echo   ^(!OLD!^) comes back automatically.
echo ===================================================================
echo.

REM --- wait for Chrome to be closed ----------------------------------
timeout /t 8 /nobreak >nul
:wait
timeout /t 5 /nobreak >nul
tasklist /FI "IMAGENAME eq chrome.exe" 2>nul | find /I "chrome.exe" >nul
if not errorlevel 1 goto wait

REM --- put the normal printer back -----------------------------------
if defined OLD (
  echo Chrome closed. Restoring !OLD! ...
  rundll32 printui.dll,PrintUIEntry /y /n "!OLD!"
  del "%TEMP%\packing_old_printer.txt" >nul 2>&1
  echo Done. Normal printing is back to !OLD!.
) else (
  echo Chrome closed. No printer to restore.
)

timeout /t 3 /nobreak >nul
endlocal
