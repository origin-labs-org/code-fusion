//! Saved results pages read back through the page script's own rules: each
//! page becomes the wire the script would send (roles, names, prose sinks,
//! link destinations), decoded by the same Rust that filters live pages.
use super::super::capture::observation_of;
use super::*;
use dom_query::{Document, NodeRef};
use serde_json::{json, Map, Value};

/// One element's role as the page script classifies it.
struct Role {
    role: &'static str,
    level: Option<u8>,
    landmark: Option<&'static str>,
}

fn role(role: &'static str) -> Option<Role> {
    Some(Role {
        role,
        level: None,
        landmark: None,
    })
}

fn landmark(kind: &'static str) -> Option<Role> {
    Some(Role {
        role: "landmark",
        level: None,
        landmark: Some(kind),
    })
}

fn attr(node: &NodeRef, name: &str) -> Option<String> {
    node.attr(name).map(|value| value.to_string())
}

/// A div with a text node among its first children reads as prose.
fn generic_text(node: &NodeRef) -> bool {
    node.children()
        .iter()
        .take(8)
        .any(|child| child.is_text() && !child.text().trim().is_empty())
}

fn classify(node: &NodeRef) -> Option<Role> {
    let tag = node.node_name()?.to_lowercase();
    if let Some(raw) = attr(node, "role") {
        for token in raw.to_lowercase().split_whitespace() {
            return match token {
                "none" | "presentation" => None,
                "group" | "figure" => role("group"),
                "document" | "article" => role("document"),
                "region" => landmark("region"),
                "navigation" => landmark("navigation"),
                "main" => landmark("main"),
                "banner" => landmark("banner"),
                "complementary" => landmark("complementary"),
                "contentinfo" => landmark("contentinfo"),
                "form" => landmark("form"),
                "search" => landmark("search"),
                "heading" => Some(Role {
                    role: "heading",
                    level: attr(node, "aria-level")
                        .and_then(|level| level.parse().ok())
                        .or(Some(2)),
                    landmark: None,
                }),
                "paragraph" => role("paragraph"),
                "link" => role("link"),
                "button" => role("button"),
                "dialog" | "alertdialog" => role("dialog"),
                "list" | "feed" => role("list"),
                "listitem" => role("list_item"),
                _ => continue,
            };
        }
    }
    match tag.as_str() {
        "body" | "div" => generic_text(node).then_some(Role {
            role: "paragraph",
            level: None,
            landmark: Some("generic"),
        }),
        "fieldset" | "details" | "figure" => role("group"),
        "article" => role("document"),
        "main" => landmark("main"),
        "nav" => landmark("navigation"),
        "header" => landmark("banner"),
        "footer" => landmark("contentinfo"),
        "aside" => landmark("complementary"),
        "section" | "form"
            if ["aria-label", "aria-labelledby", "title"]
                .iter()
                .any(|name| node.has_attr(name)) =>
        {
            landmark(if tag == "form" { "form" } else { "region" })
        }
        "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => Some(Role {
            role: "heading",
            level: tag[1..].parse().ok(),
            landmark: None,
        }),
        "p" | "pre" | "blockquote" | "dt" | "dd" => role("paragraph"),
        "a" if node.has_attr("href") => role("link"),
        "button" | "summary" => role("button"),
        "input" => match attr(node, "type").as_deref() {
            Some("hidden") => None,
            Some("search") => role("searchbox"),
            Some("button" | "submit") => role("button"),
            _ => role("textbox"),
        },
        "textarea" => role("textbox"),
        "ul" | "ol" | "menu" => role("list"),
        "li" => role("list_item"),
        "dialog" => role("dialog"),
        _ => None,
    }
}

/// Where an element's visible words go: a control's name, or prose text.
fn sink_of(role: &str, named: bool) -> Option<&'static str> {
    match role {
        "button" | "link" | "heading" | "image" => (!named).then_some("name"),
        "paragraph" | "list_item" | "document" => Some("text"),
        _ => None,
    }
}

struct Record {
    wire: Map<String, Value>,
    sink: Option<&'static str>,
    parent: Option<usize>,
}

