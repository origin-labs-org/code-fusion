//! Dialogs a site lays over its own page unasked: a sign-in or newsletter
//! offer, an app or location prompt, a promotion. Each has its own close
//! control and the page stays behind it. Closing one commits nothing, so
//! Rust closes it before the page agent spends a call on it, and the person
//! is never asked to sign in because of one.
use super::*;

/// Names of a control that only closes the dialog it sits in.
const CLOSE: [&str; 22] = [
    "close",
    "close dialog",
    "close modal",
    "close window",
    "dismiss",
    "no thanks",
    "no thank you",
    "not now",
    "maybe later",
    "skip",
    "continue shopping",
    "got it",
    "x",
    "×",
    "zamknij",
    "nie teraz",
    "nie dziękuję",
    "schließen",
    "nein danke",
    "fermer",
    "cerrar",
    "chiudi",
];
/// A close control's name is short: "Close account" is not one.
const CLOSE_WORDS: usize = 4;
/// What a closing control must never also say.
const NOT_CLOSE: [&str; 12] = [
    "account",
    "delete",
    "remove",
    "cancel order",
    "cancel subscription",
    "unsubscribe",
    "pay",
    "buy",
    "order",
    "send",
    "konto",
    "usuń",
];
/// Nodes the page must keep outside the dialog for it to be an overlay on a
/// page rather than the page itself.
const PAGE_BEHIND: usize = 15;

fn words(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|ch: char| !(ch.is_alphanumeric() || ch == '×'))
        .filter(|word| !word.is_empty())
        .map(str::to_owned)
        .collect()
}

fn has_phrase(text: &[String], phrase: &str) -> bool {
    let phrase = words(phrase);
    !phrase.is_empty()
        && text
            .windows(phrase.len())
            .any(|window| window == phrase.as_slice())
}

fn label(node: &SemanticNode) -> String {
    let mut label = String::new();
    for part in node.name().into_iter().chain(node.text()) {
        label.push(' ');
        label.push_str(part.as_str());
    }
    label
}

/// A control that only closes what holds it, by its name alone.
fn closes(node: &SemanticNode) -> bool {
    if !matches!(node.role(), SemanticRole::Button | SemanticRole::Link)
        || (node.role() == SemanticRole::Link && node.link_destination().is_some())
    {
        return false;
    }
    let name = words(&label(node));
    !name.is_empty()
        && name.len() <= CLOSE_WORDS
        && CLOSE.iter().any(|phrase| has_phrase(&name, phrase))
        && !NOT_CLOSE.iter().any(|phrase| has_phrase(&name, phrase))
}

fn subtree_end(snapshot: &SemanticSnapshot, index: usize) -> usize {
    let depth = snapshot.nodes()[index].depth();
    snapshot
        .nodes()
        .iter()
        .enumerate()
        .skip(index + 1)
        .find(|(_, next)| next.depth() <= depth)
        .map_or(snapshot.nodes().len(), |(end, _)| end)
}

/// Each dialog that can be closed with a control of its own while the page
/// stays behind it: its node range and the index of that control.
pub(crate) fn dismissable(snapshot: &SemanticSnapshot) -> Vec<(std::ops::Range<usize>, usize)> {
    let nodes = snapshot.nodes();
    let mut found = Vec::new();
    let mut index = 0;
    while index < nodes.len() {
        if nodes[index].role() != SemanticRole::Dialog {
            index += 1;
            continue;
        }
        let end = subtree_end(snapshot, index);
        let close = (index + 1..end).find(|at| {
            let node = &nodes[*at];
            closes(node)
                && node.operations().contains(SemanticOperationClass::Click)
                && !node.states().contains(SemanticState::Disabled)
                && node.sensitivity() == SemanticSensitivity::Public
        });
        // A look rooted at the dialog itself was taken inside a focused modal
        // (Booking's sign-in offer): the page is behind it, out of the look.
        let modal_look = index == 0 && nodes[0].parent().is_none();
        if let Some(close) =
            close.filter(|_| modal_look || nodes.len() - (end - index) >= PAGE_BEHIND)
        {
            found.push((index..end, close));
        }
        index = end;
    }
    found
}

