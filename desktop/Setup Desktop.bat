@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul || goto :missing_node
where npm.cmd >nul 2>nul || goto :missing_node
where rustc >nul 2>nul || goto :missing_rust
where cargo >nul 2>nul || goto :missing_rust

echo This will download the pinned frontend dependencies from package.json.
echo Rust crates will be downloaded later by Cargo during the first Tauri run.
echo No application content or clipboard data is uploaded.
echo.
choice /C YN /M "Run npm install now"
if errorlevel 2 exit /b 1
call npm.cmd install
if errorlevel 1 goto :failed
echo.
echo Setup complete. Run "Run Desktop Dev.bat" to start the application.
pause
exit /b 0

:missing_node
echo Node.js LTS is required. Install it from https://nodejs.org/ and retry.
pause
exit /b 1

:missing_rust
echo Rust with the stable MSVC toolchain is required.
echo Install it from https://rustup.rs/ and restart this terminal.
echo Tauri also requires Visual Studio Build Tools with Desktop development with C++.
pause
exit /b 1

:failed
echo Dependency installation failed. Review the npm output above.
pause
exit /b 1
