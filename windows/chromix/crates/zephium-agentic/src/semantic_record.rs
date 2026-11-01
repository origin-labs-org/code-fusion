//! Conservative card boundaries derived from repeated native structure.
use crate::{semantic::SemanticNodeKey, SemanticRole, SemanticSnapshot};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Copy, Default, Eq, Ord, PartialEq, PartialOrd)]
struct Shape {
    image: bool,
    heading: bool,
}
#[derive(Clone, Copy, Default)]
enum Destination<'a> {
    #[default]
    None,
    One(&'a str),
    Many,
}
impl<'a> Destination<'a> {
    fn join(self, other: Self) -> Self {
        match (self, other) {
            (Self::None, value) | (value, Self::None) => value,
            (Self::One(left), Self::One(right)) if left == right => Self::One(left),
            _ => Self::Many,
        }
    }
}

// Only sibling containers with distinct, individually unambiguous destinations
// qualify. A whole section containing several products cannot become one card.
pub(crate) fn roots(snapshot: &SemanticSnapshot) -> Vec<Option<SemanticNodeKey>> {
    let nodes = snapshot.nodes();
    if nodes.len() > 2048 {
        return vec![None; nodes.len()];
    }
    let mut shape = vec![Shape::default(); nodes.len()];
    let mut destination = vec![Destination::None; nodes.len()];
    for (index, node) in nodes.iter().enumerate().rev() {
        shape[index].image |= node.role() == SemanticRole::Image && node.image_source().is_some();
        shape[index].heading |= node.role() == SemanticRole::Heading
            && (node.name().is_some() || node.text().is_some());
        if let Some(link) = node.link_destination() {
            destination[index] = destination[index].join(Destination::One(link.as_url().as_str()));
        }
        if let Some(parent) = node.parent().map(usize::from) {
            if parent >= index {
                return vec![None; nodes.len()];
            }
            shape[parent].image |= shape[index].image;
            shape[parent].heading |= shape[index].heading;
            destination[parent] = destination[parent].join(destination[index]);
        }
    }
    let mut siblings = BTreeMap::<(usize, Shape), Vec<(usize, &str)>>::new();
    let mut outside = vec![false; nodes.len()];
    for (index, node) in nodes.iter().enumerate() {
        outside[index] = node
            .parent()
            .is_some_and(|parent| outside[usize::from(parent)])
            || matches!(
                node.landmark_kind(),
                Some(
                    crate::SemanticLandmarkKind::Banner
                        | crate::SemanticLandmarkKind::Navigation
                        | crate::SemanticLandmarkKind::Search
                        | crate::SemanticLandmarkKind::Contentinfo
                )
            );
        if outside[index] {
            continue;
        }
        let (Some(parent), Destination::One(url)) = (node.parent(), destination[index]) else {
            continue;
        };
        if matches!(
            node.role(),
            SemanticRole::Group | SemanticRole::ListItem | SemanticRole::Row
        ) && (shape[index].image || shape[index].heading)
        {
            siblings
                .entry((usize::from(parent), shape[index]))
                .or_default()
                .push((index, url));
        }
    }
    let mut cards = BTreeSet::new();
    for candidates in siblings.values() {
        if candidates
            .iter()
            .map(|(_, url)| *url)
            .collect::<BTreeSet<_>>()
            .len()
            >= 2
        {
            cards.extend(candidates.iter().map(|(index, _)| *index));
        }
    }
    let mut roots = vec![None; nodes.len()];
    for (index, node) in nodes.iter().enumerate() {
        roots[index] = if cards.contains(&index) {
            Some(node.key())
        } else {
            node.parent()
                .and_then(|parent| roots.get(usize::from(parent)).copied())
                .flatten()
        };
    }
    roots
}
