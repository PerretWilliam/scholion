//! Every `#[tauri::command]` exposed to the frontend. Keep in sync with `src/lib/ipc.ts`.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::State;
use tauri::ipc::Channel;

use crate::docs::intent::{self, DocIntent};
use crate::docs::manifest::{self, CachedManifest, DocEntry};
use crate::docs::search::{self, Page, SearchHit};
use crate::docs::{InstalledDoc, install, installed_status};
use crate::error::{AppError, Result};
use crate::llm::{self, LlmServer};
use crate::models::{self, CatalogModel};
use crate::settings::{self, Settings};
use crate::storage;

pub struct AppState {
    pub http: reqwest::Client,
    pub data_dir: PathBuf,
    /// Doc slugs and model files being downloaded, with their cancel flag, so nothing is
    /// downloaded twice at the same time.
    pub downloads: Mutex<HashMap<String, Arc<AtomicBool>>>,
    /// Folder holding the bundled `llama-server` and its libraries.
    pub llama_dir: PathBuf,
    /// At most one model is loaded at a time. Never held across an await, so the exit handler
    /// can always take it and kill the process.
    pub llm: Mutex<Option<LlmServer>>,
    /// Serializes `start_llm`, so concurrent callers wait for the model being loaded.
    pub llm_start: tokio::sync::Mutex<()>,
}

#[derive(Serialize)]
pub struct DocsOverview {
    /// Newest version first, as published by DevDocs. Empty until the first manifest check.
    pub available: Vec<DocEntry>,
    pub installed: Vec<InstalledDoc>,
    /// Unix seconds of the last successful manifest check (0 = never).
    pub checked_at: u64,
}

pub fn docs_overview(state: &AppState, manifest: CachedManifest) -> Result<DocsOverview> {
    let installed = install::list_installed(&state.data_dir)?;
    Ok(DocsOverview {
        installed: installed_status(installed, &manifest.docs),
        available: manifest.docs,
        checked_at: manifest.checked_at,
    })
}

/// Cached data only: never touches the network.
#[tauri::command]
pub async fn get_docs(state: State<'_, AppState>) -> Result<DocsOverview> {
    docs_overview(&state, manifest::load_cached(&state.data_dir)?)
}

/// "Check now": refreshes the manifest regardless of the 24 h window and reports errors.
#[tauri::command]
pub async fn check_doc_updates(state: State<'_, AppState>) -> Result<DocsOverview> {
    let manifest = manifest::refresh(&state.http, &state.data_dir, true).await?;
    docs_overview(&state, manifest)
}

/// Installs or updates a doc listed in the cached manifest. Sends download progress (0–100).
#[tauri::command]
pub async fn install_doc(
    state: State<'_, AppState>,
    slug: String,
    on_progress: Channel<u8>,
) -> Result<()> {
    let entry = manifest::load_cached(&state.data_dir)?
        .docs
        .into_iter()
        .find(|d| d.slug == slug)
        .ok_or_else(|| AppError::other(format!("Unknown doc: {slug}")))?;
    install_entry(&state, &entry, |percent| {
        // The window may be gone; progress is best effort.
        let _ = on_progress.send(percent);
    })
    .await
}

#[tauri::command]
pub async fn remove_doc(state: State<'_, AppState>, slug: String) -> Result<()> {
    install::remove(&state.data_dir, &slug)
}

/// Searches an installed doc by entry name, then page text.
#[tauri::command]
pub async fn search_doc(
    state: State<'_, AppState>,
    slug: String,
    query: String,
    limit: usize,
) -> Result<Vec<SearchHit>> {
    install::validate_slug(&slug)?;
    let path = install::doc_path(&state.data_dir, &slug);
    blocking(move || search::search(&search::open(&path)?, &slug, &query, limit.min(100))).await
}

#[tauri::command]
pub async fn get_page(state: State<'_, AppState>, slug: String, path: String) -> Result<Page> {
    install::validate_slug(&slug)?;
    let db = install::doc_path(&state.data_dir, &slug);
    blocking(move || search::get_page(&search::open(&db)?, &slug, &path)).await
}