struct Capture<'a> {
    page: &'a url::Url,
    records: Vec<Record>,
}

impl Capture<'_> {
    fn append(&mut self, at: usize, text: &str) {
        let record = &mut self.records[at];
        let key = match record.sink {
            Some("name") => "n",
            Some("text") => "t",
            _ => return,
        };
        let joined = match record.wire.get(key).and_then(Value::as_str) {
            Some(current) if !current.is_empty() => format!("{current} {text}"),
            _ => text.to_owned(),
        };
        record.wire.insert(key.into(), json!(joined));
    }

    /// A text node's words reach its own sink, every named control around
    /// it, and the nearest prose around it when its own sink is not prose.
    fn text(&mut self, parent: usize, sink: Option<usize>, raw: &str) {
        let Some(sink) = sink else { return };
        let text = raw.split_whitespace().collect::<Vec<_>>().join(" ");
        if text.is_empty() {
            return;
        }
        self.append(sink, &text);
        let mut prose = self.records[sink].sink == Some("text");
        let mut at = Some(parent);
        while let Some(index) = at {
            if index != sink && self.records[index].sink == Some("name") {
                self.append(index, &text);
            }
            if !prose && self.records[index].sink == Some("text") {
                prose = true;
                if index != sink {
                    self.append(index, &text);
                }
            }
            at = self.records[index].parent;
        }
    }

    fn walk(&mut self, node: &NodeRef, parent: usize, sink: Option<usize>) {
        if node.is_text() {
            self.text(parent, sink, &node.text());
            return;
        }
        if !node.is_element() {
            return;
        }
        let tag = node
            .node_name()
            .map(|name| name.to_lowercase())
            .unwrap_or_default();
        if matches!(
            tag.as_str(),
            "head" | "script" | "style" | "template" | "noscript"
        ) || node.has_attr("hidden")
            || attr(node, "aria-hidden").as_deref() == Some("true")
            || attr(node, "type").as_deref() == Some("hidden")
        {
            return;
        }
        let mut role = classify(node);
        if role
            .as_ref()
            .is_some_and(|role| role.landmark == Some("generic"))
            && sink.is_some()
        {
            role = None;
        }
        let (mut parent, mut sink) = (parent, sink);
        if let Some(role) = role {
            let mut wire = Map::new();
            wire.insert("k".into(), json!(self.records.len() + 1));
            wire.insert("p".into(), json!(parent));
            wire.insert("r".into(), json!(role.role));
            if let Some(level) = role.level {
                wire.insert("l".into(), json!(level));
            }
            if let Some(kind) = role.landmark.filter(|kind| *kind != "generic") {
                wire.insert("lm".into(), json!(kind));
            }
            let name = attr(node, "aria-label").filter(|name| !name.is_empty());
            if let Some(name) = &name {
                wire.insert("n".into(), json!(name));
            }
            if role.role == "link" {
                if let Some(href) = attr(node, "href").and_then(|href| self.page.join(&href).ok()) {
                    let href = href.to_string();
                    if (href.starts_with("https://") || href.starts_with("http://"))
                        && !href.contains('@')
                        && href.len() <= 2048
                    {
                        wire.insert("u".into(), json!(href));
                    }
                }
            }
            let own = sink_of(role.role, name.is_some());
            let inherits = matches!(
                role.role,
                "link" | "document" | "group" | "landmark" | "list"
            );
            let index = self.records.len();
            self.records.push(Record {
                wire,
                sink: own,
                parent: Some(parent),
            });
            sink = if own.is_some() {
                Some(index)
            } else if inherits && sink.is_some_and(|at| self.records[at].sink == Some("text")) {
                sink
            } else {
                None
            };
            parent = index;
        }
        for child in node.children() {
            self.walk(&child, parent, sink);
        }
    }
}

