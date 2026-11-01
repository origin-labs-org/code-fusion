//! Bounded native preparation of one model-proposed search/filter form.
use super::*;

const MAX_FORM_ACTIONS: usize = 24;
const MAX_FORM_MILLIS: u64 = 12_000;

pub(super) enum PreparedForm {
    Refresh(Box<AgentProviderObservationCheckpoint>),
    Ready(Box<SemanticObservation>),
    Follow(Box<(AgentProviderContinuation, ContextNavigationTarget)>),
}

impl AgentWorkController {
    pub(super) fn can_batch_search_fill(
        proposal: &AgentBrowserToolProposal,
        look: &SemanticObservation,
    ) -> bool {
        let AgentBrowserToolProposal::Act(batch) = proposal else {
            return false;
        };
        let [action] = batch.actions() else {
            return false;
        };
        Self::is_batchable_search_fill(action, look)
    }

    pub(crate) fn is_batchable_search_fill(
        action: &SemanticActionProposal,
        look: &SemanticObservation,
    ) -> bool {
        let SemanticActionIntent::Fill { target, .. } = action.intent() else {
            return false;
        };
        if action.effect() != SemanticEffectClass::LocalWrite {
            return false;
        }
        let Ok(frame_id) = look.reference_frame(*target) else {
            return false;
        };
        let Some(frame) = look.frames().iter().find(|frame| frame.frame() == frame_id) else {
            return false;
        };
        let Some(index) = frame
            .nodes()
            .iter()
            .position(|node| node.reference() == *target)
        else {
            return false;
        };
        let field = &frame.nodes()[index];
        let numeric_segment = |node: &SemanticNode| {
            node.role() == SemanticRole::Spinbutton
                && node.sensitivity() == SemanticSensitivity::Public
                && node.operations().contains(SemanticOperationClass::Fill)
                && !node.states().contains(SemanticState::Disabled)
                && node.form().is_none()
        };
        if numeric_segment(field)
            && field.parent().is_some_and(|parent| {
                frame.nodes()[usize::from(parent)].role() == SemanticRole::Group
            })
            && frame
                .nodes()
                .iter()
                .filter(|node| node.parent() == field.parent() && numeric_segment(node))
                .take(2)
                .count()
                == 2
        {
            return true;
        }
        let search_scope = |mut at: usize| loop {
            let node = &frame.nodes()[at];
            if node.landmark_kind() == Some(SemanticLandmarkKind::Search) {
                return Some(at);
            }
            at = usize::from(node.parent()?);
        };
        let Some(scope) = search_scope(index) else {
            return false;
        };
        let eligible = |node: &SemanticNode| {
            node.sensitivity() == SemanticSensitivity::Public
                && node.operations().contains(SemanticOperationClass::Fill)
                && node.form().is_some_and(|form| {
                    form.method() == SemanticFormMethod::Get && form.same_origin() && form.search()
                })
        };
        eligible(&frame.nodes()[index])
            && frame
                .nodes()
                .iter()
                .enumerate()
                .filter(|(at, node)| eligible(node) && search_scope(*at) == Some(scope))
                .take(2)
                .count()
                == 2
    }

