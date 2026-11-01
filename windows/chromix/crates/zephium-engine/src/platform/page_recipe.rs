//! The Ask panel's closed page recipes: the selected text, a quote scrolled
//! to and marked, the page's outline for a style turn, numbered marks around
//! items of a read, and the person's pick of an element. A recipe is one
//! fixed invocation of the private-world program; its only data is what Rust
//! serialised itself (a quote, the observed facts of marked passages, a pick
//! number). Every answer is hostile and decoded under a fixed ceiling.

use crate::page_reader::{PageOutline, PageOutlineKind, PageOutlineNode, PagePick, Rgb};

/// Longest quote a mark looks for, in characters.
pub(crate) const MAX_MARK_QUOTE_CHARS: usize = 2_048;
/// Longest selection returned, in bytes.
pub(crate) const MAX_SELECTION_BYTES: usize = 4 * 1_024;
const MAX_SELECTION_WIRE_BYTES: usize = 4 * 4_096 + 2;
const MAX_OUTLINE_WIRE_BYTES: usize = 24 * 1_024;
const MAX_OUTLINE_NODES: usize = 48;
const MAX_OUTLINE_FONTS: usize = 3;
const MAX_SELECTOR_BYTES: usize = 96;
const MAX_FONT_BYTES: usize = 48;

const SELECTION: &str = "Q1:selection";
const OUTLINE: &str = "Q1:outline";
const TOUCHED: &str = "Q1:touched";
const MARK_PREFIX: &str = "Q1:mark:";
const MARKS_PREFIX: &str = "Q1:marks:";
const MARK_FOCUS_PREFIX: &str = "Q1:markfocus:";
const CLEAR: &str = "Q1:clear";
const PICK_PREFIX: &str = "Q1:pick:";
const PICKED: &str = "Q1:picked";
const PICK_CANCEL: &str = "Q1:pickcancel";
const PICK_READ_PREFIX: &str = "Q1:pickread:";
const PICK_CLEAR_PREFIX: &str = "Q1:pickclear:";
#[cfg(feature = "page-reader-probe")]
const OVERLAY: &str = "Q1:overlay";

/// Most marks one call places.
pub(crate) const MAX_MARKS: usize = 12;
/// Passage text a mark is found again by, in characters.
const MAX_MARK_TEXT_CHARS: usize = 160;
/// Longest link destination a mark is matched by.
const MAX_MARK_HREF_BYTES: usize = 512;
const MAX_MARKS_WIRE_BYTES: usize = 64;
const MAX_PICK_WIRE_BYTES: usize = 24 * 1_024;
#[cfg(feature = "page-reader-probe")]
const MAX_OVERLAY_WIRE_BYTES: usize = 8 * 1_024;
const MAX_PICK_LABEL_CHARS: usize = 64;
const MAX_PICK_TEXT_CHARS: usize = 4_000;
const MAX_PICK_SELECTOR_BYTES: usize = 2_048;
/// Pick numbers stay exact as JavaScript numbers and in the wire's digits.
pub(crate) const MAX_PICK_ID: u64 = 9_999_999_999_999_999;

#[derive(Clone, Debug, Eq, PartialEq)]
enum Kind {
    Selection,
    Outline,
    Mark,
    Touched,
    /// Numbered marks placed, or none to clear them; answers the numbers
    /// that were.
    Marks {
        placing: bool,
    },
    /// One mark emphasised; drawings removed; a pick started, cancelled or
    /// cleared: each answers one byte.
    Short,
    /// A pick's state, or a picked element read again.
    Pick,
    #[cfg(feature = "page-reader-probe")]
    Overlay,
}

/// The facts of one marked passage, as the read observed them.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct MarkTarget {
    /// The number drawn in its badge.
    pub(crate) n: u8,
    /// What it is: one of the program's fixed kinds.
    pub(crate) kind: &'static str,
    /// Its visible text.
    pub(crate) text: Option<String>,
    /// Its accessible name.
    pub(crate) name: Option<String>,
    /// A link's destination.
    pub(crate) href: Option<String>,
    /// Which match of these facts in reading order it is.
    pub(crate) occurrence: u16,
}

