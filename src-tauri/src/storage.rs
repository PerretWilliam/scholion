//! Layout of the app data directory and small JSON file helpers.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde::de::DeserializeOwned;

use crate::error::Result;

pub fn docs_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("docs")
}

pub fn models_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("models")
}

pub fn llm_log_path(data_dir: &Path) -> PathBuf {
    data_dir.join("llama-server.log")
}

pub fn tmp_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("tmp")
}

pub fn manifest_path(data_dir: &Path) -> PathBuf {
    data_dir.join("manifest.json")
}

pub fn settings_path(data_dir: &Path) -> PathBuf {
    data_dir.join("settings.json")
}

pub fn history_path(data_dir: &Path) -> PathBuf {
    data_dir.join("history.json")
}

/// Reads a JSON file. A missing file is `Ok(None)`; a corrupt one is an error.
pub fn read_json<T: DeserializeOwned>(path: &Path) -> Result<Option<T>> {
    match fs::read(path) {
        Ok(bytes) => Ok(Some(serde_json::from_slice(&bytes)?)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Writes JSON to a sibling temp file, then renames it over `path`, so readers never see a
/// half-written file.
pub fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_vec_pretty(value)?)?;
    fs::rename(&tmp, path)?;
    Ok(())
}

/// Total size of the files under `path`; a missing folder or file counts as 0.
pub fn disk_usage(path: &Path) -> Result<u64> {
    let meta = match fs::metadata(path) {
        Ok(meta) => meta,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(e) => return Err(e.into()),
    };
    if !meta.is_dir() {
        return Ok(meta.len());
    }
    let mut total = 0;
    for entry in fs::read_dir(path)? {
        total += disk_usage(&entry?.path())?;
    }
    Ok(total)
}

/// Writes `content` to a new file `name` in `dir`, adding " (2)", " (3)"… before the extension
/// rather than overwriting. Characters that are not safe in file names become `-`.
pub fn write_new_file(dir: &Path, name: &str, content: &str) -> Result<PathBuf> {
    let name: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || " ._-".contains(c) {
                c
            } else {
                '-'
            }
        })
        .collect();
    let name = name.trim_matches(|c| c == '.' || c == ' ');
    let (stem, ext) = name.rsplit_once('.').unwrap_or((name, ""));
    let stem = if stem.is_empty() { "export" } else { stem };
    fs::create_dir_all(dir)?;
    for n in 1.. {
        let numbered = if n == 1 {
            String::new()
        } else {
            format!(" ({n})")
        };
        let path = dir.join(if ext.is_empty() {
            format!("{stem}{numbered}")
        } else {
            format!("{stem}{numbered}.{ext}")
        });
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(mut file) => {
                std::io::Write::write_all(&mut file, content.as_bytes())?;
                return Ok(path);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(e) => return Err(e.into()),
        }
    }
    unreachable!("the loop only ends by returning")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn measures_disk_usage() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(disk_usage(&dir.path().join("missing")).unwrap(), 0);
        fs::create_dir(dir.path().join("a")).unwrap();
        fs::write(dir.path().join("a/one"), "123").unwrap();
        fs::write(dir.path().join("two"), "45").unwrap();
        assert_eq!(disk_usage(dir.path()).unwrap(), 5);
        assert_eq!(disk_usage(&dir.path().join("two")).unwrap(), 2);
    }

    #[test]
    fn exports_never_overwrite() {
        let dir = tempfile::tempdir().unwrap();
        let first = write_new_file(dir.path(), "My chat/1.md", "a").unwrap();
        let second = write_new_file(dir.path(), "My chat/1.md", "b").unwrap();
        assert_eq!(first.file_name().unwrap(), "My chat-1.md");
        assert_eq!(second.file_name().unwrap(), "My chat-1 (2).md");
        assert_eq!(fs::read_to_string(first).unwrap(), "a");
        assert_eq!(
            write_new_file(dir.path(), "..", "c")
                .unwrap()
                .file_name()
                .unwrap(),
            "export"
        );
    }

    #[test]
    fn json_round_trip_and_missing_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested/value.json");
        assert_eq!(read_json::<Vec<u32>>(&path).unwrap(), None);
        write_json_atomic(&path, &vec![1, 2, 3]).unwrap();
        assert_eq!(read_json::<Vec<u32>>(&path).unwrap(), Some(vec![1, 2, 3]));
    }
}
