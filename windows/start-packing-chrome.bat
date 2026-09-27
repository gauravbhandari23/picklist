@echo off
setlocal

REM ===================================================================
REM  Opens the packing Chrome. Labels save straight to PDF, no dialogs.
REM
REM  Your normal Chrome is a completely separate instance and is not
REM  affected -- it keeps using whichever printer you choose, and both
REM  can be open at the same time.
REM
REM  --user-data-dir is what makes this work. It starts Chrome as its
REM  own instance, so --kiosk-printing actually applies. (--profile-
REM  directory would NOT: profiles share one browser process, and a
REM  flag is only read when a new process starts.)
REM
REM  Run setup-packing-chrome.bat first, once.
REM ===================================================================

set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" (
  echo Could not find chrome.exe. Edit the CHROME line in this file.
  pause
  exit /b 1
)

set "PACKDIR=%LOCALAPPDATA%\ChromePacking"

if not exist "%PACKDIR%" (
  echo The packing Chrome is not set up yet.
  echo Run setup-packing-chrome.bat first.
  pause
  exit /b 1
)

start "" "%CHROME%" --user-data-dir="%PACKDIR%" --kiosk-printing
endlocal