/// Where a pick stands.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum PickState {
    /// The person is still picking.
    Waiting,
    /// Escape, the idle limit or a cancel ended it.
    Cancelled,
    /// No picker and no outcome: the document is not the one it began on.
    Gone,
    /// The person picked this.
    Picked(PagePick),
}

/// One closed recipe invocation.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct PageRecipe {
    kind: Kind,
    encoded: String,
}

/// What a mark did.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum MarkOutcome {
    /// Scrolled to and highlighted.
    Marked,
    /// Scrolled to; this engine cannot highlight.
    Scrolled,
    /// The quote is not on the page.
    Missing,
}

impl PageRecipe {
    pub(crate) fn selection() -> Self {
        Self {
            kind: Kind::Selection,
            encoded: SELECTION.to_owned(),
        }
    }

    /// Whether the person used the page since the last ask; the first ask
    /// starts listening. Only trusted input counts.
    pub(crate) fn touched() -> Self {
        Self {
            kind: Kind::Touched,
            encoded: TOUCHED.to_owned(),
        }
    }

    pub(crate) fn outline() -> Self {
        Self {
            kind: Kind::Outline,
            encoded: OUTLINE.to_owned(),
        }
    }

    /// A mark of `quote`, or none when the quote is empty, too long or
    /// carries control characters.
    pub(crate) fn mark(quote: &str) -> Option<Self> {
        let quote = quote.trim();
        if quote.is_empty()
            || quote.chars().count() > MAX_MARK_QUOTE_CHARS
            || quote
                .chars()
                .any(|c| c.is_control() && !matches!(c, '\n' | '\t'))
        {
            return None;
        }
        let json = serde_json::to_string(quote).ok()?;
        Some(Self {
            kind: Kind::Mark,
            encoded: format!("{MARK_PREFIX}{json}"),
        })
    }

    /// Numbered marks replacing the current ones; none clears them.
    pub(crate) fn marks(targets: &[MarkTarget], reduce_motion: bool) -> Option<Self> {
        if targets.len() > MAX_MARKS {
            return None;
        }
        let clip = |text: &Option<String>| {
            text.as_deref().filter(|text| !text.is_empty()).map(|text| {
                let prefix = text.chars().count() > MAX_MARK_TEXT_CHARS;
                (
                    text.chars().take(MAX_MARK_TEXT_CHARS).collect::<String>(),
                    prefix,
                )
            })
        };
        let entries: Vec<serde_json::Value> = targets
            .iter()
            .map(|target| {
                let text = clip(&target.text);
                let name = clip(&target.name);
                let mut entry = serde_json::Map::new();
                entry.insert("n".into(), target.n.into());
                entry.insert("k".into(), target.kind.into());
                entry.insert("o".into(), target.occurrence.into());
                let prefix = text.as_ref().is_some_and(|(_, p)| *p)
                    || name.as_ref().is_some_and(|(_, p)| *p);
                if let Some((text, _)) = text {
                    entry.insert("t".into(), text.into());
                }
                if let Some((name, _)) = name {
                    entry.insert("a".into(), name.into());
                }
                if prefix {
                    entry.insert("p".into(), true.into());
                }
                if let Some(href) = target
                    .href
                    .as_deref()
                    .filter(|href| href.len() <= MAX_MARK_HREF_BYTES)
                {
                    entry.insert("h".into(), href.into());
                }
                serde_json::Value::Object(entry)
            })
            .collect();
        let json =
            serde_json::to_string(&serde_json::json!({ "r": reduce_motion, "m": entries })).ok()?;
        Some(Self {
            kind: Kind::Marks {
                placing: !targets.is_empty(),
            },
            encoded: format!("{MARKS_PREFIX}{json}"),
        })
    }

    /// Mark `n` emphasised (none: no mark is), and brought into view.
    pub(crate) fn mark_focus(n: Option<u8>, scroll: bool) -> Self {
        let json = serde_json::json!({ "n": n, "s": scroll }).to_string();
        Self {
            kind: Kind::Short,
            encoded: format!("{MARK_FOCUS_PREFIX}{json}"),
        }
    }