    pub(super) async fn prepare_compound_form(
        state: &mut WorkState,
        worker: &mut AgentRuntimeWorker,
        browser: &WorkBrowser<'_>,
        turn: AgentBrowserProviderTurn,
        original: &SemanticObservation,
    ) -> Result<PreparedForm, AgentWorkFailure> {
        let session = state.session.as_ref().ok_or_else(|| crate::contract!())?;
        let config = session.config.clone();
        let binding = match turn.turn.proposal() {
            AgentBrowserToolProposal::FillForm(form) => turn
                .turn
                .continuation()
                .bind_form_targets(form, original, &config),
            _ => return Err(crate::contract!()),
        };
        let (_, continuation) = turn.into_tool_turn().into_parts();
        let binding = match binding {
            Ok(binding) => binding,
            Err(error) if error.fault != AgentBrowserFormFault::Authority => {
                return continuation
                    .into_form_refresh(original, &config, 0, false, Some(error))
                    .map(|checkpoint| PreparedForm::Refresh(Box::new(checkpoint)))
                    .map_err(|_| crate::contract!())
            }
            Err(_) => return Err(crate::contract!()),
        };
        let mut current = original.clone();
        let deadline = Instant::now() + Duration::from_millis(MAX_FORM_MILLIS);
        let mut actions = 0usize;
        let mut committed_choices = [false; MAX_AGENT_BROWSER_FORM_FIELDS];
        // A text field whose own popup offered exactly the typed value, and
        // whose suggestion was clicked: its shown value is the site's now.
        let mut chosen_suggestions = [false; MAX_AGENT_BROWSER_FORM_FIELDS];
        let mut completed = 0u8;
        let mut failure = None;
        'fields: for index in 0..binding.field_count() {
            let mut waited = false;
            loop {
                state.check_task_contract()?;
                state.native.check_control(worker, browser)?;
                if actions >= MAX_FORM_ACTIONS || Instant::now() >= deadline {
                    failure = Some(AgentBrowserFormError {
                        field: Some((index + 1) as u8),
                        fault: AgentBrowserFormFault::Limit,
                    });
                    break 'fields;
                }
                if chosen_suggestions[index]
                    || (committed_choices[index] && binding.value_matches(index, &current))
                {
                    completed += 1;
                    break;
                }
                // A picker or dropdown already showing the value is set.
                let shown = |kind| {
                    binding
                        .field_reference(index, kind, &current)
                        .ok()
                        .zip(binding.field_value(index))
                        .is_some_and(|(control, value)| {
                            zephium_agentic::semantic_shows_value(&current, control, value)
                        })
                };
                if (binding.is_picker(index) || binding.is_choice(index))
                    && shown(SemanticActionKind::Click)
                {
                    completed += 1;
                    chosen_suggestions[index] = true;
                    break;
                }
                if binding.is_picker(index) {
                    let (next, chosen) = Box::pin(Self::fill_picker(
                        state, worker, browser, &binding, index, current,
                    ))
                    .await?;
                    current = next;
                    actions += 3;
                    if !chosen {
                        failure = Some(AgentBrowserFormError {
                            field: Some((index + 1) as u8),
                            fault: AgentBrowserFormFault::AmbiguousOption,
                        });
                        break 'fields;
                    }
                    chosen_suggestions[index] = true;
                    continue;
                }
                let recipe = match binding.field_action(index, &current) {
                    Ok(None) => {
                        completed += 1;
                        break;
                    }
                    Ok(Some(recipe)) => recipe,
                    Err(error)
                        if error.fault == AgentBrowserFormFault::OptionPending && !waited =>
                    {
                        waited = true;
                        let wake = (Instant::now() + Duration::from_millis(400))
                            .min(deadline)
                            .min(state.native.deadline);
                        tokio::select! {
                            biased;
                            event = state.native.next_event(worker, browser) => {
                                state.native.retain(event?)?;
                                return Err(AgentWorkFailure::Mailbox);
                            }
                            () = tokio::time::sleep_until(tokio::time::Instant::from_std(wake)) => {}
                        }
                        current = Box::pin(Self::observe(state, worker, browser)).await?;
                        if state.task_progress(&current)?
                            == AgentWorkTaskProgress::ReadyForExtraction
                        {
                            return Ok(PreparedForm::Ready(Box::new(current)));
                        }
                        let (next, outcome) = Box::pin(Self::choose_suggestion(
                            state, worker, browser, &binding, index, current, false,
                        ))
                        .await?;
                        current = next;
                        if outcome == Some(true) {
                            actions += 1;
                            chosen_suggestions[index] = true;
                        }
                        continue;
                    }
                    Err(error) => {
                        failure = Some(error);
                        break 'fields;
                    }
                };
                let selected = binding.is_choice(index)
                    && match recipe.intent() {
                        SemanticActionIntent::Select { .. } => true,
                        SemanticActionIntent::Click { target } => current
                            .frames()
                            .iter()
                            .flat_map(|frame| frame.nodes())
                            .any(|node| {
                                node.reference() == *target && node.role() == SemanticRole::Option
                            }),
                        _ => false,
                    };
                let typed = matches!(recipe.intent(), SemanticActionIntent::Fill { .. });
                let next = Box::pin(Self::form_primitive(
                    state, worker, browser, &current, recipe, false,
                ))
                .await?;
                let next = match next {
                    Ok(next) => next,
                    Err(fault) => {
                        failure = Some(AgentBrowserFormError {
                            field: Some((index + 1) as u8),
                            fault,
                        });
                        break 'fields;
                    }
                };
                let committed = selected && binding.choice_collapsed(index, &current, &next);
                current = next;
                if state.task_progress(&current)? == AgentWorkTaskProgress::ReadyForExtraction {
                    return Ok(PreparedForm::Ready(Box::new(current)));
                }
                actions += 1;
                if committed {
                    committed_choices[index] = true;
                }
                if typed && !binding.is_choice(index) {
                    let (next, outcome) = Box::pin(Self::choose_suggestion(
                        state, worker, browser, &binding, index, current, true,
                    ))
                    .await?;
                    current = next;
                    match outcome {
                        Some(true) => {
                            actions += 1;
                            chosen_suggestions[index] = true;
                        }
                        // Submitting typed text the site still wants
                        // chosen searched the wrong place.
                        Some(false) => {
                            failure = Some(AgentBrowserFormError {
                                field: Some((index + 1) as u8),
                                fault: AgentBrowserFormFault::AmbiguousOption,
                            });
                            break 'fields;
                        }
                        None => {}
                    }
                }
            }
        }
        // Dependent widgets can clear an earlier field. Recheck every value
        // before submission; successful earlier typing is not enough.
        if failure.is_none() {
            for index in 0..binding.field_count() {
                let settled = chosen_suggestions[index]
                    || (committed_choices[index] && binding.value_matches(index, &current));
                if !settled && !matches!(binding.field_action(index, &current), Ok(None)) {
                    failure = Some(AgentBrowserFormError {
                        field: Some((index + 1) as u8),
                        fault: AgentBrowserFormFault::Stale,
                    });
                    break;
                }
            }
        }
        let mut submitted = false;
        if failure.is_none() && (actions >= MAX_FORM_ACTIONS || Instant::now() >= deadline) {
            failure = Some(AgentBrowserFormError {
                field: None,
                fault: AgentBrowserFormFault::Limit,
            });
        }
        if failure.is_none() {
            match binding.submit_reference(&current) {
                Ok(Some(target)) => {
                    let recipe = SemanticActionProposal::try_new(
                        SemanticActionIntent::Click { target },
                        SemanticEffectClass::Read,
                        SemanticWaitCondition::Immediate,
                        SemanticVerification::PageChanged,
                        SemanticSettleBudget::try_new(MIN_AGENT_BROWSER_SNAPSHOT_SETTLE_MILLIS)
                            .map_err(|_| crate::contract!())?,
                    )
                    .map_err(|_| crate::contract!())?;
                    match Box::pin(Self::form_primitive(
                        state, worker, browser, &current, recipe, true,
                    ))
                    .await?
                    {
                        Ok(_) => submitted = true,
                        Err(fault) => failure = Some(AgentBrowserFormError { field: None, fault }),
                    }
                    if let Some(target) = state
                        .follow
                        .take()
                        .and_then(|target| Self::followable(state, target))
                    {
                        return Ok(PreparedForm::Follow(Box::new((continuation, target))));
                    }
                }
                Ok(None) => {}
                Err(error) => failure = Some(error),
            }
        }
        continuation
            .into_form_refresh(original, &config, completed, submitted, failure)
            .map(|checkpoint| PreparedForm::Refresh(Box::new(checkpoint)))
            .map_err(|_| crate::contract!())
    }

    async fn form_primitive(
        state: &mut WorkState,
        worker: &mut AgentRuntimeWorker,
        browser: &WorkBrowser<'_>,
        observation: &SemanticObservation,
        mut recipe: SemanticActionProposal,
        read_only: bool,
    ) -> Result<Result<SemanticObservation, AgentBrowserFormFault>, AgentWorkFailure> {
        state.native.check_control(worker, browser)?;
        state.refresh_account(worker, browser)?;
        let frames = observation
            .frames()
            .iter()
            .map(|frame| frame.frame().clone())
            .collect::<Vec<_>>();
        let session = state.session.as_mut().ok_or_else(|| crate::contract!())?;
        session
            .policy
            .admit_owned_observation(observation, session.account)
            .map_err(|_| crate::contract!())?;
        let batch =
            SemanticActionBatchId::new(session.next_action).ok_or_else(|| crate::contract!())?;
        let mut admitted = None;
        for _ in 0..2 {
            let Ok(proposal) = crate::AgentBrowserActionProposal::bind_code_owned(
                recipe.clone(),
                observation,
                &frames,
                batch,
            ) else {
                return Ok(Err(AgentBrowserFormFault::Target));
            };
            match state.task.assess_observed(proposal.action(), observation) {
                Ok(assessment) => {
                    if let Err(fault) = compound_effect(assessment.actual_effect(), read_only) {
                        return Ok(Err(fault));
                    }
                    if !state
                        .action_authority(observation)?
                        .permits_action(observation, &recipe)
                    {
                        return Ok(Err(AgentBrowserFormFault::Target));
                    }
                    admitted = Some((proposal, assessment));
                    break;
                }
                Err(AgentWorkFailure::EffectRequired(effect))
                    if (!read_only || effect == SemanticEffectClass::Read)
                        && matches!(
                            effect,
                            SemanticEffectClass::Read | SemanticEffectClass::LocalWrite
                        ) =>
                {
                    recipe = SemanticActionProposal::try_new(
                        recipe.intent().clone(),
                        effect,
                        recipe.wait(),
                        recipe.verification(),
                        recipe.settle_budget(),
                    )
                    .map_err(|_| crate::contract!())?;
                }
                Err(AgentWorkFailure::EffectRequired(_)) => {
                    return Ok(Err(AgentBrowserFormFault::SeparateActionRequired))
                }
                Err(AgentWorkFailure::ActionDenied) => {
                    return Ok(Err(AgentBrowserFormFault::Target))
                }
                Err(error) => return Err(error),
            }
        }
        let Some((proposal, assessment)) = admitted else {
            return Ok(Err(AgentBrowserFormFault::Target));
        };
        // A read (a picker opened, an option chosen) commits nothing: one the page
        // did not confirm is a fault to replan from, never the page's end.
        let reads = proposal.action().effect() == SemanticEffectClass::Read;
        state
            .journal_mut()?
            .emit(AgentWorkEventKind::ToolProposed(AgentBrowserToolKind::Act))?;
        let result = Self::execute_prepared_action(
            state,
            worker,
            browser,
            proposal,
            assessment,
            observation,
        )
        .await;
        let (current, _, transition) = match result {
            Ok(result) => result,
            Err(AgentWorkFailure::Browser(
                error @ AgentBrowserProviderError::Action(crate::AgentBrowserActionError::Failed(
                    failure,
                )),
            )) if crate::action::refused_before_acting(failure) => {
                let session = state.session.as_mut().ok_or_else(|| crate::contract!())?;
                let _ = session.take_rejected_refusal();
                if session
                    .close_failed_owned_action()
                    .map_err(AgentWorkFailure::Browser)?
                {
                    return Ok(Err(AgentBrowserFormFault::ChangedBeforeAction));
                }
                return Err(AgentWorkFailure::Browser(error));
            }
            Err(AgentWorkFailure::Browser(error))
                if (read_only || reads)
                    && matches!(
                        error,
                        AgentBrowserProviderError::Action(
                            crate::AgentBrowserActionError::Verification(_)
                                | crate::AgentBrowserActionError::Failed(_)
                        ) | AgentBrowserProviderError::ActionRejected(_)
                            | AgentBrowserProviderError::ActionUnverified
                    ) =>
            {
                let session = state.session.as_mut().ok_or_else(|| crate::contract!())?;
                let _ = session.take_rejected_refusal();
                if session
                    .close_failed_owned_action()
                    .map_err(AgentWorkFailure::Browser)?
                {
                    return Ok(Err(AgentBrowserFormFault::Unverified));
                }
                return Err(AgentWorkFailure::Browser(error));
            }
            Err(error) => return Err(error),
        };
        if let Some(batch) = transition.batch_result() {
            state.task.accept_verified_action(batch, &current)?;
        }
        Ok(Ok(current))
    }
}

