//! Exact, pre-dispatch rejection of a settled model action proposal.
use super::*;
use crate::{
    SemanticActionBatch, SemanticActionBatchId, SemanticActionBindingError, SemanticActionKind,
    SemanticFrameJoin, SemanticObservation, SemanticObservationGeneration, SemanticObservationId,
    SemanticOperationClass, SemanticOperations, SemanticReferenceError, SemanticReferenceId,
    SemanticRole,
};

/// Content-free identity of one rejected action against one exact observation.
///
/// This is safe to retain for bounded loop detection: it includes neither
/// model-authored fill text nor page-authored labels.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct AgentProviderActionRefusalKey {
    pub(super) observation: SemanticObservationId,
    pub(super) generation: SemanticObservationGeneration,
    pub(super) kind: SemanticActionKind,
    pub(super) target: SemanticReferenceId,
    pub(super) error: SemanticActionBindingError,
}

/// The one resolvable target of a proposal, kept so a refusal decided after
/// binding still carries the exact key that stops repeated retries.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct AgentProviderActionRefusalContext {
    observation: SemanticObservationId,
    generation: SemanticObservationGeneration,
    kind: SemanticActionKind,
    target: SemanticReferenceId,
    role: SemanticRole,
    operations: SemanticOperations,
}

impl AgentProviderActionRefusalContext {
    const fn key(self, error: SemanticActionBindingError) -> AgentProviderActionRefusalKey {
        AgentProviderActionRefusalKey {
            observation: self.observation,
            generation: self.generation,
            kind: self.kind,
            target: self.target,
            error,
        }
    }
}

/// Binding either produces an unapproved batch or proves no action was admitted.
#[must_use]
pub enum AgentProviderActionResolution {
    /// Bound references still require preparation and independent effect
    /// policy; the context keys a refusal the host may still decide.
    Bound(
        SemanticActionBatch,
        AgentProviderContinuation,
        Option<AgentProviderActionRefusalContext>,
    ),
    /// A correctable model proposal failed before preparation or native dispatch.
    Refused(AgentProviderActionRefusal),
}

/// Authority failures are never converted to model-visible planning recovery.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AgentProviderActionResolutionError {
    /// The settled call does not match the supplied configuration or baseline.
    Continuation(AgentProviderContinuationError),
    /// Action binding failed outside the narrow recoverable proposal mistakes.
    Binding(SemanticActionBindingError),
}

