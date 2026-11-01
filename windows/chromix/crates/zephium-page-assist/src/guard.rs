//! Cheap repairs of a validated stylesheet that the allow-list cannot see:
//! a rule that hides the page's main content or navigation, and text set on
//! a background it cannot be read against. The validator stays the hard gate;
//! this only removes or corrects what a model got wrong while following the
//! instructions, so a small model's redesign still lands usable.
use crate::css::{self, Validated};
use crate::outline::{Outline, OutlineKind, OutlineNode, Rgb};

/// Least contrast between a rule's own text and background colours.
pub const MIN_CONTRAST: f32 = 4.5;

const DARK_TEXT: Rgb = Rgb(17, 17, 17);
const LIGHT_TEXT: Rgb = Rgb(245, 245, 247);

/// Tags whose rules always reach the page's primary content or its way around.
const PROTECTED_TAGS: &[&str] = &["html", "body", "main", "article", "nav"];

/// A stylesheet after the checks.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Guarded {
    /// Canonical CSS, validated again.
    pub css: String,
    /// Style rules kept.
    pub rules: u16,
    /// Declarations removed because they hide protected regions.
    pub hiding_removed: u16,
    /// Text colours replaced because they could not be read on their background.
    pub contrast_repaired: u16,
}

/// Removes declarations that hide the main content or navigation, and
/// corrects unreadable text colours. Without an outline the generic
/// landmarks are still protected. `None` when nothing is left to apply.
pub fn guard(validated: &Validated, outline: Option<&Outline>) -> Option<Guarded> {
    let protected_nodes: Vec<&OutlineNode> = outline
        .map(|outline| {
            outline
                .nodes
                .iter()
                .filter(|node| {
                    node.kind.is_primary() || matches!(node.kind, OutlineKind::Navigation)
                })
                .collect()
        })
        .unwrap_or_default();
    let mut text = String::with_capacity(validated.css.len());
    let mut hiding_removed = 0u16;
    let mut contrast_repaired = 0u16;
    for line in validated.css.lines() {
        match rewrite(line, &protected_nodes) {
            Line::Keep => {
                text.push_str(line);
                text.push('\n');
            }
            Line::Rewritten {
                rule,
                hiding,
                contrast,
            } => {
                hiding_removed = hiding_removed.saturating_add(hiding);
                contrast_repaired = contrast_repaired.saturating_add(contrast);
                if let Some(rule) = rule {
                    text.push_str(&rule);
                    text.push('\n');
                }
            }
        }
    }
    if hiding_removed == 0 && contrast_repaired == 0 {
        return Some(Guarded {
            css: validated.css.clone(),
            rules: validated.rules,
            hiding_removed,
            contrast_repaired,
        });
    }
    // An emptied @media block fails validation as Empty only when nothing
    // else survived; otherwise it is simply dropped by the validator.
    let again = css::validate(&text).ok()?;
    Some(Guarded {
        css: again.css,
        rules: again.rules,
        hiding_removed,
        contrast_repaired,
    })
}

enum Line {
    Keep,
    Rewritten {
        rule: Option<String>,
        hiding: u16,
        contrast: u16,
    },
}