/// The wire the page script would send for `html` at `page`.
fn wire_of(page: &url::Url, html: &str) -> Value {
    let document = Document::from(html);
    let mut capture = Capture {
        page,
        records: vec![Record {
            wire: Map::from_iter([("k".into(), json!(1)), ("r".into(), json!("document"))]),
            sink: None,
            parent: None,
        }],
    };
    let title = document.select("title").text().trim().to_owned();
    if !title.is_empty() {
        capture.records.push(Record {
            wire: Map::from_iter([
                ("k".into(), json!(2)),
                ("p".into(), json!(0)),
                ("r".into(), json!("paragraph")),
                ("n".into(), json!("Page title")),
                ("t".into(), json!(title)),
            ]),
            sink: None,
            parent: Some(0),
        });
    }
    for body in document.select("body").nodes() {
        capture.walk(body, 0, None);
    }
    let nodes: Vec<Value> = capture
        .records
        .into_iter()
        .map(|record| Value::Object(record.wire))
        .collect();
    json!({"v": SEMANTIC_WIRE_VERSION, "c": "complete", "n": nodes})
}

fn read(engine: SearchEngine, page: &str, html: &str) -> SearchPageRead {
    let url = url::Url::parse(page).unwrap();
    let observation = observation_of(page, &wire_of(&url, html));
    read_search_page(engine, url.host_str(), &observation)
}

fn hits(read: &SearchPageRead) -> Vec<(&str, &str, Option<&str>)> {
    let WorkSearchPage::Results(hits) = &read.page else {
        panic!("no results: {:?}", read.page);
    };
    hits.iter()
        .map(|hit| (hit.title.as_str(), hit.url.as_str(), hit.snippet.as_deref()))
        .collect()
}

const TOKIO: &str = "Tokio is an event-driven, non-blocking I/O platform for writing asynchronous applications with Rust.";
const BOOK: &str =
    "This book aims to be a comprehensive, up-to-date guide to Rust's async ecosystem.";
const ASYNC_STD: &str =
    "Async version of the Rust standard library, with an interface you already know.";

#[test]
fn google_results_skip_its_ads_and_own_links_and_unwrap_its_redirect() {
    let read = read(
        SearchEngine::Google,
        "https://www.google.com/search?q=rust+async+runtime",
        include_str!("fixtures/search/google.html"),
    );
    let found = hits(&read);
    let urls: Vec<&str> = found.iter().map(|(_, url, _)| *url).collect();
    // The ad, the repeat with a fragment, the ftp link, related searches
    // and the footer are gone; /url?q= leads to its page.
    assert_eq!(
        urls,
        [
            "https://tokio.rs/",
            "https://rust-lang.github.io/async-book/",
            "https://async.rs/",
        ]
    );
    assert_eq!(found[0].0, "Tokio - An asynchronous Rust runtime");
    // Google wraps this snippet in a span the page script reads no prose
    // from; one in a div's own text is kept.
    assert_eq!(found[0].2, None);
    assert_eq!(
        found[1].2,
        Some("This book aims to be a comprehensive, up-to-date guide to Rust's async ecosystem, suitable for beginners and old hands alike.")
    );
    assert_eq!(
        found[2],
        ("async-std", "https://async.rs/", Some(ASYNC_STD))
    );
    assert_eq!(read.cited.len(), 3);
    assert_eq!(read.cited[1].len(), 2);
}

#[test]
fn duckduckgo_results_drop_its_ad_click_and_follow_uddg() {
    let read = read(
        SearchEngine::DuckDuckGo,
        "https://duckduckgo.com/?q=rust+async+runtime",
        include_str!("fixtures/search/duckduckgo.html"),
    );
    assert_eq!(
        hits(&read),
        [
            (
                "Tokio - An asynchronous Rust runtime",
                "https://tokio.rs/",
                Some(TOKIO)
            ),
            (
                "Asynchronous Programming in Rust",
                "https://rust-lang.github.io/async-book/",
                Some(BOOK)
            ),
            ("async-std", "https://async.rs/", Some(ASYNC_STD)),
        ]
    );
}

