use super::*;
use zephium_agentic::{
    AgentPolicyError, AgentProviderCallIdentity, AgentProviderInputMetricReceipt,
    AgentProviderModelClient, DecisionCallAccounting, DecisionCallFailure,
    DecisionCredentialProvider, DecisionObservation, DecisionObservationAnswers,
    DecisionProjectionError, JevDecisionClient, ModelDecisionCall, OpenAiDecisionCall,
    WorkPlanningConfig,
};

const EMULATION_INPUT_TOKENS: u32 = 32_768;
const EMULATION_OUTPUT_TOKENS: u32 = 4_096;
const EMULATION_COST_MICRO_USD: u64 = 100_000;
const REMAINING_PAGE_MODEL_CALLS: u8 = 2;

/// Trusted provider configuration; credentials remain provider-bound and zeroizing.
pub enum AgentBrowserDecisionProvider {
    /// Use the same typed questions through the existing OpenAI credential.
    Emulation,
    /// Direct TypeSafe BYOK loaded by the trusted Keychain adapter.
    TypeSafe(AgentProviderCredential<DecisionCredentialProvider>),
    /// TypeSafe selects actions only; unresolved choices return to the page planner.
    TypeSafeActions(AgentProviderCredential<DecisionCredentialProvider>),
    /// Trusted cloud-session endpoint and its separately bound bearer.
    Cloud {
        /// HTTPS service base URL supplied by the cloud session, never a page.
        base_url: String,
        /// Zeroizing cloud-session credential; a BYOK key is refused.
        credential: AgentProviderCredential<DecisionCredentialProvider>,
    },
}

pub(super) struct BrowserDecisions {
    jev: Option<JevDecisionClient>,
    emulation: DecisionEmulation,
    pub(super) actions_only: bool,
}

/// Who answers the typed questions the primary backend left open.
enum DecisionEmulation {
    /// GPT-6 Luna through the session's OpenAI key.
    OpenAi(WorkPlanningConfig),
    /// The person's chosen model through its own client.
    Model(AgentProviderModelClient),
}

struct Accounting<'a> {
    journal: Option<&'a mut work::WorkJournal>,
    receipts: &'a mut Vec<(AgentModelCallReceipt, AgentProviderInputMetricReceipt)>,
    turns: &'a mut u8,
    maximum: u8,
    failure: &'a mut Option<AgentBrowserProviderError>,
}

impl DecisionCallAccounting for Accounting<'_> {
    fn activated(&mut self, call: AgentProviderCallIdentity) -> bool {
        if *self.turns >= self.maximum {
            *self.failure = Some(AgentBrowserProviderError::TurnLimit);
            return false;
        }
        *self.turns += 1;
        if let Some(journal) = self.journal.as_mut() {
            if let Err(failure) = journal.model_active(call) {
                journal.failure.get_or_insert(failure);
                *self.failure = Some(AgentBrowserProviderError::Journal);
                return false;
            }
        }
        true
    }

    fn settled(&mut self, receipt: AgentModelCallReceipt, input: AgentProviderInputMetricReceipt) {
        self.receipts.push((receipt, input));
    }
}