/// Page text for the model: Markdown from the entry's anchor, cut to fit the context.
#[tauri::command]
pub async fn get_passage(state: State<'_, AppState>, slug: String, path: String) -> Result<String> {
    install::validate_slug(&slug)?;
    let db = install::doc_path(&state.data_dir, &slug);
    blocking(move || search::passage(&search::open(&db)?, &slug, &path, search::PASSAGE_CHARS))
        .await
}

/// The doc a question names, if any, matched against the cached manifest and installed docs.
#[tauri::command]
pub async fn detect_doc(state: State<'_, AppState>, question: String) -> Result<Option<DocIntent>> {
    let manifest = manifest::load_cached(&state.data_dir)?;
    let installed = install::list_installed(&state.data_dir)?;
    Ok(intent::detect(&question, &manifest.docs, &installed))
}

/// Runs SQLite work off the async runtime.
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| AppError::other(format!("Background task failed: {e}")))?
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<Settings> {
    settings::load(&state.data_dir)
}

#[tauri::command]
pub fn set_settings(state: State<'_, AppState>, settings: Settings) -> Result<()> {
    settings::save(&state.data_dir, &settings)
}

/// Returns the port of a `llama-server` running `model` (a file in the models directory),
/// starting it, or restarting it with another model, when needed.
#[tauri::command]
pub async fn start_llm(state: State<'_, AppState>, model: String) -> Result<u16> {
    llm::validate_model_file(&model)?;
    let path = storage::models_dir(&state.data_dir).join(&model);
    if !path.is_file() {
        return Err(AppError::other(format!("Model not downloaded: {model}")));
    }
    let log = storage::llm_log_path(&state.data_dir);
    let _starting = state.llm_start.lock().await;
    let port = {
        let mut current = lock(&state.llm);
        if let Some(server) = current.as_mut()
            && server.model == path
            && server.is_running()
        {
            return Ok(server.port);
        }
        // Free the memory of the previous model before loading the next one.
        *current = None;
        let server = llm::spawn(&state.llama_dir, &path, &log)?;
        let port = server.port;
        *current = Some(server);
        port
    };
    let ready = llm::wait_until_ready(port, &log, || {
        lock(&state.llm)
            .as_mut()
            .is_some_and(|s| s.port == port && s.is_running())
    })
    .await;
    if ready.is_err() {
        lock(&state.llm).take();
    }
    ready.map(|()| port)
}

#[derive(Serialize)]
pub struct ModelStatus {
    #[serde(flatten)]
    pub model: &'static CatalogModel,
    pub downloaded: bool,
    /// Bytes of an unfinished download that can resume (0 = none).
    pub partial_bytes: u64,
}

#[derive(Serialize)]
pub struct ModelsOverview {
    pub models: Vec<ModelStatus>,
    /// File of the model used for answers, if it is downloaded.
    pub active: Option<String>,
}

#[tauri::command]
pub fn get_models(state: State<'_, AppState>) -> Result<ModelsOverview> {
    let models: Vec<ModelStatus> = models::CATALOG
        .iter()
        .map(|model| ModelStatus {
            model,
            downloaded: models::model_path(&state.data_dir, model).is_file(),
            partial_bytes: std::fs::metadata(models::part_path(&state.data_dir, model))
                .map_or(0, |m| m.len()),
        })
        .collect();
    let active = settings::load(&state.data_dir)?
        .active_model
        .filter(|file| models.iter().any(|m| m.downloaded && m.model.file == file));
    Ok(ModelsOverview { models, active })
}

