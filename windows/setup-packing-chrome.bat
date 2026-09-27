@echo off
setlocal

REM ===================================================================
REM  RUN THIS ONCE, to set up the packing Chrome.
REM
REM  It opens the packing Chrome WITHOUT silent printing, so you still
REM  get the normal print preview and can tell it which printer to use.
REM  After this, use start-packing-chrome.bat every day instead.
REM ===================================================================

set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" (
  echo Could not find chrome.exe. Edit the CHROME line in this file.
  pause
  exit /b 1
)

set "PACKDIR=%LOCALAPPDATA%\ChromePacking"

echo ===================================================================
echo   FIRST-TIME SETUP
echo.
echo   A separate Chrome is opening. Your normal Chrome is untouched --
echo   different bookmarks, different logins, its own printer setting.
echo.
echo   In the window that opens, do these three things:
echo.
echo     1. Log in to Myntra
echo.
echo     2. Install the extension:
echo          chrome://extensions  ^>  Developer mode ON
echo          ^>  Load unpacked  ^>  pick the myntra-picklist-panel folder
echo.
echo     3. Teach it the printer:
echo          open any page, press Ctrl+P,
echo          set Destination to PDFCreator, click Print
echo        ^(this is what makes labels go to PDF later^)
echo.
echo   Then close it and use start-packing-chrome.bat from now on.
echo ===================================================================
echo.

start "" "%CHROME%" --user-data-dir="%PACKDIR%"

echo Packing Chrome opened.
echo Stored at: %PACKDIR%
echo.
echo When you have done those three things, close that Chrome and
echo use start-packing-chrome.bat from now on.
echo.
pause
endlocal