fn rewrite(line: &str, protected: &[&OutlineNode]) -> Line {
    // Wrappers and anything quoted are left to the validator's own output.
    if line.starts_with('@') || line == "}" || line.contains('"') {
        return Line::Keep;
    }
    let Some((selectors, rest)) = line.split_once('{') else {
        return Line::Keep;
    };
    let Some(body) = rest.strip_suffix('}') else {
        return Line::Keep;
    };
    let protects = selectors
        .split(',')
        .any(|selector| targets_protected(selector.trim(), protected));
    let mut declarations: Vec<(String, String, bool)> = body
        .split(';')
        .filter(|declaration| !declaration.is_empty())
        .filter_map(|declaration| {
            let (property, value) = declaration.split_once(':')?;
            let (value, important) = match value.strip_suffix("!important") {
                Some(value) => (value, true),
                None => (value, false),
            };
            Some((property.to_owned(), value.to_owned(), important))
        })
        .collect();
    let before = declarations.len();
    let mut hiding = 0u16;
    if protects {
        declarations.retain(|(property, value, _)| {
            let hides = hides(property, value);
            if hides {
                hiding += 1;
            }
            !hides
        });
    }
    let mut contrast = 0u16;
    let background = declarations
        .iter()
        .find(|(property, ..)| property == "background-color" || property == "background")
        .and_then(|(_, value, _)| hex(value));
    if let Some(background) = background {
        for (property, value, _) in &mut declarations {
            if property != "color" {
                continue;
            }
            let Some(text) = hex(value) else { continue };
            if text.contrast(background) < MIN_CONTRAST {
                let best = [DARK_TEXT, LIGHT_TEXT]
                    .into_iter()
                    .max_by(|a, b| a.contrast(background).total_cmp(&b.contrast(background)))
                    .unwrap_or(DARK_TEXT);
                *value = best.hex();
                contrast += 1;
            }
        }
    }
    if hiding == 0 && contrast == 0 && declarations.len() == before {
        return Line::Keep;
    }
    let rule = (!declarations.is_empty()).then(|| {
        let body: Vec<String> = declarations
            .iter()
            .map(|(property, value, important)| {
                format!(
                    "{property}:{value}{}",
                    if *important { "!important" } else { "" }
                )
            })
            .collect();
        format!("{selectors}{{{}}}", body.join(";"))
    });
    Line::Rewritten {
        rule,
        hiding,
        contrast,
    }
}

fn hex(value: &str) -> Option<Rgb> {
    let digits = value.trim().strip_prefix('#')?;
    if !digits.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let pair = |at: usize| u8::from_str_radix(&digits[at..at + 2], 16).ok();
    let single = |at: usize| {
        u8::from_str_radix(&digits[at..=at], 16)
            .ok()
            .map(|n| n * 17)
    };
    match digits.len() {
        3 => Some(Rgb(single(0)?, single(1)?, single(2)?)),
        6 => Some(Rgb(pair(0)?, pair(2)?, pair(4)?)),
        _ => None,
    }
}

fn hides(property: &str, value: &str) -> bool {
    let value = value.trim();
    match property {
        "display" => value == "none",
        "visibility" => matches!(value, "hidden" | "collapse"),
        "opacity" => value
            .strip_suffix('%')
            .map_or_else(
                || value.parse::<f32>().ok(),
                |percent| percent.parse::<f32>().ok().map(|p| p / 100.0),
            )
            .is_some_and(|opacity| opacity <= 0.1),
        "color" => value == "transparent",
        "font-size" | "width" | "max-width" | "height" | "max-height" => {
            let number = value.trim_end_matches(|c: char| c.is_ascii_alphabetic() || c == '%');
            number.parse::<f32>().is_ok_and(|n| n == 0.0)
        }
        _ => false,
    }
}

/// Whether a (possibly compound) selector's rightmost compound reaches a
/// protected landmark or any protected outline node.
fn targets_protected(selector: &str, nodes: &[&OutlineNode]) -> bool {
    let compound = selector
        .rsplit([' ', '>', '+', '~'])
        .find(|part| !part.is_empty())
        .unwrap_or(selector);
    let structural = compound.split([':', '[']).next().unwrap_or(compound);
    if structural == "*" {
        return true;
    }
    let (tag, id, classes) = parts(structural);
    if id.is_none() && classes.is_empty() && tag.is_some_and(|t| PROTECTED_TAGS.contains(&t)) {
        return true;
    }
    if tag.is_none() && id.is_none() && classes.is_empty() {
        return false;
    }
    nodes.iter().any(|node| {
        let (node_tag, node_id, node_classes) = parts(&node.selector);
        tag.is_none_or(|tag| node_tag == Some(tag))
            && id.is_none_or(|id| node_id == Some(id))
            && classes.iter().all(|class| node_classes.contains(class))
    })
}

