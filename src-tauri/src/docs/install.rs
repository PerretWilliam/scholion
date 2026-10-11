//! Installing a doc: download `index.json` + `db.json`, build `<slug>.sqlite`, swap it in.

use std::fmt;
use std::fs::{self, File};
use std::io::BufReader;
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags, Statement};
use serde::Deserialize;
use serde::de::{DeserializeSeed, Deserializer, MapAccess, Visitor};

use super::manifest::DocEntry;
use crate::download::download;
use crate::error::{AppError, Result};
use crate::storage;

const DOCS_BASE_URL: &str = "https://documents.devdocs.io";

const SCHEMA: &str = "
CREATE TABLE meta (entry TEXT NOT NULL);
CREATE TABLE entries (id INTEGER PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL, type TEXT NOT NULL);
CREATE TABLE pages (path TEXT PRIMARY KEY, html TEXT NOT NULL);
";

/// Slugs come from the frontend and become file names: allow DevDocs' charset only.
pub fn validate_slug(slug: &str) -> Result<()> {
    let ok = !slug.is_empty()
        && !slug.starts_with('.')
        && slug
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '~' | '.' | '_' | '-'));
    if ok {
        Ok(())
    } else {
        Err(AppError::other(format!("Invalid doc slug: {slug}")))
    }
}

pub fn doc_path(data_dir: &Path, slug: &str) -> PathBuf {
    storage::docs_dir(data_dir).join(format!("{slug}.sqlite"))
}

/// Downloads and installs `entry`. The installed version is replaced only once the new one is
/// fully built, so a failed update leaves the old one usable. `on_progress` receives the bytes
/// of `db.json` downloaded so far.
pub async fn install(
    http: &reqwest::Client,
    data_dir: &Path,
    entry: &DocEntry,
    on_progress: impl FnMut(u64),
) -> Result<()> {
    validate_slug(&entry.slug)?;
    let work = storage::tmp_dir(data_dir).join(&entry.slug);
    let _ = fs::remove_dir_all(&work);
    fs::create_dir_all(&work)?;

    let result = download_and_build(http, &work, entry, on_progress)
        .await
        .and_then(|built| {
            fs::create_dir_all(storage::docs_dir(data_dir))?;
            fs::rename(built, doc_path(data_dir, &entry.slug))?;
            Ok(())
        });
    let _ = fs::remove_dir_all(&work);
    result
}

async fn download_and_build(
    http: &reqwest::Client,
    work: &Path,
    entry: &DocEntry,
    on_progress: impl FnMut(u64),
) -> Result<PathBuf> {
    let base = format!("{DOCS_BASE_URL}/{}", entry.slug);
    let index_json = work.join("index.json");
    let db_json = work.join("db.json");
    let built = work.join("doc.sqlite");
    download(
        http,
        &format!("{base}/index.json?{}", entry.mtime),
        &index_json,
        |_| {},
    )
    .await?;
    download(
        http,
        &format!("{base}/db.json?{}", entry.mtime),
        &db_json,
        on_progress,
    )
    .await?;

    let entry = entry.clone();
    let out = built.clone();
    tokio::task::spawn_blocking(move || build_db(&index_json, &db_json, &entry, &out))
        .await
        .map_err(|e| AppError::other(format!("Install task failed: {e}")))??;
    Ok(built)
}

#[derive(Deserialize)]
struct Index {
    entries: Vec<IndexEntry>,
}

#[derive(Deserialize)]
struct IndexEntry {
    name: String,
    path: String,
    #[serde(rename = "type")]
    kind: String,
}

/// Builds the SQLite file for a doc from its DevDocs `index.json` and `db.json`.
pub fn build_db(index_json: &Path, db_json: &Path, entry: &DocEntry, out: &Path) -> Result<()> {
    let _ = fs::remove_file(out);
    let mut conn = Connection::open(out)?;
    // Scratch file that gets renamed into place: durability is not needed while building.
    conn.execute_batch("PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;")?;
    conn.execute_batch(SCHEMA)?;
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO meta (entry) VALUES (?1)",
        [serde_json::to_string(entry)?],
    )?;

    let index: Index = serde_json::from_reader(BufReader::new(File::open(index_json)?))?;
    {
        let mut insert =
            tx.prepare("INSERT INTO entries (name, path, type) VALUES (?1, ?2, ?3)")?;
        for e in &index.entries {
            insert.execute((&e.name, &e.path, &e.kind))?;
        }
    }
    {
        // db.json can reach hundreds of MB: stream it page by page instead of loading it whole.
        let mut insert = tx.prepare("INSERT INTO pages (path, html) VALUES (?1, ?2)")?;
        let mut de = serde_json::Deserializer::from_reader(BufReader::new(File::open(db_json)?));
        PageSink(&mut insert).deserialize(&mut de)?;
        de.end()?;
    }
    tx.commit()?;
    Ok(())
}

/// Inserts each `"path": "<html>"` pair of `db.json` as it is parsed.
struct PageSink<'a, 'conn>(&'a mut Statement<'conn>);

impl<'de> DeserializeSeed<'de> for PageSink<'_, '_> {
    type Value = ();
    fn deserialize<D: Deserializer<'de>>(
        self,
        deserializer: D,
    ) -> std::result::Result<(), D::Error> {
        deserializer.deserialize_map(self)
    }
}

