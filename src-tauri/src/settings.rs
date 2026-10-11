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
    /// Cloud provider to answer with instead of the local model; kept even while unused.
    pub cloud: Option<Cloud>,
    /// Answer with `cloud` rather than the local model.
    pub use_cloud: bool,
}

/// An OpenAI-compatible provider. The key sits in the settings file, readable by this user only
/// as far as the OS file permissions go.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Cloud {
    /// "openrouter" or "openai"; the frontend maps it to a base URL.
    pub provider: String,
    pub api_key: String,
    pub model: String,
}

pub fn load(data_dir: &Path) -> Result<Settings> {
    Ok(storage::read_json(&storage::settings_path(data_dir))?.unwrap_or_default())
}

pub fn save(data_dir: &Path, settings: &Settings) -> Result<()> {
    storage::write_json_atomic(&storage::settings_path(data_dir), settings)
}
