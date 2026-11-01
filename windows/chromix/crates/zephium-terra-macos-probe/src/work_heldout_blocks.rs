//! Exact frozen creation tasks. These are distinct from owned-block edit fixtures.
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    io::Write,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::Duration,
};
use zephium_core::{
    ids::ProfileId,
    resources::*,
    work::{
        artifact::WorkArtifactDataV1,
        objects::{WorkListStyleV1, WorkSheetColumnKindV1},
        runtime::*,
        *,
    },
};

const MANIFEST: &str = include_str!("../../../eval/work-heldout-v1.json");
const NAMES: [&str; 3] = ["Aspen", "Birch", "Cedar"];
static ACTIVE: OnceLock<Fixture> = OnceLock::new();
struct Sentinel {
    profile: ProfileId,
    record: ResourceRecord,
    digest: String,
}
pub(super) struct Fixture {
    case: Value,
    export: PathBuf,
    sentinel: Mutex<Option<Sentinel>>,
}
pub(super) fn active() -> Option<&'static Fixture> {
    ACTIVE.get()
}
fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn case(id: &str) -> Result<Value, &'static str> {
    let manifest: Value = serde_json::from_str(MANIFEST).map_err(|_| "blocks_manifest")?;
    manifest["tasks"]
        .as_array()
        .and_then(|tasks| {
            tasks
                .iter()
                .find(|task| task["id"] == id && task["category"] == "blocks-fixture")
        })
        .cloned()
        .ok_or("blocks_case")
}
fn appendix(id: &str) -> Option<&'static str> {
    Some(match id {
        "blocks-checklist" => "Fixture inputs: the three item identities are Aspen, Birch, Cedar, in that order. Create a NEW checklist, with only Birch complete. Do not edit any existing block. No browsing, search, folders, commands, connections or external services.",
        "blocks-table" => "Fixture inputs: columns are Identity and Value. The original rows are Aspen=2, Birch=10, Cedar=3. Values are numeric; retain each identity/value association when sorting ascending. Create a NEW table. Do not edit any existing block. No browsing, search, folders, commands, connections or external services.",
        "blocks-calendar" => "Fixture inputs: event identities are Dawn and Noon. Initial local start times on 21 November 2026 are Dawn at 09:00 and Noon at 10:00, both Europe/Warsaw. The requested one-hour move applies only to Noon. Create a NEW calendar block; do not edit existing blocks or use external calendars, browsing, search, folders, commands or connections.",
        _ => return None,
    })
}
pub(super) fn configure(id: &str, export: &Path) -> Result<String, &'static str> {
    if ACTIVE.get().is_some()
        || !export.is_absolute()
        || export.exists()
        || export.with_extension("freeze.json").exists()
        || std::env::vars_os().any(|(key, _)| key.to_string_lossy().starts_with("ZEPHIUM_"))
    {
        return Err("blocks_scope");
    }
    let case = case(id)?;
    let appendix = appendix(id).ok_or("blocks_case")?;
    let objective = format!(
        "{} {appendix}",
        case["prompt"].as_str().ok_or("blocks_prompt")?
    );
    ACTIVE
        .set(Fixture {
            case,
            export: export.to_owned(),
            sentinel: Mutex::new(None),
        })
        .map_err(|_| "blocks_scope")?;
    Ok(objective)
}
async fn resource(
    handle: &zephium_app::Handle,
    profile: ProfileId,
    call: ResourceCall,
) -> Result<ResourceResponse, &'static str> {
    let receiver = handle.resource_call(profile, call);
    let reply = tokio::task::spawn_blocking(move || receiver.recv_timeout(Duration::from_secs(8)))
        .await
        .map_err(|_| "blocks_join")?
        .map_err(|_| "blocks_timeout")?;
    if reply.profile.as_deref() != Some(&profile.to_string()) {
        return Err("blocks_profile");
    }
    Ok(reply.response)
}
impl Fixture {
    /// Only an unrelated sentinel is seeded; the target must be created by the lead.
    pub(super) async fn seed(
        &self,
        handle: &zephium_app::Handle,
        profile: ProfileId,
    ) -> Result<(), &'static str> {
        if self.sentinel.lock().map_err(|_| "blocks_state")?.is_some() {
            return Err("blocks_seed_twice");
        }
        let response = resource(handle,profile,ResourceCall::Mutate { command: Box::new(ResourceCommand {
            version:1, request_id:WorkCommandId::generate().to_string(),
            intent:ResourceIntent::Create { draft:ResourceDraft {
                title:"Unrelated synthetic sentinel".into(), pinned:false, related:vec![],
                content:ResourceContent::Object { object:WorkObjectV1 { version:1,
                    data:serde_json::from_value(json!({"kind":"list","style":"reading","items":[{"title":"Sentinel remains unchanged"}]})).map_err(|_| "blocks_seed")?,
                    evidence:vec![],provenance:None } }
            }}
        })}).await?;
        let ResourceResponse::Applied { record, .. } = response else {
            return Err("blocks_seed");
        };
        let hash = digest(&serde_json::to_vec(&record).map_err(|_| "blocks_seed")?);
        let id_case = self.case["id"].as_str().ok_or("blocks_case")?;
        write(
            &self.export.with_extension("freeze.json"),
            &json!({
                "schema_version":1,"case_id":id_case,"manifest_sha256":digest(MANIFEST.as_bytes()),"frozen_case":self.case,
                "fixture_appendix":appendix(id_case),"fixture_appendix_sha256":digest(appendix(id_case).ok_or("blocks_case")?.as_bytes()),
                "target_seeded":false,"sentinel_id":record.id,"sentinel_sha256":hash,
                "authority":"Only creation of synthetic Work artifacts; original read-only boilerplate does not override the explicit create prompt. No folder/account/external-service grants or mutation.",
                "calendar_limitation":(id_case=="blocks-calendar").then_some("No typed timestamp/timezone in WorkPlanStepV1; full p2 must remain unknown")
            }),
        )?;
        *self.sentinel.lock().map_err(|_| "blocks_state")? = Some(Sentinel {
            profile,
            record,
            digest: hash,
        });
        Ok(())
    }
    pub(super) fn cleanup(&self) {}
    pub(super) async fn export(
        &self,
        handle: &zephium_app::Handle,
        profile: ProfileId,
        state: &WorkRuntimeProjection,
        models: &Value,
        diagnostics: Value,
        wall_ms: u128,
    ) -> Result<bool, &'static str> {
        let (id, before) = {
            let guard = self.sentinel.lock().map_err(|_| "blocks_state")?;
            let seed = guard.as_ref().ok_or("blocks_seed_missing")?;
            if seed.profile != profile {
                return Err("blocks_profile");
            }
            (seed.record.id.clone(), seed.digest.clone())
        };
        let ResourceResponse::Record { record } =
            resource(handle, profile, ResourceCall::Get { id: id.clone() }).await?
        else {
            return Err("blocks_sentinel_missing");
        };
        let after = digest(&serde_json::to_vec(&record).map_err(|_| "blocks_encode")?);
        let execution = state.executions.last().ok_or("blocks_execution")?;
        let published: Vec<_> = execution
            .steps
            .iter()
            .filter(|step| {
                step.status == WorkStepStatus::Succeeded
                    && matches!(step.kind, WorkStepKindV1::Publish)
            })
            .flat_map(|step| step.artifacts.iter())
            .collect();
        let artifacts: Vec<_> = execution
            .artifacts
            .iter()
            .filter(|artifact| {
                published.contains(&&artifact.id)
                    && !execution
                        .artifacts
                        .iter()
                        .any(|later| later.revises == Some(artifact.id))
            })
            .collect();
        let id_case = self.case["id"].as_str().ok_or("blocks_case")?;
        let targets: Vec<_> = artifacts
            .iter()
            .filter(|artifact| target(id_case, &artifact.data))
            .map(|artifact| &artifact.data)
            .collect();
        let p2 = if targets.len() == 1 {
            properties(id_case, targets[0])
        } else {
            None
        };
        let grants: Vec<_> = execution
            .spec
            .nodes
            .iter()
            .filter_map(|node| match &node.capability {
                WorkCapability::Agent { grant } => Some(grant),
                _ => None,
            })
            .collect();
        let p1 = state.executions.len() == 1
            && !grants.is_empty()
            && grants.iter().all(|grant| {
                grant.folders.is_empty() && grant.accounts.is_empty() && grant.private
            });
        let no_external = execution.provider_evidence.is_empty()
            && execution.command_evidence.is_empty()
            && execution.accounts.is_empty()
            && !execution.steps.iter().any(|step| {
                matches!(
                    step.kind,
                    WorkStepKindV1::Read { .. }
                        | WorkStepKindV1::Search { .. }
                        | WorkStepKindV1::Discover { .. }
                        | WorkStepKindV1::Call { .. }
                )
            });
        let p3 = before == after
            && no_external
            && artifacts
                .iter()
                .all(|artifact| super::work_local_fixture::artifact_allowed(&artifact.data));
        let unsupported=(id_case=="blocks-calendar").then_some("WorkPlanStepV1 has date and freeform when only; no typed timestamp or timezone contract");
        let status_admitted = matches!(
            execution.status,
            WorkExecutionStatus::Completed | WorkExecutionStatus::NeedsReview
        );
        let passed = status_admitted && p1 && p2 == Some(true) && p3;
        let value = json!({"schema_version":1,"case_id":id_case,"manifest_sha256":digest(MANIFEST.as_bytes()),"frozen_case":self.case,
            "authority":"Create only fresh synthetic Work artifacts. No target resource is seeded; unrelated sentinel must remain unchanged. No folders, account, network, external calendar or other service effects.",
            "fixture_appendix":appendix(id_case),"fixture_appendix_sha256":digest(appendix(id_case).ok_or("blocks_case")?.as_bytes()),
            "sentinel":{"id":id,"before_sha256":before,"after_sha256":after},
            "predicates":{"p1":p1,"p2":p2,"p3":p3},"passed":passed,"evaluation_status_admitted":status_admitted,"unsupported":unsupported,
            "models":models,"diagnostics":diagnostics,"wall_ms":wall_ms,"status":execution.status,
            "artifacts":artifacts.iter().map(|artifact|json!({"id":artifact.id,"revises":artifact.revises,"data":artifact.data})).collect::<Vec<_>>(),
            "publication_receipts":published,"target_candidates":targets.len(),
            "identity_basis":"Predeclared unique synthetic item or row labels, not invented product row-ID fields"});
        write(&self.export, &value)?;
        Ok(passed)
    }
}
fn target(id: &str, data: &WorkArtifactDataV1) -> bool {
    match id {
        "blocks-checklist" => matches!(
            data,
            WorkArtifactDataV1::List { .. } | WorkArtifactDataV1::Checklist { .. }
        ),
        "blocks-table" => matches!(
            data,
            WorkArtifactDataV1::Sheet { .. } | WorkArtifactDataV1::Table { .. }
        ),
        "blocks-calendar" => matches!(data, WorkArtifactDataV1::Plan { .. }),
        _ => false,
    }
}
fn numeric_value(value: &str) -> Option<i64> {
    let value = value.trim();
    if let Some((whole, fraction)) = value.split_once('.') {
        if fraction.is_empty() || !fraction.bytes().all(|byte| byte == b'0') {
            return None;
        }
        whole.parse().ok()
    } else {
        value.parse().ok()
    }
}
fn rows_match(columns: &[&str], rows: &[Vec<String>]) -> bool {
    columns == ["Identity", "Value"]
        && rows.len() == 3
        && rows
            .iter()
            .zip([("Aspen", 2), ("Cedar", 3), ("Birch", 10)])
            .all(|(row, (id, value))| {
                row.len() == 2 && row[0] == id && numeric_value(&row[1]) == Some(value)
            })
}
fn properties(id: &str, data: &WorkArtifactDataV1) -> Option<bool> {
    Some(match (id, data) {
        ("blocks-checklist", WorkArtifactDataV1::List { style, items }) => {
            *style == WorkListStyleV1::Todo
                && items.len() == 3
                && items
                    .iter()
                    .enumerate()
                    .all(|(i, item)| item.title == NAMES[i] && item.done == (i == 1))
        }
        ("blocks-checklist", WorkArtifactDataV1::Checklist { items }) => {
            items.len() == 3
                && items
                    .iter()
                    .enumerate()
                    .all(|(i, item)| item.text == NAMES[i] && item.completed == (i == 1))
        }
        ("blocks-table", WorkArtifactDataV1::Sheet { columns, rows, .. }) => {
            columns.len() == 2
                && columns[1].kind == WorkSheetColumnKindV1::Number
                && rows_match(
                    &columns
                        .iter()
                        .map(|column| column.label.as_str())
                        .collect::<Vec<_>>(),
                    &rows.iter().map(|row| row.cells.clone()).collect::<Vec<_>>(),
                )
        }
        ("blocks-table", WorkArtifactDataV1::Table { columns, rows }) => rows_match(
            &columns.iter().map(String::as_str).collect::<Vec<_>>(),
            rows,
        ),
        // Freeform strings are not a typed timestamp/timezone proof.
        ("blocks-calendar", _) => return None,
        _ => return None,
    })
}
fn write(path: &Path, value: &Value) -> Result<(), &'static str> {
    let bytes = serde_json::to_vec_pretty(value).map_err(|_| "blocks_export")?;
    if bytes.len() > 2 * 1024 * 1024 {
        return Err("blocks_export_bound");
    }
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path).map_err(|_| "blocks_export")?;
    file.write_all(&bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| "blocks_export")
}
#[cfg(test)]
mod tests {
    use super::*;
    fn data(value: Value) -> WorkArtifactDataV1 {
        serde_json::from_value(value).unwrap()
    }
    #[test]
    fn frozen_create_prompts_and_inputs_remain_distinct_from_old_edit_fixtures() {
        for id in ["blocks-checklist", "blocks-table", "blocks-calendar"] {
            assert!(case(id).unwrap()["prompt"]
                .as_str()
                .unwrap()
                .starts_with("Create"));
            assert!(appendix(id).unwrap().contains("NEW"));
        }
    }
    #[test]
    fn checklist_checks_identity_order_and_only_middle_completion() {
        let correct = json!({"kind":"list","style":"todo","items":[{"title":"Aspen"},{"title":"Birch","done":true},{"title":"Cedar"}]});
        assert_eq!(
            properties("blocks-checklist", &data(correct.clone())),
            Some(true)
        );
        let mut wrong = correct;
        wrong["items"][0]["done"] = json!(true);
        assert_eq!(properties("blocks-checklist", &data(wrong)), Some(false));
    }
    #[test]
    fn numeric_sort_preserves_identity_association_and_rejects_lexical_order() {
        let mut value = json!({"kind":"sheet","columns":[{"label":"Identity","kind":"text"},{"label":"Value","kind":"number"}],"rows":[{"cells":["Aspen","2"]},{"cells":["Cedar","3"]},{"cells":["Birch","10"]}]});
        assert_eq!(properties("blocks-table", &data(value.clone())), Some(true));
        let mut decimal = value.clone();
        decimal["rows"][0]["cells"][1] = json!("2.00");
        assert_eq!(properties("blocks-table", &data(decimal)), Some(true));

        value["rows"].as_array_mut().unwrap().swap(0, 2);
        assert_eq!(
            properties("blocks-table", &data(value.clone())),
            Some(false)
        );
        value["rows"] =
            json!([{"cells":["Birch","2"]},{"cells":["Cedar","3"]},{"cells":["Aspen","10"]}]);
        assert_eq!(properties("blocks-table", &data(value)), Some(false));
    }
    #[test]
    fn plausible_calendar_text_does_not_invent_a_typed_timezone() {
        let value = data(
            json!({"kind":"plan","calendar":true,"steps":[{"title":"Dawn","kind":"event","date":"2026-11-21","when":"09:00 Europe/Warsaw"},{"title":"Noon","kind":"event","date":"2026-11-21","when":"11:00 Europe/Warsaw"}]}),
        );
        assert_eq!(properties("blocks-calendar", &value), None);
    }
}
