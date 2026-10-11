//! DevDocs page HTML to Markdown, for full-text indexing (and model passages in Phase 6).

use std::rc::Rc;

use htmd::element_handler::{HandlerResult, Handlers};
use htmd::{Element, HtmlToMarkdown};
use markup5ever_rcdom::{Node, NodeData};

thread_local! {
    static CONVERTER: HtmlToMarkdown = HtmlToMarkdown::builder()
        .skip_tags(vec!["script", "style", "nav", "img", "svg"])
        // DevDocs writes code as `<pre data-language="c">` without `<code>`, which htmd would
        // flatten into a paragraph.
        .add_handler(vec!["pre"], fenced_code)
        .build();
}

fn fenced_code(_: &dyn Handlers, element: Element) -> Option<HandlerResult> {
    let language = element
        .attrs
        .iter()
        .find(|a| &*a.name.local == "data-language")
        .map(|a| a.value.to_string())
        .unwrap_or_default();
    let mut code = String::new();
    collect_text(element.node, &mut code);
    let code = code.trim_matches('\n');
    // A fence longer than any backtick run inside the code.
    let fence = "`".repeat(longest_backtick_run(code).max(2) + 1);
    Some(format!("\n\n{fence}{language}\n{code}\n{fence}\n\n").into())
}

fn collect_text(node: &Rc<Node>, out: &mut String) {
    if let NodeData::Text { contents } = &node.data {
        out.push_str(&contents.borrow());
    }
    for child in node.children.borrow().iter() {
        collect_text(child, out);
    }
}

fn longest_backtick_run(text: &str) -> usize {
    text.split(|c| c != '`').map(str::len).max().unwrap_or(0)
}

pub fn to_markdown(html: &str) -> std::io::Result<String> {
    CONVERTER.with(|c| c.convert(html))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_code_blocks_and_text() {
        let md = to_markdown(
            r#"<h1>strcpy</h1><pre data-language="c">char* strcpy( char* dest, const char* src );</pre><p>Copies <code>src</code>.</p><script>alert(1)</script>"#,
        )
        .unwrap();
        assert!(md.contains("# strcpy"), "{md}");
        assert!(md.contains("```c\nchar* strcpy("), "{md}");
        assert!(
            md.contains("char* strcpy( char* dest, const char* src );"),
            "{md}"
        );
        assert!(md.contains("Copies `src`."), "{md}");
        assert!(!md.contains("alert"), "{md}");
    }

    #[test]
    fn code_keeps_markup_free_text_and_safe_fence() {
        let md =
            to_markdown(r#"<pre data-language="md"><span>a *b*</span> ```x```</pre>"#).unwrap();
        assert!(md.contains("````md\na *b* ```x```\n````"), "{md}");
    }
}
