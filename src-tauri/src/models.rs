//! Model catalog and downloads. Pins (sizes, sha256) are documented in docs/architecture.md.

use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;

use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::download::download_resumable;
use crate::error::{AppError, Result};
use crate::storage;

#[derive(Debug, Serialize)]
pub struct CatalogModel {
    /// File name in the models directory; also the model id.
    pub file: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    /// Hugging Face repository.
    pub repo: &'static str,
    pub size: u64,
    pub sha256: &'static str,
    pub recommended: bool,
}

pub const CATALOG: &[CatalogModel] = &[
    CatalogModel {
        file: "Qwen3.5-4B-Q4_K_M.gguf",
        name: "Qwen3.5 4B",
        description: "Fast, good answers. Needs 8 GB of RAM.",
        repo: "unsloth/Qwen3.5-4B-GGUF",
        size: 2_740_937_888,
        sha256: "00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4",
        recommended: true,
    },
    CatalogModel {
        file: "Qwen3.5-9B-Q4_K_M.gguf",
        name: "Qwen3.5 9B",
        description: "More accurate, slower. Needs 16 GB of RAM.",
        repo: "unsloth/Qwen3.5-9B-GGUF",
        size: 5_680_522_464,
        sha256: "03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8",
        recommended: false,
    },
    CatalogModel {
        file: "gemma-4-E4B_q4_0-it.gguf",
        name: "Gemma 4 E4B",
        description: "Alternative to Qwen3.5 9B. Needs 16 GB of RAM.",
        repo: "google/gemma-4-E4B-it-qat-q4_0-gguf",
        size: 5_154_941_280,
        sha256: "676c35070db6dbe52f93e9c864ee0fba4eddea94b9c875d9cb10daff453fbaee",
        recommended: false,
    },
];

pub fn find(file: &str) -> Result<&'static CatalogModel> {
    CATALOG
        .iter()
        .find(|m| m.file == file)
        .ok_or_else(|| AppError::other(format!("Unknown model: {file}")))
}

pub fn model_path(data_dir: &Path, model: &CatalogModel) -> PathBuf {
    storage::models_dir(data_dir).join(model.file)
}

/// Unfinished download, kept so it can resume.
pub fn part_path(data_dir: &Path, model: &CatalogModel) -> PathBuf {
    storage::tmp_dir(data_dir).join(format!("{}.part", model.file))
}

/// Downloads `model`, resuming a previous partial download, then checks its sha256 and moves it
/// into the models directory. `on_progress` receives the bytes downloaded so far.
pub async fn download(
    http: &reqwest::Client,
    data_dir: &Path,
    model: &'static CatalogModel,
    cancel: &AtomicBool,
    on_progress: impl FnMut(u64),
) -> Result<()> {
    let part = part_path(data_dir, model);
    fs::create_dir_all(storage::tmp_dir(data_dir))?;
    fs::create_dir_all(storage::models_dir(data_dir))?;
    let url = format!(
        "https://huggingface.co/{}/resolve/main/{}",
        model.repo, model.file
    );
    download_resumable(http, &url, &part, cancel, on_progress).await?;

    let check = part.clone();
    let actual = tokio::task::spawn_blocking(move || sha256_file(&check))
        .await
        .map_err(|e| AppError::other(format!("Checksum task failed: {e}")))??;
    if actual != model.sha256 {
        // A corrupt part would fail every resume: start over next time.
        let _ = fs::remove_file(&part);
        return Err(AppError::other(format!(
            "{} is corrupt (checksum mismatch). Download it again.",
            model.name
        )));
    }
    fs::rename(&part, model_path(data_dir, model))?;
    Ok(())
}

fn sha256_file(path: &Path) -> Result<String> {
    let mut hasher = Sha256::new();
    let mut file = File::open(path)?;
    let mut buf = vec![0; 1 << 20];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_is_well_formed() {
        for m in CATALOG {
            crate::llm::validate_model_file(m.file).unwrap();
            assert_eq!(m.sha256.len(), 64, "{}", m.file);
            assert!(m.size > 0, "{}", m.file);
        }
        assert_eq!(CATALOG.iter().filter(|m| m.recommended).count(), 1);
    }

    /// Not in the catalog (its answers are poor), but small: 0.5 GB.
    const TINY: CatalogModel = CatalogModel {
        file: "Qwen3.5-0.8B-Q4_K_M.gguf",
        name: "Qwen3.5 0.8B",
        description: "",
        repo: "unsloth/Qwen3.5-0.8B-GGUF",
        size: 532_517_120,
        sha256: "bd258782e35f7f458f8aced1adc053e6e92e89bc735ba3be89d38a06121dc517",
        recommended: false,
    };

    /// Downloads a small model from Hugging Face, cancelling once to test resume.
    #[tokio::test]
    #[ignore]
    async fn live_download_cancel_resume() {
        let http = reqwest::Client::new();
        let dir = tempfile::tempdir().unwrap();
        let model = &TINY;
        let cancel = AtomicBool::new(false);
        let cancelled = download(&http, dir.path(), model, &cancel, |bytes| {
            if bytes > 50_000_000 {
                cancel.store(true, std::sync::atomic::Ordering::Relaxed);
            }
        })
        .await;
        assert!(cancelled.is_err());
        let partial = fs::metadata(part_path(dir.path(), model)).unwrap().len();
        assert!(partial > 50_000_000 && partial < model.size, "{partial}");

        cancel.store(false, std::sync::atomic::Ordering::Relaxed);
        let mut first = None;
        download(&http, dir.path(), model, &cancel, |bytes| {
            first.get_or_insert(bytes);
        })
        .await
        .unwrap();
        assert_eq!(first, Some(partial), "resumed where it stopped");
        assert!(model_path(dir.path(), model).is_file());
        assert!(!part_path(dir.path(), model).exists());
    }

    #[test]
    fn hashes_files() {
        let file = tempfile::NamedTempFile::new().unwrap();
        fs::write(file.path(), b"abc").unwrap();
        assert_eq!(
            sha256_file(file.path()).unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
