//! Provider search runs under the original admitted attempt, without a browser
//! lease or dependency disclosure. Provider citations remain provider evidence.
use crate::work_runtime::*;
use std::time::{Duration, Instant};
use zephium_core::work::{artifact::*, runtime::*, search::*, *};

/// One provider search outcome before publication. `record` is present only
/// for a validated, fully attributed success.
pub(crate) struct WorkSearchOutcome {
    pub(crate) status: WorkAttemptStatus,
    pub(crate) usage: Option<WorkUsage>,
    /// Why a decoded answer was not admitted; closed words for the step.
    pub(crate) note: Option<&'static str>,
    pub(crate) record: Option<WorkProviderSearchRecordV1>,
}

impl WorkAttemptProbe {
    /// An agent's search. A work's searches are remembered for a while: the
    /// same question, asked again or in other words by another part, a later
    /// turn or a follow-up, reuses the earlier answer instead of paying for
    /// another search. Jev judges "in other words": the two queries must ask
    /// the same, and the earlier answer must have found it. A search with
    /// context is never shared.
    pub(crate) async fn run_search(
        &self,
        provider: &dyn WorkPublicSearchProvider,
        scope: &WorkPublicSearchScope,
        context: &[context::WorkContextBody],
        limits: WorkExecutionLimits,
    ) -> Result<WorkSearchOutcome, WorkError> {
        self.run_search_from(provider, scope, context, Dispatch::Provider, limits)
            .await
    }

    /// A browser search over what its results page showed, `None` when the
    /// page could not be opened; reused and settled as any other search.
    pub(crate) async fn run_search_on_page(
        &self,
        provider: &dyn WorkPublicSearchProvider,
        scope: &WorkPublicSearchScope,
        page: Option<WorkSearchPage>,
        limits: WorkExecutionLimits,
    ) -> Result<WorkSearchOutcome, WorkError> {
        self.run_search_from(provider, scope, &[], Dispatch::Page(page), limits)
            .await
    }

    async fn run_search_from(
        &self,
        provider: &dyn WorkPublicSearchProvider,
        scope: &WorkPublicSearchScope,
        context: &[context::WorkContextBody],
        dispatch: Dispatch,
        limits: WorkExecutionLimits,
    ) -> Result<WorkSearchOutcome, WorkError> {
        // Several questions joined with ";" get one search's worth of answer
        // for the first of them: each is searched on its own instead.
        if scope
            .query
            .split(';')
            .filter(|part| zephium_agentic::SearchQueryTerms::of(part).words() >= 2)
            .count()
            >= 2
        {
            return Ok(WorkSearchOutcome {
                status: WorkAttemptStatus::Failed,
                usage: Some(WorkUsage::default()),
                note: Some("One question per search: search each part on its own"),
                record: None,
            });
        }
        let terms = zephium_agentic::SearchQueryTerms::of(&scope.query);
        if !context.is_empty()
            || terms.words() == 0
            || self.cancelled().await?
            || Instant::now() >= self.deadline()
        {
            return self
                .run_search_once(provider, scope, context, dispatch, limits)
                .await;
        }
        let started = Instant::now();
        let key = (self.profile(), self.work());
        let mut checked = Vec::new();
        let mut checks = WorkUsage::default();
        let mut waited = false;
        let slot = loop {
            if Instant::now() >= self.deadline() {
                return self
                    .run_search_once(provider, scope, context, dispatch, limits)
                    .await;
            }
            match shared::next(key, scope, &terms, &checked, checked.len() < REUSE_CHECKS) {
                shared::Next::Wait(mut running) => {
                    waited = true;
                    let _ = tokio::time::timeout_at(
                        self.deadline().into(),
                        running.wait_for(|done| *done),
                    )
                    .await;
                }
                shared::Next::Same(evidence) => {
                    if let Some(outcome) = self.reused(evidence, checks, limits) {
                        trace("same", checked.len(), waited, started);
                        return Ok(outcome);
                    }
                    break None;
                }
                shared::Next::Check(id, earlier, evidence) => {
                    checked.push(id);
                    let Some(remaining) = remaining(limits, checks) else {
                        break None;
                    };
                    let decided = self
                        .bounded_search(provider.reuse(
                            scope,
                            &earlier,
                            &evidence,
                            remaining,
                            self.deadline(),
                        ))
                        .await;
                    let answers = match decided {
                        Ok(reuse) => {
                            checks = add(checks, reuse.usage);
                            reuse.answers
                        }
                        Err(WorkPublicSearchError::Rejected(usage)) => {
                            checks = add(checks, usage);
                            false
                        }
                        Err(WorkPublicSearchError::NotDispatched(_)) => false,
                        Err(WorkPublicSearchError::OutcomeUnknown) => break None,
                    };
                    if answers {
                        if let Some(outcome) = self.reused(evidence, checks, limits) {
                            trace("similar", checked.len(), waited, started);
                            return Ok(outcome);
                        }
                    }
                }
                shared::Next::Run(slot) => break Some(slot),
            }
        };
        trace("none", checked.len(), waited, started);
        let Some(left) = remaining(limits, checks) else {
            return Ok(WorkSearchOutcome {
                status: WorkAttemptStatus::Failed,
                usage: Some(clamp(checks, limits)),
                note: Some("The search exceeded the step budget"),
                record: None,
            });
        };
        let mut outcome = self
            .run_search_once(provider, scope, context, dispatch, left)
            .await?;
        if let (Some(slot), Some(record)) = (slot, &outcome.record) {
            slot.known(record.evidence.clone());
        }
        // Every check this search paid for joins its ranking's usage, so the
        // record still accounts for exactly what the step spent.
        if checks.operations > 0 {
            outcome.usage = outcome.usage.map(|usage| add(usage, checks));
            if let Some(record) = &mut outcome.record {
                let ranking = record.ranking.take().unwrap_or_default();
                record.ranking = Some(WorkPublicSearchRanking {
                    usage: add(ranking.usage, checks),
                    preferred: ranking.preferred,
                });
            }
        }
        Ok(outcome)
    }