impl super::super::AgentProviderSettledToolTurn {
    /// Resolves only the original settled action against its delivered state.
    /// A refusal cannot be constructed from a caller-supplied error or proposal.
    pub fn resolve_action(
        self,
        id: SemanticActionBatchId,
        observation: &SemanticObservation,
        frames: &[SemanticFrameJoin],
        config: &AgentProviderCallConfig,
    ) -> Result<AgentProviderActionResolution, AgentProviderActionResolutionError> {
        use AgentProviderActionResolutionError as Error;
        let (proposal, continuation) = self.into_parts();
        if config != &continuation.config {
            return Err(Error::Continuation(AgentProviderContinuationError::Config));
        }
        if !continuation.baseline.matches(observation) {
            return Err(Error::Continuation(
                AgentProviderContinuationError::Baseline,
            ));
        }
        let super::super::AgentBrowserToolProposal::Act(actions) = proposal else {
            return Err(Error::Continuation(
                AgentProviderContinuationError::ToolKind,
            ));
        };
        let mut actions = actions.into_actions();
        for action in &mut actions {
            if let Some(click) = select_as_click(
                action,
                observation,
                frames,
                continuation.transcript.action_targets(),
            ) {
                *action = click;
            }
        }
        let refusal_context = if actions.len() == 1 {
            let action = &actions[0];
            let target = action.intent().target();
            observation
                .reference_frame(target)
                .ok()
                .and_then(|expected| {
                    frames
                        .iter()
                        .find(|current| current.frame() == expected.frame())
                })
                .and_then(|current| observation.resolve_node(target, current).ok())
                .map(|node| AgentProviderActionRefusalContext {
                    observation: observation.request().id(),
                    generation: observation.request().generation(),
                    kind: action.intent().kind(),
                    target,
                    role: node.role(),
                    operations: node.operations(),
                })
        } else {
            None
        };
        let projected_refusal = continuation
            .transcript
            .action_targets()
            .and_then(|targets| {
                actions.iter().find_map(|action| {
                    let target = action.intent().target();
                    let expected = observation.reference_frame(target).ok()?;
                    let current = frames
                        .iter()
                        .find(|current| current.frame() == expected.frame())?;
                    let node = observation.resolve_node(target, current).ok()?;
                    let mut context = AgentProviderActionRefusalContext {
                        observation: observation.request().id(),
                        generation: observation.request().generation(),
                        kind: action.intent().kind(),
                        target,
                        role: node.role(),
                        operations: node.operations(),
                    };
                    let permitted = targets.permitted_operations(context.target);
                    context.operations = permitted;
                    if !permitted.contains(context.kind.operation()) {
                        Some((
                            context,
                            SemanticActionBindingError::Reference(
                                SemanticReferenceError::OperationDenied,
                            ),
                        ))
                    } else if let Some(expected) = targets
                        .required_effect()
                        .filter(|expected| *expected != action.effect())
                    {
                        Some((
                            context,
                            SemanticActionBindingError::TaskEffectMismatch(expected),
                        ))
                    } else {
                        targets
                            .excluded_error(context.kind, context.target)
                            .map(|error| (context, error))
                    }
                })
            });
        if let Some((context, error)) = projected_refusal {
            return Ok(AgentProviderActionResolution::Refused(
                AgentProviderActionRefusal {
                    continuation,
                    error,
                    context: Some(context),
                    repeated: false,
                    stuck: false,
                    unsent_search: false,
                    scrolled_enough: false,
                },
            ));
        }
        match SemanticActionBatch::bind(id, observation, frames, actions) {
            Ok(batch) => {
                let incomplete = batch.actions().first().is_some_and(|action| {
                    observation
                        .frames()
                        .iter()
                        .find(|snapshot| snapshot.frame() == action.frame())
                        .is_some_and(|snapshot| {
                            matches!(
                                action.prepare(snapshot),
                                Err(crate::SemanticActionPreparationError::IncompleteSnapshot)
                            )
                        })
                });
                if incomplete {
                    return Ok(AgentProviderActionResolution::Refused(
                        AgentProviderActionRefusal {
                            continuation,
                            error: SemanticActionBindingError::TargetIncomplete,
                            context: refusal_context,
                            repeated: false,
                            stuck: false,
                            unsent_search: false,
                            scrolled_enough: false,
                        },
                    ));
                }
                Ok(AgentProviderActionResolution::Bound(
                    batch,
                    continuation,
                    refusal_context,
                ))
            }
            Err(
                error @ (SemanticActionBindingError::Reference(
                    SemanticReferenceError::OperationDenied | SemanticReferenceError::Unknown,
                )
                | SemanticActionBindingError::OutcomeAlreadySatisfied
                | SemanticActionBindingError::OutcomeContract
                | SemanticActionBindingError::SelectionTarget),
            ) => Ok(AgentProviderActionResolution::Refused(
                AgentProviderActionRefusal {
                    continuation,
                    error,
                    context: refusal_context,
                    repeated: false,
                    stuck: false,
                    unsent_search: false,
                    scrolled_enough: false,
                },
            )),
            Err(error) => Err(Error::Binding(error)),
        }
    }
}