    /// Every mark, attached pick and running picker removed at once.
    pub(crate) fn clear() -> Self {
        Self {
            kind: Kind::Short,
            encoded: CLEAR.to_owned(),
        }
    }

    /// The person's picker, for pick `pick`.
    pub(crate) fn pick(pick: u64, reduce_motion: bool) -> Option<Self> {
        if pick == 0 || pick > MAX_PICK_ID {
            return None;
        }
        let json = serde_json::json!({ "p": pick.to_string(), "r": reduce_motion }).to_string();
        Some(Self {
            kind: Kind::Short,
            encoded: format!("{PICK_PREFIX}{json}"),
        })
    }

    /// Where the running pick stands.
    pub(crate) fn picked() -> Self {
        Self {
            kind: Kind::Pick,
            encoded: PICKED.to_owned(),
        }
    }

    pub(crate) fn pick_cancel() -> Self {
        Self {
            kind: Kind::Short,
            encoded: PICK_CANCEL.to_owned(),
        }
    }

    /// Picked element `pick` read again, as it is now.
    pub(crate) fn pick_read(pick: u64) -> Option<Self> {
        (pick != 0 && pick <= MAX_PICK_ID).then(|| Self {
            kind: Kind::Pick,
            encoded: format!("{PICK_READ_PREFIX}{pick}"),
        })
    }

    /// The outline of pick `pick` removed.
    pub(crate) fn pick_clear(pick: u64) -> Option<Self> {
        (pick != 0 && pick <= MAX_PICK_ID).then(|| Self {
            kind: Kind::Short,
            encoded: format!("{PICK_CLEAR_PREFIX}{pick}"),
        })
    }

    /// Our own drawings' geometry and upkeep, for the reader's probe.
    #[cfg(feature = "page-reader-probe")]
    pub(crate) fn overlay() -> Self {
        Self {
            kind: Kind::Overlay,
            encoded: OVERLAY.to_owned(),
        }
    }

    /// Whether this recipe draws over the page.
    pub(crate) fn draws(&self) -> bool {
        self.kind == Kind::Marks { placing: true } || self.encoded.starts_with(PICK_PREFIX)
    }

    /// The answer this recipe would give on a page we have drawn nothing
    /// on: it changes nothing there, so it need not reach the page at all.
    pub(crate) fn nothing_drawn(&self) -> Option<&'static str> {
        match self.kind {
            Kind::Marks { placing: false } => Some("M:"),
            Kind::Pick => Some("N"),
            Kind::Short if self.encoded.starts_with(MARK_FOCUS_PREFIX) => Some("0"),
            Kind::Short if !self.encoded.starts_with(PICK_PREFIX) => Some("1"),
            _ => None,
        }
    }

    /// The invocation the private world receives. Never logged.
    pub(crate) fn as_str(&self) -> &str {
        &self.encoded
    }

    /// Validates one hostile answer for this recipe; none when it is not a
    /// well-formed answer of this kind.
    pub(crate) fn decode(&self, bytes: &[u8]) -> Option<String> {
        let limit = match self.kind {
            Kind::Selection => MAX_SELECTION_WIRE_BYTES,
            Kind::Outline => MAX_OUTLINE_WIRE_BYTES,
            Kind::Mark | Kind::Touched | Kind::Short => 1,
            Kind::Marks { .. } => MAX_MARKS_WIRE_BYTES,
            Kind::Pick => MAX_PICK_WIRE_BYTES,
            #[cfg(feature = "page-reader-probe")]
            Kind::Overlay => MAX_OVERLAY_WIRE_BYTES,
        };
        if bytes.len() > limit {
            return None;
        }
        let text = std::str::from_utf8(bytes).ok()?;
        match self.kind {
            Kind::Selection => {
                if text == "N" {
                    return Some(String::new());
                }
                let selected = text.strip_prefix("T:")?;
                Some(bounded(selected.trim(), MAX_SELECTION_BYTES).to_owned())
            }
            Kind::Outline => text.starts_with('{').then(|| text.to_owned()),
            Kind::Mark => matches!(text, "0" | "1" | "2").then(|| text.to_owned()),
            Kind::Touched | Kind::Short => matches!(text, "0" | "1").then(|| text.to_owned()),
            Kind::Marks { .. } => text.starts_with("M:").then(|| text.to_owned()),
            Kind::Pick => (matches!(text, "W" | "C" | "N") || text.starts_with("P:{"))
                .then(|| text.to_owned()),
            #[cfg(feature = "page-reader-probe")]
            Kind::Overlay => text.starts_with('{').then(|| text.to_owned()),
        }
    }
}