impl AgentBrowserSession {
    /// A chosen decision model, else a chosen page model, answers what the
    /// primary backend leaves open; an exact session falls back to GPT-6 Luna.
    pub(super) fn configure_decisions(
        &mut self,
        provider: AgentBrowserDecisionProvider,
        model: Option<AgentProviderModelClient>,
    ) -> Result<(), AgentBrowserProviderError> {
        self.check_live()?;
        if self.turns != 0 || self.decisions.is_some() {
            return Err(crate::continuation!());
        }
        let actions_only = matches!(&provider, AgentBrowserDecisionProvider::TypeSafeActions(_));
        let jev = match provider {
            AgentBrowserDecisionProvider::Emulation => None,
            AgentBrowserDecisionProvider::TypeSafe(credential)
            | AgentBrowserDecisionProvider::TypeSafeActions(credential) => Some(
                JevDecisionClient::direct(self.transport.0.clone(), credential),
            ),
            AgentBrowserDecisionProvider::Cloud {
                base_url,
                credential,
            } => Some(JevDecisionClient::cloud(
                self.transport.0.clone(),
                credential,
                &base_url,
            )),
        }
        .transpose();
        let jev = match jev {
            Ok(client) => client,
            Err(DecisionCallFailure::Unavailable) => None,
            Err(_) => return Err(AgentBrowserProviderError::Transport),
        };
        let emulation = match model.or_else(|| self.chosen.clone()) {
            Some(model) => DecisionEmulation::Model(model),
            None => {
                let config = zephium_agent_model_catalog::try_gpt6_luna_decision_call_config(
                    EMULATION_OUTPUT_TOKENS,
                    zephium_agent_model_catalog::Gpt6LunaDecisionEffort::Low,
                )
                .map_err(|_| AgentBrowserProviderError::Catalog)?;
                DecisionEmulation::OpenAi(
                    WorkPlanningConfig::try_new(
                        config,
                        EMULATION_INPUT_TOKENS,
                        EMULATION_COST_MICRO_USD,
                    )
                    .map_err(|_| AgentBrowserProviderError::Catalog)?,
                )
            }
        };
        self.decisions = Some(BrowserDecisions {
            jev,
            emulation,
            actions_only,
        });
        Ok(())
    }

    pub(super) fn actions_only_decisions(&self) -> bool {
        self.decisions
            .as_ref()
            .is_some_and(|decisions| decisions.actions_only)
    }

    fn has_decision_capacity(&self) -> Result<bool, AgentBrowserProviderError> {
        Ok(
            self.turns.saturating_add(REMAINING_PAGE_MODEL_CALLS) < self.max_model_calls
                && self
                    .policy
                    .remaining_operations(self.lease.lease())
                    .map_err(AgentBrowserProviderError::RequestPolicy)?
                    > u32::from(REMAINING_PAGE_MODEL_CALLS),
        )
    }

    pub(super) async fn decide_observation(
        &mut self,
        observation: &zephium_agentic::SemanticObservation,
        authority: &zephium_agentic::AgentProviderActionAuthority,
        schema: Option<&zephium_agentic::SemanticExtractionSchema>,
        locate_only: bool,
    ) -> Result<Option<DecisionObservationAnswers>, AgentBrowserProviderError> {
        self.check_live()?;
        if self.decisions.is_none() || !self.has_decision_capacity()? {
            return Ok(None);
        }
        if self.attempt.is_some() || self.retained_terminal.is_some() || self.action.is_some() {
            return Err(AgentBrowserProviderError::ActionPending);
        }
        let objective = self
            .objective
            .as_ref()
            .ok_or_else(|| crate::continuation!())?;
        let built = project_observation(
            self.actions_only_decisions(),
            observation,
            objective,
            authority,
            self.account,
            schema,
            locate_only,
        );
        let projection = match built {
            Ok(projection) => projection,
            Err(DecisionProjectionError::Capacity) => return Ok(None),
            Err(_) => return Err(AgentBrowserProviderError::Authority),
        };
        self.decide_projection(observation, projection).await
    }

    /// A catalog read's second batch: which node inside each found record
    /// holds each text column. It discloses only those records.
    pub(super) async fn decide_row_cells(
        &mut self,
        observation: &zephium_agentic::SemanticObservation,
        discovery: &zephium_agentic::DecisionRowDiscovery,
    ) -> Result<Option<DecisionObservationAnswers>, AgentBrowserProviderError> {
        self.check_live()?;
        if self.actions_only_decisions() {
            return Ok(None);
        }
        if self.decisions.is_none() || !self.has_decision_capacity()? {
            return Ok(None);
        }
        if self.attempt.is_some() || self.retained_terminal.is_some() || self.action.is_some() {
            return Err(AgentBrowserProviderError::ActionPending);
        }
        let objective = self
            .objective
            .as_ref()
            .ok_or_else(|| crate::continuation!())?;
        let projection = match DecisionObservation::try_for_row_cells(
            observation,
            objective,
            self.account,
            discovery,
        ) {
            Ok(projection) => projection,
            Err(DecisionProjectionError::Capacity) => return Ok(None),
            Err(_) => return Err(AgentBrowserProviderError::Authority),
        };
        self.decide_projection(observation, projection).await
    }