#[test]
fn bing_results_decode_ck_redirects_and_skip_labelled_ads_and_repeats() {
    let read = read(
        SearchEngine::Bing,
        "https://www.bing.com/search?q=rust+async+runtime",
        include_str!("fixtures/search/bing.html"),
    );
    // The repeat carries a campaign parameter and still names the same page.
    assert_eq!(
        hits(&read),
        [
            (
                "Tokio - An asynchronous Rust runtime",
                "https://tokio.rs/",
                Some(TOKIO)
            ),
            (
                "Asynchronous Programming in Rust",
                "https://rust-lang.github.io/async-book/",
                Some(BOOK)
            ),
            ("async-std", "https://async.rs/", Some(ASYNC_STD)),
        ]
    );
}

#[test]
fn brave_results_read_titles_held_as_text_and_skip_sponsored() {
    let read = read(
        SearchEngine::Brave,
        "https://search.brave.com/search?q=rust+async+runtime",
        include_str!("fixtures/search/brave.html"),
    );
    assert_eq!(
        hits(&read),
        [
            (
                "Tokio - An asynchronous Rust runtime",
                "https://tokio.rs/",
                Some(TOKIO)
            ),
            (
                "Asynchronous Programming in Rust",
                "https://rust-lang.github.io/async-book/",
                Some(BOOK)
            ),
            ("async-std", "https://async.rs/", Some(ASYNC_STD)),
        ]
    );
}

#[test]
fn a_custom_engine_reads_heading_links_and_drops_its_own() {
    let read = read(
        SearchEngine::Custom,
        "https://search.example.net/search?q=rust+async+runtime",
        include_str!("fixtures/search/custom.html"),
    );
    assert_eq!(
        hits(&read),
        [
            (
                "Tokio - An asynchronous Rust runtime",
                "https://tokio.rs/",
                Some(TOKIO)
            ),
            ("async-std", "https://async.rs/", Some(ASYNC_STD)),
        ]
    );
}

#[test]
fn walls_say_what_stood_in_the_way_and_cite_it() {
    for (engine, page, html, wall) in [
        (
            SearchEngine::Google,
            "https://www.google.com/sorry/index?continue=https://www.google.com/search",
            include_str!("fixtures/search/google-sorry.html"),
            WorkSearchWall::Challenge,
        ),
        (
            SearchEngine::DuckDuckGo,
            "https://duckduckgo.com/?q=rust+async+runtime",
            include_str!("fixtures/search/duckduckgo-anomaly.html"),
            WorkSearchWall::Challenge,
        ),
        (
            SearchEngine::Google,
            "https://consent.google.com/ml?continue=https://www.google.com/search",
            include_str!("fixtures/search/google-consent.html"),
            WorkSearchWall::Consent,
        ),
        (
            SearchEngine::Bing,
            "https://www.bing.com/search?q=qzxv+wkrrt+plorb",
            include_str!("fixtures/search/bing-none.html"),
            WorkSearchWall::NoResults,
        ),
        (
            SearchEngine::Brave,
            "https://search.brave.com/search?q=rust",
            "<html><head><title>Brave Search</title></head><body><main><p>Loading</p></main></body></html>",
            WorkSearchWall::Unreadable,
        ),
    ] {
        let read = read(engine, page, html);
        assert_eq!(read.page, WorkSearchPage::Wall(wall), "{page}");
        assert_eq!(read.cited.len(), 1, "{page}");
    }
}

#[test]
fn a_results_page_reads_as_cited_findings_with_no_provider_call() {
    let page = "https://duckduckgo.com/?q=rust+async+runtime";
    let url = url::Url::parse(page).unwrap();
    let look = observation_of(
        page,
        &wire_of(&url, include_str!("fixtures/search/duckduckgo.html")),
    );
    let read = read_search_page(SearchEngine::DuckDuckGo, None, &look);
    let schema = SemanticExtractionSchema::try_new(
        SemanticExtractionSchemaId::new(7).unwrap(),
        vec![
            SemanticExtractionFieldSchema::try_text_list("output_0".into(), true, 16, 1024)
                .unwrap(),
        ],
    )
    .unwrap();
    let account = AgentContextAccountBinding::new(
        AgentAccountAttestationId::from_raw(14),
        look.request().context(),
        AgentAccountScope::Anonymous,
        AgentPolicyInstant::from_millis(100),
    );
    let located = super::super::apps::read_cited_rows(
        &look,
        account,
        SemanticCaptureInstant::from_millis(200),
        &schema,
        &read.cited,
    )
    .expect("a located read");
    assert_eq!(located.rows_read(), 3);
}

