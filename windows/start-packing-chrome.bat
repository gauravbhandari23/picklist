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

REM The trailing backslash is what makes this test a DIRECTORY reliably.
if not exist "%PACKDIR%\" (
  echo.
  echo  ==================================================================
  echo   NOT SET UP YET
  echo.
  echo   Run  setup-packing-chrome.bat  first -- once only.
  echo.
  echo   That one logs you in to Myntra, installs the extension and
  echo   sets the printer. This one refuses to start until it has,
  echo   because it turns off the print preview and you would have
  echo   no way to fix any of that from inside.
  echo  ==================================================================
  echo.
  pause
  exit /b 1
)

echo Starting packing Chrome...
start "" "%CHROME%" --user-data-dir="%PACKDIR%" --kiosk-printing
if errorlevel 1 (
  echo.
  echo Chrome did not start. Path used:
  echo   %CHROME%
  pause
)
endlocal
