//! Throwaway owned blocks exercised through the real Luna lead. Assertions
//! inspect durable resource data, never the model's claimed completion.
use serde_json::{json, Value};
use std::time::Duration;
use zephium_core::{
    ids::{ProfileId, SpaceId},
    resources::*,
    work::{context::WorkContextSelectionV1, environment::*, port::*, runtime::*, *},
};

pub(super) struct Fixture {
    selection: WorkContextSelectionV1,
    resource: String,
    initial: Value,
    name: &'static str,
}
impl Fixture {
    pub(super) fn selection(&self) -> WorkContextSelectionV1 {
        self.selection.clone()
    }
}
async fn resource(
    handle: &zephium_app::Handle,
    profile: ProfileId,
    call: ResourceCall,
) -> Result<ResourceResponse, &'static str> {
    let rx = handle.resource_call(profile, call);
    let reply = tokio::task::spawn_blocking(move || rx.recv_timeout(Duration::from_secs(8)))
        .await
        .map_err(|_| "blocks_join")?
        .map_err(|_| "blocks_timeout")?;
    if reply.profile.as_deref() != Some(&profile.to_string()) {
        return Err("blocks_profile");
    }
    Ok(reply.response)
}
async fn environment(
    handle: &zephium_app::Handle,
    profile: ProfileId,
    call: WorkEnvironmentCall,
) -> Result<WorkEnvironmentSnapshot, &'static str> {
    let request = handle
        .work_call(
            profile,
            zephium_ipc::work::WorkCallV1::Environment {
                version: 1,
                request: call,
            },
        )
        .map_err(|_| "blocks_environment_admission")?;
    let reply = tokio::time::timeout(Duration::from_secs(8), request)
        .await
        .map_err(|_| "blocks_environment_timeout")?
        .map_err(|_| "blocks_environment_read")?;
    if reply.profile != profile {
        return Err("blocks_environment_profile");
    }
    match reply.reply {
        WorkReply::Environment(WorkEnvironmentReply::Applied { snapshot, .. }) => Ok(*snapshot),
        _ => Err("blocks_environment_reply"),
    }
}
pub(super) async fn seed(
    handle: &zephium_app::Handle,
    profile: ProfileId,
    space: SpaceId,
    name: &'static str,
) -> Result<Option<Fixture>, &'static str> {
    let initial = match name {
        "blocks-checklist" => {
            json!({"kind":"list","style":"todo","items":[{"title":"Pack passport","due":"2026-11-20","done":false},{"title":"Confirm train","due":"2026-11-19","done":true}]})
        }
        "blocks-table" => {
            json!({"kind":"sheet","columns":[{"label":"Task","kind":"text"},{"label":"Owner","kind":"text"},{"label":"Status","kind":"text"}],"rows":(1..=199).map(|n|json!({"cells":[format!("Item{n:03}"),"Ada","Todo"]})).collect::<Vec<_>>()})
        }
        "blocks-calendar" => {
            json!({"kind":"plan","calendar":true,"steps":[{"title":"Lunch","kind":"event","date":"2026-11-21","when":"12:00"},{"title":"Train","kind":"travel","date":"2026-11-20","when":"08:00"}]})
        }
        _ => return Ok(None),
    };
    if [
        "ZEPHIUM_PROBE_PROFILE",
        "ZEPHIUM_PROBE_SEEDED_PROFILE",
        "ZEPHIUM_PROBE_WORK_MEMORY",
    ]
    .iter()
    .any(|k| std::env::var_os(k).is_some())
    {
        return Err("blocks_require_fresh_profile");
    }
    let response = resource(
        handle,
        profile,
        ResourceCall::Mutate {
            command: Box::new(ResourceCommand {
                version: 1,
                request_id: WorkCommandId::generate().to_string(),
                intent: ResourceIntent::Create {
                    draft: ResourceDraft {
                        title: "Synthetic block".into(),
                        pinned: false,
                        related: vec![],
                        content: ResourceContent::Object {
                            object: WorkObjectV1 {
                                version: 1,
                                data: serde_json::from_value(initial.clone())
                                    .map_err(|_| "blocks_data")?,
                                evidence: vec![],
                                provenance: None,
                            },
                        },
                    },
                },
            }),
        },
    )
    .await?;
    let ResourceResponse::Applied { record, .. } = response else {
        return Err("blocks_create");
    };
    let canvas = environment(
        handle,
        profile,
        WorkEnvironmentCall::Command {
            command: WorkCommandId::generate(),
            intent: WorkEnvironmentIntent::Create {
                space,
                title: "Synthetic blocks".into(),
            },
        },
    )
    .await?;
    let canvas = environment(
        handle,
        profile,
        WorkEnvironmentCall::Command {
            command: WorkCommandId::generate(),
            intent: WorkEnvironmentIntent::Edit {
                id: canvas.id,
                expected: canvas.revision,
                edit: WorkEnvironmentEdit::Add {
                    reference: WorkEnvironmentReference::Resource {
                        resource: zephium_core::ids::ResourceId::parse(&record.id)
                            .ok_or("blocks_id")?,
                    },
                    area: None,
                },
            },
        },
    )
    .await?;
    Ok(Some(Fixture {
        selection: WorkContextSelectionV1 {
            environment: canvas.id,
            items: vec![],
            tabs: false,
            blocks: true,
        },
        resource: record.id,
        initial,
        name,
    }))
}
pub(super) async fn verify(
    handle: &zephium_app::Handle,
    profile: ProfileId,
    fixture: &Fixture,
    state: &WorkRuntimeProjection,
) -> Result<(), &'static str> {
    let ResourceResponse::Record { record } = resource(
        handle,
        profile,
        ResourceCall::Get {
            id: fixture.resource.clone(),
        },
    )
    .await?
    else {
        return Err("blocks_readback");
    };
    let ResourceContent::Object { object } = &record.draft.content else {
        return Err("blocks_object");
    };
    let data = serde_json::to_value(&object.data).map_err(|_| "blocks_encode")?;
    let correct = match fixture.name {
        "blocks-checklist" => {
            data["items"].as_array().is_some_and(|a| a.len() == 3)
                && data["items"][0]["done"] == true
                && data["items"][0]["due"] == "2026-11-20"
                && data["items"][1] == fixture.initial["items"][1]
                && data["items"][2]["title"] == "Book taxi"
                && data["items"][2]["due"] == "2026-11-21"
        }
        "blocks-table" => {
            data["columns"] == fixture.initial["columns"]
                && data["rows"].as_array().is_some_and(|rows| {
                    rows.len() == 200
                        && (0..199).all(|i| {
                            if i == 119 {
                                rows[i]["cells"] == json!(["Item120", "Ada", "Ready"])
                            } else {
                                rows[i] == fixture.initial["rows"][i]
                            }
                        })
                        && rows[199]["cells"] == json!(["Item200", "Ada", "Todo"])
                })
        }
        "blocks-calendar" => {
            data["calendar"] == true
                && data["steps"].as_array().is_some_and(|a| a.len() == 3)
                && data["steps"][0]["title"] == "Lunch"
                && data["steps"][0]["date"] == "2026-11-22"
                && data["steps"][0]["when"] == "13:00"
                && data["steps"][1] == fixture.initial["steps"][1]
                && data["steps"][2]["title"] == "Walk"
                && data["steps"][2]["date"] == "2026-11-23"
                && data["steps"][2]["when"] == "09:00"
        }
        _ => false,
    };
    let edits:Vec<_>=state.executions.iter().flat_map(|e|&e.steps).filter(|s|matches!(&s.kind,WorkStepKindV1::EditBlock {resource,..} if resource==&fixture.resource)).collect();
    let receipts = !edits.is_empty() && edits.iter().all(|s| s.status == WorkStepStatus::Succeeded);
    println!(
        "blocks-proof: case={} exact_resource={} settled_edits={} revision={}",
        fixture.name, correct, receipts, record.revision
    );
    if correct && receipts {
        Ok(())
    } else {
        Err("blocks_predicate")
    }
}
