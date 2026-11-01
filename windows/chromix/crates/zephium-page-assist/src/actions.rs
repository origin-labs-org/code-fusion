//! Light page steps the model may ask for, through the `act` tool. The
//! grammar is closed: a verb, a passage reference and, for typing and
//! choosing, a value. What each step may do is decided later by Rust from
//! the live control, never from these words.
use crate::refs::{self, Ref};

/// Most steps one call may run.
pub const MAX_STEPS: usize = 8;
/// Longest value a step may type or choose, in characters.
pub const MAX_VALUE_CHARS: usize = 256;

/// What a step does.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Verb {
    /// Press a button or link.
    Click,
    /// Type into a field.
    Fill,
    /// Choose an option.
    Select,
    /// Tick a checkbox.
    Check,
    /// Untick a checkbox.
    Uncheck,
    /// Bring a passage into view.
    Scroll,
    /// Open a collapsed section.
    Expand,
    /// Follow a link on the same site.
    Open,
    /// Press Return in a field, as a search box asks.
    Submit,
}

impl Verb {
    /// The verb a tool call names.
    pub fn parse(name: &str) -> Option<Self> {
        Some(match name.trim().to_ascii_lowercase().as_str() {
            "click" | "press" => Self::Click,
            "fill" | "type" => Self::Fill,
            "select" | "choose" => Self::Select,
            "check" => Self::Check,
            "uncheck" => Self::Uncheck,
            "scroll" => Self::Scroll,
            "expand" => Self::Expand,
            "open" => Self::Open,
            "submit" | "enter" | "return" => Self::Submit,
            _ => return None,
        })
    }
}

/// Where a scroll goes when it names no passage.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Direction {
    /// One screen up.
    Up,
    /// One screen down.
    Down,
}

/// One asked-for step.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Step {
    /// What it does.
    pub verb: Verb,
    /// The passage it acts on.
    pub target: Option<Ref>,
    /// A page scroll with no passage.
    pub direction: Option<Direction>,
    /// What to type or choose.
    pub value: Option<String>,
}

/// One step from a tool call's fields; anything outside the grammar is none.
pub fn step(verb: &str, target: Option<&str>, value: Option<&str>) -> Option<Step> {
    let verb = Verb::parse(verb)?;
    let value = value.filter(|value| !value.is_empty());
    if let Some(value) = value {
        if value.chars().any(char::is_control) || value.chars().count() > MAX_VALUE_CHARS {
            return None;
        }
    }
    if verb == Verb::Scroll {
        let direction = match target.map(|t| t.trim().to_ascii_lowercase()).as_deref() {
            Some("up") => Some(Direction::Up),
            Some("down") | None => Some(Direction::Down),
            _ => None,
        };
        if direction.is_some() {
            return Some(Step {
                verb,
                target: None,
                direction,
                value: None,
            });
        }
    }
    let target = refs::parse(target?)?;
    let value = match verb {
        Verb::Fill | Verb::Select => Some(value?.to_owned()),
        _ if value.is_none() => None,
        _ => return None,
    };
    Some(Step {
        verb,
        target: Some(target),
        direction: None,
        value,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(passage: u16) -> Option<Ref> {
        Some(Ref { read: 0, passage })
    }

    #[test]
    fn the_grammar_is_closed() {
        let fill = step("fill", Some("a3"), Some("Ada Lovelace")).unwrap();
        assert_eq!(
            (fill.verb, fill.target, fill.value.as_deref()),
            (Verb::Fill, at(3), Some("Ada Lovelace"))
        );
        assert_eq!(step("Press", Some("@a12"), None).unwrap().verb, Verb::Click);
        let down = step("scroll", None, None).unwrap();
        assert_eq!((down.target, down.direction), (None, Some(Direction::Down)));
        assert_eq!(
            step("scroll", Some("up"), None).unwrap().direction,
            Some(Direction::Up)
        );
        assert_eq!(
            step("scroll", Some("b7"), None).unwrap().target,
            Some(Ref {
                read: 1,
                passage: 7
            })
        );
        for (verb, target, value) in [
            ("click", None, None),
            ("click", Some("a0"), None),
            ("click", Some("#submit"), None),
            ("click", Some("a5"), Some("now")),
            ("fill", Some("a3"), None),
            ("fill", Some("a3"), Some("line\nbreak")),
            ("navigate", Some("https://evil.example"), None),
            ("eval", Some("a1"), None),
            ("delete", Some("a1"), None),
        ] {
            assert_eq!(
                step(verb, target, value),
                None,
                "{verb} {target:?} {value:?}"
            );
        }
        let long = "a".repeat(MAX_VALUE_CHARS + 1);
        assert_eq!(step("fill", Some("a1"), Some(&long)), None);
    }
}
