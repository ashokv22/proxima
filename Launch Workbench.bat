@echo off
setlocal
cd /d "%~dp0"

where py >nul 2>nul
if not errorlevel 1 (
  where pyw >nul 2>nul
  if not errorlevel 1 (
    py -3 -c "import sys, PySide6; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>nul
    if not errorlevel 1 (
      start "" pyw -3 "%~dp0run.pyw"
      exit /b 0
    )
  )
)

where pythonw >nul 2>nul
if not errorlevel 1 (
  where python >nul 2>nul
  if not errorlevel 1 (
    python -c "import sys, PySide6; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>nul
    if not errorlevel 1 (
      start "" pythonw "%~dp0run.pyw"
      exit /b 0
    )
  )
)

:missing_dependency
echo Local Text Workbench requires Python 3.10 or newer and PySide6.
echo.
echo PySide6 is not installed for the selected Python interpreter.
echo Run "Setup PySide6.bat" to review and explicitly approve installation.
pause
exit /b 1