/// Planners "select" what is no choice list: a filter checkbox, a place
/// field's suggestion, a menu entry. A select whose target takes no select
/// becomes a click on the option it named (the control itself when it named
/// itself), verified as a page change; every rule after this judges that
/// click as if the model had proposed it.
fn select_as_click(
    action: &crate::SemanticActionProposal,
    observation: &SemanticObservation,
    frames: &[SemanticFrameJoin],
    targets: Option<&AgentProviderActionTargets>,
) -> Option<crate::SemanticActionProposal> {
    let crate::SemanticActionIntent::Select { target, option } = *action.intent() else {
        return None;
    };
    let operations = |reference: SemanticReferenceId| {
        let expected = observation.reference_frame(reference).ok()?;
        let current = frames
            .iter()
            .find(|current| current.frame() == expected.frame())?;
        let node = observation.resolve_node(reference, current).ok()?;
        Some(match targets {
            Some(targets) => targets.permitted_operations(reference),
            None => node.operations(),
        })
    };
    if operations(target)?.contains(SemanticOperationClass::Select)
        || !operations(option)?.contains(SemanticOperationClass::Click)
        || !matches!(
            action.effect(),
            crate::SemanticEffectClass::Read | crate::SemanticEffectClass::LocalWrite
        )
    {
        return None;
    }
    // A custom listbox may close on selection. Its named choice still has to
    // belong to that list; a sibling picker is not an equivalent proposal.
    for frame in observation.frames() {
        let Some(target_node) = frame.nodes().iter().find(|node| node.reference() == target) else {
            continue;
        };
        if target_node
            .operations()
            .contains(SemanticOperationClass::Select)
        {
            return None;
        }
        if target_node.role() == crate::SemanticRole::Listbox {
            let option_node = frame
                .nodes()
                .iter()
                .find(|node| node.reference() == option)?;
            if option_node.role() != crate::SemanticRole::Option {
                return None;
            }
            let mut parent = option_node.parent();
            let mut belongs = false;
            for _ in 0..frame.nodes().len() {
                let Some(node) = parent.and_then(|index| frame.nodes().get(usize::from(index)))
                else {
                    break;
                };
                if node.reference() == target {
                    belongs = true;
                    break;
                }
                parent = node.parent();
            }
            if !belongs {
                return None;
            }
        }
    }
    crate::SemanticActionProposal::try_new(
        crate::SemanticActionIntent::Click { target: option },
        action.effect(),
        crate::SemanticWaitCondition::Immediate,
        crate::SemanticVerification::PageChanged,
        action.settle_budget(),
    )
    .ok()
}

/// Move-only proof that the original settled action was never prepared or issued.
#[must_use]
pub struct AgentProviderActionRefusal {
    continuation: AgentProviderContinuation,
    error: SemanticActionBindingError,
    context: Option<AgentProviderActionRefusalContext>,
    repeated: bool,
    stuck: bool,
    unsent_search: bool,
    scrolled_enough: bool,
}

impl AgentProviderActionRefusal {
    /// A bound action the host declines before any permit or dispatch: the
    /// continuation proves nothing was issued, and the model hears why.
    pub fn unissued(
        continuation: AgentProviderContinuation,
        error: SemanticActionBindingError,
        context: Option<AgentProviderActionRefusalContext>,
    ) -> Self {
        Self {
            continuation,
            error,
            context,
            repeated: false,
            stuck: false,
            unsent_search: false,
            scrolled_enough: false,
        }
    }
    /// This control was refused before on an earlier look: the model hears
    /// to change approach instead of trying it again.
    pub fn repeated(mut self) -> Self {
        self.repeated = true;
        self
    }
    /// A scroll proposed right after typing into a search or filter field
    /// that was never run: the model hears to run it first.
    pub fn unsent_search(mut self) -> Self {
        self.unsent_search = true;
        self
    }
    /// A planner that scrolled the page several times in a row with nothing
    /// else done hears that its looks already hold what scrolling showed.
    pub fn scrolled_enough(mut self) -> Self {
        self.scrolled_enough = true;
        self
    }
    /// The model proposed this exact refused action again and again: it
    /// gets a fresh look of the page with that said, whatever the refusal.
    pub fn stuck(mut self) -> Self {
        self.repeated = true;
        self.stuck = true;
        self
    }
    /// The refused proposal's target on the observation it was made on.
    pub fn target(&self) -> Option<SemanticReferenceId> {
        self.context.map(|context| context.target)
    }
    /// Content-free rejection reason for auditing.
    pub const fn reason(&self) -> SemanticActionBindingError {
        self.error
    }