impl AgentWorkController {
    /// A picker field (Delta's origin button, a date button): the choice its
    /// value names is taken when already shown; otherwise the button is
    /// clicked, the value typed into the box it focuses, if any, and the
    /// one matching suggestion or day chosen. Returns the latest page and
    /// whether a choice was made.
    async fn fill_picker(
        state: &mut WorkState,
        worker: &mut AgentRuntimeWorker,
        browser: &WorkBrowser<'_>,
        binding: &AgentBrowserFormBinding,
        index: usize,
        mut current: SemanticObservation,
    ) -> Result<(SemanticObservation, bool), AgentWorkFailure> {
        let values =
            zephium_agentic::semantic_picker_values(binding.field_value(index).unwrap_or_default());
        let value = values.first().cloned().unwrap_or_default();
        if zephium_agentic::semantic_sole_choice(&current, &value).is_none() {
            let Ok(button) = binding.field_reference(index, SemanticActionKind::Click, &current)
            else {
                return Ok((current, false));
            };
            let open = Self::form_recipe(SemanticActionIntent::Click { target: button })?;
            current = match Box::pin(Self::form_primitive(
                state, worker, browser, &current, open, true,
            ))
            .await?
            {
                Ok(next) => {
                    state.task_progress(&next)?;
                    next
                }
                Err(_) => return Ok((current, false)),
            };
            if let Some(field) = zephium_agentic::semantic_focused_text_field(&current) {
                let text =
                    SemanticActionText::try_new(value.clone()).map_err(|_| crate::contract!())?;
                let typed = SemanticActionProposal::try_new(
                    SemanticActionIntent::Fill {
                        target: field,
                        value: text,
                    },
                    SemanticEffectClass::LocalWrite,
                    SemanticWaitCondition::Immediate,
                    SemanticVerification::TargetValueMatchesInput,
                    SemanticSettleBudget::try_new(MIN_AGENT_BROWSER_SNAPSHOT_SETTLE_MILLIS)
                        .map_err(|_| crate::contract!())?,
                )
                .map_err(|_| crate::contract!())?;
                current = match Box::pin(Self::form_primitive(
                    state, worker, browser, &current, typed, false,
                ))
                .await?
                {
                    Ok(next) => {
                        state.task_progress(&next)?;
                        next
                    }
                    Err(_) => return Ok((current, false)),
                };
            }
        }
        if values.len() == 1 {
            let (current, outcome) = Box::pin(Self::choose_suggestion(
                state, worker, browser, binding, index, current, true,
            ))
            .await?;
            return Ok((current, outcome == Some(true)));
        }
        // A range picker's two days are chosen in turn in its calendar.
        for day in &values {
            let Some(choice) = zephium_agentic::semantic_sole_choice(&current, day) else {
                return Ok((current, false));
            };
            let click = Self::form_recipe(SemanticActionIntent::Click { target: choice })?;
            current = match Box::pin(Self::form_primitive(
                state, worker, browser, &current, click, true,
            ))
            .await?
            {
                Ok(next) => {
                    state.task_progress(&next)?;
                    next
                }
                Err(_) => return Ok((current, false)),
            };
        }
        Ok((current, true))
    }

