//! Lexical search in an installed doc: entry names first, then page full text.

use std::collections::HashSet;
use std::path::Path;

use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde::Serialize;

use crate::error::{AppError, Result};

/// Below this Jaro-Winkler similarity, a name is not a typo of the query.
const FUZZY_THRESHOLD: f64 = 0.88;

#[derive(Debug, PartialEq, Serialize)]
pub struct SearchHit {
    pub name: String,
    /// Entry path, possibly with a `#fragment`.
    pub path: String,
    #[serde(rename = "type")]
    pub kind: String,
    /// Official DevDocs page.
    pub url: String,
}

#[derive(Debug, Serialize)]
pub struct Page {
    pub path: String,
    pub title: String,
    /// Raw DevDocs HTML: sanitize before rendering.
    pub html: String,
    pub url: String,
}

pub fn open(path: &Path) -> Result<Connection> {
    if !path.exists() {
        return Err(AppError::other("This doc is not installed"));
    }
    Ok(Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY,
    )?)
}

pub fn page_url(slug: &str, path: &str) -> String {
    format!("https://devdocs.io/{slug}/{path}")
}

/// Page key of an entry path: `db.json` keys have no fragment.
fn page_key(path: &str) -> &str {
    path.split('#').next().unwrap_or(path)
}

/// Ranks entry names: exact, prefix, substring, then typo-tolerant. Lower is better.
fn name_rank(name: &str, query: &str) -> Option<u8> {
    let name = name.to_lowercase();
    if name == query {
        Some(0)
    } else if name.starts_with(query) {
        Some(1)
    } else if name.contains(query) {
        Some(2)
    } else if query.chars().count() >= 3 && strsim::jaro_winkler(&name, query) >= FUZZY_THRESHOLD {
        Some(3)
    } else {
        None
    }
}

/// FTS5 query matching any word of `query`, with every word quoted so user input can never be
/// read as FTS syntax.
fn fts_query(query: &str) -> Option<String> {
    let words: Vec<String> = query
        .split(|c: char| !c.is_alphanumeric() && c != '_')
        .filter(|w| w.chars().count() >= 2)
        .map(|w| format!("\"{w}\""))
        .collect();
    (!words.is_empty()).then(|| words.join(" OR "))
}

