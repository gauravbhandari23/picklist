@echo off
setlocal enabledelayedexpansion

REM Safety net. Run this if packing mode was interrupted -- the window
REM was closed, or the PC restarted -- and printing is still going to
REM PDF instead of paper.

if exist "%TEMP%\packing_old_printer.txt" (
  set /p OLD=<"%TEMP%\packing_old_printer.txt"
  echo Restoring !OLD! ...
  rundll32 printui.dll,PrintUIEntry /y /n "!OLD!"
  del "%TEMP%\packing_old_printer.txt" >nul 2>&1
  echo Done.
) else (
  echo No saved printer found.
  echo.
  echo Set it by hand instead:  Win+R  ^>  control printers
  echo then right-click your printer ^> Set as default printer
)

pause
endlocal
