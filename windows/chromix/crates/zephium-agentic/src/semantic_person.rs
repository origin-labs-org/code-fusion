//! One step the person directed on their own Browse tab from the Ask panel,
//! run through the same fixed isolated-world recipes as Work: the exact
//! observed target is revalidated in the page, then clicked, filled, chosen,
//! pressed or scrolled by the immutable runtime. No agent run, plan, budget or model
//! authority is created; the shell asks the person to confirm any step that
//! commits before it reaches this seam.

use std::fmt;

use crate::{
    prepare_semantic_action_execution, AgentActiveEffect, AgentEffectId, SemanticActionAttemptId,
    SemanticActionExecutionDisposition, SemanticActionExecutionInstant,
    SemanticActionExecutionPending, SemanticActionExecutionPreparationError, SemanticActionFailure,
    SemanticActionKind, SemanticActionNativeRequest, SemanticActionNativeSettlement,
    SemanticFrameJoin, SemanticPreparedAction,
};

/// The kinds a person may direct from the panel.
const PERSON_ACTION_KINDS: [SemanticActionKind; 5] = [
    SemanticActionKind::Click,
    SemanticActionKind::Fill,
    SemanticActionKind::Select,
    SemanticActionKind::Press,
    SemanticActionKind::Scroll,
];

/// The retained half of one person-directed step, awaiting its one native
/// terminal.
#[must_use]
pub struct PersonDirectedAction {
    pending: SemanticActionExecutionPending,
    frame: SemanticFrameJoin,
}

impl PersonDirectedAction {
    /// Splits one prepared action into this retained half and the closed
    /// native request the platform runtime executes once.
    pub fn prepare(
        action: &SemanticPreparedAction,
        attempt: SemanticActionAttemptId,
        requested_at: SemanticActionExecutionInstant,
    ) -> Result<(Self, SemanticActionNativeRequest), SemanticActionExecutionPreparationError> {
        if !PERSON_ACTION_KINDS.contains(&action.kind()) {
            return Err(SemanticActionExecutionPreparationError::Invariant);
        }
        let id = AgentEffectId::new(attempt.get())
            .ok_or(SemanticActionExecutionPreparationError::Invariant)?;
        let active = AgentActiveEffect::for_person_directed(action, attempt, id);
        let (pending, native) = prepare_semantic_action_execution(active, action, requested_at)
            .map_err(|refusal| refusal.into_parts().1)?;
        Ok((
            Self {
                pending,
                frame: action.frame().clone(),
            },
            native,
        ))
    }

    /// Joins the exact native terminal: applied, or why not.
    pub fn settle(
        self,
        settlement: SemanticActionNativeSettlement,
    ) -> Result<(), SemanticActionFailure> {
        match self.pending.settle(&self.frame, settlement).disposition() {
            SemanticActionExecutionDisposition::Applied(_) => Ok(()),
            SemanticActionExecutionDisposition::Failed(failure) => Err(failure),
            SemanticActionExecutionDisposition::ContractViolation(_) => {
                Err(SemanticActionFailure::BackendRefused)
            }
        }
    }
}

impl fmt::Debug for PersonDirectedAction {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("PersonDirectedAction([redacted])")
    }
}