pub fn search(conn: &Connection, slug: &str, query: &str, limit: usize) -> Result<Vec<SearchHit>> {
    let query = query.trim().to_lowercase();
    if query.is_empty() || limit == 0 {
        return Ok(Vec::new());
    }

    // Docs have at most tens of thousands of entries: scoring them all in memory is a few
    // milliseconds and gives full control over ranking.
    let mut stmt = conn.prepare("SELECT name, path, type FROM entries")?;
    let mut ranked: Vec<(u8, SearchHit)> = stmt
        .query_map([], |row| {
            Ok(SearchHit {
                name: row.get(0)?,
                path: row.get(1)?,
                kind: row.get(2)?,
                url: String::new(),
            })
        })?
        .filter_map(|hit| {
            let hit = hit.ok()?;
            Some((name_rank(&hit.name, &query)?, hit))
        })
        .collect();
    ranked.sort_by(|(ra, a), (rb, b)| {
        ra.cmp(rb)
            .then(a.name.len().cmp(&b.name.len()))
            .then_with(|| a.name.cmp(&b.name))
    });
    let mut hits: Vec<SearchHit> = ranked.into_iter().take(limit).map(|(_, h)| h).collect();

    // Natural-language queries rarely match a name: fill up with full-text matches.
    if hits.len() < limit
        && let Some(fts) = fts_query(&query)
    {
        let mut seen: HashSet<String> = hits.iter().map(|h| page_key(&h.path).to_owned()).collect();
        let mut stmt = conn.prepare(
            "SELECT p.path FROM pages_fts JOIN pages p ON p.rowid = pages_fts.rowid \
             WHERE pages_fts MATCH ?1 ORDER BY rank LIMIT ?2",
        )?;
        let paths = stmt
            .query_map((fts, limit as i64), |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for path in paths {
            if hits.len() >= limit {
                break;
            }
            if seen.insert(path.clone()) {
                let (name, kind) =
                    page_entry(conn, &path)?.unwrap_or_else(|| (path.clone(), String::new()));
                hits.push(SearchHit {
                    name,
                    path,
                    kind,
                    url: String::new(),
                });
            }
        }
    }

    for hit in &mut hits {
        hit.url = page_url(slug, &hit.path);
    }
    Ok(hits)
}

/// Name and type of the first entry pointing at a page.
fn page_entry(conn: &Connection, page: &str) -> Result<Option<(String, String)>> {
    Ok(conn
        .query_row(
            "SELECT name, type FROM entries WHERE path = ?1 OR path LIKE ?1 || '#%' \
             ORDER BY id LIMIT 1",
            [page],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?)
}

pub fn get_page(conn: &Connection, slug: &str, path: &str) -> Result<Page> {
    let key = page_key(path);
    let html: String = conn
        .query_row("SELECT html FROM pages WHERE path = ?1", [key], |row| {
            row.get(0)
        })
        .optional()?
        .ok_or_else(|| AppError::other(format!("Page not found: {key}")))?;
    let title = page_entry(conn, key)?.map_or_else(|| key.to_owned(), |(name, _)| name);
    Ok(Page {
        path: key.to_owned(),
        title,
        html,
        url: page_url(slug, path),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::docs::install::build_db;
    use crate::docs::manifest::DocEntry;

    const FIXTURES: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/devdocs");

    fn c_doc() -> (tempfile::TempDir, Connection) {
        let docs: Vec<DocEntry> =
            serde_json::from_str(include_str!("../../tests/fixtures/devdocs/docs.json")).unwrap();
        let c = docs.into_iter().find(|d| d.slug == "c").unwrap();
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("c.sqlite");
        let fixtures = Path::new(FIXTURES);
        build_db(
            &fixtures.join("c_index.json"),
            &fixtures.join("c_db.json"),
            &c,
            &out,
        )
        .unwrap();
        let conn = open(&out).unwrap();
        (dir, conn)
    }

    fn names(hits: &[SearchHit]) -> Vec<&str> {
        hits.iter().map(|h| h.name.as_str()).collect()
    }

    #[test]
    fn exact_then_prefix() {
        let (_dir, conn) = c_doc();
        let hits = search(&conn, "c", "strcpy", 10).unwrap();
        assert_eq!(names(&hits)[..2], ["strcpy", "strcpy_s"]);
        assert_eq!(hits[0].url, "https://devdocs.io/c/string/byte/strcpy");
    }

    #[test]
    fn case_insensitive_and_typo_tolerant() {
        let (_dir, conn) = c_doc();
        assert_eq!(
            names(&search(&conn, "c", "MEMCPY", 10).unwrap())[0],
            "memcpy"
        );
        assert_eq!(
            names(&search(&conn, "c", "memcyp", 10).unwrap())[0],
            "memcpy"
        );
    }

    #[test]
    fn natural_language_falls_back_to_full_text() {
        let (_dir, conn) = c_doc();
        // No entry is named like this; the strcpy page text matches.
        let hits = search(&conn, "c", "copy a null-terminated string", 10).unwrap();
        assert_eq!(hits[0].path, "string/byte/strcpy");
        assert_eq!(hits[0].name, "strcpy");
    }

    #[test]
    fn fts_syntax_in_input_is_inert() {
        let (_dir, conn) = c_doc();
        for q in ["\"", "a OR", "NEAR(", "*", "-x", "  "] {
            search(&conn, "c", q, 10).unwrap();
        }
        assert_eq!(
            fts_query("str\"cpy OR x"),
            Some("\"str\" OR \"cpy\" OR \"OR\"".into())
        );
    }

    #[test]
    fn page_by_entry_path() {
        let (_dir, conn) = c_doc();
        let page = get_page(&conn, "c", "string/byte/memcpy#Example").unwrap();
        assert_eq!(page.title, "memcpy");
        assert_eq!(page.path, "string/byte/memcpy");
        assert!(page.html.contains("<h1>memcpy</h1>"));
        assert_eq!(page.url, "https://devdocs.io/c/string/byte/memcpy#Example");
        assert!(get_page(&conn, "c", "nope").is_err());
    }
}
