@echo off
setlocal
cd /d "%~dp0"
if not exist node_modules (
  echo Proxima dependencies are missing. Run "Setup Desktop.bat" first.
  pause
  exit /b 1
)
where cargo >nul 2>nul || (
  echo Rust/Cargo is missing. See README.md for prerequisites.
  pause
  exit /b 1
)
call npm.cmd run tauri dev
pause
