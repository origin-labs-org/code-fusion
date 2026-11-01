//! Bounded mechanical loading of an already observed collection.

use super::*;
use std::collections::BTreeSet;

const MAX_LOADING_STEPS: usize = 6;
const MAX_LOADING_MILLIS: u64 = 8_000;

/// Why loading more of a listing stopped, as a closed fact.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ListingStop {
    /// The page held as many records as were asked for.
    Enough,
    /// The page showed no more records, or none it could count.
    Exhausted,
    /// Its time or action budget ran out.
    Budget,
    /// A human check, a wall or private content was on the page.
    Guarded,
    /// The page had no load-more control and nothing to scroll.
    NoControl,
    /// The step did not change the page.
    Unchanged,
    /// This task does not load listings.
    Off,
}

#[derive(Default)]
struct ListingProgress {
    identities: BTreeSet<[u8; 32]>,
    unchanged: u8,
}

impl ListingProgress {
    /// Why loading should stop after this census, if it should.
    fn observe(&mut self, census: &NativeListingCensus, requested: usize) -> Option<ListingStop> {
        let previous = self.identities.len();
        self.identities.extend(census.identities.iter().copied());
        self.unchanged = if self.identities.len() == previous {
            self.unchanged.saturating_add(1)
        } else {
            0
        };
        if self.identities.len() >= requested {
            Some(ListingStop::Enough)
        } else if census.limited || census.identities.is_empty() || self.unchanged >= 2 {
            Some(ListingStop::Exhausted)
        } else {
            None
        }
    }
}

impl AgentWorkController {
    pub(super) fn preserves_listing_view(
        kind: SemanticActionKind,
        target: Option<SemanticReferenceId>,
        observation: &SemanticObservation,
    ) -> bool {
        if kind == SemanticActionKind::Scroll {
            return true;
        }
        if kind != SemanticActionKind::Click {
            return false;
        }
        let census = native_listing_census(observation);
        if observation
            .frames()
            .iter()
            .flat_map(|frame| frame.nodes())
            .any(|node| {
                Some(node.reference()) == target
                    && node
                        .link_destination()
                        .is_some_and(|link| census.contains_record_link(link))
            })
        {
            return true;
        }
        match census.continuation {
            Some(
                NativeListingContinuation::LoadMore(next)
                | NativeListingContinuation::NextPage(next),
            ) => target == Some(next),
            None => false,
        }
    }

    pub(super) async fn load_listing(
        state: &mut WorkState,
        worker: &mut AgentRuntimeWorker,
        browser: &WorkBrowser<'_>,
        mut observation: SemanticObservation,
    ) -> Result<SemanticObservation, AgentWorkFailure> {
        let Some(requested) = state
            .extraction_schema
            .as_ref()
            .filter(|schema| schema.is_row_collection())
            .and_then(|schema| schema.fields().first())
            .and_then(SemanticExtractionFieldSchema::max_list_items)
            .filter(|count| *count > 1)
        else {
            return Ok(observation);
        };
        // Historical observations must remain available to the one later mapping.
        // A task without that capability keeps its ordinary observation path.
        if !state.actions_before_extraction
            || !(state.progressive_observation || state.navigation_discovery.is_some())
        {
            state
                .journal_mut()?
                .emit(AgentWorkEventKind::ListingLoaded {
                    steps: 0,
                    records: 0,
                    stop: ListingStop::Off,
                })?;
            return Ok(observation);
        }
        let started = Instant::now();
        if observation
            .frames()
            .first()
            .and_then(|frame| frame.nodes().first())
            .is_some_and(|node| node.role() != SemanticRole::Document)
        {
            state.native.check_control(worker, browser)?;
            state.refresh_account(worker, browser)?;
            observation = Box::pin(Self::observe(state, worker, browser)).await?;
        }
        let mut progress = ListingProgress::default();
        let mut steps = 0u8;
        let stop = loop {
            if usize::from(steps) >= MAX_LOADING_STEPS {
                break ListingStop::Budget;
            }
            state.check_task_contract()?;
            state.native.check_control(worker, browser)?;
            let session = state.session.as_ref().ok_or_else(|| crate::contract!())?;
            if started.elapsed() >= Duration::from_millis(MAX_LOADING_MILLIS)
                || session.next_action > session.max_actions
                || session.turns.saturating_add(1) >= session.max_model_calls
            {
                break ListingStop::Budget;
            }
            if state.task.human_wall(&observation).is_some()
                || looks_like_human_challenge(&observation)
                || observation
                    .frames()
                    .iter()
                    .flat_map(|frame| frame.nodes())
                    .any(|node| node.sensitivity() != SemanticSensitivity::Public)
            {
                break ListingStop::Guarded;
            }
            let census = native_listing_census(&observation);
            if let Some(stop) = progress.observe(&census, requested) {
                break stop;
            }
            // Loading more is a courtesy before the read: a step the action
            // contract refuses ends the loading, never the read.
            let Some(recipe) = load_more(&census) else {
                break ListingStop::NoControl;
            };
            let Some(next) = Box::pin(Self::code_owned_read(
                state,
                worker,
                browser,
                &observation,
                recipe,
            ))
            .await?
            else {
                break ListingStop::Unchanged;
            };
            steps += 1;
            observation = next;
        };
        // The read is accepted against the look the task judged last.
        if steps > 0 {
            state.task_progress(&observation)?;
        }
        state
            .journal_mut()?
            .emit(AgentWorkEventKind::ListingLoaded {
                steps,
                records: u16::try_from(progress.identities.len()).unwrap_or(u16::MAX),
                stop,
            })?;
        Ok(observation)
    }
}