    /// An earlier answer as this step's own record: its tokens are the
    /// original search's (the record's attribution), its cost only the
    /// checks, carried as an empty ranking's usage.
    fn reused(
        &self,
        evidence: WorkProviderSearchEvidenceV1,
        checks: WorkUsage,
        limits: WorkExecutionLimits,
    ) -> Option<WorkSearchOutcome> {
        let ranking = (checks.operations > 0).then_some(WorkPublicSearchRanking {
            preferred: vec![],
            usage: checks,
        });
        let extra = ranking.as_ref().map(|r| r.usage).unwrap_or_default();
        let usage = WorkUsage {
            model_tokens: evidence
                .actual_input_tokens
                .checked_add(evidence.actual_output_tokens)?
                .checked_add(extra.model_tokens)?,
            cost_micro_usd: extra.cost_micro_usd,
            operations: extra.operations.checked_add(1)?,
            accounting: extra.accounting,
        };
        if !usage.within(limits) {
            return None;
        }
        self.record_activity(zephium_ipc::work::WorkActivityV1::Searching);
        Some(WorkSearchOutcome {
            status: WorkAttemptStatus::Succeeded,
            usage: Some(usage),
            note: None,
            record: Some(WorkProviderSearchRecordV1 {
                id: WorkArtifactId::generate(),
                node: self.node(),
                attempt: self.attempt(),
                evidence,
                ranking,
            }),
        })
    }

    /// The store answers a bounded number of reads at once; a busy store is a
    /// wait, not a refusal.
    async fn cancelled(&self) -> Result<bool, WorkError> {
        let mut delay = Duration::from_millis(25);
        loop {
            match self.cancellation_requested().await {
                Err(WorkError::Capacity) if Instant::now() + delay < self.deadline() => {
                    tokio::time::sleep(delay).await;
                    delay = (delay * 2).min(Duration::from_millis(400));
                }
                other => return other,
            }
        }
    }

