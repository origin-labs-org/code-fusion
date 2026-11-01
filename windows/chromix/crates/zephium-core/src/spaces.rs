//! Spaces (workspaces) group items within a profile; switching spaces swaps
//! the visible item set and the theme.

use std::collections::HashMap;

use crate::ids::{ProfileId, SpaceId};

/// Curated symbols the frame draws by index, and the avatar hues shared with
/// profiles.
pub const SPACE_SYMBOLS: u8 = 20;
pub const SPACE_COLORS: u8 = crate::profiles::PROFILE_AVATAR_COLORS;
pub const MAX_SPACE_EMOJI_BYTES: usize = 32;
pub const MAX_SPACE_NAME_CHARS: usize = 48;
/// Spaces one profile may hold; the first nine have keys.
pub const MAX_PROFILE_SPACES: usize = 24;

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub enum SpaceIcon {
    Symbol(u8),
    Emoji(String),
}

/// A theme of the space's own: a preset id, or custom seeds stored in the
/// shape of `ui.theme-custom`.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub enum SpaceTheme {
    Preset(String),
    Custom(String),
}

#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SpaceLook {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<SpaceIcon>,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub color: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub theme: Option<SpaceTheme>,
}

fn is_zero(value: &u8) -> bool {
    *value == 0
}

fn emoji_allowed(value: &str) -> bool {
    let mut chars = value.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    value.len() <= MAX_SPACE_EMOJI_BYTES
        && value.chars().count() <= 10
        && value.chars().all(|c| !c.is_control() && !c.is_whitespace())
        && (!first.is_ascii() || value.contains('\u{20e3}'))
}

impl SpaceIcon {
    pub fn valid(&self) -> bool {
        match self {
            Self::Symbol(index) => *index < SPACE_SYMBOLS,
            Self::Emoji(text) => emoji_allowed(text),
        }
    }
}

impl SpaceTheme {
    pub fn valid(&self) -> bool {
        match self {
            Self::Preset(id) => crate::theme::preset(id).is_some(),
            Self::Custom(seeds) => crate::theme::parse_custom(seeds).is_some(),
        }
    }

    /// The `ui.theme` and `ui.theme-custom` values this theme stands in for.
    pub fn preference(&self) -> (&str, Option<&str>) {
        match self {
            Self::Preset(id) => (id, None),
            Self::Custom(seeds) => (crate::theme::CUSTOM, Some(seeds)),
        }
    }
}

impl SpaceLook {
    pub fn is_default(&self) -> bool {
        *self == Self::default()
    }

    pub fn valid(&self) -> bool {
        self.icon.as_ref().is_none_or(SpaceIcon::valid)
            && self.color < SPACE_COLORS
            && self.theme.as_ref().is_none_or(SpaceTheme::valid)
    }

    /// Restored data keeps whatever part of it still validates.
    pub fn sanitized(self) -> Self {
        Self {
            icon: self.icon.filter(SpaceIcon::valid),
            color: if self.color < SPACE_COLORS {
                self.color
            } else {
                0
            },
            theme: self.theme.filter(SpaceTheme::valid),
        }
    }
}

/// A name a person gave a space, trimmed and bounded, or nothing when blank.
pub fn space_name(name: &str) -> Option<String> {
    let name: String = crate::session::bounded_name(name.trim(), "")
        .trim()
        .chars()
        .take(MAX_SPACE_NAME_CHARS)
        .collect();
    let name = name.trim();
    (!name.is_empty()).then(|| name.to_owned())
}

#[derive(Clone, Debug)]
pub struct Space {
    pub id: SpaceId,
    pub profile: ProfileId,
    pub name: String,
    pub look: SpaceLook,
}

/// Unforgeable aggregate proof of the exact spaces removed for one profile.
/// `Items` consumes this proof so it never guesses ownership through a
/// missing/dangling `SpaceId`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RemovedProfileSpaces {
    profile: ProfileId,
    ids: Vec<SpaceId>,
}

impl RemovedProfileSpaces {
    pub fn profile(&self) -> ProfileId {
        self.profile
    }

    pub fn ids(&self) -> &[SpaceId] {
        &self.ids
    }
}

#[derive(Default)]
pub struct Spaces {
    order: Vec<SpaceId>,
    map: HashMap<SpaceId, Space>,
}

impl Spaces {
    pub fn insert(&mut self, space: Space) -> bool {
        if self.map.len() >= crate::session::MAX_SESSION_SPACES || self.map.contains_key(&space.id)
        {
            return false;
        }
        self.order.push(space.id);
        self.map.insert(space.id, space);
        true
    }

    pub fn get(&self, id: SpaceId) -> Option<&Space> {
        self.map.get(&id)
    }

