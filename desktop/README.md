# Local Text Workbench Desktop

This directory contains the Tauri 2 migration. The existing Python application remains untouched at the repository root.

## Prerequisites on Windows

1. Node.js LTS (Node 20 or newer).
2. Rust stable MSVC toolchain. Current Tauri plugins require Rust 1.90 or newer.
3. Visual Studio Build Tools with **Desktop development with C++** selected.
4. Microsoft Edge WebView2. It is already included with current Windows 10 and Windows 11 installations.

Official prerequisite guide: <https://v2.tauri.app/start/prerequisites/>

## Setup and development

1. Run `Setup Desktop.bat`. It asks before downloading npm packages.
2. Run `Run Desktop Dev.bat` for the native development application.
3. Run `npm.cmd test` for frontend tests.
4. Run `cargo test --manifest-path src-tauri/Cargo.toml` for Rust tests.

PowerShell blocks `npm.ps1` on some Windows configurations. The scripts deliberately call `npm.cmd`, so changing PowerShell execution policy is unnecessary.

## Production build

Run `Build Desktop.bat`. The NSIS installer is written under `src-tauri/target/release/bundle/nsis/`.

The application makes no external network requests. The optional AI Insights feature connects only to a llama.cpp server already running on `127.0.0.1:8000`; it never starts or downloads a model. The default installer is configured to obtain WebView2 only when the target machine does not already provide it.

## Optional local AI Insights

Start your existing llama.cpp OpenAI-compatible server on port 8000, then open **AI Insights** in the Output panel and select **Analyze**. Processing and pasting never send text automatically.

- The UI sends only the deterministic, sanitized output to the Rust command, never the raw input editor value.
- Rust accepts no configurable host and connects only to IPv4 loopback at `127.0.0.1:8000`.
- Evidence is limited to 64 KiB at the command boundary and sampled down to at most 80 lines / 8 KiB.
- Requests use temperature `0.1`, a 256-token output limit, and a 90-second timeout.
- Logs, sampled evidence, and model responses are held in memory only and are cleared with the session.

The server contract and safe error codes are documented in [`docs/ai-insights-contract.md`](docs/ai-insights-contract.md).

## Architecture

- `src/`: React/TypeScript UI and the narrow Tauri bridge.
- `src-tauri/`: native lifecycle, shortcut, single-instance behavior, Rust processing, and the fixed-loopback llama.cpp client.
- Clean Logs metadata preferences contain only booleans and are stored in WebView local storage.
- Input, output, clipboard contents, and processing results are never persisted by the application.