/// The numbers a marks answer placed, among those asked for.
pub(crate) fn placed_marks(answer: &str, asked: &[MarkTarget]) -> Vec<u8> {
    let Some(list) = answer.strip_prefix("M:") else {
        return Vec::new();
    };
    let mut placed = Vec::new();
    for number in list.split(',').filter(|n| !n.is_empty()) {
        let Ok(n) = number.parse::<u8>() else {
            return Vec::new();
        };
        if asked.iter().any(|target| target.n == n) && !placed.contains(&n) {
            placed.push(n);
        }
    }
    placed
}

/// A pick answer: the state of the running pick, or a picked element.
pub(crate) fn pick_state(answer: &str, pick: u64) -> Option<PickState> {
    match answer {
        "W" => return Some(PickState::Waiting),
        "C" => return Some(PickState::Cancelled),
        "N" => return Some(PickState::Gone),
        _ => {}
    }
    let value: serde_json::Value = serde_json::from_str(answer.strip_prefix("P:")?).ok()?;
    let object = value.as_object()?;
    if object.get("p")?.as_str()? != pick.to_string() {
        return None;
    }
    let label: String = object
        .get("l")?
        .as_str()?
        .chars()
        .filter(|c| !c.is_control())
        .take(MAX_PICK_LABEL_CHARS)
        .collect();
    let text: String = object
        .get("t")?
        .as_str()?
        .chars()
        .filter(|c| *c == '\n' || !c.is_control())
        .take(MAX_PICK_TEXT_CHARS)
        .collect();
    let selector = match object.get("s")? {
        serde_json::Value::Null => None,
        serde_json::Value::String(selector) => {
            selector_admitted(selector).then(|| selector.clone())
        }
        _ => return None,
    };
    Some(PickState::Picked(PagePick {
        pick,
        label: if label.trim().is_empty() {
            "Section".to_owned()
        } else {
            label.trim().to_owned()
        },
        text: text.trim().to_owned(),
        selector,
    }))
}

/// A pick's selector as the shared picker builds them: an id, up to two
/// classes, or a short positional path. Nothing that could close a rule.
fn selector_admitted(selector: &str) -> bool {
    !selector.is_empty()
        && selector.len() <= MAX_PICK_SELECTOR_BYTES
        && (selector.starts_with('[') || selector.starts_with(|c: char| c.is_ascii_lowercase()))
        && !selector
            .chars()
            .any(|c| c.is_control() || matches!(c, '{' | '}' | ';' | '<' | '@'))
        && !selector.contains("/*")
}

pub(crate) fn mark_outcome(answer: &str) -> Option<MarkOutcome> {
    match answer {
        "1" => Some(MarkOutcome::Marked),
        "2" => Some(MarkOutcome::Scrolled),
        "0" => Some(MarkOutcome::Missing),
        _ => None,
    }
}