    /// Removes only spaces whose stored ownership exactly matches `profile`.
    /// The returned proof preserves their aggregate order and can be passed to
    /// `Items::remove_for_profile`.
    pub fn remove_for_profile(&mut self, profile: ProfileId) -> RemovedProfileSpaces {
        let ids: Vec<SpaceId> = self
            .order
            .iter()
            .copied()
            .filter(|id| {
                self.map
                    .get(id)
                    .is_some_and(|space| space.profile == profile)
            })
            .collect();
        for id in &ids {
            self.map.remove(id);
        }
        self.order.retain(|id| !ids.contains(id));
        RemovedProfileSpaces { profile, ids }
    }

    pub fn iter(&self) -> impl Iterator<Item = &Space> {
        self.order.iter().filter_map(|id| self.map.get(id))
    }

    pub fn is_empty(&self) -> bool {
        self.order.is_empty()
    }

    pub fn first_for(&self, profile: ProfileId) -> Option<SpaceId> {
        self.iter().find(|s| s.profile == profile).map(|s| s.id)
    }

    /// The profile's spaces in the order the person keeps them.
    pub fn of(&self, profile: ProfileId) -> Vec<SpaceId> {
        self.iter()
            .filter(|space| space.profile == profile)
            .map(|space| space.id)
            .collect()
    }

    /// Adds a space for `profile` within both the profile's and the
    /// aggregate's bounds.
    pub fn create(&mut self, id: SpaceId, profile: ProfileId, name: &str, look: SpaceLook) -> bool {
        let Some(name) = space_name(name) else {
            return false;
        };
        look.valid()
            && self.of(profile).len() < MAX_PROFILE_SPACES
            && self.insert(Space {
                id,
                profile,
                name,
                look,
            })
    }

    pub fn update(&mut self, id: SpaceId, name: &str, look: SpaceLook) -> bool {
        let (Some(name), true) = (space_name(name), look.valid()) else {
            return false;
        };
        let Some(space) = self.map.get_mut(&id) else {
            return false;
        };
        if space.name == name && space.look == look {
            return false;
        }
        space.name = name;
        space.look = look;
        true
    }

    /// Moves `id` before `before` (or to the end of its profile's spaces).
    /// Spaces only reorder among their own profile's.
    pub fn reorder(&mut self, id: SpaceId, before: Option<SpaceId>) -> bool {
        let Some(profile) = self.get(id).map(|space| space.profile) else {
            return false;
        };
        if before == Some(id)
            || before.is_some_and(|other| self.get(other).is_none_or(|s| s.profile != profile))
        {
            return false;
        }
        let from = self.order.iter().position(|x| *x == id).expect("ordered");
        let mut next = self.order.clone();
        next.remove(from);
        let at = match before {
            Some(other) => next.iter().position(|x| *x == other).expect("ordered"),
            None => next
                .iter()
                .rposition(|x| self.map.get(x).is_some_and(|s| s.profile == profile))
                .map_or(next.len(), |last| last + 1),
        };
        next.insert(at, id);
        if next == self.order {
            return false;
        }
        self.order = next;
        true
    }