    /// Retires this refusal into a fresh whole look the host takes for the
    /// model, the refusal told alongside it. Only a step that reached the
    /// page (covered, changed, or run without its outcome) has a page worth
    /// looking at again; any other refusal stays with its observation.
    pub fn into_refresh(
        self,
        observation: &SemanticObservation,
        config: &AgentProviderCallConfig,
    ) -> Result<super::AgentProviderObservationCheckpoint, Box<Self>> {
        let note = match self.error {
            _ if self.stuck => "repeated_proposal: nothing executed. You proposed exactly this refused action several times in a row; it will not run on this page. This is a fresh look at the page: choose a different control or tool (fill a text field and then click a suggestion or a search button, press Enter in a field, navigate to the site's search results address, or extract what your looks already show).",
            SemanticActionBindingError::TargetCovered => "target_covered: nothing executed; another element (a cookie or consent banner, a dialog, a popover or a sticky header) lay over the target where it would be clicked. This is a fresh look at the page. The control still takes a key: press it with Enter (act press, key enter, on its ref in this look), which reaches it without the pointer. Or close what covers it with its own close, dismiss or reject control. A dialog whose own controls are refused does not block the rest of the page: leave it and use the page's search box, its links, or the site's search results address.",
            SemanticActionBindingError::DispatchRejected => "target_changed: nothing executed; the page changed before the action ran. This is a fresh look at the page: act on these refs; if a dialog opened, work within it first.",
            SemanticActionBindingError::Unverified
                if self.context.is_some_and(|context| {
                    matches!(
                        context.kind,
                        SemanticActionKind::Fill | SemanticActionKind::Select
                    )
                }) => "field_rewritten: the text was typed, but the field did not keep it exactly as typed: the page rewrote it or is offering suggestions (an autocomplete, a place or date picker). This is a fresh look at the page as it is now, with the field's current value and any suggestion list or calendar it opened. If a suggestion matches what you meant, click it; if the field already holds an acceptable value, go on (search, apply, or the next field); otherwise fill it again with a shorter or different value.",
            SemanticActionBindingError::Unverified => "outcome_not_observed: the action ran, but its declared outcome was not seen. This is a fresh look at the page as it is now: continue from what it shows, and do not repeat the same action unchanged.",
            SemanticActionBindingError::OutcomeUnknown => "outcome_unknown: the step reached the page but its outcome was not seen, so it may already have taken effect. This is a fresh look at the page as it is now: check on it whether the step happened (a sent message in its thread or folder, a new item in its list, a changed cart or status) and report what it shows. This step is not run again in this task, in this form or another.",
            _ => return Err(Box::new(self)),
        };
        let note = if self.stuck {
            note.to_owned()
        } else if self.repeated && self.error == SemanticActionBindingError::TargetCovered {
            format!("{note} This control was covered before too: do not click it again. Press it with Enter, or change approach (navigate to another address on this site, such as its search results for your query, or use its search box).")
        } else if self.repeated {
            format!("{note} This control was refused before: change approach (navigate to another address on this site, such as its search results for your query, use its search box, or scroll).")
        } else {
            note.to_owned()
        };
        if config != &self.continuation.config
            || !super::AgentProviderObservationCheckpoint::refreshable(
                &self.continuation,
                observation,
            )
        {
            return Err(Box::new(self));
        }
        Ok(super::AgentProviderObservationCheckpoint::refresh(
            self.continuation,
            note,
        ))
    }

    /// The pending Act continuation, for a site-session follow that retires
    /// it instead of reporting the refusal.
    pub fn into_continuation(self) -> AgentProviderContinuation {
        self.continuation
    }

    /// Exact content-free proposal identity when the rejected batch contained
    /// one resolvable target. Callers may use it only to stop repeated retries;
    /// it grants no replacement action or native authority.
    pub fn key(&self) -> Option<AgentProviderActionRefusalKey> {
        self.context.map(|context| context.key(self.error))
    }

