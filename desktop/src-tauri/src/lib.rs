use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

mod ai;
mod processor;
use ai::{AiAnalysis, AiClient, AiStatus};
use processor::{ProcessRequest, ProcessResult};

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct ShortcutStatus {
    shortcut: Option<String>,
    available: bool,
}

#[derive(Default)]
struct AppState {
    shortcut: Mutex<ShortcutStatus>,
}

fn show_fresh_session(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("clear-session", ());
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[tauri::command]
fn shortcut_status(state: State<'_, AppState>) -> ShortcutStatus {
    state
        .shortcut
        .lock()
        .expect("shortcut state poisoned")
        .clone()
}

#[tauri::command]
fn exit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn process_text(request: ProcessRequest) -> Result<ProcessResult, String> {
    processor::process(request).map_err(str::to_owned)
}

#[tauri::command]
async fn check_ai_status() -> AiStatus {
    let connected = tauri::async_runtime::spawn_blocking(|| AiClient::production().check_status())
        .await
        .unwrap_or(false);
    AiStatus { connected }
}

#[tauri::command]
async fn analyze_logs(evidence: String) -> Result<AiAnalysis, String> {
    tauri::async_runtime::spawn_blocking(move || AiClient::production().analyze(&evidence))
        .await
        .map_err(|_| "AI_HTTP_ERROR".to_owned())?
        .map_err(|error| error.code().to_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // This must be the first plugin so a second launch cannot initialize
        // another hotkey listener or application window.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_fresh_session(app);
        }))
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        show_fresh_session(app);
                    }
                })
                .build(),
        )
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            shortcut_status,
            exit_app,
            process_text,
            check_ai_status,
            analyze_logs
        ])
        .setup(|app| {
            let shortcuts = ["Ctrl+Alt+Space", "Ctrl+Shift+Space"];
            let selected = shortcuts
                .into_iter()
                .find(|shortcut| app.global_shortcut().register(*shortcut).is_ok())
                .map(str::to_owned);
            let state = app.state::<AppState>();
            *state.shortcut.lock().expect("shortcut state poisoned") = ShortcutStatus {
                available: selected.is_some(),
                shortcut: selected,
            };
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Local Text Workbench");
}

#[cfg(test)]
mod tests {
    use super::process_text;
    use crate::processor::{GlobalOptions, LogMetadataOptions, ProcessRequest};

    #[test]
    fn process_command_does_not_return_unchanged_input_as_success() {
        let input = "password=hunter2";
        let result = process_text(ProcessRequest {
            text: input.to_owned(),
            action: "Sanitize".to_owned(),
            global_options: GlobalOptions {
                mask_ips: false,
                mask_emails: false,
                mask_phones: false,
                remove_threads: false,
                remove_loggers: false,
            },
            log_metadata: LogMetadataOptions::default(),
        });

        let response = result.expect("process_text must return a structured result");
        assert_ne!(response.text, input);
    }
}
