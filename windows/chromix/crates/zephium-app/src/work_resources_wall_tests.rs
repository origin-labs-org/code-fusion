//! A site task meeting a wall on the retained owner: the person is asked, the
//! model is not.
use super::*;

/// A page that is only a frame it cannot read, the way DataDome shows itself.
pub(super) fn check_result(
    request: WorkBrowserObservationRequest,
    callback: WorkBrowserObservationCompletionCallback,
) {
    let (invocation, completion) = request.into_parts();
    let wire = format!(
        r#"{{"v":1,"i":{},"g":{},"c":"complete","n":[{{"k":1,"r":"document","o":16}},{{"k":2,"p":0,"r":"frame_boundary","n":"DataDome CAPTCHA","b":{{"x":0,"y":0,"w":1280,"h":800}}}}]}}"#,
        invocation.invocation().get(),
        invocation.snapshot_generation().get()
    );
    callback(completion.settle(Ok(invocation.decode_result(wire.as_bytes()).unwrap())));
}

/// The site policy's part of the loop: every operation the page offers, and
/// no wall of its own, as the product's policy reads a frame it cannot name.
struct Policy;
impl AgentWorkLocalActionPolicy for Policy {
    fn allows_compound_forms(&self) -> bool {
        true
    }
    fn model_action_operations(
        &self,
        node: &SemanticNode,
        _: &SemanticObservation,
    ) -> Result<SemanticOperations, AgentWorkFailure> {
        Ok(node.operations())
    }
    fn assess(
        &self,
        action: &SemanticPreparedAction,
        _: &SemanticObservation,
    ) -> Result<AgentEffectAssessment, AgentWorkFailure> {
        Ok(AgentEffectAssessment::new(
            action,
            action.frame().origin().clone(),
            action.effect(),
        ))
    }
}

fn snapshot_stream(turn: usize) -> String {
    response_stream(1)
        .replace("\"extract\"", "\"snapshot\"")
        .replace(
            r#"{\"scope\":{\"kind\":\"initial\"},\"schema_id\":1}"#,
            r#"{\"scope\":{\"kind\":\"initial\"}}"#,
        )
        .replace("resp_1", &format!("resp_{turn}"))
        .replace("fc_1", &format!("fc_{turn}"))
        .replace("call_1", &format!("call_{turn}"))
}

/// A shop's site task on its first page, whose reads from `check_from` on
/// (counting the first as 1) show a bot check.
fn run_site(responses: Vec<String>, check_from: usize) -> AgentWorkRetainedOutcome {
    let _serial = crate::WORK_RUNTIME_TEST_SERIAL
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let native = Arc::new(Native::default());
    let target = ContextNavigationTarget::parse("https://shop.example.com/").unwrap();
    *native.final_document.lock().unwrap() = Some(target.clone());
    native.discovery.store(true, Ordering::Release);
    native.check_from_read.store(check_from, Ordering::Release);
    let port = native.clone();
    let owner = WorkResourceOwner::new(
        WorkId::generate(),
        ProfileId::generate(),
        Arc::new(|| true),
        Box::new(move |sink| {
            *port.resource_sink.lock().unwrap() = Some(sink);
            Some(port)
        }),
    )
    .unwrap();
    let mut construct = owner
        .construct_with_policy(
            WorkBrowserResourceId::generate(),
            ContextId::generate(),
            ContextProfileStorageClass::Ephemeral,
            target,
            WorkBrowserDocumentPolicy::SiteSession,
            now(),
        )
        .unwrap();
    let Some(LifecycleResult::Event(WorkBrowserResourceEvent::Retained(resource))) =
        construct.poll(now()).unwrap()
    else {
        panic!("original construction")
    };
    let mut acquire = owner
        .acquire(
            &resource,
            ContextRunId::generate(),
            now(),
            AgentPolicyInstant::from_millis(600_002),
        )
        .unwrap();
    let Some(LifecycleResult::Event(WorkBrowserResourceEvent::Acquired(lease))) =
        acquire.poll(now()).unwrap()
    else {
        panic!("original acquisition")
    };
    let browser = owner.retained_browser(lease, now()).unwrap();
    let binding = browser.binding();
    let scope =
        AgentNavigationDiscovery::try_new_site_session(binding.document().clone(), 4).unwrap();
    let input = input_for_context_effects(
        binding.frame().context().identity(),
        binding.frame().origin().clone(),
        Arc::new(Clock(AtomicU64::new(2))),
        binding.storage(),
        binding.document().clone(),
        AgentRunBudget::try_new(24, 1_000_000, 1_000_000, 1).unwrap(),
        (
            Instant::now() + Duration::from_secs(30),
            Some(scope.clone()),
        ),
        WorkBrowserDocumentPolicy::SiteSession,
        AgentEffectScope::try_new(&[SemanticEffectClass::Read, SemanticEffectClass::LocalWrite])
            .unwrap(),
    );
    let task = AgentWorkDiscoveryTask::try_new(
        binding.frame().context().identity(),
        scope,
        vec![SemanticExtractionFieldSchema::try_text("label".into(), true, 64).unwrap()],
    )
    .unwrap()
    .with_local_actions(Box::new(Policy));
    let turns = responses.len();
    let (transport, server) = fixture_provider_responses(responses);
    let (controller, mut result, scope) = AgentWorkRetainedController::try_new_for_probe(
        input,
        Box::new(browser),
        transport,
        AgentProviderCredential::try_new(
            AgentProviderKind::OpenAiResponses,
            "fixture-not-a-secret".into(),
        )
        .unwrap(),
        Arc::new(Audit(false)),
        Box::new(task),
    )
    .unwrap();
    let (_, lifecycle) = start(controller, scope);
    let mut outcome = None;
    wait_until(|| {
        while result.take_event().is_some() {}
        outcome = result.take_outcome();
        outcome.is_some()
    });
    assert!(matches!(
        lifecycle.drain_until(Instant::now() + Duration::from_secs(2)),
        AgentRuntimeScopedDrain::Drained(_)
    ));
    native.join();
    let mut destroy = owner.destroy(&resource).unwrap();
    assert!(matches!(
        destroy.poll(now()).unwrap(),
        Some(LifecycleResult::Event(WorkBrowserResourceEvent::Destroyed(
            _
        )))
    ));
    owner.seal_resources().unwrap();
    assert_eq!(server.join().unwrap(), turns);
    outcome.unwrap()
}

#[test]
fn a_bot_check_met_after_the_first_look_goes_to_the_person_not_to_the_model() {
    // The page was fine at first; a look the model asked for finds only the
    // check's frame. Rust reads it as it does at the first look, so the page
    // is handed over after the one model call and no second look is spent.
    let outcome = run_site(vec![snapshot_stream(1)], 2);
    let AgentWorkRetainedOutcome::WaitingForHuman(waiting) = outcome else {
        panic!("the check is the person's, not a failed page");
    };
    assert_eq!(
        waiting.request().reason(),
        AgentBrowserHumanReason::HumanChallenge
    );
    assert_eq!(waiting.closure().model_calls(), 1);
}
