@echo off
setlocal
cd /d "%~dp0"
echo Local Text Workbench requires PySide6.
echo.
echo This explicit setup step will use pip to download and install the packages
echo listed in requirements.txt for your Windows user account.
echo No installation will occur unless you confirm below.
echo.
choice /C YN /M "Install PySide6 now"
if errorlevel 2 exit /b 1

where py >nul 2>nul
if not errorlevel 1 (
  py -3 -m pip install --user --requirement "%~dp0requirements.txt"
) else (
  where python >nul 2>nul
  if errorlevel 1 goto :no_python
  python -m pip install --user --requirement "%~dp0requirements.txt"
)

if errorlevel 1 (
  echo.
  echo PySide6 installation failed. Review the pip output above.
  pause
  exit /b 1
)

echo.
echo PySide6 is installed. You can now run Launch Workbench.bat.
pause
exit /b 0

:no_python
echo Python 3.10 or newer is required. Install Python from python.org and retry.
pause
exit /b 1
