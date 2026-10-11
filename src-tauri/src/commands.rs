//! Every `#[tauri::command]` exposed to the frontend. Keep in sync with `src/lib/ipc.ts`.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
use tauri::State;
use tauri::ipc::Channel;

use crate::docs::manifest::{self, CachedManifest, DocEntry};
use crate::docs::search::{self, Page, SearchHit};
use crate::docs::{InstalledDoc, install, installed_status};
use crate::error::{AppError, Result};
use crate::settings::{self, Settings};

pub struct AppState {
    pub http: reqwest::Client,
    pub data_dir: PathBuf,
    /// Slugs being installed, so a doc is never installed twice at the same time.
    pub installing: Mutex<HashSet<String>>,
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

/// Shared by the command and the background auto-update.
pub async fn install_entry(
    state: &AppState,
    entry: &DocEntry,
    mut on_percent: impl FnMut(u8),
) -> Result<()> {
    let _guard = InstallGuard::acquire(&state.installing, &entry.slug)?;
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

struct InstallGuard<'a> {
    set: &'a Mutex<HashSet<String>>,
    slug: String,
}

impl<'a> InstallGuard<'a> {
    fn acquire(set: &'a Mutex<HashSet<String>>, slug: &str) -> Result<Self> {
        let mut slugs = set.lock().unwrap_or_else(|e| e.into_inner());
        if !slugs.insert(slug.to_owned()) {
            return Err(AppError::other(format!(
                "{slug} is already being installed"
            )));
        }
        Ok(Self {
            set,
            slug: slug.to_owned(),
        })
    }
}

impl Drop for InstallGuard<'_> {
    fn drop(&mut self) {
        self.set
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&self.slug);
    }
}
