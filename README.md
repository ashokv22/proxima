# Local Text Workbench v0.1

Offline Windows utility for sanitizing and cleaning text. The native desktop interface uses PySide6; no AI model, network service, or database is used.

## Requirements
- Windows 11
- Python 3.10+
- PySide6 6.8 or newer

## One-time setup
Double-click **Setup PySide6.bat**. It explains that pip will download PySide6 and asks for explicit confirmation before installing anything. The application never installs or downloads dependencies silently.

## Launch
1. Extract the ZIP to `C:\AI\local_text_workbench` (or anywhere you prefer) and complete the one-time setup above.
2. Double-click **Launch Workbench.bat**. The launcher verifies Python and PySide6 before starting; Python stays running in the background when you close the window.
3. Press **Ctrl+Alt+Space** to open a fresh workbench session, then use **Paste clipboard** when you are ready to load the current clipboard text.
4. Choose **Sanitize**, **Clean Logs**, or **Sanitize + Clean**.
5. Click **Process** or press **Ctrl+Enter**. Review the output. Click **Copy output** when satisfied.
6. **File > Exit** completely quits the app.

If the shortcut is already reserved by another program, the application will say so. Keep the window open or restart it from the launcher after closing it.

## Testing
Double-click **Run Tests.bat**, or run `py -3 -m unittest discover -s tests -v`.

## Data and security
- No raw input is persisted to disk by the application. Clipboard content is held in memory while the app runs.
- Clean Logs preferences are stored locally as five boolean values; log and clipboard contents are never written to settings.
- This app does **not** call the internet or launch llama.cpp.
- Sanitization is **best-effort**: it does not guarantee removal of all PII, passwords, tokens, account numbers, names, addresses, custom identifiers, or secret formats. Review before sharing externally.
- IPs, emails, bearer/basic tokens, JWTs, common key-value secrets, URL credentials and sensitive JSON keys are handled; Indian phone detection is optional and heuristic.
- The app never automatically replaces the clipboard with its output.
- File-open preview limit: 10 MB and 2 million characters. Larger file processing will be implemented with streaming tools in a later release.
- The app does not log raw inputs, but Windows clipboard history, antivirus, or other system services may independently retain clipboard contents.

## Current limitations
- No system tray icon. Closing hides the app, and the global shortcut reopens it. Use File > Exit to quit.
- No SQLite preferences, learning, embeddings, AI planner, or streaming log analysis in v0.1.
- Windows may block global hotkey registration if another application already owns the combination.
- This is a prototype. Do not treat its redaction as a compliance-certified DLP system.
