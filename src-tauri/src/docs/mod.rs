pub mod install;
pub mod manifest;

use serde::Serialize;

use manifest::DocEntry;

#[derive(Debug, PartialEq, Serialize)]
pub struct InstalledDoc {
    pub entry: DocEntry,
    /// DevDocs published a new build of this exact version (different `mtime`).
    pub update_available: bool,
    /// A newer version of the same doc exists (e.g. Python 3.15 while 3.14 is installed).
    /// Never switched automatically.
    pub newer_version: Option<String>,
}

/// Display label of a doc version, e.g. "3.15" or "22.0.0".
pub fn version_label(doc: &DocEntry) -> String {
    match &doc.release {
        Some(release) if !release.is_empty() => release.clone(),
        _ => doc.version.clone(),
    }
}

/// Compares installed docs with the manifest, which lists the newest version of a doc first.
pub fn installed_status(installed: Vec<DocEntry>, manifest: &[DocEntry]) -> Vec<InstalledDoc> {
    installed
        .into_iter()
        .map(|entry| {
            let current = manifest.iter().position(|d| d.slug == entry.slug);
            let newest = manifest.iter().position(|d| d.name == entry.name);
            let update_available = current.is_some_and(|i| manifest[i].mtime != entry.mtime);
            let newer_version = match (newest, current) {
                (Some(n), Some(c)) if n < c => Some(version_label(&manifest[n])),
                (Some(n), None) => Some(version_label(&manifest[n])),
                _ => None,
            };
            InstalledDoc {
                entry,
                update_available,
                newer_version,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest() -> Vec<DocEntry> {
        serde_json::from_str(include_str!("../../tests/fixtures/devdocs/docs.json")).unwrap()
    }

    fn find(slug: &str) -> DocEntry {
        manifest().into_iter().find(|d| d.slug == slug).unwrap()
    }

    #[test]
    fn up_to_date_latest_version() {
        let status = installed_status(vec![find("python~3.15")], &manifest());
        assert!(!status[0].update_available);
        assert_eq!(status[0].newer_version, None);
    }

    #[test]
    fn detects_new_build_of_same_version() {
        let mut old = find("c");
        old.mtime -= 1;
        let status = installed_status(vec![old], &manifest());
        assert!(status[0].update_available);
    }

    #[test]
    fn reports_newer_version_without_switching() {
        let status = installed_status(vec![find("python~3.14")], &manifest());
        assert_eq!(status[0].entry.slug, "python~3.14");
        assert_eq!(status[0].newer_version.as_deref(), Some("3.15.0"));
    }

    #[test]
    fn version_dropped_from_manifest_points_to_newest() {
        let mut gone = find("python~3.14");
        gone.slug = "python~3.9".into();
        let status = installed_status(vec![gone], &manifest());
        assert!(!status[0].update_available);
        assert_eq!(status[0].newer_version.as_deref(), Some("3.15.0"));
    }
}
