//! Finds which doc a question asks for ("how do I do X in Go", "I want the Rust docs"), so the
//! chat can switch to it or offer to install it. This runs in code against the cached manifest:
//! small models are unreliable at tool calls, and must never make up a doc or a URL.

use serde::Serialize;
use strsim::jaro_winkler;

use super::manifest::DocEntry;

/// Below this Jaro-Winkler similarity, a word is not a typo of a doc name.
const FUZZY_THRESHOLD: f64 = 0.9;
/// Below this, a doc name is too different to suggest.
const SUGGEST_THRESHOLD: f64 = 0.75;

/// Common names DevDocs does not list as aliases, mapped to a slug.
const EXTRA_ALIASES: &[(&str, &str)] = &[
    ("golang", "go"),
    ("nodejs", "node"),
    ("postgres", "postgresql"),
    ("reactjs", "react"),
    ("vuejs", "vue"),
];

/// Words that make the next words a doc name: "in Go", "avec Python".
const BEFORE_NAME: &[&str] = &["in", "with", "using", "en", "avec", "dans"];
const INSTALL_WORDS: &[&str] = &["install", "installer", "installe"];
/// Words that make a doc request explicit: "Rust docs", "install Go", "doc de Python".
const DOC_WORDS: &[&str] = &[
    "doc",
    "docs",
    "documentation",
    "documentations",
    "install",
    "installer",
    "installe",
];
/// Links a doc word to the name after it: "docs for Rust", "documentation de Go".
const LINKS: &[&str] = &["of", "for", "on", "about", "de", "du", "des", "sur", "pour"];
/// Doc names that are also common words ("in less than", "at the moment"): only matched when the
/// question explicitly asks for docs.
const AMBIGUOUS_NAMES: &[&str] = &["less", "moment"];
/// Words before "docs" that are not doc names: "the official docs".
const NOT_NAMES: &[&str] = &[
    "the", "a", "an", "this", "these", "that", "my", "your", "its", "their", "official", "full",
    "online", "some", "any", "more", "le", "la", "les", "un", "une", "cette", "ces", "ma", "ta",
    "sa", "mes", "vos",
];
/// Words of a bare doc request: "I want the Rust docs", "j'ai besoin de la doc Go".
const FILLER: &[&str] = &[
    "i", "i'd", "want", "need", "would", "like", "to", "please", "give", "get", "show", "open",
    "use", "me", "can", "you", "could", "let's", "switch", "is", "are", "there", "je", "j", "veux",
    "voudrais", "aimerais", "besoin", "ai", "montre", "moi", "ouvre", "utilise", "stp", "svp",
    "merci", "thanks", "et", "and",
];

#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DocIntent {
    /// An installed doc: answer from it. `question` is false for a bare request ("open the Go
    /// docs"), which needs no answer.
    Installed {
        name: String,
        slug: String,
        question: bool,
    },
    /// In the manifest but not installed: offer to install it. Newest version first. `question`
    /// tells whether to answer once it is installed.
    Available {
        name: String,
        versions: Vec<DocEntry>,
        question: bool,
    },
    /// Explicitly asked for, but DevDocs has no doc by that name.
    Unknown {
        name: String,
        suggestions: Vec<String>,
    },
}

/// The doc a question is about, if it names one. `manifest` lists the newest version first.
pub fn detect(question: &str, manifest: &[DocEntry], installed: &[DocEntry]) -> Option<DocIntent> {
    let words = tokenize(question);
    let docs: Vec<&DocEntry> = manifest.iter().chain(installed).collect();
    let is = |list: &[&str], i: Option<usize>| i.is_some_and(|i| list.contains(&words[i].as_str()));
    let mut unknown = None;

    for i in 0..words.len() {
        let prev = i.checked_sub(1);
        let prev2 = i.checked_sub(2);
        // Longest phrase first, so "React Native" wins over "React".
        for len in (1..=3).rev().filter(|len| i + len <= words.len()) {
            let next = Some(i + len).filter(|&n| n < words.len());
            let explicit = is(DOC_WORDS, next)
                || is(DOC_WORDS, prev)
                || (is(LINKS, prev) && is(DOC_WORDS, prev2));
            if !explicit && !is(BEFORE_NAME, prev) {
                continue;
            }
            let phrase = words[i..i + len].join(" ");
            if !explicit && AMBIGUOUS_NAMES.contains(&phrase.as_str()) {
                continue;
            }
            if let Some(name) = find_name(&phrase, &docs) {
                let question = has_question(&words, i..i + len);
                return Some(intent_for(name, question, manifest, installed));
            }
            // "Foo docs", "install foo": a request for a doc DevDocs may not have.
            let asks_for_doc = is(DOC_WORDS, next) || is(INSTALL_WORDS, prev);
            if len == 1
                && asks_for_doc
                && unknown.is_none()
                && !NOT_NAMES.contains(&phrase.as_str())
            {
                unknown = Some(phrase);
            }
        }
    }
    unknown.map(|name| DocIntent::Unknown {
        suggestions: suggest(&name, &docs),
        name,
    })
}

