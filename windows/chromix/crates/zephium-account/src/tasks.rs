//! Which Work task or feature made each hosted call, kept only on this
//! computer. The service sees request ids and accounting, never a task: this
//! map is how the usage history can group calls by task without telling it.

use std::collections::VecDeque;

use serde::{Deserialize, Serialize};

/// Enough for weeks of use; older calls simply show ungrouped.
const MAX_ENTRIES: usize = 400;
const MAX_FIELD_BYTES: usize = 64;

/// What a hosted call was made for.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CallSource {
    /// One Work task, in the profile that owns it.
    Task {
        profile: String,
        work: String,
    },
    Voice,
    /// The Ask panel; which page is never kept.
    Page,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct Entry {
    id: String,
    #[serde(flatten)]
    source: CallSource,
}

#[derive(Debug, Default)]
pub(crate) struct Ledger {
    entries: VecDeque<Entry>,
}

fn plain(text: &str) -> bool {
    (1..=MAX_FIELD_BYTES).contains(&text.len())
        && text
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn valid(id: &str, source: &CallSource) -> bool {
    plain(id)
        && match source {
            CallSource::Task { profile, work } => plain(profile) && plain(work),
            CallSource::Voice | CallSource::Page => true,
        }
}

impl Ledger {
    /// Reads a stored ledger; anything unreadable or malformed is dropped.
    pub(crate) fn load(text: Option<&str>) -> Self {
        let stored: Vec<serde_json::Value> = text
            .and_then(|text| serde_json::from_str(text).ok())
            .unwrap_or_default();
        let mut entries: VecDeque<Entry> = stored
            .into_iter()
            .filter_map(|value| serde_json::from_value::<Entry>(value).ok())
            .filter(|entry| valid(&entry.id, &entry.source))
            .collect();
        while entries.len() > MAX_ENTRIES {
            entries.pop_front();
        }
        Self { entries }
    }

    /// Notes a call's source; true when the ledger changed.
    pub(crate) fn record(&mut self, id: &str, source: CallSource) -> bool {
        if !valid(id, &source) {
            return false;
        }
        if self
            .entries
            .iter()
            .any(|entry| entry.id == id && entry.source == source)
        {
            return false;
        }
        self.entries.retain(|entry| entry.id != id);
        self.entries.push_back(Entry {
            id: id.to_owned(),
            source,
        });
        while self.entries.len() > MAX_ENTRIES {
            self.entries.pop_front();
        }
        true
    }

    pub(crate) fn lookup(&self, ids: &[String]) -> Vec<Option<CallSource>> {
        ids.iter()
            .map(|id| {
                self.entries
                    .iter()
                    .rev()
                    .find(|entry| entry.id.eq_ignore_ascii_case(id))
                    .map(|entry| entry.source.clone())
            })
            .collect()
    }

    pub(crate) fn clear(&mut self) -> bool {
        let had = !self.entries.is_empty();
        self.entries.clear();
        had
    }

    pub(crate) fn text(&self) -> String {
        serde_json::to_string(&self.entries).unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn task(work: &str) -> CallSource {
        CallSource::Task {
            profile: "p1".into(),
            work: work.into(),
        }
    }

    #[test]
    fn calls_are_found_by_id_and_unknown_ones_stay_ungrouped() {
        let mut ledger = Ledger::default();
        assert!(ledger.record("a-1", task("w1")));
        assert!(ledger.record("a-2", CallSource::Voice));
        assert!(!ledger.record("a-1", task("w1")));
        assert_eq!(
            ledger.lookup(&["a-1".into(), "A-2".into(), "zz".into()]),
            vec![Some(task("w1")), Some(CallSource::Voice), None]
        );
    }

    #[test]
    fn the_ledger_is_bounded_and_keeps_the_newest() {
        let mut ledger = Ledger::default();
        for n in 0..(MAX_ENTRIES + 25) {
            ledger.record(&format!("r{n}"), task("w"));
        }
        let found = ledger.lookup(&["r0".into(), format!("r{}", MAX_ENTRIES + 24)]);
        assert_eq!(found, vec![None, Some(task("w"))]);
        assert_eq!(
            Ledger::load(Some(&ledger.text())).entries.len(),
            MAX_ENTRIES
        );
    }

    #[test]
    fn stored_text_round_trips_and_malformed_entries_are_dropped() {
        let mut ledger = Ledger::default();
        ledger.record("a-1", task("w1"));
        ledger.record("a-2", CallSource::Voice);
        let again = Ledger::load(Some(&ledger.text()));
        assert_eq!(
            again.lookup(&["a-1".into(), "a-2".into()]),
            vec![Some(task("w1")), Some(CallSource::Voice)]
        );
        let hostile = r#"[{"id":"../x","kind":"voice"},{"id":"ok","kind":"task","profile":"p","work":"w w"},{"id":"fine","kind":"voice"},{"nonsense":1}]"#;
        let loaded = Ledger::load(Some(hostile));
        assert_eq!(
            loaded.lookup(&["../x".into(), "ok".into(), "fine".into()]),
            vec![None, None, Some(CallSource::Voice)]
        );
        assert!(Ledger::load(Some("not json")).entries.is_empty());
        assert!(Ledger::load(None).entries.is_empty());
    }

    #[test]
    fn refusing_to_record_a_malformed_call_changes_nothing() {
        let mut ledger = Ledger::default();
        assert!(!ledger.record("", CallSource::Voice));
        assert!(!ledger.record("a b", CallSource::Voice));
        assert!(!ledger.clear());
    }
}