/// Downloads (or resumes) a catalog model and sends progress (0–100). The first model downloaded
/// becomes the active one.
#[tauri::command]
pub async fn download_model(
    state: State<'_, AppState>,
    file: String,
    on_progress: Channel<u8>,
) -> Result<()> {
    let model = models::find(&file)?;
    let guard = DownloadGuard::acquire(&state.downloads, model.file)?;
    let mut last = None;
    models::download(
        &state.http,
        &state.data_dir,
        model,
        &guard.cancel,
        |bytes| {
            let percent = (bytes.saturating_mul(100) / model.size).min(100) as u8;
            if last != Some(percent) {
                last = Some(percent);
                let _ = on_progress.send(percent);
            }
        },
    )
    .await?;
    let mut current = settings::load(&state.data_dir)?;
    if current.active_model.is_none() {
        current.active_model = Some(model.file.to_owned());
        settings::save(&state.data_dir, &current)?;
    }
    Ok(())
}

/// Stops a model download. The partial file is kept so it can resume.
#[tauri::command]
pub fn cancel_model_download(state: State<'_, AppState>, file: String) {
    if let Some(cancel) = lock(&state.downloads).get(&file) {
        cancel.store(true, Ordering::Relaxed);
    }
}

/// Deletes a model and any partial download, stopping `llama-server` first if it uses it.
#[tauri::command]
pub async fn remove_model(state: State<'_, AppState>, file: String) -> Result<()> {
    let model = models::find(&file)?;
    if lock(&state.downloads).contains_key(model.file) {
        return Err(AppError::other(format!(
            "Cancel the download of {} first",
            model.name
        )));
    }
    let path = models::model_path(&state.data_dir, model);
    {
        let _starting = state.llm_start.lock().await;
        let mut current = lock(&state.llm);
        if current.as_ref().is_some_and(|s| s.model == path) {
            *current = None; // Windows cannot delete a file in use.
        }
    }
    for path in [path, models::part_path(&state.data_dir, model)] {
        match std::fs::remove_file(path) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e.into()),
            _ => {}
        }
    }
    let mut current = settings::load(&state.data_dir)?;
    if current.active_model.as_deref() == Some(model.file) {
        current.active_model = None;
        settings::save(&state.data_dir, &current)?;
    }
    Ok(())
}

#[tauri::command]
pub fn set_active_model(state: State<'_, AppState>, file: String) -> Result<()> {
    let model = models::find(&file)?;
    if !models::model_path(&state.data_dir, model).is_file() {
        return Err(AppError::other(format!("{} is not downloaded", model.name)));
    }
    let mut current = settings::load(&state.data_dir)?;
    current.active_model = Some(model.file.to_owned());
    settings::save(&state.data_dir, &current)
}

/// A poisoned lock only means another thread panicked; the data is still usable.
fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

/// Shared by the command and the background auto-update.
pub async fn install_entry(
    state: &AppState,
    entry: &DocEntry,
    mut on_percent: impl FnMut(u8),
) -> Result<()> {
    let _guard = DownloadGuard::acquire(&state.downloads, &entry.slug)?;
    let total = entry.db_size.max(1);
    let mut last = None;
    install::install(&state.http, &state.data_dir, entry, |bytes| {
        let percent = (bytes.saturating_mul(100) / total).min(100) as u8;
        if last != Some(percent) {
            last = Some(percent);
            on_percent(percent);
        }
    })
    .await
}

struct DownloadGuard<'a> {
    map: &'a Mutex<HashMap<String, Arc<AtomicBool>>>,
    key: String,
    cancel: Arc<AtomicBool>,
}

impl<'a> DownloadGuard<'a> {
    fn acquire(map: &'a Mutex<HashMap<String, Arc<AtomicBool>>>, key: &str) -> Result<Self> {
        let cancel = Arc::new(AtomicBool::new(false));
        let mut downloads = lock(map);
        if downloads.contains_key(key) {
            return Err(AppError::other(format!(
                "{key} is already being downloaded"
            )));
        }
        downloads.insert(key.to_owned(), cancel.clone());
        Ok(Self {
            map,
            key: key.to_owned(),
            cancel,
        })
    }
}

impl Drop for DownloadGuard<'_> {
    fn drop(&mut self) {
        lock(self.map).remove(&self.key);
    }
}
