//! Retrieval benchmark: does a real question bring the right page into the four given to the model?
//! Run it against the docs installed on this machine:
//! `SCHOLION_DATA_DIR=<app data dir> cargo test --manifest-path src-tauri/Cargo.toml search_bench -- --ignored --nocapture`

use std::collections::HashSet;
use std::path::PathBuf;

use super::install::doc_path;
use super::search::{open, passage, search};

/// Pages given to the model per answer, as `MAX_PASSAGES` in `src/lib/prompts.ts`.
const PAGES: usize = 4;

/// (doc slug, question, search terms the model should extract, expected pages).
/// A page counts when its path contains one of the `|`-separated expected paths.
const CASES: &[(&str, &str, &str, &str)] = &[
    (
        "python~3.15",
        "How do I get the length of a list?",
        "len length",
        "builtins/functions",
    ),
    (
        "python~3.15",
        "Comment trier une liste de dictionnaires par clé ?",
        "sorted key sort",
        "builtins/functions|howto/sorting",
    ),
    (
        "python~3.15",
        "How to parse a JSON string into a dict?",
        "json.loads",
        "library/json",
    ),
    (
        "python~3.15",
        "How do I run coroutines concurrently?",
        "asyncio.gather",
        "library/asyncio-task",
    ),
    (
        "python~3.15",
        "Comment assembler des morceaux de chemin de fichier ?",
        "os.path.join",
        "library/os.path|library/pathlib",
    ),
    (
        "python~3.15",
        "How do I create a dataclass with default values?",
        "dataclass field default",
        "library/dataclasses",
    ),
    (
        "python~3.15",
        "How do I loop with an index?",
        "enumerate",
        "builtins/functions",
    ),
    (
        "python~3.15",
        "Comment lire un fichier texte ligne par ligne ?",
        "open file read",
        "builtins/functions|tutorial/inputoutput|library/io",
    ),
    (
        "python~3.15",
        "What is a list comprehension?",
        "list comprehension",
        "glossary|tutorial/datastructures",
    ),
    (
        "python~3.15",
        "How do I get a dictionary value with a default?",
        "dict.get",
        "builtins/stdtypes|library/stdtypes",
    ),
    (
        "python~3.15",
        "How do I merge two dictionaries?",
        "dict update merge",
        "builtins/stdtypes|library/stdtypes|tutorial/datastructures",
    ),
    (
        "python~3.15",
        "How do I read command line arguments?",
        "sys.argv argparse",
        "library/sys|library/argparse",
    ),
    (
        "python~3.15",
        "Comment gérer les exceptions ?",
        "try except exception",
        "tutorial/errors|reference/compound_stmts",
    ),
    (
        "python~3.15",
        "How do I match a regular expression?",
        "re.match",
        "library/re",
    ),
    (
        "python~3.15",
        "How do I format a date and time?",
        "datetime strftime",
        "library/datetime",
    ),
    (
        "python~3.15",
        "How do I make a function run in a thread?",
        "threading.Thread",
        "library/threading",
    ),
    (
        "react",
        "How do I keep state in a component?",
        "useState",
        "reference/react/usestate",
    ),
    (
        "react",
        "How do I run code after the component renders?",
        "useEffect",
        "reference/react/useeffect",
    ),
    (
        "react",
        "Comment éviter de recalculer une valeur coûteuse ?",
        "useMemo",
        "reference/react/usememo",
    ),
    (
        "react",
        "How do I share data without passing props down?",
        "useContext createContext",
        "reference/react/usecontext|reference/react/createcontext",
    ),
    (
        "react",
        "How do I access a DOM element?",
        "useRef",
        "reference/react/useref",
    ),
    (
        "react",
        "How do I skip re-rendering when props are unchanged?",
        "memo",
        "reference/react/memo",
    ),
    (
        "react",
        "How do I show a fallback while loading?",
        "Suspense",
        "reference/react/suspense",
    ),
    (
        "react",
        "Comment passer une ref à un composant enfant ?",
        "forwardRef ref",
        "reference/react/forwardref|learn/manipulating-the-dom-with-refs",
    ),
];

/// The pages `findPages` in `src/lib/chat-transport.ts` would hand to the model.
fn pages_for(
    conn: &rusqlite::Connection,
    slug: &str,
    question: &str,
    terms: &[&str],
) -> Vec<String> {
    let mut hits = Vec::new();
    for t in terms {
        hits.extend(search(conn, slug, t, 2).unwrap());
    }
    let full = [question]
        .into_iter()
        .chain(terms.iter().copied())
        .collect::<Vec<_>>();
    hits.extend(search(conn, slug, &full.join(" "), PAGES).unwrap());
    let mut seen = HashSet::new();
    // Full entry paths, with their `#fragment`: the passage starts at that anchor.
    hits.into_iter()
        .map(|h| h.path)
        .filter(|p| seen.insert(p.split('#').next().unwrap_or_default().to_owned()))
        .take(PAGES)
        .collect()
}

#[test]
#[ignore = "needs installed docs: set SCHOLION_DATA_DIR to the app data dir"]
fn retrieval_recall() {
    let dir = PathBuf::from(std::env::var("SCHOLION_DATA_DIR").expect("SCHOLION_DATA_DIR"));
    let (mut with_terms, mut question_only, mut run) = (0, 0, 0);
    // Passages of the expected page that still contain the key term, by size cap.
    let caps = [4000, 3000, 2000, 1500];
    let mut holds = [0; 4];
    for (slug, question, terms, expected) in CASES {
        let Ok(conn) = open(&doc_path(&dir, slug)) else {
            continue; // doc not installed here
        };
        run += 1;
        let expects = |pages: &[String]| {
            pages
                .iter()
                .any(|p| expected.split('|').any(|e| p.contains(e)))
        };
        let terms: Vec<&str> = terms.split(' ').collect();
        let pages = pages_for(&conn, slug, question, &terms);
        if expects(&pages) {
            with_terms += 1;
        } else {
            println!("MISS {slug}: {question}\n     wanted {expected}\n     got    {pages:?}");
        }
        if let Some(page) = pages
            .iter()
            .find(|p| expected.split('|').any(|e| p.contains(e)))
        {
            let key = terms[0].to_lowercase();
            for (i, cap) in caps.iter().enumerate() {
                let text = passage(&conn, slug, page, *cap).unwrap();
                holds[i] += usize::from(text.to_lowercase().contains(&key));
            }
        }
        let alone = pages_for(&conn, slug, question, &[]);
        if expects(&alone) {
            question_only += 1;
        } else {
            println!("ALONE-MISS {question}\n     got {alone:?}");
        }
    }
    println!("passages holding the key term at {caps:?} chars: {holds:?} of {with_terms}");
    println!(
        "recall@{PAGES}: {with_terms}/{run} with search terms, {question_only}/{run} from the question alone"
    );
    assert!(run > 0, "no case ran: install the Python and React docs");
    assert!(with_terms * 10 >= run * 8, "recall fell below 80%");
}
