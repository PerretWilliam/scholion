mod commands;
mod docs;
mod download;
mod error;
mod settings;
mod storage;

use std::collections::HashSet;
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};

use commands::AppState;

/// Sent with every DevDocs request so the service can identify us.
pub const USER_AGENT: &str = concat!("ai-doc/", env!("CARGO_PKG_VERSION"));

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let http = reqwest::Client::builder().user_agent(USER_AGENT).build()?;
            let data_dir = app.path().app_data_dir()?;
            app.manage(AppState {
                http,
                data_dir,
                installing: Mutex::new(HashSet::new()),
            });
            tauri::async_runtime::spawn(background_doc_check(app.handle().clone()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_docs,
            commands::check_doc_updates,
            commands::install_doc,
            commands::remove_doc,
            commands::get_settings,
            commands::set_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Launch-time manifest check (at most once per 24 h) and optional auto-update.
/// Offline or failing checks are logged and otherwise ignored, as the spec requires.
async fn background_doc_check(app: AppHandle) {
    let state = app.state::<AppState>();
    let manifest = match docs::manifest::refresh(&state.http, &state.data_dir, false).await {
        Ok(manifest) => manifest,
        Err(e) => {
            eprintln!("Background manifest check skipped: {e}");
            return;
        }
    };
    let auto_update = settings::load(&state.data_dir).is_ok_and(|s| s.auto_update_docs);
    if auto_update {
        let installed = docs::install::list_installed(&state.data_dir).unwrap_or_default();
        for doc in docs::installed_status(installed, &manifest.docs) {
            if !doc.update_available {
                continue;
            }
            let Some(latest) = manifest.docs.iter().find(|d| d.slug == doc.entry.slug) else {
                continue;
            };
            if let Err(e) = commands::install_entry(&state, latest, |_| {}).await {
                eprintln!("Auto-update of {} failed: {e}", latest.slug);
            }
        }
    }
    let _ = app.emit("docs-changed", ());
}