    async fn decide_projection(
        &mut self,
        observation: &zephium_agentic::SemanticObservation,
        projection: DecisionObservation,
    ) -> Result<Option<DecisionObservationAnswers>, AgentBrowserProviderError> {
        #[cfg(feature = "probe-harness")]
        projection.record_anonymous_eval_request();
        let primary = if self
            .decisions
            .as_ref()
            .is_some_and(|decisions| decisions.jev.is_some())
        {
            let call = self.next_model_call_request_with_budget(
                JevDecisionClient::call_budget()
                    .map_err(AgentBrowserProviderError::RequestPolicy)?,
            )?;
            let decisions = self
                .decisions
                .as_ref()
                .ok_or(AgentBrowserProviderError::Authority)?;
            let client = decisions
                .jev
                .as_ref()
                .ok_or(AgentBrowserProviderError::Authority)?;
            let mut accounting = Accounting {
                journal: self.journal.as_mut(),
                receipts: &mut self.model_receipts,
                turns: &mut self.turns,
                maximum: self.max_model_calls,
                failure: &mut self.failure,
            };
            let output = client
                .evaluate_observation_accounted(
                    &mut self.policy,
                    call,
                    observation,
                    &projection,
                    self.deadline,
                    &self.cancellation,
                    Some(&mut accounting),
                )
                .await;
            self.settle_decision(output)?
        } else {
            Err(DecisionCallFailure::Unavailable)
        };
        let fallback = projection
            .route(primary)
            .map_err(|_| AgentBrowserProviderError::Authority)?;
        let can_emulate =
            !self.actions_only_decisions() && self.has_decision_capacity()? && self.can_emulate();
        if fallback.projection().is_some() {
            if let Some(journal) = &self.journal {
                journal
                    .emit(work::AgentWorkEventKind::DecisionFallback {
                        counts: fallback.fallback_counts(),
                        purposes: fallback.fallback_purposes(),
                        capacity: can_emulate,
                    })
                    .map_err(|_| AgentBrowserProviderError::Journal)?;
            }
        }
        let emulation = match fallback.projection().filter(|_| can_emulate) {
            Some(projection) => self.emulate(observation, projection).await?,
            None => None,
        };
        self.check_live()?;
        Ok(Some(fallback.finish(emulation)))
    }

    fn can_emulate(&self) -> bool {
        match self
            .decisions
            .as_ref()
            .map(|decisions| &decisions.emulation)
        {
            Some(DecisionEmulation::Model(_)) => true,
            Some(DecisionEmulation::OpenAi(_)) => {
                matches!(self.access, Some(AgentBrowserModelAccess::Exact(_)))
            }
            None => false,
        }
    }

