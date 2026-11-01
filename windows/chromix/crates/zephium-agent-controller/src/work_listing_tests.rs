use super::*;
use serde_json::json;

#[test]
fn native_listing_loads_the_missing_record_before_one_mapping_without_action_turns() {
    let _guard = lock(&SERIAL);
    provider_fixture(ProviderFault::Extraction(ExtractionFault::Listing));
}

#[test]
fn native_listing_policy_refusal_keeps_partial_records_without_dispatch() {
    let _guard = lock(&SERIAL);
    provider_fixture(ProviderFault::Extraction(ExtractionFault::ListingDenied));
}

pub(super) fn schema() -> SemanticExtractionFieldSchema {
    SemanticExtractionFieldSchema::try_rows(
        "label".into(),
        true,
        vec![
            SemanticExtractionFieldSchema::try_text("name".into(), true, 128)
                .unwrap()
                .with_verbatim_text()
                .unwrap(),
            SemanticExtractionFieldSchema::try_url("url".into(), true, 512).unwrap(),
        ],
        3,
    )
    .unwrap()
}

pub(super) struct WallClock(pub Instant);
impl TerraControllerClock for WallClock {
    fn now(&self) -> Result<AgentPolicyInstant, super::super::super::TerraControllerClockError> {
        Ok(AgentPolicyInstant::from_millis(
            FIXTURE_POLICY_NOW_MILLIS + self.0.elapsed().as_millis() as u64,
        ))
    }
}

pub(super) struct ListingTask(pub AgentWorkExtractionTask, pub bool);
impl AgentWorkTask for ListingTask {
    fn allows_progressive_observation(&self) -> bool {
        true
    }
    fn allows_baseline_read(&self) -> bool {
        true
    }
    fn allows_actions_before_extraction(&self) -> bool {
        true
    }
    fn extraction_schema(&self) -> Option<&SemanticExtractionSchema> {
        self.0.extraction_schema()
    }
    fn evaluate(
        &mut self,
        _: &SemanticObservation,
    ) -> Result<AgentWorkTaskProgress, AgentWorkFailure> {
        Ok(AgentWorkTaskProgress::ReadyForExtraction)
    }
    fn assess(
        &self,
        action: &SemanticPreparedAction,
    ) -> Result<AgentEffectAssessment, AgentWorkFailure> {
        assert_eq!(action.kind(), SemanticActionKind::Click);
        if self.1 {
            return Err(AgentWorkFailure::ActionDenied);
        }
        Ok(AgentEffectAssessment::new(
            action,
            action.frame().origin().clone(),
            SemanticEffectClass::Read,
        ))
    }
    fn attest_account(
        &self,
        context: ContextJoin,
        now: AgentPolicyInstant,
    ) -> Result<AgentContextAccountBinding, AgentWorkFailure> {
        self.0.attest_account(context, now)
    }
    fn accept_extraction(
        &mut self,
        result: &SemanticExtractionResult<'_>,
    ) -> Result<AgentWorkTaskProgress, AgentWorkFailure> {
        self.0.accept_extraction(result)
    }
}

pub(super) fn wire(invocation: u64, generation: u64, loaded: bool) -> String {
    let mut nodes = vec![
        json!({"k":1,"r":"document","o":16,"fc":true}),
        json!({"k":2,"p":0,"r":"list","fc":true}),
    ];
    for (index, title) in ["First record", "Second record", "Third record"]
        .into_iter()
        .take(if loaded { 3 } else { 2 })
        .enumerate()
    {
        let root = 2 + index * 3;
        nodes.extend([
            json!({"k":root+1,"p":1,"r":"list_item","fc":true}),
            json!({"k":root+2,"p":root,"r":"heading","l":2,"n":title,"fc":true}),
            json!({"k":root+3,"p":root+1,"r":"link","n":title,"u":format!("https://example.test/item?id={}",index+1),"o":1,"fc":true}),
        ]);
    }
    if !loaded {
        nodes.push(json!({"k":12,"p":0,"r":"button","n":"Load more","o":1,"fc":true,"b":{"x":10,"y":20,"w":120,"h":30}}));
    }
    json!({"v":SEMANTIC_WIRE_VERSION,"i":invocation,"g":generation,"c":"complete","n":nodes})
        .to_string()
}

pub(super) fn mapped_rows(count: usize) -> String {
    json!({"k":"rows","rows":(0..count).map(|i| json!({"fields":[
        {"name":"name","value":{"k":"text","sources":[format!("@r{}",1+i*3)]}},
        {"name":"url","value":{"k":"url","sources":[format!("@r{}",3+i*3)]}}
    ]})).collect::<Vec<_>>()})
    .to_string()
}

pub(super) fn assert_result(
    outcome: AgentWorkOutcome,
    shutdown: AgentBrowserShutdownOutcome,
    calls: &[u8],
    denied: bool,
) {
    let AgentWorkOutcome::Succeeded(mut success) = outcome else {
        panic!("{outcome:?}")
    };
    assert_eq!(
        success.closure().model_calls(),
        2,
        "one extraction decision and one mapping"
    );
    assert_eq!(
        calls.iter().filter(|&&call| call == 7).count(),
        usize::from(!denied),
        "native loading cannot bypass task approval"
    );
    let result = success.take_extraction().unwrap();
    let SemanticExtractedValue::Rows(rows) = result.fields()[0].value() else {
        panic!("rows")
    };
    assert_eq!(rows.items().len(), if denied { 2 } else { 3 });
    assert!(matches!(shutdown, AgentBrowserShutdownOutcome::Clean(_)));
}