    fn form_recipe(
        intent: SemanticActionIntent,
    ) -> Result<SemanticActionProposal, AgentWorkFailure> {
        SemanticActionProposal::try_new(
            intent,
            SemanticEffectClass::Read,
            SemanticWaitCondition::Immediate,
            SemanticVerification::PageChanged,
            SemanticSettleBudget::try_new(MIN_AGENT_BROWSER_SNAPSHOT_SETTLE_MILLIS)
                .map_err(|_| crate::contract!())?,
        )
        .map_err(|_| crate::contract!())
    }

    /// Clicks the one suggestion a field's popup offers for the value typed
    /// into it, when one clearly matches. With `late`, a popup not drawn yet
    /// is given a moment. Returns the latest page and Some(true) when one was
    /// chosen, Some(false) when the popup offers only several or none that
    /// match, None when no popup opened.
    #[allow(clippy::too_many_arguments)]
    async fn choose_suggestion(
        state: &mut WorkState,
        worker: &mut AgentRuntimeWorker,
        browser: &WorkBrowser<'_>,
        binding: &AgentBrowserFormBinding,
        index: usize,
        mut current: SemanticObservation,
        late: bool,
    ) -> Result<(SemanticObservation, Option<bool>), AgentWorkFailure> {
        // A popup the field opened can be drawn before its suggestions are.
        if late
            && zephium_agentic::semantic_typed_choices(&current).is_empty()
            && current
                .frames()
                .iter()
                .flat_map(|frame| frame.nodes())
                .any(|node| matches!(node.role(), SemanticRole::Dialog | SemanticRole::Listbox))
        {
            let wake = (Instant::now() + Duration::from_millis(400)).min(state.native.deadline);
            tokio::select! {
                biased;
                event = state.native.next_event(worker, browser) => {
                    state.native.retain(event?)?;
                    return Err(AgentWorkFailure::Mailbox);
                }
                () = tokio::time::sleep_until(tokio::time::Instant::from_std(wake)) => {}
            }
            current = Box::pin(Self::observe(state, worker, browser)).await?;
            state.task_progress(&current)?;
        }
        if zephium_agentic::semantic_typed_choices(&current).is_empty() {
            return Ok((current, None));
        }
        let Some(choice) = binding
            .field_value(index)
            .and_then(|value| zephium_agentic::semantic_sole_choice(&current, value))
        else {
            return Ok((current, Some(false)));
        };
        let click = Self::form_recipe(SemanticActionIntent::Click { target: choice })?;
        match Box::pin(Self::form_primitive(
            state, worker, browser, &current, click, true,
        ))
        .await?
        {
            Ok(next) => {
                state.task_progress(&next)?;
                Ok((next, Some(true)))
            }
            Err(_) => Ok((current, Some(false))),
        }
    }
}