    /// Dispatches exactly one bounded search and reads back the settled
    /// outcome. Cancellation and the attempt deadline yield unknown outcomes,
    /// never a refund.
    async fn run_search_once(
        &self,
        provider: &dyn WorkPublicSearchProvider,
        scope: &WorkPublicSearchScope,
        context: &[context::WorkContextBody],
        dispatch: Dispatch,
        limits: WorkExecutionLimits,
    ) -> Result<WorkSearchOutcome, WorkError> {
        if self.cancelled().await? || Instant::now() >= self.deadline() {
            return Ok(WorkSearchOutcome {
                status: WorkAttemptStatus::Cancelled,
                usage: Some(WorkUsage::default()),
                note: None,
                record: None,
            });
        }
        self.record_activity(zephium_ipc::work::WorkActivityV1::Searching);
        let result = match dispatch {
            Dispatch::Provider => {
                self.bounded_search(provider.search(scope, context, limits))
                    .await
            }
            Dispatch::Page(page) => {
                self.bounded_search(provider.search_page(scope, page, limits))
                    .await
            }
        };
        // A response that arrived is a known outcome: what it lacks is a
        // failed step with a reason. Only a lost outcome stays unknown.
        let failed = |usage: WorkUsage, note: &'static str| WorkSearchOutcome {
            status: WorkAttemptStatus::Failed,
            usage: Some(clamp(usage, limits)),
            note: Some(note),
            record: None,
        };
        Ok(match result {
            Ok(result) => {
                let refused = if !result.usage.within(limits) {
                    Some("The search exceeded the step budget")
                } else if result.evidence.validate().is_err() {
                    Some("The search results could not be admitted")
                } else if (result.evidence.provider, result.evidence.model.as_str())
                    != (scope.provider, scope.model.as_str())
                    && provider.fallback().is_none_or(|fallback| {
                        (fallback.provider, fallback.model.as_str())
                            != (result.evidence.provider, result.evidence.model.as_str())
                    })
                {
                    Some("The search came from another provider")
                } else if u64::from(result.usage.model_tokens)
                    != u64::from(result.evidence.actual_input_tokens)
                        + u64::from(result.evidence.actual_output_tokens)
                {
                    Some("The search usage did not reconcile")
                } else {
                    None
                };
                match refused {
                    None => {
                        let ranked = self
                            .rank_search(provider, scope, &result.evidence, result.usage, limits)
                            .await?;
                        match ranked {
                            Some((usage, ranking)) => WorkSearchOutcome {
                                status: WorkAttemptStatus::Succeeded,
                                usage: Some(usage),
                                note: None,
                                record: Some(WorkProviderSearchRecordV1 {
                                    id: WorkArtifactId::generate(),
                                    node: self.node(),
                                    attempt: self.attempt(),
                                    evidence: result.evidence,
                                    ranking,
                                }),
                            },
                            None => WorkSearchOutcome {
                                status: WorkAttemptStatus::OutcomeUnknown,
                                usage: None,
                                note: None,
                                record: None,
                            },
                        }
                    }
                    Some(note) => failed(result.usage, note),
                }
            }
            Err(WorkPublicSearchError::NotDispatched(cause)) => {
                crate::work_trace::record(format_args!(
                    "work: phase=search refused=not_sent cause={cause:?}"
                ));
                failed(WorkUsage::default(), "The search could not be sent")
            }
            Err(WorkPublicSearchError::Rejected(usage)) => {
                failed(usage, "The search gave no usable sources")
            }
            Err(WorkPublicSearchError::OutcomeUnknown) => WorkSearchOutcome {
                status: WorkAttemptStatus::OutcomeUnknown,
                usage: None,
                note: None,
                record: None,
            },
        })
    }

    async fn bounded_search<T>(
        &self,
        future: impl std::future::Future<Output = Result<T, WorkPublicSearchError>>,
    ) -> Result<T, WorkPublicSearchError> {
        // Each look reads the run's whole projection: only when the work changed.
        let mut changes = self.changes();
        let cancelled = async {
            loop {
                changes.next(crate::work_changes::FALLBACK).await;
                if self.cancellation_requested().await.unwrap_or(false) {
                    break;
                }
            }
        };
        tokio::select! {
            biased;
            _ = tokio::time::sleep_until(self.deadline().into()) => Err(WorkPublicSearchError::OutcomeUnknown),
            _ = cancelled => Err(WorkPublicSearchError::OutcomeUnknown),
            result = future => result,
        }
    }

    async fn rank_search(
        &self,
        provider: &dyn WorkPublicSearchProvider,
        scope: &WorkPublicSearchScope,
        evidence: &WorkProviderSearchEvidenceV1,
        used: WorkUsage,
        limits: WorkExecutionLimits,
    ) -> Result<Option<(WorkUsage, Option<WorkPublicSearchRanking>)>, WorkError> {
        let remaining = WorkExecutionLimits {
            model_tokens: limits.model_tokens - used.model_tokens,
            cost_micro_usd: limits.cost_micro_usd - used.cost_micro_usd,
            operations: limits.operations - used.operations,
            ..limits
        };
        if evidence.citations.len() < 2
            || remaining.validate().is_err()
            || Instant::now() >= self.deadline()
            || self.cancelled().await?
        {
            return Ok(Some((used, None)));
        }
        let result = self
            .bounded_search(provider.rerank(scope, evidence, remaining, self.deadline()))
            .await;
        let (extra, preferred) = match result {
            Ok(ranking) => {
                let preferred = if ranking.validate(evidence).is_ok() {
                    ranking.preferred
                } else {
                    vec![]
                };
                (ranking.usage, preferred)
            }
            Err(WorkPublicSearchError::NotDispatched(_)) => return Ok(Some((used, None))),
            Err(WorkPublicSearchError::Rejected(usage)) => (usage, vec![]),
            Err(WorkPublicSearchError::OutcomeUnknown) => return Ok(None),
        };
        if !extra.within(remaining) || (extra != WorkUsage::default() && extra.operations == 0) {
            return Ok(None);
        }
        Ok(Some((
            WorkUsage {
                model_tokens: used.model_tokens + extra.model_tokens,
                cost_micro_usd: used.cost_micro_usd + extra.cost_micro_usd,
                operations: used.operations + extra.operations,
                accounting: if used.accounting == WorkUsageAccounting::ConservativeReservation
                    || extra.accounting == WorkUsageAccounting::ConservativeReservation
                {
                    WorkUsageAccounting::ConservativeReservation
                } else {
                    WorkUsageAccounting::Exact
                },
            },
            (extra != WorkUsage::default()).then_some(WorkPublicSearchRanking {
                preferred,
                usage: extra,
            }),
        )))
    }
}