#[test]
fn redirects_unwrap_only_to_web_pages_and_never_follow_ad_clicks() {
    let rules = |engine| Rules { engine, own: None };
    let destination = |engine, raw: &str| {
        rules(engine).destination(Some(&ContextNavigationTarget::parse(raw).unwrap()))
    };
    assert_eq!(
        destination(
            SearchEngine::Google,
            "https://www.google.com/url?q=https://a.example/x&sa=U"
        )
        .as_deref(),
        Some("https://a.example/x")
    );
    assert_eq!(
        destination(
            SearchEngine::Google,
            "https://www.google.co.uk/url?q=javascript:alert(1)"
        ),
        None
    );
    assert_eq!(
        destination(
            SearchEngine::Google,
            "https://www.googleadservices.com/pagead/aclk?adurl=https://a.example/"
        ),
        None
    );
    assert_eq!(
        destination(SearchEngine::Google, "https://support.google.com/websearch").as_deref(),
        Some("https://support.google.com/websearch")
    );
    assert_eq!(
        destination(
            SearchEngine::DuckDuckGo,
            "https://duckduckgo.com/y.js?ad_domain=a.example&u3=https://a.example/"
        ),
        None
    );
    assert_eq!(
        destination(
            SearchEngine::Bing,
            "https://www.bing.com/ck/a?u=a1aHR0cDovL2EuZXhhbXBsZS8&ntb=1"
        )
        .as_deref(),
        Some("http://a.example/")
    );
    assert_eq!(
        destination(
            SearchEngine::Bing,
            "https://www.bing.com/ck/a?u=a1ZmlsZTovLy9ldGMvcGFzc3dk"
        ),
        None
    );
    assert_eq!(
        destination(
            SearchEngine::Brave,
            "https://search.brave.com/a/redirect?url=https://a.example/"
        )
        .as_deref(),
        Some("https://a.example/")
    );
    assert_eq!(
        canonical("https://www.a.example/x/?utm_source=s#top"),
        canonical("https://a.example/x")
    );
    assert_ne!(
        canonical("https://a.example/x?id=1"),
        canonical("https://a.example/x?id=2")
    );
}

#[test]
fn a_results_address_link_never_stands_as_its_title() {
    // The address link sits in the result's heading too, before the title.
    let html = r#"<html><body><main><ol>
      <li><article>
        <h3><a href="https://allegro.pl/listing?string=karta+3090"><span>allegro.pl</span></a></h3>
        <h2><a href="https://allegro.pl/listing?string=karta+3090"><span>Karta 3090 24 GB - Allegro</span></a></h2>
      </article></li>
      <li><article>
        <h2><a href="https://allegro.pl/listing?string=rtx+3090"><span>allegro.pl</span></a>
            <a href="https://allegro.pl/listing?string=rtx+3090"><span>Karta graficzna RTX 3090 - Niska cena na Allegro</span></a></h2>
        <div><span>Karty graficzne RTX 3090 24 GB w niskich cenach.</span></div>
      </article></li>
      <li><article>
        <h2><a href="https://www.ycombinator.com/blog/demo-day"><span>ycombinator.com › blog</span></a>
            <a href="https://www.ycombinator.com/blog/demo-day"><span>2026 Demo Day Dates | Y Combinator</span></a></h2>
      </article></li>
    </ol></main></body></html>"#;
    let read = read(
        SearchEngine::DuckDuckGo,
        "https://duckduckgo.com/?q=rtx+3090",
        html,
    );
    let titles: Vec<&str> = hits(&read).iter().map(|(title, ..)| *title).collect();
    assert_eq!(
        titles,
        [
            "Karta 3090 24 GB - Allegro",
            "Karta graficzna RTX 3090 - Niska cena na Allegro",
            "2026 Demo Day Dates | Y Combinator"
        ]
    );
}