/// The next step that shows more of a listing: its own load-more or next
/// control, else a page of scroll.
fn load_more(census: &NativeListingCensus) -> Option<SemanticActionProposal> {
    let (intent, wait, verification) = match census.continuation {
        Some(
            NativeListingContinuation::LoadMore(target)
            | NativeListingContinuation::NextPage(target),
        ) => (
            SemanticActionIntent::Click { target },
            SemanticWaitCondition::MutationQuiet(SemanticMutationQuietPeriod::try_new(250).ok()?),
            SemanticVerification::PageChanged,
        ),
        None => (
            SemanticActionIntent::Scroll {
                target: census.scroll?,
                direction: SemanticScrollDirection::Down,
                amount: SemanticScrollAmount::Page,
            },
            // The one wait both a scroll's contract and an owned binding admit.
            SemanticWaitCondition::Immediate,
            SemanticVerification::ScrollPositionChanged,
        ),
    };
    SemanticActionProposal::try_new(
        intent,
        SemanticEffectClass::Read,
        wait,
        verification,
        SemanticSettleBudget::try_new(MIN_AGENT_BROWSER_SNAPSHOT_SETTLE_MILLIS).ok()?,
    )
    .ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn census(ids: &[u8]) -> NativeListingCensus {
        NativeListingCensus {
            identities: ids.iter().map(|id| [*id; 32]).collect(),
            scroll: None,
            continuation: None,
            limited: false,
        }
    }

    #[test]
    fn loading_more_of_a_listing_is_an_action_the_contract_admits() {
        let target = SemanticReferenceId::new(3).unwrap();
        let mut scroll = census(&[1]);
        scroll.scroll = Some(target);
        let owned = |recipe: SemanticActionProposal| {
            matches!(
                recipe.wait(),
                SemanticWaitCondition::Immediate | SemanticWaitCondition::MutationQuiet(_)
            )
        };
        assert!(load_more(&scroll).is_some_and(owned), "a page of scroll");
        let mut more = census(&[1]);
        more.continuation = Some(NativeListingContinuation::LoadMore(target));
        assert!(load_more(&more).is_some_and(owned), "a load-more control");
        assert!(load_more(&census(&[1])).is_none());
    }

    #[cfg(feature = "probe-harness")]
    #[test]
    fn listing_preparation_resets_evidence_but_scroll_pagination_and_item_navigation_preserve_it() {
        let (_, source) = super::super::super::tests::browser_fixture();
        let frame = &source.frames()[0];
        let wire = br#"{"v":1,"i":1,"g":1,"c":"complete","n":[
            {"k":1,"r":"document","o":16},
            {"k":2,"p":0,"r":"group"},{"k":3,"p":1,"r":"heading","l":2,"n":"One"},
            {"k":4,"p":1,"r":"link","n":"One","u":"https://fixture.example.test/one","o":1},
            {"k":5,"p":0,"r":"group"},{"k":6,"p":4,"r":"heading","l":2,"n":"Two"},
            {"k":7,"p":4,"r":"link","n":"Two","u":"https://fixture.example.test/two","o":1},
            {"k":8,"p":0,"r":"button","n":"Load more","o":1},
            {"k":9,"p":0,"r":"button","n":"Price ascending","o":1}
        ]}"#;
        let snapshot = decode_semantic_snapshot(
            SemanticDecodeContext::new(
                frame.invocation(),
                frame.frame().clone(),
                frame.generation(),
            ),
            wire,
        )
        .unwrap();
        let look = SemanticObservationAssembler::new(source.request().clone(), snapshot)
            .unwrap()
            .finish()
            .unwrap();
        let keeps = |kind, target| {
            AgentWorkController::preserves_listing_view(
                kind,
                Some(SemanticReferenceId::new(target).unwrap()),
                &look,
            )
        };
        assert!(keeps(SemanticActionKind::Scroll, 1));
        assert!(keeps(SemanticActionKind::Click, 8));
        assert!(keeps(SemanticActionKind::Click, 4));
        assert!(!keeps(SemanticActionKind::Click, 9));
        assert!(!keeps(SemanticActionKind::Fill, 9));
        assert!(!keeps(SemanticActionKind::Select, 9));
    }

    #[test]
    fn virtualized_records_count_once_across_looks_and_loading_stops_at_the_bound() {
        let mut progress = ListingProgress::default();
        assert!(progress.observe(&census(&[1, 2]), 4).is_none());
        assert!(progress.observe(&census(&[2, 3]), 4).is_none());
        assert!(progress.observe(&census(&[3, 4]), 4).is_some());
        assert_eq!(progress.identities.len(), 4);
    }

    #[test]
    fn repeated_candidates_stop_loading_without_claiming_the_requested_count() {
        let mut progress = ListingProgress::default();
        assert!(progress.observe(&census(&[1, 2]), 3).is_none());
        assert!(progress.observe(&census(&[1, 2]), 3).is_none());
        assert!(progress.observe(&census(&[2, 1]), 3).is_some());
        assert_eq!(progress.identities.len(), 2);
    }

    #[test]
    fn no_collection_or_structural_limit_cannot_trigger_loading() {
        assert!(ListingProgress::default()
            .observe(&census(&[]), 3)
            .is_some());
        let mut limited = census(&[1, 2]);
        limited.limited = true;
        assert!(ListingProgress::default().observe(&limited, 3).is_some());
    }
}