fn bounded(text: &str, limit: usize) -> &str {
    if text.len() <= limit {
        return text;
    }
    let mut end = limit;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

fn rgb(value: Option<&serde_json::Value>) -> Option<Rgb> {
    let channels = value?.as_array()?;
    if channels.len() != 3 {
        return None;
    }
    let channel = |index: usize| {
        channels[index]
            .as_u64()
            .and_then(|value| u8::try_from(value).ok())
    };
    Some(Rgb(channel(0)?, channel(1)?, channel(2)?))
}

fn kind(word: &str) -> Option<PageOutlineKind> {
    Some(match word {
        "header" => PageOutlineKind::Header,
        "navigation" => PageOutlineKind::Navigation,
        "main" => PageOutlineKind::Main,
        "article" => PageOutlineKind::Article,
        "aside" => PageOutlineKind::Aside,
        "footer" => PageOutlineKind::Footer,
        "heading" => PageOutlineKind::Heading,
        "content" => PageOutlineKind::Content,
        "control" => PageOutlineKind::Control,
        "other" => PageOutlineKind::Other,
        _ => return None,
    })
}

/// A selector the outline may carry: `tag`, one `#id`, up to three classes,
/// each an identifier. Anything else is dropped here and again by the
/// service's admission.
fn selector_shaped(selector: &str) -> bool {
    if selector.is_empty() || selector.len() > MAX_SELECTOR_BYTES || !selector.is_ascii() {
        return false;
    }
    let identifier = |token: &str| {
        let mut bytes = token.bytes();
        token.len() <= 32
            && bytes.next().is_some_and(|b| b.is_ascii_alphabetic())
            && bytes.all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    };
    let mut tokens = Vec::new();
    let (mut marker, mut start) = (None, 0);
    for (index, byte) in selector.bytes().enumerate() {
        if matches!(byte, b'#' | b'.') {
            tokens.push((marker, &selector[start..index]));
            marker = Some(byte);
            start = index + 1;
        }
    }
    tokens.push((marker, &selector[start..]));
    let (mut ids, mut classes) = (0, 0);
    for (index, (marker, token)) in tokens.into_iter().enumerate() {
        match (index, marker) {
            (0, None) => {}
            (0, _) | (_, None) => return false,
            (_, Some(b'#')) => ids += 1,
            (_, Some(_)) => classes += 1,
        }
        if !identifier(token) || ids > 1 || classes > 3 {
            return false;
        }
    }
    true
}

fn font_shaped(font: &str) -> bool {
    !font.is_empty()
        && font.len() <= MAX_FONT_BYTES
        && font
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b' ' | b'-' | b'_'))
}