    async fn emulate(
        &mut self,
        observation: &zephium_agentic::SemanticObservation,
        projection: &DecisionObservation,
    ) -> Result<Option<zephium_decision::DecisionResponse>, AgentBrowserProviderError> {
        self.check_live()?;
        let model = match self
            .decisions
            .as_ref()
            .map(|decisions| &decisions.emulation)
        {
            Some(DecisionEmulation::Model(model)) => Some(model.clone()),
            Some(DecisionEmulation::OpenAi(_)) => None,
            None => return Err(AgentBrowserProviderError::Authority),
        };
        let output = if let Some(model) = model {
            let budget = ModelDecisionCall::new(&self.transport, &model)
                .call_budget()
                .map_err(AgentBrowserProviderError::RequestPolicy)?;
            let call = self.next_model_call_request_with_budget(budget)?;
            let client = ModelDecisionCall::new(&self.transport, &model);
            let mut accounting = Accounting {
                journal: self.journal.as_mut(),
                receipts: &mut self.model_receipts,
                turns: &mut self.turns,
                maximum: self.max_model_calls,
                failure: &mut self.failure,
            };
            client
                .evaluate_observation(
                    &mut self.policy,
                    call,
                    observation,
                    projection,
                    self.deadline,
                    &self.cancellation,
                    Some(&mut accounting),
                )
                .await
        } else {
            let decisions = self
                .decisions
                .as_ref()
                .ok_or(AgentBrowserProviderError::Authority)?;
            let DecisionEmulation::OpenAi(config) = &decisions.emulation else {
                return Err(AgentBrowserProviderError::Authority);
            };
            let Some(AgentBrowserModelAccess::Exact(credential)) = self.access.as_ref() else {
                return Err(AgentBrowserProviderError::Cancelled);
            };
            let budget = OpenAiDecisionCall::try_new(&self.transport, credential, config)
                .map_err(|_| AgentBrowserProviderError::Catalog)?
                .call_budget()
                .map_err(AgentBrowserProviderError::RequestPolicy)?;
            let call = self.next_model_call_request_with_budget(budget)?;
            let decisions = self
                .decisions
                .as_ref()
                .ok_or(AgentBrowserProviderError::Authority)?;
            let DecisionEmulation::OpenAi(config) = &decisions.emulation else {
                return Err(AgentBrowserProviderError::Authority);
            };
            let Some(AgentBrowserModelAccess::Exact(credential)) = self.access.as_ref() else {
                return Err(AgentBrowserProviderError::Cancelled);
            };
            let client = OpenAiDecisionCall::try_new(&self.transport, credential, config)
                .map_err(|_| AgentBrowserProviderError::Catalog)?;
            let mut accounting = Accounting {
                journal: self.journal.as_mut(),
                receipts: &mut self.model_receipts,
                turns: &mut self.turns,
                maximum: self.max_model_calls,
                failure: &mut self.failure,
            };
            client
                .evaluate_observation(
                    &mut self.policy,
                    call,
                    observation,
                    projection,
                    self.deadline,
                    &self.cancellation,
                    Some(&mut accounting),
                )
                .await
        };
        Ok(self.settle_decision(output)?.ok())
    }

    fn settle_decision(
        &mut self,
        output: Result<zephium_agentic::AdmittedDecisionOutput, AgentPolicyError>,
    ) -> Result<
        Result<zephium_decision::DecisionResponse, DecisionCallFailure>,
        AgentBrowserProviderError,
    > {
        self.record_model_receipts()?;
        self.check_live()?;
        match output {
            Ok(output) => {
                if let Some(journal) = &self.journal {
                    journal
                        .emit(work::AgentWorkEventKind::DecisionSettled(
                            output.call.diagnostic,
                        ))
                        .map_err(|_| AgentBrowserProviderError::Journal)?;
                }
                Ok(output.call.response)
            }
            Err(AgentPolicyError::Budget) => Ok(Err(DecisionCallFailure::Capacity)),
            #[cfg(feature = "probe-harness")]
            Err(AgentPolicyError::ModelInputBudget { .. }) => {
                Ok(Err(DecisionCallFailure::Capacity))
            }
            Err(error) => Err(AgentBrowserProviderError::RequestPolicy(error)),
        }
    }
}

fn project_observation(
    actions_only: bool,
    observation: &zephium_agentic::SemanticObservation,
    objective: &zephium_agentic::AgentProviderObjective,
    authority: &zephium_agentic::AgentProviderActionAuthority,
    account: zephium_agentic::AgentContextAccountBinding,
    schema: Option<&zephium_agentic::SemanticExtractionSchema>,
    locate_only: bool,
) -> Result<DecisionObservation, DecisionProjectionError> {
    if actions_only {
        return DecisionObservation::try_for_actions(observation, objective, authority, account);
    }
    match schema.filter(|_| locate_only) {
        Some(schema) => {
            DecisionObservation::try_for_locate(observation, objective, authority, account, schema)
        }
        None => {
            DecisionObservation::try_for_read(observation, objective, authority, account, schema)
        }
    }
}