/// How a search is answered: by its provider, or from a results page the
/// run opened for it.
enum Dispatch {
    Provider,
    Page(Option<WorkSearchPage>),
}

/// At most this many earlier searches are ranked against one new query.
const REUSE_CHECKS: usize = 2;

pub(crate) fn add(a: WorkUsage, b: WorkUsage) -> WorkUsage {
    WorkUsage {
        model_tokens: a.model_tokens.saturating_add(b.model_tokens),
        cost_micro_usd: a.cost_micro_usd.saturating_add(b.cost_micro_usd),
        operations: a.operations.saturating_add(b.operations),
        accounting: if a.accounting == WorkUsageAccounting::ConservativeReservation
            || b.accounting == WorkUsageAccounting::ConservativeReservation
        {
            WorkUsageAccounting::ConservativeReservation
        } else {
            WorkUsageAccounting::Exact
        },
    }
}

fn remaining(limits: WorkExecutionLimits, used: WorkUsage) -> Option<WorkExecutionLimits> {
    let remaining = WorkExecutionLimits {
        model_tokens: limits.model_tokens.checked_sub(used.model_tokens)?,
        cost_micro_usd: limits.cost_micro_usd.checked_sub(used.cost_micro_usd)?,
        operations: limits.operations.checked_sub(used.operations)?,
        ..limits
    };
    remaining.validate().ok().map(|()| remaining)
}

fn trace(reuse: &str, checks: usize, waited: bool, started: Instant) {
    crate::work_trace::record(format_args!(
        "work: phase=search reuse={reuse} checks={checks} waited={waited} elapsed_ms={}",
        started.elapsed().as_millis()
    ));
}

/// The searches each work ran recently, and the ones running now.
mod shared {
    use super::*;
    use std::sync::{Mutex, PoisonError};
    use zephium_agentic::SearchQueryTerms;
    use zephium_core::ids::ProfileId;

