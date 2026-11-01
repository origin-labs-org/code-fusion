//! The one-click starts offered for a page, chosen from its structure.
use crate::ipc::PageAssistSuggestionV1 as Suggestion;
use crate::page::{PageKind, PageTraits};

/// Most reading suggestions shown at once.
pub const MAX_UNDERSTAND: usize = 3;
/// Most restyle suggestions shown at once.
pub const MAX_RESTYLE: usize = 3;

/// Suggestions for a page, most useful first: what to understand, then, where
/// a page style can be added, how to restyle it.
pub fn suggestions(traits: &PageTraits, styles: bool) -> Vec<Suggestion> {
    let mut chosen = Vec::with_capacity(MAX_UNDERSTAND + MAX_RESTYLE);
    let long = traits.words >= 150;
    if long {
        chosen.push(Suggestion::Summarize);
    }
    match traits.kind {
        PageKind::HowTo if traits.steps >= 3 => chosen.push(Suggestion::Steps),
        PageKind::Product if traits.prices >= 2 => chosen.push(Suggestion::Compare),
        PageKind::Docs => chosen.push(Suggestion::Explain),
        PageKind::Article if traits.words >= 600 => chosen.push(Suggestion::KeyPoints),
        PageKind::Listing => chosen.insert(0, Suggestion::Picks),
        _ => {}
    }
    if traits.prices > 0 || matches!(traits.kind, PageKind::Product) {
        chosen.push(Suggestion::Catch);
    }
    if traits.numbers >= 5 || traits.table_rows >= 3 {
        chosen.push(Suggestion::KeyNumbers);
    }
    if long && !chosen.contains(&Suggestion::KeyPoints) && chosen.len() < 3 {
        chosen.push(Suggestion::KeyPoints);
    }
    chosen.dedup();
    chosen.truncate(MAX_UNDERSTAND);
    if styles {
        chosen.push(Suggestion::Redesign);
        if traits.words >= 1500 {
            chosen.push(Suggestion::Readable);
        }
        chosen.push(Suggestion::Darker);
    }
    chosen
}

/// Whether a suggestion restyles the site.
pub fn restyles(suggestion: Suggestion) -> bool {
    matches!(
        suggestion,
        Suggestion::Redesign | Suggestion::Darker | Suggestion::Readable
    )
}

/// What the suggestion asks, in the model's words. Fixed text; the person's
/// question is empty for a suggestion.
pub fn request_text(suggestion: Suggestion) -> &'static str {
    match suggestion {
        Suggestion::Summarize => "Summarize this page.",
        Suggestion::KeyPoints => "What are the key points of this page?",
        Suggestion::KeyNumbers => {
            "List the most important numbers on this page as figures, each with its label."
        }
        Suggestion::Catch => {
            "What's the catch? Point out fine print, conditions, fees, limits or anything easy to miss."
        }
        Suggestion::Explain => "Explain this page in plain language.",
        Suggestion::Steps => "List the steps this page describes, in order.",
        Suggestion::Compare => "Compare the options this page offers and say who each suits.",
        Suggestion::Picks => "What's worth opening on this page? Show the few best as items.",
        Suggestion::Redesign => {
            "Redesign this site: a refined, modern look that keeps its identity, with a clear type scale and a comfortable reading width."
        }
        Suggestion::Darker => "Make this site dark: dark backgrounds, light readable text.",
        Suggestion::Readable => {
            "Make this site easier to read: larger text, comfortable line length and spacing."
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn suggestions_follow_the_page() {
        let cases = [
            (
                PageTraits::default(),
                vec![Suggestion::Redesign, Suggestion::Darker],
            ),
            (
                PageTraits {
                    kind: PageKind::Article,
                    words: 2000,
                    ..Default::default()
                },
                vec![
                    Suggestion::Summarize,
                    Suggestion::KeyPoints,
                    Suggestion::Redesign,
                    Suggestion::Readable,
                    Suggestion::Darker,
                ],
            ),
            (
                PageTraits {
                    kind: PageKind::Product,
                    words: 400,
                    prices: 3,
                    numbers: 9,
                    ..Default::default()
                },
                vec![
                    Suggestion::Summarize,
                    Suggestion::Compare,
                    Suggestion::Catch,
                    Suggestion::Redesign,
                    Suggestion::Darker,
                ],
            ),
            (
                PageTraits {
                    kind: PageKind::HowTo,
                    words: 300,
                    steps: 6,
                    ..Default::default()
                },
                vec![
                    Suggestion::Summarize,
                    Suggestion::Steps,
                    Suggestion::KeyPoints,
                    Suggestion::Redesign,
                    Suggestion::Darker,
                ],
            ),
        ];
        for (traits, expected) in cases {
            assert_eq!(suggestions(&traits, true), expected, "{traits:?}");
        }
    }

    #[test]
    fn no_restyle_suggestions_where_a_style_cannot_be_added() {
        let traits = PageTraits {
            kind: PageKind::Article,
            words: 2000,
            ..Default::default()
        };
        assert_eq!(
            suggestions(&traits, false),
            vec![Suggestion::Summarize, Suggestion::KeyPoints]
        );
        assert!(suggestions(&PageTraits::default(), false).is_empty());
    }

    #[test]
    fn every_suggestion_has_fixed_text() {
        for suggestion in [
            Suggestion::Summarize,
            Suggestion::KeyPoints,
            Suggestion::KeyNumbers,
            Suggestion::Catch,
            Suggestion::Explain,
            Suggestion::Steps,
            Suggestion::Compare,
            Suggestion::Picks,
            Suggestion::Redesign,
            Suggestion::Darker,
            Suggestion::Readable,
        ] {
            assert!(!request_text(suggestion).is_empty());
        }
    }
}
