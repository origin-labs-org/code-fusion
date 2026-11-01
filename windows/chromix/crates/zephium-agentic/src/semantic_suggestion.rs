//! Choices a page shows for what was just typed into a field: a listbox's
//! options, or the buttons of a list or calendar grid in a popup.
use crate::{
    SemanticNode, SemanticObservation, SemanticOperationClass, SemanticReferenceId, SemanticRole,
};

/// On-screen choices a typed field opened, in page order (Expedia's
/// airports in a popup list, Delta's listbox, a date picker's days).
pub fn semantic_typed_choices(look: &SemanticObservation) -> Vec<&SemanticNode> {
    let mut choices = Vec::new();
    for frame in look.frames() {
        let nodes = frame.nodes();
        let within = |node: &SemanticNode, roles: &[SemanticRole]| {
            let mut parent = node.parent();
            while let Some(index) = parent {
                let Some(ancestor) = nodes.get(usize::from(index)) else {
                    return false;
                };
                if roles.contains(&ancestor.role()) {
                    return true;
                }
                parent = ancestor.parent();
            }
            false
        };
        for node in nodes {
            let choice = node.geometry().is_some()
                && node.operations().contains(SemanticOperationClass::Click)
                && (node.role() == SemanticRole::Option
                    || (matches!(
                        node.role(),
                        SemanticRole::Button | SemanticRole::Link | SemanticRole::Cell
                    ) && (within(node, &[SemanticRole::Listbox])
                        || (within(node, &[SemanticRole::Dialog])
                            && within(node, &[SemanticRole::List, SemanticRole::Table])))));
            if choice {
                choices.push(node);
            }
        }
    }
    choices
}

/// Whether a picker or dropdown already shows this value in its own name
/// ("Origin, JFK, New York-Kennedy, NY" for JFK; "Trip Type, Round Trip").
pub fn semantic_shows_value(
    look: &SemanticObservation,
    control: SemanticReferenceId,
    value: &str,
) -> bool {
    let value = words(value);
    !value.is_empty()
        && look
            .frames()
            .iter()
            .flat_map(|frame| frame.nodes())
            .find(|node| node.reference() == control)
            .and_then(|node| node.name())
            .is_some_and(|name| {
                format!(" {} ", words(name.as_str())).contains(&format!(" {value} "))
            })
}

/// A picker value naming two days, "2026-11-10 - 2026-11-15" or "… to …",
/// split into its dates; any other value is itself.
pub fn semantic_picker_values(value: &str) -> Vec<String> {
    for separator in [" - ", " to ", " – ", " — "] {
        if let Some((from, to)) = value.split_once(separator) {
            if typed_date(from).is_some() && typed_date(to).is_some() {
                return vec![from.trim().to_owned(), to.trim().to_owned()];
            }
        }
    }
    vec![value.to_owned()]
}

/// The focused public text box a picker opened for typing.
pub fn semantic_focused_text_field(look: &SemanticObservation) -> Option<SemanticReferenceId> {
    look.frames()
        .iter()
        .flat_map(|frame| frame.nodes())
        .find(|node| {
            matches!(
                node.role(),
                SemanticRole::Textbox | SemanticRole::Searchbox | SemanticRole::Combobox
            ) && node.states().contains(crate::SemanticState::Focused)
                && node.geometry().is_some()
                && node.sensitivity() == crate::SemanticSensitivity::Public
                && node.operations().contains(SemanticOperationClass::Fill)
        })
        .map(SemanticNode::reference)
}

/// The one choice that clearly is what was typed: named exactly so, or the
/// only one led by it or holding it as a whole word ("JFK" in "New York
/// (JFK - John F. Kennedy Intl.)"). Several candidates are the model's to
/// choose between.
pub fn semantic_sole_choice(
    look: &SemanticObservation,
    typed: &str,
) -> Option<SemanticReferenceId> {
    if let Some(date) = typed_date(typed) {
        return sole_day(look, date);
    }
    let typed = words(typed);
    if typed.is_empty() || typed.chars().filter(|ch| ch.is_alphanumeric()).count() < 2 {
        return None;
    }
    let choices = semantic_typed_choices(look);
    let label =
        |node: &SemanticNode| words(node.name().or(node.text()).map_or("", |text| text.as_str()));
    let exact: Vec<_> = choices.iter().filter(|node| label(node) == typed).collect();
    if let [only] = exact.as_slice() {
        return Some(only.reference());
    }
    if !exact.is_empty() {
        return None;
    }
    let near: Vec<_> = choices
        .iter()
        .filter(|node| {
            let label = label(node);
            label.starts_with(&format!("{typed} "))
                || format!(" {label} ").contains(&format!(" {typed} "))
        })
        .collect();
    match near.as_slice() {
        [only] => Some(only.reference()),
        _ => None,
    }
}

const MONTHS: [&str; 12] = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
];

/// A typed calendar date as (year, month, day): 2026-11-10 or 11/10/2026.
fn typed_date(typed: &str) -> Option<(u32, usize, u32)> {
    let parts: Vec<u32> = typed
        .trim()
        .split(['-', '/', '.'])
        .map(|part| part.parse().ok())
        .collect::<Option<_>>()?;
    let (year, month, day) = match parts.as_slice() {
        [year, month, day] if *year > 999 => (*year, *month, *day),
        [month, day, year] if *year > 999 => (*year, *month, *day),
        _ => return None,
    };
    ((1..=12).contains(&month) && (1..=31).contains(&day)).then_some((year, month as usize, day))
}

/// The one calendar day whose label names this date: its day as a word,
/// and its month and year when the label says them.
fn sole_day(
    look: &SemanticObservation,
    (year, month, day): (u32, usize, u32),
) -> Option<SemanticReferenceId> {
    let month_name = MONTHS[month - 1];
    let days: Vec<_> = semantic_typed_choices(look)
        .into_iter()
        .filter(|node| {
            let label = words(node.name().or(node.text()).map_or("", |text| text.as_str()));
            let tokens: Vec<&str> = label.split(' ').collect();
            let names_year = tokens
                .iter()
                .any(|token| token.len() == 4 && token.parse::<u32>().is_ok());
            tokens.contains(&day.to_string().as_str())
                && tokens
                    .iter()
                    .any(|token| token.len() >= 3 && month_name.starts_with(token))
                && (!names_year || tokens.contains(&year.to_string().as_str()))
        })
        .collect();
    match days.as_slice() {
        [only] => Some(only.reference()),
        _ => None,
    }
}

fn words(text: &str) -> String {
    text.to_lowercase()
        .split(|ch: char| !ch.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}
