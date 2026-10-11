use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, Result};
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

/// An OpenAI-compatible provider. The key lives in the OS keychain, never in `settings.json`:
/// `load` and `save` leave it blank, `load_with_key` and `save_with_key` move it.
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

fn keychain_entry() -> Result<keyring::Entry> {
    keyring::Entry::new("scholion", "cloud-api-key").map_err(keychain_error)
}

fn keychain_error(e: keyring::Error) -> AppError {
    AppError::other(format!("Keychain error: {e}"))
}

/// Settings for the settings screen, with the API key read from the keychain. A key found in
/// `settings.json` (older versions) is moved to the keychain first.
pub fn load_with_key(data_dir: &Path) -> Result<Settings> {
    let mut settings = load(data_dir)?;
    let Some(cloud) = settings.cloud.as_mut() else {
        return Ok(settings);
    };
    let entry = keychain_entry()?;
    if cloud.api_key.is_empty() {
        cloud.api_key = match entry.get_password() {
            Ok(key) => key,
            Err(keyring::Error::NoEntry) => String::new(),
            Err(e) => return Err(keychain_error(e)),
        };
    } else {
        entry.set_password(&cloud.api_key).map_err(keychain_error)?;
        save(data_dir, &without_key(&settings))?;
    }
    Ok(settings)
}

/// Saves the settings: the API key goes to the keychain, the rest to `settings.json`.
pub fn save_with_key(data_dir: &Path, settings: &Settings) -> Result<()> {
    let entry = keychain_entry()?;
    match settings.cloud.as_ref().map(|c| c.api_key.as_str()) {
        Some(key) if !key.is_empty() => entry.set_password(key).map_err(keychain_error)?,
        Some(_) => {}
        None => match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(e) => return Err(keychain_error(e)),
        },
    }
    save(data_dir, &without_key(settings))
}

fn without_key(settings: &Settings) -> Settings {
    let mut copy = settings.clone();
    if let Some(cloud) = copy.cloud.as_mut() {
        cloud.api_key.clear();
    }
    copy
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saved_file_never_holds_the_key() {
        let settings = Settings {
            cloud: Some(Cloud {
                provider: "openai".into(),
                api_key: "sk-secret".into(),
                model: "gpt".into(),
            }),
            ..Settings::default()
        };
        let copy = without_key(&settings);
        assert_eq!(copy.cloud.as_ref().map(|c| c.api_key.as_str()), Some(""));
        assert!(!serde_json::to_string(&copy).unwrap().contains("sk-secret"));
        // The original is untouched.
        assert_eq!(settings.cloud.unwrap().api_key, "sk-secret");
    }

    /// Talks to the real OS keychain, on a throwaway account.
    #[test]
    #[ignore = "uses the OS keychain"]
    fn live_keychain_round_trip() {
        let entry = keyring::Entry::new("scholion", "test-account").unwrap();
        entry.set_password("value").unwrap();
        assert_eq!(entry.get_password().unwrap(), "value");
        entry.delete_credential().unwrap();
        assert!(matches!(entry.get_password(), Err(keyring::Error::NoEntry)));
    }
}