    /// Removes one space, never a profile's last.
    pub fn remove(&mut self, id: SpaceId) -> Option<Space> {
        let profile = self.get(id)?.profile;
        if self.of(profile).len() < 2 {
            return None;
        }
        self.order.retain(|x| *x != id);
        self.map.remove(&id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn space(id: u128, profile: u128) -> Space {
        Space {
            id: SpaceId::from(id),
            profile: ProfileId::from(profile),
            name: format!("Space {id}"),
            look: SpaceLook::default(),
        }
    }

    #[test]
    fn space_count_is_bounded_at_the_aggregate_boundary() {
        let mut spaces = Spaces::default();
        for value in 0..crate::session::MAX_SESSION_SPACES {
            assert!(spaces.insert(space(value as u128 + 1, 1)));
        }
        assert!(!spaces.insert(space(10_000, 1)));
    }

    #[test]
    fn remove_for_profile_returns_only_exact_owned_spaces() {
        let first = ProfileId::from(1);
        let mut spaces = Spaces::default();
        for (id, profile) in [(10, 1), (11, 2), (12, 1)] {
            assert!(spaces.insert(space(id, profile)));
        }

        let removed = spaces.remove_for_profile(first);
        assert_eq!(removed.profile(), first);
        assert_eq!(removed.ids(), &[SpaceId::from(10), SpaceId::from(12)]);
        assert_eq!(
            spaces.iter().map(|space| space.id).collect::<Vec<_>>(),
            vec![SpaceId::from(11)]
        );
        assert!(spaces.remove_for_profile(first).ids().is_empty());
    }

    #[test]
    fn create_names_bounds_and_validates_a_space() {
        let profile = ProfileId::from(1);
        let mut spaces = Spaces::default();
        assert!(!spaces.create(SpaceId::from(1), profile, "   ", SpaceLook::default()));
        let wrong = SpaceLook {
            color: SPACE_COLORS,
            ..SpaceLook::default()
        };
        assert!(!spaces.create(SpaceId::from(1), profile, "Work", wrong));
        let look = SpaceLook {
            icon: Some(SpaceIcon::Emoji("🚀".into())),
            color: 3,
            theme: Some(SpaceTheme::Preset("nord".into())),
        };
        assert!(spaces.create(SpaceId::from(1), profile, "  Work  ", look.clone()));
        let made = spaces.get(SpaceId::from(1)).unwrap();
        assert_eq!((made.name.as_str(), &made.look), ("Work", &look));
        for id in 2..=MAX_PROFILE_SPACES as u128 {
            assert!(spaces.create(SpaceId::from(id), profile, "S", SpaceLook::default()));
        }
        assert!(!spaces.create(SpaceId::from(99), profile, "S", SpaceLook::default()));
        assert!(spaces.create(
            SpaceId::from(100),
            ProfileId::from(2),
            "S",
            SpaceLook::default()
        ));
        let long = "x".repeat(200);
        assert!(spaces.update(SpaceId::from(100), &long, SpaceLook::default()));
        assert_eq!(
            spaces.get(SpaceId::from(100)).unwrap().name.chars().count(),
            MAX_SPACE_NAME_CHARS
        );
    }

    #[test]
    fn icons_and_themes_only_admit_what_the_frame_can_draw() {
        assert!(SpaceIcon::Symbol(SPACE_SYMBOLS - 1).valid());
        assert!(!SpaceIcon::Symbol(SPACE_SYMBOLS).valid());
        for emoji in ["🌿", "👩‍💻", "1️⃣", "🇯🇵"] {
            assert!(SpaceIcon::Emoji(emoji.into()).valid(), "{emoji}");
        }
        for text in ["", "a", "ab", " 🌿", "🌿\n", &"🌿".repeat(12)] {
            assert!(!SpaceIcon::Emoji(text.into()).valid(), "{text:?}");
        }
        assert!(SpaceTheme::Preset("nord".into()).valid());
        assert!(!SpaceTheme::Preset("nope".into()).valid());
        let seeds = r##"{"light":{"bg":"#ffffff","fg":"#000000","accent":"#123456"},"dark":{"bg":"#000000","fg":"#ffffff","accent":"#abcdef"}}"##;
        assert!(SpaceTheme::Custom(seeds.into()).valid());
        assert_eq!(
            SpaceTheme::Custom(seeds.into()).preference(),
            ("custom", Some(seeds))
        );
        assert!(!SpaceTheme::Custom("{}".into()).valid());
        let damaged = SpaceLook {
            icon: Some(SpaceIcon::Symbol(200)),
            color: 77,
            theme: Some(SpaceTheme::Preset("gone".into())),
        };
        assert!(damaged.sanitized().is_default());
    }

    #[test]
    fn reorder_moves_within_a_profile_and_keeps_others_in_place() {
        let mut spaces = Spaces::default();
        for (id, profile) in [(1, 1), (2, 2), (3, 1), (4, 1)] {
            assert!(spaces.insert(space(id, profile)));
        }
        let ids = |spaces: &Spaces| spaces.iter().map(|s| s.id).collect::<Vec<_>>();
        assert!(spaces.reorder(SpaceId::from(4), Some(SpaceId::from(1))));
        assert_eq!(ids(&spaces), [4, 1, 2, 3].map(SpaceId::from));
        assert!(spaces.reorder(SpaceId::from(4), None));
        assert_eq!(ids(&spaces), [1, 2, 3, 4].map(SpaceId::from));
        assert!(!spaces.reorder(SpaceId::from(4), None));
        assert!(!spaces.reorder(SpaceId::from(1), Some(SpaceId::from(2))));
        assert!(!spaces.reorder(SpaceId::from(1), Some(SpaceId::from(1))));
        assert_eq!(spaces.of(ProfileId::from(1)), [1, 3, 4].map(SpaceId::from));
    }

    #[test]
    fn a_profile_always_keeps_one_space() {
        let mut spaces = Spaces::default();
        for (id, profile) in [(1, 1), (2, 1), (3, 2)] {
            assert!(spaces.insert(space(id, profile)));
        }
        assert!(spaces.remove(SpaceId::from(3)).is_none());
        assert!(spaces.remove(SpaceId::from(1)).is_some());
        assert!(spaces.remove(SpaceId::from(2)).is_none());
        assert!(spaces.remove(SpaceId::from(9)).is_none());
        assert_eq!(spaces.of(ProfileId::from(1)), [SpaceId::from(2)]);
    }
}