    /// An answer is reused for this long; after it a search runs again.
    const FRESH_FOR: Duration = Duration::from_secs(30 * 60);
    /// Earlier searches whose words overlap this much are worth a check.
    const OVERLAP: f64 = 0.6;
    const WORKS: usize = 8;
    const SEARCHES: usize = 64;

    type Key = (ProfileId, WorkId);

    enum State {
        Running(tokio::sync::watch::Receiver<bool>),
        Known {
            evidence: WorkProviderSearchEvidenceV1,
            at: Instant,
        },
    }

    struct Entry {
        id: u64,
        query: String,
        terms: SearchQueryTerms,
        provider: WorkSearchProvider,
        model: String,
        state: State,
    }

    static WORK_SEARCHES: Mutex<Vec<(Key, Vec<Entry>)>> = Mutex::new(Vec::new());
    static NEXT_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

    fn same_request(first: &str, second: &str) -> bool {
        let tokens = |query: &str| {
            query
                .split_whitespace()
                .map(str::to_lowercase)
                .collect::<Vec<_>>()
        };
        let first = tokens(first);
        let mut second = tokens(second);
        if first == second {
            return true;
        }
        // Numeric bindings, search operators, phrases and relational queries
        // keep their order. Bare keyword order and case carry no extra scope.
        const RELATIONS: &[&str] = &[
            "to", "from", "for", "before", "after", "between", "under", "over", "above", "below",
            "without", "not", "except", "until", "since", "vs", "versus", "than", "into", "by",
            "with", "or", "and", "do", "z", "od", "bez", "przed", "po", "poniżej", "powyżej",
            "między",
        ];
        if first.len() != second.len()
            || first.iter().chain(&second).any(|token| {
                !token.chars().all(char::is_alphabetic) || RELATIONS.contains(&token.as_str())
            })
        {
            return false;
        }
        first.iter().all(|token| {
            let terms = SearchQueryTerms::of(token);
            let found = second.iter().position(|other| {
                if terms.words() == 0 {
                    token == other
                } else {
                    terms == SearchQueryTerms::of(other)
                }
            });
            if let Some(index) = found {
                second.swap_remove(index);
                true
            } else {
                false
            }
        })
    }

    pub(super) enum Next {
        /// An equivalent keyword query is running: wait for its answer.
        /// Similar ones run side by side; only settled answers are checked.
        Wait(tokio::sync::watch::Receiver<bool>),
        /// An equivalent keyword query answered.
        Same(WorkProviderSearchEvidenceV1),
        /// An earlier search, its query and answer, worth checking.
        Check(u64, String, WorkProviderSearchEvidenceV1),
        /// Nothing to reuse: this search runs, and others may wait on it.
        Run(Slot),
    }

    /// A running search's place; dropping it without an answer frees it.
    pub(super) struct Slot {
        key: Key,
        id: u64,
        done: tokio::sync::watch::Sender<bool>,
    }

    impl Slot {
        pub(super) fn known(self, evidence: WorkProviderSearchEvidenceV1) {
            let mut works = WORK_SEARCHES.lock().unwrap_or_else(PoisonError::into_inner);
            if let Some((_, entries)) = works.iter_mut().find(|(key, _)| *key == self.key) {
                if let Some(entry) = entries.iter_mut().find(|entry| entry.id == self.id) {
                    entry.state = State::Known {
                        evidence,
                        at: Instant::now(),
                    };
                }
            }
        }
    }

    impl Drop for Slot {
        fn drop(&mut self) {
            let mut works = WORK_SEARCHES.lock().unwrap_or_else(PoisonError::into_inner);
            if let Some((_, entries)) = works.iter_mut().find(|(key, _)| *key == self.key) {
                entries.retain(|entry| {
                    entry.id != self.id || matches!(entry.state, State::Known { .. })
                });
            }
            drop(works);
            let _ = self.done.send(true);
        }
    }

