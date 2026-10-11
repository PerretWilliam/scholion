mod commands;
mod docs;
mod download;
mod error;
mod llm;
mod models;
mod settings;
mod storage;

use std::collections::HashMap;
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, RunEvent};

use commands::AppState;

/// Sent with every DevDocs request so the service can identify us.
pub const USER_AGENT: &str = concat!("Scholion/", env!("CARGO_PKG_VERSION"));

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let http = reqwest::Client::builder().user_agent(USER_AGENT).build()?;
            let data_dir = app.path().app_data_dir()?;
            // Exists before anything is downloaded, so its disk can be measured.
            std::fs::create_dir_all(&data_dir)?;
            let llama_dir = app.path().resource_dir()?.join("llama");
            app.manage(AppState {
                http,
                data_dir,
                downloads: Mutex::new(HashMap::new()),
                llama_dir,
                llm: Mutex::new(None),
                llm_start: tokio::sync::Mutex::new(()),
            });
            tauri::async_runtime::spawn(background_doc_check(app.handle().clone()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_docs,
            commands::check_doc_updates,
            commands::install_doc,
            commands::remove_doc,
            commands::search_doc,
            commands::get_page,
            commands::get_passage,
            commands::detect_doc,
            commands::get_settings,
            commands::set_settings,
            commands::free_disk_space,
            commands::start_llm,
            commands::get_models,
            commands::download_model,
            commands::cancel_model_download,
            commands::remove_model,
            commands::set_active_model,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Managed state is not dropped on exit, so stop llama-server explicitly.
            if let RunEvent::Exit = event {
                let state = app.state::<AppState>();
                state.llm.lock().unwrap_or_else(|e| e.into_inner()).take();
            }
        });
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
