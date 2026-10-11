use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::storage;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    /// Install doc updates automatically after the background manifest check.
    pub auto_update_docs: bool,
    /// File name of the model used for answers.
    pub active_model: Option<String>,
}

pub fn load(data_dir: &Path) -> Result<Settings> {
    Ok(storage::read_json(&storage::settings_path(data_dir))?.unwrap_or_default())
}

pub fn save(data_dir: &Path, settings: &Settings) -> Result<()> {
    storage::write_json_atomic(&storage::settings_path(data_dir), settings)
}