/// The close control Rust presses on a look the page agent has not acted on
/// yet: the first overlay with one that is on screen. A cookie banner is the
/// consent module's, which refuses rather than closes.
pub(crate) fn dismissal(observation: &SemanticObservation) -> Option<SemanticReferenceId> {
    let snapshot = observation.frames().first()?;
    dismissable(snapshot)
        .into_iter()
        .map(|(_, close)| &snapshot.nodes()[close])
        .find(|node| {
            node.geometry().is_some() && super::consent::banner_choice(node, snapshot).is_none()
        })
        .map(SemanticNode::reference)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn page(nodes: Vec<serde_json::Value>) -> SemanticObservation {
        super::super::tests::reading_observation(json!(nodes), "complete")
    }
    fn at(x: u32) -> serde_json::Value {
        json!({"x": x, "y": 200, "w": 40, "h": 32})
    }
    fn behind(nodes: &mut Vec<serde_json::Value>, from: usize) {
        nodes.extend((from..from + 20).map(|k| json!({"k":k,"p":0,"r":"paragraph","t":"Flights"})));
    }

    #[test]
    fn a_sign_in_offer_over_a_page_is_closed_and_a_page_alone_is_not() {
        let mut nodes = vec![
            json!({"k":1,"r":"document","o":16}),
            json!({"k":2,"p":0,"r":"button","n":"Zaloguj się","o":1,"ak":1,"b":at(900)}),
            json!({"k":3,"p":0,"r":"dialog","n":"Zaloguj się lub utwórz konto"}),
            json!({"k":4,"p":2,"r":"button","n":"Zamknij okno dialogowe","o":1,"ak":1,"b":at(600)}),
            json!({"k":5,"p":2,"r":"textbox","n":"Adres e-mail","o":2}),
            json!({"k":6,"p":2,"r":"button","n":"Dalej","o":1,"ak":1,"b":at(300)}),
        ];
        behind(&mut nodes, 7);
        let offer = page(nodes);
        let snapshot = &offer.frames()[0];
        assert_eq!(dismissal(&offer), Some(snapshot.nodes()[3].reference()));
        let offers = dismissable(snapshot);
        assert!(offers.len() == 1 && offers[0].0.contains(&4) && !offers[0].0.contains(&1));

        // The same dialog as the whole page is the page itself.
        let alone = page(vec![
            json!({"k":1,"r":"document","o":16}),
            json!({"k":2,"p":0,"r":"dialog","n":"Sign in"}),
            json!({"k":3,"p":1,"r":"button","n":"Close","o":1,"ak":1,"b":at(600)}),
            json!({"k":4,"p":1,"r":"textbox","n":"Email","o":2}),
        ]);
        assert_eq!(dismissal(&alone), None);
    }

    #[test]
    fn a_look_taken_inside_a_focused_modal_offer_is_closed() {
        let modal = page(vec![
            json!({"k":1,"r":"dialog","n":"Window offering discounts when you sign in"}),
            json!({"k":2,"p":0,"r":"button","n":"Dismiss sign-in info.","o":1,"ak":1,"b":at(600)}),
            json!({"k":3,"p":0,"r":"heading","n":"Sign in, save money","l":2}),
            json!({"k":4,"p":0,"r":"paragraph","t":"Sign in to save 10% or more"}),
        ]);
        assert_eq!(
            dismissal(&modal),
            Some(modal.frames()[0].nodes()[1].reference())
        );
    }

    #[test]
    fn only_a_short_closing_name_closes() {
        for (name, closing) in [
            ("Close", true),
            ("×", true),
            ("No thanks", true),
            ("Continue shopping", true),
            ("Change address", false),
            ("Close account", false),
            ("Close and delete my data", false),
            ("Close this window and continue to checkout now", false),
        ] {
            let mut nodes = vec![
                json!({"k":1,"r":"document","o":16}),
                json!({"k":2,"p":0,"r":"dialog"}),
                json!({"k":3,"p":1,"r":"button","n":name,"o":1,"ak":1,"b":at(600)}),
            ];
            behind(&mut nodes, 4);
            assert_eq!(dismissal(&page(nodes)).is_some(), closing, "{name}");
        }
    }
}