/// Parses an outline answer; malformed entries are dropped one by one, a
/// malformed answer as a whole yields none.
pub(crate) fn parse_outline(wire: &str) -> Option<PageOutline> {
    if wire.len() > MAX_OUTLINE_WIRE_BYTES {
        return None;
    }
    let value: serde_json::Value = serde_json::from_str(wire).ok()?;
    let object = value.as_object()?;
    let mut nodes = Vec::new();
    for node in object.get("n")?.as_array()?.iter().take(MAX_OUTLINE_NODES) {
        let Some(node) = node.as_object() else {
            continue;
        };
        let (Some(selector), Some(kind)) = (
            node.get("s")
                .and_then(serde_json::Value::as_str)
                .filter(|s| selector_shaped(s)),
            node.get("k")
                .and_then(serde_json::Value::as_str)
                .and_then(kind),
        ) else {
            continue;
        };
        let count = node
            .get("c")
            .and_then(serde_json::Value::as_u64)
            .map_or(0, |count| u16::try_from(count).unwrap_or(u16::MAX));
        let font_size_px = node
            .get("z")
            .and_then(serde_json::Value::as_u64)
            .and_then(|size| u16::try_from(size).ok())
            .filter(|size| (1..=200).contains(size));
        nodes.push(PageOutlineNode {
            selector: selector.to_owned(),
            kind,
            count,
            background: rgb(node.get("b")),
            color: rgb(node.get("f")),
            font_size_px,
        });
    }
    let fonts = object
        .get("ft")
        .and_then(serde_json::Value::as_array)
        .map(|fonts| {
            fonts
                .iter()
                .filter_map(serde_json::Value::as_str)
                .filter(|font| font_shaped(font))
                .take(MAX_OUTLINE_FONTS)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default();
    Some(PageOutline {
        nodes,
        background: rgb(object.get("bg")),
        text: rgb(object.get("tx")),
        link: rgb(object.get("ln")),
        accent: rgb(object.get("ac")),
        fonts,
        dark: object
            .get("dk")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invocations_are_closed_and_marks_carry_only_a_json_string() {
        assert_eq!(PageRecipe::selection().as_str(), "Q1:selection");
        assert_eq!(PageRecipe::outline().as_str(), "Q1:outline");
        let mark = PageRecipe::mark("He said \"go\"</script>").expect("mark");
        assert_eq!(mark.as_str(), "Q1:mark:\"He said \\\"go\\\"</script>\"");
        for refused in ["", "   ", "a\u{0}b", "\u{1b}[31m"] {
            assert!(PageRecipe::mark(refused).is_none(), "{refused:?}");
        }
        assert!(PageRecipe::mark(&"x".repeat(MAX_MARK_QUOTE_CHARS + 1)).is_none());
        assert!(PageRecipe::mark(&"é".repeat(MAX_MARK_QUOTE_CHARS)).is_some());
    }

    #[test]
    fn answers_are_bounded_and_shaped_per_recipe() {
        let selection = PageRecipe::selection();
        assert_eq!(selection.decode(b"N").as_deref(), Some(""));
        assert_eq!(selection.decode(b"T: hello ").as_deref(), Some("hello"));
        assert!(selection.decode(b"hello").is_none());
        let long = format!("T:{}", "é".repeat(4_000));
        assert_eq!(
            selection.decode(long.as_bytes()).map(|s| s.len()),
            Some(MAX_SELECTION_BYTES)
        );
        assert!(selection
            .decode(format!("T:{}", "a".repeat(MAX_SELECTION_WIRE_BYTES)).as_bytes())
            .is_none());
        let mark = PageRecipe::mark("quote").expect("mark");
        for (answer, outcome) in [
            ("1", MarkOutcome::Marked),
            ("2", MarkOutcome::Scrolled),
            ("0", MarkOutcome::Missing),
        ] {
            let decoded = mark.decode(answer.as_bytes()).expect("answer");
            assert_eq!(mark_outcome(&decoded), Some(outcome));
        }
        assert!(mark.decode(b"E").is_none() && mark.decode(b"11").is_none());
        assert!(PageRecipe::outline().decode(b"[1]").is_none());
        assert!(PageRecipe::outline()
            .decode(&vec![b'{'; MAX_OUTLINE_WIRE_BYTES + 1])
            .is_none());
    }

    #[test]
    fn windows_recipe_calls_are_closed_and_grant_no_gesture() {
        use crate::platform::agent_semantic_cdp_protocol::{
            decode_page_recipe_response, decode_root_frame,
            install_page_recipes_in_context_command, invoke_page_recipe_command,
            SemanticContextDiscovery, SemanticWorldName,
        };
        let world = SemanticWorldName::from_nonce(1, 7).expect("world");
        let root = decode_root_frame(r#"{"frameTree":{"frame":{"id":"F1"}}}"#).expect("root");
        let mut discovery = SemanticContextDiscovery::new(world.clone(), root);
        discovery
            .record_created_context(r#"{"executionContextId":5}"#)
            .expect("created");
        discovery
            .observe_context_created(&format!(
                r#"{{"context":{{"id":5,"uniqueId":"u-5","name":"{}","auxData":{{"frameId":"F1","isDefault":false,"type":"isolated"}}}}}}"#,
                world.as_str()
            ))
            .expect("observed");
        let context = discovery.resolved().expect("resolved").expect("context");
        let mark = PageRecipe::mark("q").expect("mark");
        for command in [
            invoke_page_recipe_command(&context, &mark).expect("invoke"),
            install_page_recipes_in_context_command(&context).expect("install"),
        ] {
            assert_eq!(command.method().as_str(), "Runtime.callFunctionOn");
            let parameters: serde_json::Value =
                serde_json::from_str(command.parameters()).expect("json");
            assert_eq!(parameters["userGesture"], false);
            assert_eq!(parameters["uniqueContextId"], "u-5");
        }
        let parameters: serde_json::Value = serde_json::from_str(
            invoke_page_recipe_command(&context, &mark)
                .expect("invoke")
                .parameters(),
        )
        .expect("json");
        assert_eq!(
            parameters["functionDeclaration"],
            "function(encoded){return globalThis.__zephiumPageAssistV1.recipe(encoded);}"
        );
        assert_eq!(parameters["arguments"][0]["value"], "Q1:mark:\"q\"");
        let selection = PageRecipe::selection();
        assert_eq!(
            decode_page_recipe_response(
                &selection,
                r#"{"result":{"type":"string","value":"T:hello"}}"#
            )
            .as_deref(),
            Ok("hello")
        );
        for refused in [
            r#"{"result":{"type":"string","value":"hello"}}"#,
            r#"{"result":{"type":"object","value":"T:hello"}}"#,
            r#"{"exceptionDetails":{},"result":{"type":"string","value":"T:x"}}"#,
        ] {
            assert!(
                decode_page_recipe_response(&selection, refused).is_err(),
                "{refused}"
            );
        }
    }

    fn target(n: u8, text: &str) -> MarkTarget {
        MarkTarget {
            n,
            kind: "link",
            text: Some(text.to_owned()),
            name: None,
            href: Some("https://example.org/a".to_owned()),
            occurrence: 2,
        }
    }

    #[test]
    fn marks_carry_only_serialised_facts_and_answer_the_numbers_placed() {
        let long = "x".repeat(MAX_MARK_TEXT_CHARS + 40);
        let mut far = target(2, &long);
        far.href = Some(format!(
            "https://example.org/{}",
            "q".repeat(MAX_MARK_HREF_BYTES)
        ));
        let recipe =
            PageRecipe::marks(&[target(1, "Story \"one\"</script>"), far], true).expect("marks");
        let json = recipe.as_str().strip_prefix(MARKS_PREFIX).expect("prefix");
        let value: serde_json::Value = serde_json::from_str(json).expect("json");
        assert_eq!(value["r"], true);
        assert_eq!(value["m"][0]["t"], "Story \"one\"</script>");
        assert_eq!(value["m"][0]["h"], "https://example.org/a");
        assert_eq!(value["m"][0]["o"], 2);
        assert!(value["m"][0].get("p").is_none());
        assert_eq!(
            value["m"][1]["t"].as_str().map(|t| t.chars().count()),
            Some(MAX_MARK_TEXT_CHARS)
        );
        assert_eq!(value["m"][1]["p"], true);
        assert!(
            value["m"][1].get("h").is_none(),
            "a long destination is not matched on"
        );
        assert!(recipe.draws() && recipe.nothing_drawn().is_none());
        let many: Vec<MarkTarget> = (1..=13).map(|n| target(n, "t")).collect();
        assert!(PageRecipe::marks(&many, false).is_none());
        let asked = [target(1, "a"), target(4, "b")];
        assert_eq!(placed_marks("M:4,1,9,4", &asked), [4, 1]);
        assert!(placed_marks("M:1,x", &asked).is_empty());
        assert!(placed_marks("1,4", &asked).is_empty());
        assert_eq!(recipe.decode(b"M:1,2").as_deref(), Some("M:1,2"));
        assert!(recipe.decode(&[b'M'; MAX_MARKS_WIRE_BYTES + 1]).is_none());
        let clear = PageRecipe::marks(&[], false).expect("clear");
        assert!(!clear.draws());
        assert_eq!(clear.nothing_drawn(), Some("M:"));
    }

    #[test]
    fn pick_answers_are_bounded_and_admit_only_closed_selectors() {
        assert!(PageRecipe::pick(0, false).is_none());
        assert!(PageRecipe::pick(MAX_PICK_ID + 1, false).is_none());
        let start = PageRecipe::pick(7, true).expect("pick");
        assert_eq!(start.as_str(), "Q1:pick:{\"p\":\"7\",\"r\":true}");
        assert!(start.draws() && start.nothing_drawn().is_none());
        assert_eq!(
            PageRecipe::pick_read(7).expect("read").as_str(),
            "Q1:pickread:7"
        );
        assert_eq!(
            PageRecipe::pick_clear(7).expect("clear").as_str(),
            "Q1:pickclear:7"
        );
        assert_eq!(PageRecipe::picked().nothing_drawn(), Some("N"));
        assert_eq!(PageRecipe::pick_cancel().nothing_drawn(), Some("1"));
        assert_eq!(PageRecipe::clear().nothing_drawn(), Some("1"));
        assert_eq!(
            PageRecipe::mark_focus(Some(2), true).nothing_drawn(),
            Some("0")
        );
        assert_eq!(pick_state("W", 7), Some(PickState::Waiting));
        assert_eq!(pick_state("C", 7), Some(PickState::Cancelled));
        assert_eq!(pick_state("N", 7), Some(PickState::Gone));
        let wire = |selector: &str| {
            format!(
                "P:{}",
                serde_json::json!({"p": "7", "l": "Story\u{7}list", "t": "One\ntwo\u{1b}", "s": selector})
            )
        };
        let Some(PickState::Picked(picked)) = pick_state(&wire("[id=\"hnmain\"]"), 7) else {
            panic!("picked");
        };
        assert_eq!(picked.label, "Storylist");
        assert_eq!(picked.text, "One\ntwo");
        assert_eq!(picked.selector.as_deref(), Some("[id=\"hnmain\"]"));
        for refused in [
            "a{}b{color:red}",
            "[id=\"x\"];x",
            "/* x */ a",
            "@import x",
            "",
            "A > b",
        ] {
            let Some(PickState::Picked(picked)) = pick_state(&wire(refused), 7) else {
                panic!("picked");
            };
            assert!(picked.selector.is_none(), "{refused}");
        }
        assert!(
            pick_state(&wire("div"), 8).is_none(),
            "another pick's answer"
        );
        assert!(pick_state("P:[]", 7).is_none());
        let long = format!(
            "P:{}",
            serde_json::json!({"p": "7", "l": "l".repeat(200), "t": "t".repeat(9_000), "s": null})
        );
        let Some(PickState::Picked(picked)) = pick_state(&long, 7) else {
            panic!("picked");
        };
        assert_eq!(picked.label.chars().count(), MAX_PICK_LABEL_CHARS);
        assert_eq!(picked.text.chars().count(), MAX_PICK_TEXT_CHARS);
        assert!(PageRecipe::picked()
            .decode(&vec![b'P'; MAX_PICK_WIRE_BYTES + 1])
            .is_none());
        assert!(PageRecipe::picked().decode(b"X").is_none());
    }

    #[test]
    fn outline_keeps_only_well_shaped_entries() {
        let wire = r##"{"n":[
            {"s":"header.site-head","k":"header","c":1,"b":[255,255,255],"f":[17,17,17],"z":16},
            {"s":"div#main.a.b.c","k":"main","c":70000,"b":null,"f":[1,2,3],"z":900},
            {"s":"div.a.b.c.d","k":"content","c":3},
            {"s":"a[href]","k":"other","c":1},
            {"s":"p.x","k":"poem","c":1},
            {"s":"div#a#b","k":"other","c":1},
            {"s":"9x","k":"other","c":1},
            {"s":"nav.","k":"navigation","c":1},
            {"s":"section.card","k":"content","c":4,"b":[300,0,0]}
        ],"bg":[250,250,250],"tx":[20,20,20],"ln":[0,0,238],"ac":null,
        "ft":["Inter","Georgia; color:red","system-ui","x","y"],"dk":false}"##;
        let outline = parse_outline(wire).expect("outline");
        let selectors: Vec<&str> = outline.nodes.iter().map(|n| n.selector.as_str()).collect();
        assert_eq!(
            selectors,
            ["header.site-head", "div#main.a.b.c", "section.card"]
        );
        assert_eq!(outline.nodes[1].count, u16::MAX);
        assert_eq!(outline.nodes[1].font_size_px, None);
        assert_eq!(outline.nodes[2].background, None);
        assert_eq!(outline.background, Some(Rgb(250, 250, 250)));
        assert_eq!(outline.accent, None);
        assert_eq!(outline.fonts, ["Inter", "system-ui", "x"]);
        assert!(parse_outline("not json").is_none());
        assert!(parse_outline("{}").is_none());
    }
}