    pub(in crate::agent_provider) fn bind(
        self,
        observation: &SemanticObservation,
        config: &AgentProviderCallConfig,
        payload: String,
    ) -> Result<
        (AgentProviderCallIdentity, AgentProviderBoundTranscript),
        AgentProviderContinuationError,
    > {
        if config != &self.continuation.config {
            return Err(AgentProviderContinuationError::Config);
        }
        if !self.continuation.baseline.matches(observation) {
            return Err(AgentProviderContinuationError::Baseline);
        }
        let (code, guidance) = match self.error {
            SemanticActionBindingError::Reference(SemanticReferenceError::OperationDenied) => (
                "operation_not_supported",
                "The requested operation is not in the target ref's advertised ops. The rejected metadata identifies the exact operation, target, role and observed capabilities without echoing action content. This operation/target pair is unavailable while the observation is unchanged; other eligible refs remain available. Choose an advertised operation on another supplied ref, inspect to reveal a suitable control, or request a genuinely fresh observation before reconsidering changed state. Do not repeat the rejected pair.",
            ),
            SemanticActionBindingError::Reference(SemanticReferenceError::Unknown) => (
                "unknown_ref",
                "Nothing executed. A ref in this action is not on the look you hold: refs change with every look. Use refs exactly as the latest look prints them, such as @a12, and only ones it shows.",
            ),
            SemanticActionBindingError::SelectionTarget => (
                "selection_target_invalid",
                "Nothing executed. select needs a target that is a native select or listbox the look lists for select, and an option ref that is an r=option inside that target, never the select itself. When the select says option_refs=locate, call locate with the option's words first: it returns that option's ref. A text field with suggestions takes fill, then a click on the suggestion; a custom dropdown opens with click, and its option is clicked. A choice you do not need (a search box's category) can be left as it is: run the search instead.",
            ),
            SemanticActionBindingError::TaskEffectMismatch(_) => (
                "task_effect_mismatch",
                "Nothing executed. The host read this control's effect as required_effect (adding to a cart is external_write, placing an order is purchase). If the action is what the goal needs, propose it again now with effect set to required_effect, the same current ref and a supported verification; the host decides whether the person is asked. Otherwise inspect or extract within scope.",
            ),
            SemanticActionBindingError::OutcomeContract => (
                "outcome_incompatible",
                "Nothing executed. The requested outcome does not match this control's observed structure. page_dialog_closed requires a control inside an observed dialog; a tab uses selected=true and a disclosure uses expanded=true. Inspect the relevant container if context is missing, then choose a supported outcome. Do not substitute another unrelated target.",
            ),
            SemanticActionBindingError::OutcomeAlreadySatisfied => (
                "outcome_already_satisfied",
                "The proposed postcondition already holds in the supplied observation. Choose a meaningfully different operation or input with a verifiable change, request a genuinely fresh observation if state may have changed, or extract the result if the objective is complete. A message this task already sent, or an item it already added, is done: do not type or send it again. Do not repeat this exact proposal.",
            ),
            SemanticActionBindingError::ValueUnobserved => (
                "value_unobserved",
                "Nothing executed. This field's current value is private or too long to observe here, so a fill of it cannot be verified. Do not retry it or look again for it: fill the other fields, and report this one as left for the person.",
            ),
            SemanticActionBindingError::TargetIncomplete => (
                "target_incomplete",
                "Nothing executed. The supplied observation omits fields needed to prepare this target. Capture snapshot(subtree) of the target or its containing dialog or section, then use the fresh refs and advertised operations. Repeating the action against this unchanged observation cannot succeed. You can also read or extract the available evidence without acting.",
            ),
            SemanticActionBindingError::UnsupportedVerification => (
                "verification_not_supported",
                "Nothing executed. This host verifies only in-page outcomes (page_dialog_closed, selected, expanded, scroll_position_changed) with wait=immediate or a mutation-quiet wait; it cannot verify navigation or dialogs. Do not click links or submit forms here: other pages are separate assignments the coordinator opens from cited link destinations. Inspect, scroll, dismiss, or extract what this page already shows.",
            ),
            SemanticActionBindingError::AssignmentDenied => (
                "outside_assignment",
                "Nothing executed. This reading assignment permits only dismissing a notice, choosing a tab, expanding a disclosure, or scrolling, each with its supported verification. Links, forms, purchases and account changes are outside it. Inspect or extract the evidence this page already shows; cite link destinations for the coordinator instead of following them.",
            ),
            SemanticActionBindingError::BudgetExhausted => (
                "budget_exhausted",
                "Nothing executed. The operation budget for this page cannot cover another action and its settlement. Extract now from the current observation; report what is missing rather than acting further.",
            ),
            SemanticActionBindingError::DispatchRejected => (
                "target_changed",
                "Nothing executed. The page changed between the observation and the action, so the target no longer matched. Request a fresh observation with snapshot(initial), then act on the current refs; if a dialog just opened, work within it first. Do not repeat the rejected proposal against the old observation.",
            ),
            SemanticActionBindingError::Unverified => (
                "outcome_not_observed",
                "The action ran, but its declared outcome was not seen afterwards: the control may have left the page (a dismissed notice, a menu item that closed its menu) or the page did not change as declared. The observation you hold is stale. Request snapshot(initial) to see the page as it is now and continue from what it shows; do not repeat this action unchanged.",
            ),
            SemanticActionBindingError::OutcomeUnknown => (
                "outcome_unknown",
                "Nothing executed now. This step reached the page earlier in this task, or just now, and its outcome was not seen: it may already have taken effect, so it is not run again in this task, in this form or another. Look at the page (snapshot initial) for whether it happened (a sent message in its thread or folder, a new item in its list), then report what it shows.",
            ),
            SemanticActionBindingError::WrongRecipient => (
                "wrong_recipient",
                "Nothing executed. This message is not addressed to the recipient or channel the task names, so it is not sent. Open a new message addressed to them (the page's compose or new-message control, or the channel in its sidebar or search), or add them in its To field, then send that one. If the page has no such channel or person, report that instead. Do not send in a conversation or channel other than the one named.",
            ),
            SemanticActionBindingError::TargetCovered => (
                "target_covered",
                "Nothing executed. The target was covered by another element (a banner, a sticky header, a dialog or a popover) even after it was brought into view. Do not click it again: press it with Enter instead (act press, key enter), which reaches it without the pointer, close what covers it with its own close or reject control, or use the page's search box, its links or the site's search results address. A dialog whose own controls are refused does not block the rest of the page.",
            ),
            _ => return Err(AgentProviderContinuationError::ToolKind),
        };
        let executed = self.error == SemanticActionBindingError::Unverified;
        // The one confusion planners repeat: a text field with suggestions
        // (a place or search combobox) is typed into, not chosen from.
        let hint = match (self.error, self.context) {
            (
                SemanticActionBindingError::Reference(SemanticReferenceError::OperationDenied),
                Some(context),
            ) if context.kind == SemanticActionKind::Select
                && context.operations.contains(SemanticOperationClass::Fill) =>
            {
                Some(" This control is a text field with suggestions: it takes fill, not select. Fill it with the text you want; then, in the fresh look, click the matching suggestion if one appears.")
            }
            (
                SemanticActionBindingError::Reference(SemanticReferenceError::OperationDenied),
                Some(context),
            ) if context.kind == SemanticActionKind::Fill
                && context.operations.contains(SemanticOperationClass::Click) =>
            {
                Some(" This control cannot be typed into: click it to open its field or picker, then fill the field it opens.")
            }
            (
                SemanticActionBindingError::Reference(SemanticReferenceError::OperationDenied),
                Some(context),
            ) if context.kind == SemanticActionKind::Scroll => {
                Some(" Only a ref listed for scroll scrolls. A click, fill or press brings its control into view by itself, so act on the control directly; to see more of the page, scroll the document ref by a page; to read records already in your looks, extract.")
            }
            _ => None,
        };
        let (code, guidance) = if self.scrolled_enough {
            ("scrolled_enough", "Nothing executed. You scrolled this page several times in a row: every look you took stays evidence for extract, so extract the records your looks already show now. If they lack what the goal needs, act instead: open the site's search results or listing address with your filters (dates, guests, query, sort) in it, or use a filter or sort control. Do not scroll back and forth.")
        } else if self.unsent_search {
            ("search_not_run", "Nothing executed. You typed into a search or filter field and have not run it: press Enter in that field now (act press, key enter, effect read, verification page_changed), or click its search button. Scrolling or looking again does not run it.")
        } else {
            (code, guidance)
        };
        let guidance = format!("{guidance}{}", hint.unwrap_or_default());
        // The same control is what the planner should propose again, with
        // the effect named in the guidance itself: told only by reference
        // to a field, it repeated `purchase` for an add to cart.
        let guidance = if let SemanticActionBindingError::TaskEffectMismatch(expected) = self.error
        {
            guidance.replace("required_effect", effect_label(expected))
        } else if self.repeated {
            format!("{guidance} This control was already refused on an earlier look, so trying it again will not work: change approach. Navigate to another address on this site that shows what you need (a link's destination, or the site's own search results address with your query), use the site's search or filter box, close what covers the page, or scroll and read what it already shows.")
        } else {
            guidance.to_owned()
        };
        let mut result = serde_json::json!({
            "status": "refused", "code": code, "executed": executed,
            "guidance": guidance, "observation_unchanged": !executed,
        });
        if self.repeated {
            result["repeated_target"] = serde_json::json!(true);
        }
        if let SemanticActionBindingError::TaskEffectMismatch(expected) = self.error {
            result["required_effect"] = serde_json::json!(effect_label(expected));
        }
        if let Some(context) = self.context {
            result["rejected"] = serde_json::json!({
                "operation": action_kind_label(context.kind),
                "target": context.target.model_token(),
                "target_role": crate::semantic_model::role_label(context.role),
                "advertised_ops": operation_labels(context.operations),
            });
        }
        let result = result.to_string();
        // OperationDenied is structural for this exact observation. An
        // already-satisfied outcome is parameter-specific (for example Fill
        // with one value) and must not suppress a different proposal using the
        // same operation/ref; Work's exact refusal key still stops repetition.
        // A scroll streak is target-wide on this view. Keeping it in the next
        // strict schema let small models resume the same scroll loop at once.
        let exclusion = (matches!(
            self.error,
            SemanticActionBindingError::Reference(SemanticReferenceError::OperationDenied)
        ) || (self.scrolled_enough
            && self
                .context
                .is_some_and(|context| context.kind == SemanticActionKind::Scroll)))
        .then(|| self.context.map(|context| context.key(self.error)))
        .flatten();
        let (call, _, _, correlation, mut transcript) = self.continuation.into_parts();
        let action_targets = transcript.take_action_targets();
        let mut transcript = AgentProviderTranscript::try_initial_with_progress(
            transcript.objective,
            payload,
            transcript.navigation_checkpoint,
            transcript.inspection_checkpoint,
            transcript.action_progress,
        )
        .ok_or(AgentProviderContinuationError::TranscriptLimit)?;
        if let Some(mut targets) = action_targets {
            if !targets.matches(observation) {
                return Err(AgentProviderContinuationError::Baseline);
            }
            if let Some(exclusion) = exclusion {
                targets.try_exclude(exclusion)?;
            }
            transcript.set_action_targets(targets);
        }
        Ok((call, transcript.try_bind(correlation, result)?))
    }
}