/// Whether words outside the doc name ask something, beyond "I want the ... docs".
fn has_question(words: &[String], name: std::ops::Range<usize>) -> bool {
    let request_words = [DOC_WORDS, LINKS, BEFORE_NAME, NOT_NAMES, FILLER];
    let other = words
        .iter()
        .enumerate()
        .filter(|(i, w)| {
            !name.contains(i) && !request_words.iter().any(|l| l.contains(&w.as_str()))
        })
        .count();
    other > 0
}

/// Lowercase words, keeping characters that belong to names like "c++", "c#" or "node.js".
fn tokenize(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| c.is_whitespace() || ",;:!?()[]{}\"'`’«»".contains(c))
        .map(|w| w.trim_end_matches('.'))
        .filter(|w| !w.is_empty())
        .map(str::to_owned)
        .collect()
}

/// Lowercase names a doc goes by: "node.js", "node", "react native", "js"...
fn keys(doc: &DocEntry) -> Vec<String> {
    let name = doc.name.to_lowercase();
    let slug = doc.slug.split('~').next().unwrap_or(&doc.slug);
    let mut keys = vec![
        name.trim_end_matches(".js").to_owned(),
        slug.to_owned(),
        slug.replace('_', " "),
        name,
    ];
    keys.extend(doc.alias.as_deref().map(str::to_lowercase));
    keys.extend(
        EXTRA_ALIASES
            .iter()
            .filter(|(_, target)| *target == slug)
            .map(|(alias, _)| (*alias).to_owned()),
    );
    keys
}

/// Name of the doc `phrase` designates: an exact name, slug or alias, else a close typo.
fn find_name<'a>(phrase: &str, docs: &[&'a DocEntry]) -> Option<&'a str> {
    if let Some(doc) = docs.iter().find(|d| keys(d).iter().any(|k| k == phrase)) {
        return Some(&doc.name);
    }
    if phrase.chars().count() < 4 {
        return None;
    }
    docs.iter()
        .flat_map(|d| keys(d).into_iter().map(move |k| (d, k)))
        .filter(|(_, k)| k.chars().count() >= 4)
        .map(|(d, k)| (jaro_winkler(phrase, &k), d))
        .filter(|(score, _)| *score >= FUZZY_THRESHOLD)
        .max_by(|(a, _), (b, _)| a.total_cmp(b))
        .map(|(_, d)| d.name.as_str())
}

fn intent_for(
    name: &str,
    question: bool,
    manifest: &[DocEntry],
    installed: &[DocEntry],
) -> DocIntent {
    match installed.iter().find(|d| d.name == name) {
        Some(doc) => DocIntent::Installed {
            name: name.to_owned(),
            slug: doc.slug.clone(),
            question,
        },
        None => DocIntent::Available {
            name: name.to_owned(),
            versions: manifest
                .iter()
                .filter(|d| d.name == name)
                .cloned()
                .collect(),
            question,
        },
    }
}

