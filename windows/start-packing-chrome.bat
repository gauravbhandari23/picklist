@echo off
REM Starts Chrome with silent printing, reliably.
REM
REM A Chrome command-line flag is only read when Chrome starts a NEW process.
REM If any Chrome is already running -- including the background process that
REM survives closing every window -- a shortcut just opens another window in
REM the old process and the flag is silently ignored. That is the single most
REM common reason silent printing "stops working".
REM
REM So: close Chrome properly first, then start it with the flag.

echo Closing Chrome...
taskkill /F /IM chrome.exe >nul 2>&1
timeout /t 2 /nobreak >nul

echo Starting Chrome with silent printing...
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing

REM If Chrome is installed elsewhere, change the path above. The 32-bit
REM location is:
REM   C:\Program Files (x86)\Google\Chrome\Application\chrome.exe