pub(in crate::agent_provider) const fn effect_label(
    effect: crate::SemanticEffectClass,
) -> &'static str {
    use crate::SemanticEffectClass::*;
    match effect {
        Read => "read",
        LocalWrite => "local_write",
        ExternalWrite => "external_write",
        Communication => "communication",
        Purchase => "purchase",
        Destructive => "destructive",
        CapabilityBoundary => "capability_boundary",
    }
}

const fn action_kind_label(kind: SemanticActionKind) -> &'static str {
    match kind {
        SemanticActionKind::Click => "click",
        SemanticActionKind::Fill => "fill",
        SemanticActionKind::Select => "select",
        SemanticActionKind::Press => "press",
        SemanticActionKind::Scroll => "scroll",
    }
}

fn operation_labels(operations: SemanticOperations) -> Vec<&'static str> {
    [
        (SemanticOperationClass::Click, "click"),
        (SemanticOperationClass::Fill, "fill"),
        (SemanticOperationClass::Select, "select"),
        (SemanticOperationClass::Press, "press"),
        (SemanticOperationClass::Scroll, "scroll"),
    ]
    .into_iter()
    .filter_map(|(operation, label)| operations.contains(operation).then_some(label))
    .collect()
}

impl fmt::Debug for AgentProviderActionRefusal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("AgentProviderActionRefusal")
            .field("reason", &self.error)
            .finish_non_exhaustive()
    }
}
