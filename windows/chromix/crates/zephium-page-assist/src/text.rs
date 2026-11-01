//! Display-safe text: no control, bidirectional-override or invisible
//! characters, collapsed whitespace, and bounds that cut at word edges.

/// Characters that could reorder or hide what the person reads.
fn invisible(character: char) -> bool {
    matches!(
        character,
        '\u{200B}'..='\u{200F}'
            | '\u{202A}'..='\u{202E}'
            | '\u{2060}'..='\u{2064}'
            | '\u{2066}'..='\u{2069}'
            | '\u{FEFF}'
            | '\u{FFF9}'..='\u{FFFB}'
    )
}

/// One line of text safe to show: controls and invisible characters removed,
/// runs of whitespace collapsed to one space, trimmed.
pub fn clean(text: &str) -> String {
    let mut output = String::with_capacity(text.len());
    let mut space = false;
    for character in text.chars() {
        if character.is_whitespace() || character.is_control() {
            space = !output.is_empty();
            continue;
        }
        if invisible(character)
            || character == crate::ipc::PAGE_ASSIST_CITE_OPEN
            || character == crate::ipc::PAGE_ASSIST_CITE_CLOSE
        {
            continue;
        }
        if space {
            output.push(' ');
            space = false;
        }
        output.push(character);
    }
    output
}

/// At most `limit` characters, cut at a word edge when one is near, with an
/// ellipsis when anything was cut.
pub fn bounded(text: &str, limit: usize) -> String {
    if text.chars().count() <= limit {
        return text.to_owned();
    }
    let keep = limit.saturating_sub(1);
    let end = text
        .char_indices()
        .nth(keep)
        .map_or(text.len(), |(index, _)| index);
    let head = &text[..end];
    let cut = head
        .rfind(char::is_whitespace)
        .filter(|space| *space >= end / 2)
        .unwrap_or(end);
    format!("{}…", head[..cut].trim_end())
}

/// A prefix of `text` at most `max_bytes` long, ending at a word edge when
/// possible, so it still matches the page verbatim.
pub fn verbatim_prefix(text: &str, max_bytes: usize) -> &str {
    if text.len() <= max_bytes {
        return text;
    }
    let mut end = max_bytes;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    let head = &text[..end];
    match head.rfind(char::is_whitespace) {
        Some(space) if space >= end / 2 => head[..space].trim_end(),
        _ => head,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_strips_controls_and_bidi_overrides() {
        for (input, expected) in [
            ("  plain  text ", "plain text"),
            ("line\nbreak\ttab", "line break tab"),
            ("evil\u{202E}txt.exe", "eviltxt.exe"),
            ("zero\u{200B}width", "zerowidth"),
            ("\u{7}bell", "bell"),
            ("", ""),
        ] {
            assert_eq!(clean(input), expected, "{input:?}");
        }
    }

    #[test]
    fn bounded_cuts_at_words_and_marks_the_cut() {
        assert_eq!(bounded("short", 10), "short");
        assert_eq!(bounded("one two three four", 10), "one two…");
        assert_eq!(bounded("abcdefghijklmnop", 6), "abcde…");
        assert!(bounded(&"é".repeat(200), 80).chars().count() <= 80);
    }

    #[test]
    fn verbatim_prefix_stays_a_prefix() {
        let text = "The quick brown fox jumps over the lazy dog";
        let prefix = verbatim_prefix(text, 20);
        assert!(text.starts_with(prefix));
        assert_eq!(prefix, "The quick brown fox");
        let wide = "ééééééééé";
        assert!(wide.starts_with(verbatim_prefix(wide, 5)));
    }
}