    pub(super) fn next(
        key: Key,
        scope: &WorkPublicSearchScope,
        terms: &SearchQueryTerms,
        checked: &[u64],
        may_check: bool,
    ) -> Next {
        let mut works = WORK_SEARCHES.lock().unwrap_or_else(PoisonError::into_inner);
        let position = match works.iter().position(|(known, _)| *known == key) {
            Some(position) => position,
            None => {
                if works.len() >= WORKS {
                    works.remove(0);
                }
                works.push((key, Vec::new()));
                works.len() - 1
            }
        };
        let (_, entries) = &mut works[position];
        entries.retain(|entry| match &entry.state {
            State::Known { at, .. } => at.elapsed() < FRESH_FOR,
            State::Running(done) => !*done.borrow(),
        });
        let comparable =
            |entry: &&Entry| entry.provider == scope.provider && entry.model == scope.model;
        if let Some(State::Known { evidence, .. }) = entries
            .iter()
            .filter(comparable)
            .find(|entry| same_request(&entry.query, &scope.query))
            .map(|entry| &entry.state)
        {
            return Next::Same(evidence.clone());
        }
        if let Some(State::Running(done)) = entries
            .iter()
            .filter(comparable)
            .find(|entry| {
                matches!(entry.state, State::Running(_)) && same_request(&entry.query, &scope.query)
            })
            .map(|entry| &entry.state)
        {
            return Next::Wait(done.clone());
        }
        if may_check {
            let candidate = entries
                .iter()
                .filter(comparable)
                .filter(|entry| !checked.contains(&entry.id))
                .filter_map(|entry| match &entry.state {
                    State::Known { evidence, .. } if terms.served_by(evidence) => {
                        Some((entry.terms.overlap(terms), entry, evidence))
                    }
                    _ => None,
                })
                .filter(|(overlap, ..)| *overlap >= OVERLAP)
                .max_by(|a, b| a.0.total_cmp(&b.0));
            if let Some((_, entry, evidence)) = candidate {
                return Next::Check(entry.id, entry.query.clone(), evidence.clone());
            }
        }
        if entries.len() >= SEARCHES {
            if let Some(oldest) = entries
                .iter()
                .position(|entry| matches!(entry.state, State::Known { .. }))
            {
                entries.remove(oldest);
            }
        }
        let id = NEXT_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let (done, running) = tokio::sync::watch::channel(false);
        entries.push(Entry {
            id,
            query: scope.query.clone(),
            terms: terms.clone(),
            provider: scope.provider,
            model: scope.model.clone(),
            state: State::Running(running),
        });
        Next::Run(Slot { key, id, done })
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn equivalent_keywords_reuse_without_erasing_request_constraints() {
            for (first, second) in [
                (
                    "Hetzner cloud prices load balancer",
                    "load balancer price HETZNER cloud",
                ),
                ("tanie laptopy Warszawa", "WARSZAWA   tanie laptopy"),
                ("flights Warsaw to Paris", "FLIGHTS Warsaw TO Paris"),
                ("library 1.2 compatibility", "LIBRARY 1.2 compatibility"),
            ] {
                assert!(same_request(first, second), "{first} / {second}");
            }
            for (first, second) in [
                ("flights Warsaw to Paris", "flights Paris to Warsaw"),
                ("library 1.2 compatibility", "library 2.1 compatibility"),
                ("hotel 2 adults 3 nights", "hotel 3 adults 2 nights"),
                ("cloud prices", "latest cloud prices"),
                ("latest cloud prices", "best cloud prices"),
                ("python python rust", "python rust rust"),
                (
                    "site:example.com cloud price",
                    "site:other.test cloud price",
                ),
                ("\"Warsaw Paris\" flights", "\"Paris Warsaw\" flights"),
                ("loty Warszawa do Paryż", "loty Paryż do Warszawa"),
            ] {
                assert!(!same_request(first, second), "{first} / {second}");
            }
        }

        #[test]
        fn reordered_terms_and_versions_do_not_bypass_semantic_reuse_checks() {
            let _serial = crate::WORK_RUNTIME_TEST_SERIAL.lock().unwrap();
            for (first, changed) in [
                ("flights Warsaw to Paris", "flights Paris to Warsaw"),
                ("library 1.2 compatibility", "library 2.1 compatibility"),
                ("hotel 2 adults 3 nights", "hotel 3 adults 2 nights"),
            ] {
                let key = (ProfileId::generate(), WorkId::generate());
                let mut scope = WorkPublicSearchScope {
                    provider: WorkSearchProvider::OpenAi,
                    model: "fixture".into(),
                    query: first.into(),
                };
                let terms = SearchQueryTerms::of(first);
                assert_eq!(terms, SearchQueryTerms::of(changed));
                let Next::Run(slot) = next(key, &scope, &terms, &[], true) else {
                    panic!("first run")
                };
                assert!(matches!(
                    next(key, &scope, &terms, &[], true),
                    Next::Wait(_)
                ));
                scope.query = changed.into();
                let Next::Run(other) = next(key, &scope, &terms, &[], true) else {
                    panic!("different request must run while first is pending")
                };
                drop(other);
                slot.known(WorkProviderSearchEvidenceV1 {
                    version: 1,
                    provider: scope.provider,
                    model: scope.model.clone(),
                    response_model: scope.model.clone(),
                    response_id: "fixture".into(),
                    search_call_id: "fixture".into(),
                    answer: "Public evidence".into(),
                    citations: vec![],
                    actual_input_tokens: 0,
                    actual_output_tokens: 0,
                });
                assert!(matches!(
                    next(key, &scope, &terms, &[], true),
                    Next::Check(..)
                ));
                scope.query = first.into();
                assert!(matches!(
                    next(key, &scope, &terms, &[], true),
                    Next::Same(_)
                ));
                WORK_SEARCHES
                    .lock()
                    .unwrap()
                    .retain(|(known, _)| *known != key);
            }
        }
    }
}

