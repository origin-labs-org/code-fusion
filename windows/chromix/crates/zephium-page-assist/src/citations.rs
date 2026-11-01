//! A reply's numbered sources. Only passages the read proved verbatim can be
//! cited, so every excerpt and highlight is the page's own words.
use crate::ipc::{PageAssistCiteV1 as Cite, PAGE_ASSIST_MAX_EXCERPT_CHARS};
use crate::page::PageRead;
use crate::refs::Ref;
use crate::text;

/// Most sources one reply numbers.
pub const MAX_SOURCES: usize = 32;
/// Longest highlight sent to the page, in bytes.
pub const MAX_HIGHLIGHT_BYTES: usize = 256;

#[derive(Clone, Debug, Eq, PartialEq)]
struct Source {
    reference: Ref,
    tab: String,
    epoch: u64,
    cite: Cite,
    highlight: String,
}

/// Where a cite jumps: the tab, the document it was read in, the quote.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Jump<'a> {
    /// The tab it is on.
    pub tab: &'a str,
    /// The document's epoch at the read.
    pub epoch: u64,
    /// The verbatim quote to mark.
    pub highlight: &'a str,
}

/// The sources of one reply, numbered in order of first citation.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct CitationBook {
    sources: Vec<Source>,
}

impl CitationBook {
    /// The number of `reference` in `read` of `tab` at `epoch`, numbering it
    /// now if it is new; none when it cannot be cited.
    pub fn cite(&mut self, reference: Ref, read: &PageRead, tab: &str, epoch: u64) -> Option<Cite> {
        if let Some(source) = self.sources.iter().find(|s| s.reference == reference) {
            return Some(source.cite.clone());
        }
        if self.sources.len() >= MAX_SOURCES {
            return None;
        }
        let verbatim = read
            .fragments
            .get(&reference.passage)?
            .verbatim
            .as_deref()?;
        let shown = text::clean(verbatim);
        if shown.is_empty() {
            return None;
        }
        let highlight = text::verbatim_prefix(verbatim.trim(), MAX_HIGHLIGHT_BYTES);
        if highlight.is_empty() || highlight.chars().any(char::is_control) {
            return None;
        }
        let cite = Cite {
            n: u8::try_from(self.sources.len() + 1).ok()?,
            excerpt: text::bounded(&shown, PAGE_ASSIST_MAX_EXCERPT_CHARS),
            tab: tab.to_owned(),
            host: read.host.clone(),
        };
        self.sources.push(Source {
            reference,
            tab: tab.to_owned(),
            epoch,
            cite: cite.clone(),
            highlight: highlight.to_owned(),
        });
        Some(cite)
    }

    /// Where cite `n` jumps.
    pub fn jump(&self, n: u8) -> Option<Jump<'_>> {
        let index = usize::from(n).checked_sub(1)?;
        self.sources.get(index).map(|source| Jump {
            tab: &source.tab,
            epoch: source.epoch,
            highlight: &source.highlight,
        })
    }

    /// How many sources are numbered.
    pub fn len(&self) -> usize {
        self.sources.len()
    }

    /// Whether none are.
    pub fn is_empty(&self) -> bool {
        self.sources.is_empty()
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::page::{Fragment, PageTraits};
    use std::collections::BTreeMap;

    pub(crate) fn read(passages: &[(u16, Option<&str>)]) -> PageRead {
        PageRead {
            site: "example.com".into(),
            host: "www.example.com".into(),
            title: None,
            payload: String::new(),
            fragments: passages
                .iter()
                .map(|(id, text)| {
                    (
                        *id,
                        Fragment {
                            verbatim: text.map(str::to_owned),
                            href: None,
                        },
                    )
                })
                .collect::<BTreeMap<_, _>>(),
            traits: PageTraits::default(),
            fingerprint: 1,
        }
    }

    fn at(passage: u16) -> Ref {
        Ref { read: 0, passage }
    }

    #[test]
    fn numbers_follow_first_citation_and_drop_what_is_not_verbatim() {
        let page = read(&[
            (3, Some("Shipping starts in May.")),
            (7, Some("Returns are free for 30 days.")),
            (9, None),
            (11, Some("  \u{202E}  ")),
        ]);
        let mut book = CitationBook::default();
        assert_eq!(book.cite(at(7), &page, "t", 4).map(|c| c.n), Some(1));
        assert_eq!(book.cite(at(99), &page, "t", 4), None);
        assert_eq!(book.cite(at(9), &page, "t", 4), None);
        assert_eq!(book.cite(at(11), &page, "t", 4), None);
        assert_eq!(book.cite(at(3), &page, "t", 4).map(|c| c.n), Some(2));
        assert_eq!(book.cite(at(7), &page, "t", 4).map(|c| c.n), Some(1));
        let jump = book.jump(1).unwrap();
        assert_eq!((jump.tab, jump.epoch), ("t", 4));
        assert_eq!(jump.highlight, "Returns are free for 30 days.");
        assert_eq!(
            book.cite(at(7), &page, "t", 4).unwrap().host,
            "www.example.com"
        );
        assert!(book.jump(0).is_none() && book.jump(3).is_none());
    }

    #[test]
    fn excerpts_and_highlights_are_bounded_and_highlight_stays_verbatim() {
        let long = "word ".repeat(200);
        let page = read(&[(1, Some(long.as_str()))]);
        let mut book = CitationBook::default();
        let cite = book.cite(at(1), &page, "t", 1).unwrap();
        assert!(cite.excerpt.chars().count() <= PAGE_ASSIST_MAX_EXCERPT_CHARS);
        let highlight = book.jump(1).unwrap().highlight;
        assert!(highlight.len() <= MAX_HIGHLIGHT_BYTES);
        assert!(long.starts_with(highlight));
    }

    #[test]
    fn the_cap_holds() {
        let passages: Vec<(u16, Option<String>)> = (1..=40)
            .map(|i| (i, Some(format!("passage {i}"))))
            .collect();
        let borrowed: Vec<(u16, Option<&str>)> =
            passages.iter().map(|(i, t)| (*i, t.as_deref())).collect();
        let page = read(&borrowed);
        let mut book = CitationBook::default();
        for id in 1..=40 {
            book.cite(at(id), &page, "t", 1);
        }
        assert_eq!(book.len(), MAX_SOURCES);
    }
}