impl<'de> Visitor<'de> for PageSink<'_, '_> {
    type Value = ();
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("a map of page path to HTML")
    }
    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> std::result::Result<(), A::Error> {
        while let Some((path, html)) = map.next_entry::<String, String>()? {
            self.0
                .execute((path, html))
                .map_err(serde::de::Error::custom)?;
        }
        Ok(())
    }
}

/// Reads the manifest entry stored in an installed doc.
pub fn read_meta(path: &Path) -> Result<DocEntry> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let json: String = conn.query_row("SELECT entry FROM meta", [], |row| row.get(0))?;
    Ok(serde_json::from_str(&json)?)
}

/// Lists installed docs. Unreadable files are reported and skipped so one bad file does not
/// hide the others.
pub fn list_installed(data_dir: &Path) -> Result<Vec<DocEntry>> {
    let dir = storage::docs_dir(data_dir);
    let read_dir = match fs::read_dir(&dir) {
        Ok(read_dir) => read_dir,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.into()),
    };
    let mut docs = Vec::new();
    for item in read_dir {
        let path = item?.path();
        if path.extension().is_some_and(|ext| ext == "sqlite") {
            match read_meta(&path) {
                Ok(entry) => docs.push(entry),
                Err(e) => eprintln!("Skipping unreadable doc {}: {e}", path.display()),
            }
        }
    }
    docs.sort_by(|a, b| a.name.cmp(&b.name).then(b.mtime.cmp(&a.mtime)));
    Ok(docs)
}

pub fn remove(data_dir: &Path, slug: &str) -> Result<()> {
    validate_slug(slug)?;
    match fs::remove_file(doc_path(data_dir, slug)) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.into()),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURES: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/devdocs");

    fn c_entry() -> DocEntry {
        let docs: Vec<DocEntry> =
            serde_json::from_str(include_str!("../../tests/fixtures/devdocs/docs.json")).unwrap();
        docs.into_iter().find(|d| d.slug == "c").unwrap()
    }

    fn fixture(name: &str) -> PathBuf {
        Path::new(FIXTURES).join(name)
    }

    #[test]
    fn builds_db_from_devdocs_files() {
        let data = tempfile::tempdir().unwrap();
        let out = doc_path(data.path(), "c");
        fs::create_dir_all(out.parent().unwrap()).unwrap();
        build_db(
            &fixture("c_index.json"),
            &fixture("c_db.json"),
            &c_entry(),
            &out,
        )
        .unwrap();

        let conn = Connection::open(&out).unwrap();
        let count = |table: &str| -> i64 {
            conn.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
                .unwrap()
        };
        assert_eq!(count("entries"), 3);
        assert_eq!(count("pages"), 2);
        let html: String = conn
            .query_row(
                "SELECT html FROM pages WHERE path = 'string/byte/strcpy'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(html.contains("strcpy"));
        drop(conn);

        assert_eq!(list_installed(data.path()).unwrap(), vec![c_entry()]);
        remove(data.path(), "c").unwrap();
        assert!(list_installed(data.path()).unwrap().is_empty());
        // Removing twice is fine.
        remove(data.path(), "c").unwrap();
    }

    #[test]
    fn invalid_db_json_fails_without_touching_installed_doc() {
        let data = tempfile::tempdir().unwrap();
        let installed = doc_path(data.path(), "c");
        fs::create_dir_all(installed.parent().unwrap()).unwrap();
        build_db(
            &fixture("c_index.json"),
            &fixture("c_db.json"),
            &c_entry(),
            &installed,
        )
        .unwrap();

        let scratch = data.path().join("scratch.sqlite");
        let bad = data.path().join("bad.json");
        fs::write(&bad, r#"{"a": "<p>ok</p>", "b": 42}"#).unwrap();
        assert!(build_db(&fixture("c_index.json"), &bad, &c_entry(), &scratch).is_err());
        assert_eq!(read_meta(&installed).unwrap(), c_entry());
    }

    #[test]
    #[ignore = "hits devdocs.io; run with `cargo test -- --ignored`"]
    fn live_refresh_and_install() {
        tauri::async_runtime::block_on(async {
            let data = tempfile::tempdir().unwrap();
            let http = reqwest::Client::builder()
                .user_agent(crate::USER_AGENT)
                .build()
                .unwrap();
            let first = super::super::manifest::refresh(&http, data.path(), false)
                .await
                .unwrap();
            let c = first.docs.iter().find(|d| d.slug == "c").unwrap();
            install(&http, data.path(), c, |_| {}).await.unwrap();
            assert_eq!(list_installed(data.path()).unwrap(), vec![c.clone()]);
            // A forced re-check sees the same redirect target and keeps the cached docs.
            let second = super::super::manifest::refresh(&http, data.path(), true)
                .await
                .unwrap();
            assert_eq!(second.location, first.location);
            assert_eq!(second.docs.len(), first.docs.len());
        });
    }

    #[test]
    fn rejects_unsafe_slugs() {
        for slug in ["python~3.15", "scala~2.13_library", "c", "dom-events"] {
            assert!(validate_slug(slug).is_ok(), "{slug}");
        }
        for slug in ["", "../etc", "a/b", "a\\b", ".hidden"] {
            assert!(validate_slug(slug).is_err(), "{slug}");
        }
    }
}
