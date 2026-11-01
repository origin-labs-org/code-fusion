//! Names for what the model may point at. Every page read in a reply gets a
//! letter (`a`, `b`, … `z`, `aa`, …) and each passage of it is that letter
//! and its number, so `b12` names passage 12 of the second read.

/// Most reads one conversation context names.
pub const MAX_READS: u16 = 26 * 27;

/// A passage of a named read.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct Ref {
    /// The read, 0 for `a`.
    pub read: u16,
    /// The passage within it.
    pub passage: u16,
}

/// The letters of read `index`; none past [`MAX_READS`].
pub fn letters(index: u16) -> Option<String> {
    if index >= MAX_READS {
        return None;
    }
    let letter = |n: u16| char::from(b'a' + u8::try_from(n).unwrap_or(0));
    Some(if index < 26 {
        letter(index).to_string()
    } else {
        let rest = index - 26;
        format!("{}{}", letter(rest / 26), letter(rest % 26))
    })
}

fn read_index(letters: &str) -> Option<u16> {
    let bytes = letters.as_bytes();
    let value = |byte: u8| byte.is_ascii_lowercase().then(|| u16::from(byte - b'a'));
    match bytes {
        [one] => value(*one),
        [first, second] => Some(26 + value(*first)? * 26 + value(*second)?),
        _ => None,
    }
}

/// Parses `b12` (or `@b12`); anything else is none.
pub fn parse(token: &str) -> Option<Ref> {
    let token = token.trim();
    let token = token.strip_prefix('@').unwrap_or(token);
    let split = token.find(|c: char| c.is_ascii_digit())?;
    let (letters, digits) = token.split_at(split);
    if digits.is_empty()
        || digits.len() > 5
        || (digits.len() > 1 && digits.starts_with('0'))
        || !digits.bytes().all(|byte| byte.is_ascii_digit())
    {
        return None;
    }
    Some(Ref {
        read: read_index(letters)?,
        passage: digits.parse::<u16>().ok().filter(|id| *id > 0)?,
    })
}

/// How the model writes `reference`.
pub fn render(reference: Ref) -> Option<String> {
    Some(format!("{}{}", letters(reference.read)?, reference.passage))
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    #[test]
    fn letters_count_like_columns() {
        assert_eq!(letters(0).as_deref(), Some("a"));
        assert_eq!(letters(25).as_deref(), Some("z"));
        assert_eq!(letters(26).as_deref(), Some("aa"));
        assert_eq!(letters(27).as_deref(), Some("ab"));
        assert_eq!(letters(MAX_READS - 1).as_deref(), Some("zz"));
        assert_eq!(letters(MAX_READS), None);
    }

    #[test]
    fn only_well_formed_refs_parse() {
        assert_eq!(
            parse("a12"),
            Some(Ref {
                read: 0,
                passage: 12
            })
        );
        assert_eq!(
            parse("@b3"),
            Some(Ref {
                read: 1,
                passage: 3
            })
        );
        assert_eq!(
            parse("ab1"),
            Some(Ref {
                read: 27,
                passage: 1
            })
        );
        for bad in [
            "", "a", "12", "a0", "a012", "A1", "abc1", "a1x", "a123456", "r-1",
        ] {
            assert_eq!(parse(bad), None, "{bad}");
        }
    }

    proptest! {
        #[test]
        fn render_and_parse_agree(read in 0u16..MAX_READS, passage in 1u16..u16::MAX) {
            let reference = Ref { read, passage };
            prop_assert_eq!(parse(&render(reference).unwrap()), Some(reference));
        }
    }
}
