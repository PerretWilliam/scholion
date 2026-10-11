//! DevDocs manifest: download, cache, and staleness rules.
//! See docs/architecture.md, "DevDocs > Manifest".

use std::collections::BTreeMap;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use reqwest::header::LOCATION;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, Result};
use crate::storage;

pub const MANIFEST_URL: &str = "https://devdocs.io/docs.json";
const CHECK_INTERVAL_SECS: u64 = 24 * 60 * 60;

/// One entry of the DevDocs manifest. Field names match DevDocs.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DocEntry {
    pub name: String,
    pub slug: String,
    #[serde(rename = "type", default, deserialize_with = "null_as_default")]
    pub kind: String,
    #[serde(default, deserialize_with = "null_as_default")]
    pub version: String,
    #[serde(default)]
    pub release: Option<String>,
    pub mtime: u64,
    pub db_size: u64,
    /// HTML. Sanitize before rendering.
    #[serde(default, deserialize_with = "null_as_default")]
    pub attribution: String,
    #[serde(default)]
    pub alias: Option<String>,
    #[serde(default, deserialize_with = "null_as_default")]
    pub links: BTreeMap<String, String>,
}

/// The live manifest has `null` in fields that are usually strings (e.g. `type`).
fn null_as_default<'de, D, T>(deserializer: D) -> std::result::Result<T, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Default + Deserialize<'de>,
{
    Ok(Option::<T>::deserialize(deserializer)?.unwrap_or_default())
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct CachedManifest {
    /// Content-hashed URL that `docs.json` redirected to. Unchanged location = unchanged manifest.
    pub location: Option<String>,
    /// Unix seconds of the last successful check.
    pub checked_at: u64,
    /// Newest version first, as published by DevDocs.
    pub docs: Vec<DocEntry>,
}

pub fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

pub fn is_stale(checked_at: u64, now: u64) -> bool {
    now.saturating_sub(checked_at) >= CHECK_INTERVAL_SECS
}

pub fn load_cached(data_dir: &Path) -> Result<CachedManifest> {
    Ok(storage::read_json(&storage::manifest_path(data_dir))?.unwrap_or_default())
}

/// Returns the cached manifest, refreshing it from DevDocs when stale or when `force` is set.
/// Only downloads the full manifest when the redirect target changed.
pub async fn refresh(
    http: &reqwest::Client,
    data_dir: &Path,
    force: bool,
) -> Result<CachedManifest> {
    let mut cached = load_cached(data_dir)?;
    let now = unix_now();
    if !force && !cached.docs.is_empty() && !is_stale(cached.checked_at, now) {
        return Ok(cached);
    }

    // `docs.json` answers 303 to an immutable, content-hashed asset: compare that location
    // instead of downloading ~400 KB every time.
    let no_redirect = reqwest::Client::builder()
        .user_agent(crate::USER_AGENT)
        .redirect(reqwest::redirect::Policy::none())
        .build()?;
    let response = no_redirect.get(MANIFEST_URL).send().await?;
    let location = match response.headers().get(LOCATION) {
        Some(value) => {
            let value = value
                .to_str()
                .map_err(|_| AppError::other("Invalid manifest redirect"))?;
            let url = response
                .url()
                .join(value)
                .map_err(|_| AppError::other("Invalid manifest redirect"))?;
            Some(url.to_string())
        }
        None => None,
    };

    if location.is_some() && location == cached.location && !cached.docs.is_empty() {
        cached.checked_at = now;
    } else {
        let docs: Vec<DocEntry> = match &location {
            Some(url) => {
                http.get(url)
                    .send()
                    .await?
                    .error_for_status()?
                    .json()
                    .await?
            }
            None => response.error_for_status()?.json().await?,
        };
        cached = CachedManifest {
            location,
            checked_at: now,
            docs,
        };
    }
    storage::write_json_atomic(&storage::manifest_path(data_dir), &cached)?;
    Ok(cached)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_devdocs_manifest() {
        let raw = include_str!("../../tests/fixtures/devdocs/docs.json");
        let docs: Vec<DocEntry> = serde_json::from_str(raw).unwrap();
        assert_eq!(docs.len(), 4);
        let python = &docs[0];
        assert_eq!(python.slug, "python~3.15");
        assert_eq!(python.release.as_deref(), Some("3.15.0"));
        assert_eq!(python.alias.as_deref(), Some("py"));
        // `alias: null` and missing `links` are accepted.
        let c = docs.iter().find(|d| d.slug == "c").unwrap();
        assert_eq!(c.alias, None);
        assert!(c.links.is_empty());
        // `type: null` is accepted.
        let angular = docs.iter().find(|d| d.slug == "angular").unwrap();
        assert_eq!(angular.kind, "");
    }

    #[test]
    fn staleness_uses_a_24_hour_window() {
        assert!(!is_stale(1_000, 1_000 + CHECK_INTERVAL_SECS - 1));
        assert!(is_stale(1_000, 1_000 + CHECK_INTERVAL_SECS));
        // A clock that went backwards is not "stale".
        assert!(!is_stale(5_000, 1_000));
    }
}