#[cfg(all(test, feature = "probe-harness"))]
mod action_mode_tests {
    use super::*;
    #[test]
    fn interaction_projection_cannot_turn_a_read_schema_into_jev_extraction_heads() {
        let (session, source) = super::super::tests::browser_fixture();
        let frame = &source.frames()[0];
        let wire = serde_json::to_vec(&serde_json::json!({"v":1,"i":1,"g":1,"c":"complete","n":[
            {"k":1,"r":"document","o":16},
            {"k":2,"p":0,"r":"paragraph","t":"Fixture detail ".repeat(200)},
            {"k":3,"p":0,"r":"paragraph","t":"Sort order"},
            {"k":4,"p":0,"r":"button","n":"Default","o":1}
        ]}))
        .unwrap();
        let snapshot = zephium_agentic::decode_semantic_snapshot(
            zephium_agentic::SemanticDecodeContext::new(
                frame.invocation(),
                frame.frame().clone(),
                frame.generation(),
            ),
            &wire,
        )
        .unwrap();
        let observation =
            zephium_agentic::SemanticObservationAssembler::new(source.request().clone(), snapshot)
                .unwrap()
                .finish()
                .unwrap();
        let authority = zephium_agentic::AgentProviderActionAuthority::try_new(
            &observation,
            &[(
                observation.frames()[0].nodes()[3].reference(),
                zephium_agentic::SemanticOperations::try_new(&[
                    zephium_agentic::SemanticOperationClass::Click,
                ])
                .unwrap(),
            )],
        )
        .unwrap();
        let objective = session.objective.as_ref().unwrap();
        let schema = zephium_agentic::SemanticExtractionSchema::try_new(
            zephium_agentic::SemanticExtractionSchemaId::new(1).unwrap(),
            vec![zephium_agentic::SemanticExtractionFieldSchema::try_text(
                "detail".into(),
                true,
                128,
            )
            .unwrap()
            .with_verbatim_text()
            .unwrap()],
        )
        .unwrap();
        let expected = DecisionObservation::try_for_actions(
            &observation,
            objective,
            &authority,
            session.account,
        )
        .unwrap()
        .into_anonymous_eval_requests()
        .unwrap()
        .0
        .encode()
        .unwrap();
        assert!(
            !String::from_utf8_lossy(&expected).contains("Fixture detail"),
            "action decisions must not pay for unrelated extraction prose"
        );
        for value in ["Default", "Sort order", "click_target"] {
            assert!(
                String::from_utf8_lossy(&expected).contains(value),
                "missing control context: {value}"
            );
        }
        let answers = project_observation(
            true,
            &observation,
            objective,
            &authority,
            session.account,
            Some(&schema),
            false,
        )
        .unwrap()
        .route(Err(DecisionCallFailure::Unavailable))
        .unwrap()
        .finish(None);
        assert!(answers.matches_observation(&observation, session.account));
        assert!(!answers.matches_observation(&source, session.account));
        let fresh_account = zephium_agentic::AgentContextAccountBinding::new(
            zephium_agentic::AgentAccountAttestationId::generate(),
            session.account.context(),
            session.account.account(),
            zephium_agentic::AgentPolicyInstant::from_millis(1002),
        );
        assert!(!answers.matches_observation(&observation, fresh_account));
        for locate in [false, true] {
            let actual = project_observation(
                true,
                &observation,
                objective,
                &authority,
                session.account,
                Some(&schema),
                locate,
            )
            .unwrap()
            .into_anonymous_eval_requests()
            .unwrap()
            .0
            .encode()
            .unwrap();
            assert_eq!(
                actual, expected,
                "action mode must never request value or row extraction"
            );
        }
        let read = project_observation(
            false,
            &observation,
            objective,
            &authority,
            session.account,
            Some(&schema),
            false,
        )
        .unwrap()
        .into_anonymous_eval_requests()
        .unwrap()
        .0
        .encode()
        .unwrap();
        assert!(
            read.len() > expected.len() + 2_000,
            "the action table must remove the unrelated prose"
        );
        assert_ne!(
            read, expected,
            "ordinary read decisions still retain their own schema"
        );
    }
}
