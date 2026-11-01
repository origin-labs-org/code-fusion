//! A browser search's results page: Rust reads its results from the first
//! whole look and the page ends there. Nothing on it is pressed, a consent
//! wall included: a page that cannot be read as it stands is a wall.
use super::*;
use std::sync::Mutex;
use zephium_core::search::SearchEngine;
use zephium_core::work::search::WorkSearchPage;

/// What the page showed, kept for the step that opened it.
pub(crate) struct ResultsReader {
    engine: SearchEngine,
    /// A custom engine's host, whose links are its own.
    own: Option<String>,
    read: Mutex<Option<WorkSearchPage>>,
}

impl ResultsReader {
    pub(crate) fn new(engine: SearchEngine, own: Option<String>) -> Self {
        Self {
            engine,
            own,
            read: Mutex::new(None),
        }
    }

    /// The page as read; `None` when the page never reached a look.
    pub(crate) fn take(&self) -> Option<WorkSearchPage> {
        self.read
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take()
    }
}

pub(super) struct ResultsPagePolicy {
    pub(super) reader: Arc<ResultsReader>,
}

impl AgentWorkLocalActionPolicy for ResultsPagePolicy {
    fn human_wall(&self, observation: &SemanticObservation) -> Option<AgentBrowserHumanReason> {
        super::site_work::reading_wall(observation)
    }

    fn model_action_operations(
        &self,
        _: &SemanticNode,
        _: &SemanticObservation,
    ) -> Result<SemanticOperations, AgentWorkFailure> {
        SemanticOperations::try_new(&[]).map_err(|_| AgentWorkFailure::Contract)
    }

    fn assess(
        &self,
        _: &SemanticPreparedAction,
        _: &SemanticObservation,
    ) -> Result<AgentEffectAssessment, AgentWorkFailure> {
        Err(AgentWorkFailure::ActionDenied)
    }

    fn whole_first_look(&self) -> bool {
        true
    }

    fn reads_results_page(&self) -> bool {
        true
    }

    fn results_drawn(&self, observation: &SemanticObservation) -> bool {
        !matches!(
            read_search_page(self.reader.engine, self.reader.own.as_deref(), observation).page,
            WorkSearchPage::Wall(zephium_core::work::search::WorkSearchWall::Unreadable)
        )
    }

    fn results_page(&self, observation: &SemanticObservation) -> Vec<Vec<SemanticReferenceId>> {
        let read = read_search_page(self.reader.engine, self.reader.own.as_deref(), observation);
        *self
            .reader
            .read
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(read.page);
        read.cited
    }
}