/// Splits a plain `tag#id.class` compound.
fn parts(compound: &str) -> (Option<&str>, Option<&str>, Vec<&str>) {
    let tag_end = compound.find(['#', '.']).unwrap_or(compound.len());
    let tag = (tag_end > 0).then(|| &compound[..tag_end]);
    let mut id = None;
    let mut classes = Vec::new();
    let mut rest = &compound[tag_end..];
    while !rest.is_empty() {
        let marker = &rest[..1];
        let end = rest[1..].find(['#', '.']).map_or(rest.len(), |at| at + 1);
        let name = &rest[1..end];
        if marker == "#" {
            id = Some(name);
        } else {
            classes.push(name);
        }
        rest = &rest[end..];
    }
    (tag, id, classes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn outline() -> Outline {
        let node = |selector: &str, kind| OutlineNode {
            selector: selector.into(),
            kind,
            count: 1,
            background: None,
            color: None,
            font_size_px: None,
        };
        Outline {
            nodes: vec![
                node("div#mw-content-text.mw-body-content", OutlineKind::Article),
                node("nav#mw-panel", OutlineKind::Navigation),
                node("div#footer", OutlineKind::Footer),
            ],
            background: None,
            text: None,
            link: None,
            accent: None,
            fonts: Vec::new(),
            dark: false,
        }
    }

    fn run(input: &str, outline: Option<&Outline>) -> Option<Guarded> {
        guard(&css::validate(input).unwrap(), outline)
    }

    #[test]
    fn hiding_the_main_content_or_navigation_is_removed() {
        let outline = outline();
        let guarded = run(
            "#mw-content-text{display:none;color:#222}\nnav#mw-panel{visibility:hidden}\n.mw-body-content{opacity:0}\nbody{display:none}\n#footer{display:none}",
            Some(&outline),
        )
        .unwrap();
        assert_eq!(guarded.hiding_removed, 4);
        assert!(guarded.css.contains("#mw-content-text{color:#222}"));
        assert!(!guarded.css.contains("nav#mw-panel"));
        assert!(!guarded.css.contains("body{"));
        assert!(
            guarded.css.contains("#footer{display:none}"),
            "a footer may go"
        );
    }

    #[test]
    fn landmarks_are_protected_without_an_outline() {
        let guarded = run(
            "main{display:none}\nbody > nav{display:none}\nh1{color:#111}",
            None,
        )
        .unwrap();
        assert_eq!(guarded.hiding_removed, 2);
        assert_eq!(guarded.rules, 1);
        assert!(guarded.css.starts_with("h1{"));
        assert!(run("main{display:none}", None).is_none());
        assert!(run("*{opacity:0}", None).is_none());
    }

    #[test]
    fn unreadable_text_is_corrected_not_refused() {
        let guarded = run(
            "article{background-color:#fff;color:#bbb}\nbody{background:#0b0b0d;color:#222!important}\np{color:#444}",
            None,
        )
        .unwrap();
        assert_eq!(guarded.contrast_repaired, 2);
        assert!(guarded
            .css
            .contains("article{background-color:#fff;color:#111111}"));
        assert!(guarded.css.contains("color:#f5f5f7!important"));
        assert!(guarded.css.contains("p{color:#444}"));
    }

    #[test]
    fn good_output_passes_through_untouched() {
        let input = "body{background-color:#faf9f7;color:#1c1c1e;line-height:1.6}\nh1,h2{font-weight:650}\n@media (prefers-color-scheme: dark){\nbody{background-color:#141416;color:#ececf0}\n}";
        let validated = css::validate(input).unwrap();
        let guarded = guard(&validated, Some(&outline())).unwrap();
        assert_eq!(guarded.css, validated.css);
        assert_eq!(guarded.hiding_removed + guarded.contrast_repaired, 0);
    }

    #[test]
    fn media_blocks_are_guarded_too() {
        let guarded = run(
            "@media (max-width: 700px){\nmain{display:none}\np{margin:0}\n}",
            None,
        )
        .unwrap();
        assert!(!guarded.css.contains("main"));
        assert!(guarded.css.contains("p{margin:0}"));
    }
}