/// A charge never exceeds what the step was allowed to spend.
fn clamp(usage: WorkUsage, limits: WorkExecutionLimits) -> WorkUsage {
    WorkUsage {
        model_tokens: usage.model_tokens.min(limits.model_tokens),
        cost_micro_usd: usage.cost_micro_usd.min(limits.cost_micro_usd),
        operations: usage.operations.min(limits.operations),
        accounting: usage.accounting,
    }
}

impl WorkNodeAttempt {
    pub async fn search_public_owned(
        self,
        provider: &dyn WorkPublicSearchProvider,
    ) -> Result<WorkNodeSettlement, WorkError> {
        self.search_public_owned_with_context(provider, &[]).await
    }

    /// `context` must be the bodies admitted for this exact execution; the
    /// persisted spec carries their manifest.
    pub async fn search_public_owned_with_context(
        self,
        provider: &dyn WorkPublicSearchProvider,
        context: &[zephium_core::work::context::WorkContextBody],
    ) -> Result<WorkNodeSettlement, WorkError> {
        let WorkCapability::PublicSearch { scope } = &self.specification().capability else {
            return self
                .settle_owned(empty(WorkAttemptStatus::Failed, Some(WorkUsage::default())))
                .await;
        };
        let limits = self.specification().limits;
        let outcome = self
            .probe()
            .run_search_once(provider, scope, context, Dispatch::Provider, limits)
            .await?;
        let Some(record) = outcome.record else {
            return self
                .settle_owned(empty(outcome.status, outcome.usage))
                .await;
        };
        let links: Vec<_> = (1..=record.evidence.citations.len())
            .map(|index| WorkEvidenceLink {
                extraction_id: record.id,
                source_id: index as u16,
            })
            .collect();
        let artifacts = self
            .node()
            .outputs
            .iter()
            .map(|output| WorkArtifactDraft {
                output: output.name.clone(),
                title: output.name.clone(),
                data: WorkArtifactDataV1::EvidenceCollection {
                    summary: record.evidence.answer.clone(),
                    subjects: vec![],
                    entries: vec![],
                },
                evidence: links.clone(),
            })
            .collect();
        self.settle_with_provider_evidence(
            WorkAdapterResult {
                status: WorkAttemptStatus::Succeeded,
                intervention: None,
                usage: outcome.usage,
                artifacts,
            },
            Some(record),
        )
        .await
    }
}

fn empty(status: WorkAttemptStatus, usage: Option<WorkUsage>) -> WorkAdapterResult {
    WorkAdapterResult {
        status,
        usage,
        artifacts: vec![],
        intervention: None,
    }
}
