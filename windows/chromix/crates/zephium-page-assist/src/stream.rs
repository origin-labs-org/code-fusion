//! Streamed reply text: the model writes sources as `[a12]` or `[a12, b3]`;
//! the panel receives cite marks `⟦1⟧` for the ones that can be cited, and
//! nothing for the rest. A bracket still open at a chunk's end is held until
//! it closes, so a mark is never split across deliveries.
use crate::ipc::{PAGE_ASSIST_CITE_CLOSE as CLOSE, PAGE_ASSIST_CITE_OPEN as OPEN};
use crate::refs::{self, Ref};

/// Longest bracket held while waiting for it to close.
const MAX_HELD: usize = 64;

/// Rewrites one reply's text as it streams.
#[derive(Debug, Default)]
pub struct CiteRewriter {
    held: String,
}

impl CiteRewriter {
    /// Rewrites `chunk`; `cite` numbers a reference or refuses it.
    pub fn push(&mut self, chunk: &str, cite: &mut dyn FnMut(Ref) -> Option<u8>) -> String {
        let mut output = String::with_capacity(chunk.len());
        for character in chunk.chars() {
            if character == OPEN || character == CLOSE {
                continue;
            }
            if self.held.is_empty() {
                if character == '[' {
                    self.held.push(character);
                } else {
                    output.push(character);
                }
                continue;
            }
            if character == '[' || character == '\n' {
                output.push_str(&std::mem::take(&mut self.held));
                if character == '[' {
                    self.held.push(character);
                } else {
                    output.push(character);
                }
                continue;
            }
            self.held.push(character);
            if character == ']' {
                let held = std::mem::take(&mut self.held);
                match references(&held[1..held.len() - 1]) {
                    Some(list) => {
                        let mut last = None;
                        for reference in list {
                            if let Some(n) = cite(reference).filter(|n| Some(*n) != last) {
                                output.push(OPEN);
                                output.push_str(&n.to_string());
                                output.push(CLOSE);
                                last = Some(n);
                            }
                        }
                    }
                    None => output.push_str(&held),
                }
            } else if self.held.len() > MAX_HELD {
                output.push_str(&std::mem::take(&mut self.held));
            }
        }
        output
    }

    /// The reply ended: whatever is still held, as written.
    pub fn finish(&mut self) -> String {
        std::mem::take(&mut self.held)
    }
}

fn references(inner: &str) -> Option<Vec<Ref>> {
    let list: Option<Vec<Ref>> = inner
        .split(',')
        .map(|token| refs::parse(token.trim()))
        .collect();
    list.filter(|list| !list.is_empty())
}

/// Removes cite marks, for text replayed to the model.
pub fn strip_cites(text: &str) -> String {
    let mut output = String::with_capacity(text.len());
    let mut inside = false;
    for character in text.chars() {
        match character {
            OPEN => inside = true,
            CLOSE => inside = false,
            _ if !inside => output.push(character),
            _ => {}
        }
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    fn numbering(reference: Ref) -> Option<u8> {
        (reference.passage < 100).then(|| u8::try_from(reference.passage).unwrap())
    }

    fn run(chunks: &[&str]) -> String {
        let mut rewriter = CiteRewriter::default();
        let mut cite = numbering;
        let mut text: String = chunks.iter().map(|c| rewriter.push(c, &mut cite)).collect();
        text.push_str(&rewriter.finish());
        text
    }

    #[test]
    fn refs_become_marks_and_other_brackets_stay() {
        assert_eq!(run(&["Ships in May [a3]."]), "Ships in May ⟦3⟧.");
        assert_eq!(run(&["Two [a3, b7] here"]), "Two ⟦3⟧⟦7⟧ here");
        assert_eq!(run(&["Gone [a300] ok"]), "Gone  ok");
        assert_eq!(
            run(&["A [link](https://x.y) stays"]),
            "A [link](https://x.y) stays"
        );
        assert_eq!(run(&["[x] and [ a2 ]"]), "[x] and ⟦2⟧");
        assert_eq!(run(&["same [a2][a2]"]), "same ⟦2⟧⟦2⟧");
        assert_eq!(run(&["no forged ⟦9⟧ marks"]), "no forged 9 marks");
    }

    #[test]
    fn a_bracket_split_across_chunks_is_held_until_it_closes() {
        let mut rewriter = CiteRewriter::default();
        let mut cite = numbering;
        assert_eq!(rewriter.push("Price [", &mut cite), "Price ");
        assert_eq!(rewriter.push("a1", &mut cite), "");
        assert_eq!(rewriter.push("2] next", &mut cite), "⟦12⟧ next");
        assert_eq!(rewriter.push("open [never", &mut cite), "open ");
        assert_eq!(rewriter.finish(), "[never");
    }

    #[test]
    fn long_or_broken_brackets_are_released() {
        let long = format!("[{}", "x".repeat(80));
        assert_eq!(run(&[&long]), long);
        assert_eq!(run(&["[a1\nnext"]), "[a1\nnext");
    }

    #[test]
    fn stripping_drops_marks_only() {
        assert_eq!(strip_cites("Ships ⟦1⟧ in May⟦12⟧."), "Ships  in May.");
    }

    proptest! {
        #[test]
        fn chunking_never_changes_the_result(text in "[a-c0-9 \\[\\],x\\n]{0,80}", cut in 0usize..80) {
            let cut = text.char_indices().map(|(i, _)| i).chain([text.len()]).nth(cut.min(text.chars().count())).unwrap();
            let (head, tail) = text.split_at(cut);
            prop_assert_eq!(run(&[head, tail]), run(&[&text]));
        }
    }
}