/// Up to three doc names close to `name`, closest first.
fn suggest(name: &str, docs: &[&DocEntry]) -> Vec<String> {
    let mut scored: Vec<(f64, &str)> = Vec::new();
    for doc in docs {
        let score = keys(doc)
            .iter()
            .map(|k| jaro_winkler(name, k))
            .fold(0.0, f64::max);
        if score >= SUGGEST_THRESHOLD && !scored.iter().any(|(_, n)| *n == doc.name) {
            scored.push((score, &doc.name));
        }
    }
    scored.sort_by(|(a, _), (b, _)| b.total_cmp(a));
    scored
        .into_iter()
        .take(3)
        .map(|(_, n)| n.to_owned())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn all_docs() -> Vec<DocEntry> {
        serde_json::from_str(include_str!("../../tests/fixtures/devdocs/all_names.json")).unwrap()
    }

    fn versions() -> Vec<DocEntry> {
        serde_json::from_str(include_str!("../../tests/fixtures/devdocs/docs.json")).unwrap()
    }

    fn detect_name(question: &str) -> Option<String> {
        match detect(question, &all_docs(), &[])? {
            DocIntent::Installed { name, .. } | DocIntent::Available { name, .. } => Some(name),
            DocIntent::Unknown { name, .. } => Some(format!("unknown:{name}")),
        }
    }

    #[test]
    fn finds_names_aliases_and_typos() {
        for (question, name) in [
            ("How do I copy a string in C?", "C"),
            ("how to read a file in Go", "Go"),
            ("comment trier une liste en Python ?", "Python"),
            ("I want the Rust docs", "Rust"),
            ("install golang", "Go"),
            ("map over an array in js", "JavaScript"),
            ("generics in pyhton", "Python"),
            ("navigation in React Native", "React Native"),
            ("la doc de Node.js", "Node.js"),
            ("streams with nodejs", "Node.js"),
            ("templates in C++", "C++"),
            ("records in java", "OpenJDK"),
        ] {
            assert_eq!(detect_name(question).as_deref(), Some(name), "{question}");
        }
    }

    #[test]
    fn ignores_ordinary_sentences() {
        for question in [
            "copy a null-terminated string",
            "sort a list in place",
            "how to do it in less than 10 lines",
            "write this in a loop",
            "for example with a closure",
            "what does the official docs say about strcpy",
            "reverse a string in order",
            "comment faire une boucle en parallèle",
        ] {
            assert_eq!(detect_name(question), None, "{question}");
        }
    }

    #[test]
    fn unknown_doc_requests_get_suggestions() {
        match detect("I need the Rustacean docs", &all_docs(), &[]) {
            Some(DocIntent::Unknown { name, suggestions }) => {
                assert_eq!(name, "rustacean");
                assert!(suggestions.contains(&"Rust".to_owned()), "{suggestions:?}");
            }
            other => panic!("{other:?}"),
        }
        assert_eq!(
            detect_name("install cobolscript").as_deref(),
            Some("unknown:cobolscript")
        );
    }

    #[test]
    fn tells_bare_requests_from_questions() {
        let question = |q: &str| match detect(q, &all_docs(), &[]) {
            Some(DocIntent::Available { question, .. }) => question,
            other => panic!("{q}: {other:?}"),
        };
        for bare in [
            "I want the Rust docs",
            "install golang",
            "j'ai besoin de la doc Python",
            "open the Go documentation please",
        ] {
            assert!(!question(bare), "{bare}");
        }
        for asks in [
            "dicts in python",
            "how to read a file in Go",
            "Rust docs for traits",
        ] {
            assert!(question(asks), "{asks}");
        }
    }

    #[test]
    fn prefers_installed_version_else_offers_all_versions() {
        let manifest = versions();
        let installed: Vec<DocEntry> = manifest
            .iter()
            .filter(|d| d.slug == "python~3.14")
            .cloned()
            .collect();
        assert_eq!(
            detect("dicts in python", &manifest, &installed),
            Some(DocIntent::Installed {
                name: "Python".into(),
                slug: "python~3.14".into(),
                question: true,
            })
        );
        match detect("dicts in python", &manifest, &[]) {
            Some(DocIntent::Available { versions, .. }) => {
                let slugs: Vec<&str> = versions.iter().map(|d| d.slug.as_str()).collect();
                assert_eq!(slugs, ["python~3.15", "python~3.14"]);
            }
            other => panic!("{other:?}"),
        }
    }
}