fn compound_effect(
    effect: SemanticEffectClass,
    read_only: bool,
) -> Result<(), AgentBrowserFormFault> {
    match effect {
        SemanticEffectClass::Read => Ok(()),
        SemanticEffectClass::LocalWrite if !read_only => Ok(()),
        _ => Err(AgentBrowserFormFault::SeparateActionRequired),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn compound_submission_never_widens_an_effect_or_hides_why_it_stopped() {
        assert_eq!(compound_effect(SemanticEffectClass::Read, true), Ok(()));
        assert_eq!(
            compound_effect(SemanticEffectClass::LocalWrite, false),
            Ok(())
        );
        assert_eq!(
            compound_effect(SemanticEffectClass::LocalWrite, true),
            Err(AgentBrowserFormFault::SeparateActionRequired)
        );
    }
    #[test]
    fn every_consequential_effect_requires_its_separate_admission() {
        for effect in [
            SemanticEffectClass::ExternalWrite,
            SemanticEffectClass::Communication,
            SemanticEffectClass::Purchase,
            SemanticEffectClass::Destructive,
            SemanticEffectClass::CapabilityBoundary,
        ] {
            for read_only in [false, true] {
                assert_eq!(
                    compound_effect(effect, read_only),
                    Err(AgentBrowserFormFault::SeparateActionRequired)
                );
            }
        }
    }
    fn look(nodes: serde_json::Value) -> SemanticObservation {
        let identity = ContextIdentity::new(
            ContextId::generate(),
            ContextRunId::generate(),
            1_u128.into(),
            ContextKind::Owned,
        );
        let mut registry = ContextRegistry::new();
        registry
            .reserve(
                identity,
                ContextCapabilities::try_new(
                    ContextKind::Owned,
                    &[ContextCapability::Observe, ContextCapability::Act],
                )
                .unwrap(),
            )
            .unwrap();
        let operation = registry
            .begin_context(identity.id(), ContextOperationId::new(1).unwrap())
            .unwrap();
        registry
            .settle_construction(identity.id(), operation, ContextSettlement::Applied)
            .unwrap();
        let context = registry.join(identity.id()).unwrap();
        let frame = SemanticFrameJoin::try_new(
            context,
            FrameId::MAIN,
            context.frame_generation(),
            SemanticOrigin::parse("https://forms.example.test/").unwrap(),
            SemanticFrameTrust::SameOrigin,
        )
        .unwrap();
        let snapshot = decode_semantic_snapshot(
            SemanticDecodeContext::new(
                SemanticInvocationId::new(1).unwrap(),
                frame,
                SemanticSnapshotGeneration::new(1).unwrap(),
            ),
            &serde_json::to_vec(
                &json!({"v":SEMANTIC_WIRE_VERSION,"i":1,"g":1,"c":"complete","n":nodes}),
            )
            .unwrap(),
        )
        .unwrap();
        SemanticObservationAssembler::new(
            SemanticObservationRequest::initial(
                SemanticObservationId::new(1).unwrap(),
                context,
                SemanticObservationBudget::INITIAL_FILTERED,
            ),
            snapshot,
        )
        .unwrap()
        .finish()
        .unwrap()
    }
    #[test]
    fn batch_offer_is_limited_to_one_same_origin_get_search_form() {
        let nodes = json!([
            {"k":1,"r":"document"}, {"k":2,"p":0,"r":"landmark","lm":"search"},
            {"k":3,"p":1,"r":"textbox","n":"From","o":2,"ff":13},
            {"k":4,"p":1,"r":"textbox","n":"To","o":2,"ff":13}
        ]);
        let fill = SemanticActionProposal::try_new(
            SemanticActionIntent::Fill {
                target: SemanticReferenceId::parse("@a3").unwrap(),
                value: SemanticActionText::try_new("Northport".into()).unwrap(),
            },
            SemanticEffectClass::LocalWrite,
            SemanticWaitCondition::Immediate,
            SemanticVerification::TargetValueMatchesInput,
            SemanticSettleBudget::try_new(2000).unwrap(),
        )
        .unwrap();
        assert!(AgentWorkController::is_batchable_search_fill(
            &fill,
            &look(nodes.clone())
        ));
        let mut single = nodes.clone();
        single.as_array_mut().unwrap().pop();
        assert!(!AgentWorkController::is_batchable_search_fill(
            &fill,
            &look(single)
        ));
        let mut post = nodes.clone();
        post[2]["ff"] = json!(14);
        assert!(!AgentWorkController::is_batchable_search_fill(
            &fill,
            &look(post)
        ));
        let mut unrelated = nodes.clone();
        unrelated[3]["p"] = json!(0);
        assert!(!AgentWorkController::is_batchable_search_fill(
            &fill,
            &look(unrelated)
        ));
        let mut ordinary = nodes;
        ordinary[1]["lm"] = json!("main");
        assert!(!AgentWorkController::is_batchable_search_fill(
            &fill,
            &look(ordinary)
        ));
    }
}
