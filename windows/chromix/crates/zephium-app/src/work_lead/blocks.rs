//! Context-bound edits to owned checklist, table and calendar resources.
//! A read pins the full local basis; the model receives bounded rows. Only
//! explicit conflicts are rebased once. An uncertain write is never replayed.
use super::tools::{
    LeadRunView, LeadScope, LeadToolContext, LeadToolFuture, LeadToolOutcome, LeadToolSet,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Mutex,
    time::Duration,
};
use zephium_core::{
    resources::*,
    work::{
        artifact::{WorkArtifactDataV1, WorkEvidenceLink},
        context::WorkContextSelectionV1,
        environment::WorkEnvironmentReference,
        model::{WorkModelTool, WorkModelToolCall},
        runtime::*,
        WorkCommandId,
    },
};

const TIMEOUT: Duration = Duration::from_secs(8);
const MAX_ROWS: usize = 50;
const MAX_CHANGES: usize = 32;
const MAX_REPLY: usize = 24 * 1024;

#[derive(Clone)]
struct ReadBlock {
    record: ResourceRecord,
    seen: BTreeSet<usize>,
}

#[derive(Default)]
pub(crate) struct BlockScope {
    selection: Mutex<Option<WorkContextSelectionV1>>,
    implicit_kind: Mutex<Option<String>>,
    read: Mutex<BTreeMap<String, ReadBlock>>,
    uncertain: Mutex<BTreeSet<String>>,
    private: Mutex<Vec<String>>,
    serial: tokio::sync::Mutex<()>,
}
impl BlockScope {
    pub fn bind(&self, mut selection: Option<WorkContextSelectionV1>, request: &str) {
        let kind = referenced_kind(request);
        if let Some(selected) = &mut selection {
            if selected.items.is_empty() {
                selected.blocks &= kind.is_some();
                if selected.blocks {
                    *self
                        .implicit_kind
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner) =
                        kind.map(str::to_owned);
                }
            }
        }
        *self
            .selection
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = selection;
    }
    pub(crate) fn private_texts(&self) -> Vec<String> {
        self.private
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }
    fn retain_private(&self, text: String) -> Result<(), String> {
        let mut texts = self
            .private
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if !texts.contains(&text) {
            if texts.len() >= 64
                || texts.iter().map(String::len).sum::<usize>() + text.len() > 512 * 1024
            {
                return Err("The private block context budget is full".into());
            }
            texts.push(text);
        }
        Ok(())
    }
    pub fn available(&self) -> bool {
        self.selection
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .as_ref()
            .is_some_and(|s| s.blocks || !s.items.is_empty())
    }
}

/// Conservative implicit references; anything ambiguous needs an explicit selection.
fn referenced_kind(request: &str) -> Option<&'static str> {
    let words: Vec<_> = request
        .split(|c: char| !c.is_ascii_alphabetic())
        .filter(|s| !s.is_empty())
        .map(str::to_ascii_lowercase)
        .collect();
    let mut found = BTreeSet::new();
    for pair in words.windows(2) {
        if ["this", "my", "the"].contains(&pair[0].as_str()) {
            match pair[1].as_str() {
                "checklist" => {
                    found.insert("checklist");
                }
                "table" => {
                    found.insert("table");
                }
                "calendar" => {
                    found.insert("calendar");
                }
                _ => {}
            }
        }
    }
    if found.len() == 1 {
        found.first().copied()
    } else {
        None
    }
}

pub(crate) struct BlockTools;
impl LeadToolSet for BlockTools {
    fn tools(&self, scope: LeadScope, run: &LeadRunView<'_>) -> Vec<WorkModelTool> {
        if scope != LeadScope::Lead || !run.run.blocks.available() {
            return vec![];
        }
        vec![
            WorkModelTool { name: "read_block".into(), description: "Read the specifically requested owned checklist, table or calendar on this canvas. An omitted id resolves only one matching kind; ambiguity requires the person to select one. Returns exact revision, structure and at most 50 rows, with offset/count. Read before revising. Never inspect unrelated blocks.".into(), schema: json!({"type":"object","properties":{"id":{"type":"string"},"kind":{"type":"string","enum":["checklist","table","calendar"]},"offset":{"type":"integer","minimum":0},"limit":{"type":"integer","minimum":1,"maximum":50}},"additionalProperties":false}), strict:false },
            WorkModelTool { name: "revise_block".into(), description: "Edit only a block read in this request, using its id and exact revision. Changes address zero-based row index and fields; table cells use field=cell and column. Checklist fields: title,detail,due,done. Calendar: title,detail,date,when,place,cost,kind. Append contains new row/item objects in the read structure (table: cells), optionally source with a known run source key such as s1. Columns and untouched fields are preserved. At most 32 changes/appends. No deletion or reorder. A conflict merges disjoint edits once; uncertain writes must not be retried.".into(), schema:json!({"type":"object","properties":{"id":{"type":"string"},"revision":{"type":"string"},"changes":{"type":"array","items":{"type":"object","properties":{"index":{"type":"integer","minimum":0},"field":{"type":"string"},"column":{"type":"integer","minimum":0},"value":{}},"required":["index","field","value"],"additionalProperties":false}},"append":{"type":"array","items":{"type":"object"}}},"required":["id","revision"],"additionalProperties":false}),strict:false },
        ]
    }
    fn call<'a>(
        &'a self,
        context: LeadToolContext<'a>,
        call: WorkModelToolCall,
    ) -> LeadToolFuture<'a> {
        Box::pin(async move {
            let Ok(_serial) = context.run.blocks.serial.try_lock() else {
                return LeadToolOutcome::error("Another block operation is in flight; use its result before another block call");
            };
            let result = match call.name.as_str() {
                "read_block" => {
                    tokio::time::timeout(Duration::from_secs(10), read(context, call.arguments))
                        .await
                        .unwrap_or_else(
                            |_| Err("The block read timed out; no edit was made".into()),
                        )
                }
                "revise_block" => revise(context, call.arguments).await,
                _ => Err("Unknown block tool".into()),
            };
            match result {
                Ok(value) => LeadToolOutcome::ok(value),
                Err(error) => LeadToolOutcome::error(error),
            }
        })
    }
}

fn shape(data: &WorkArtifactDataV1) -> Option<(&'static str, &'static str)> {
    match data {
        WorkArtifactDataV1::List {
            style: zephium_core::work::objects::WorkListStyleV1::Todo,
            ..
        } => Some(("checklist", "items")),
        WorkArtifactDataV1::Sheet { .. } => Some(("table", "rows")),
        WorkArtifactDataV1::Plan { calendar: true, .. } => Some(("calendar", "steps")),
        _ => None,
    }
}
fn object(record: &ResourceRecord) -> Result<&WorkObjectV1, String> {
    match &record.draft.content {
        ResourceContent::Object { object } if !record.trashed && shape(&object.data).is_some() => {
            Ok(object)
        }
        _ => Err("This is not an available checklist, table or calendar".into()),
    }
}
async fn resource(
    context: LeadToolContext<'_>,
    call: ResourceCall,
) -> Result<ResourceResponse, ResourceError> {
    let receiver = context.handle().resource_call(context.profile(), call);
    let reply = tokio::task::spawn_blocking(move || receiver.recv_timeout(TIMEOUT))
        .await
        .map_err(|_| ResourceError::OutcomeUnknown)?
        .map_err(|_| ResourceError::OutcomeUnknown)?;
    if reply.profile.as_deref() != Some(&context.profile().to_string()) {
        return Err(ResourceError::OutcomeUnknown);
    }
    match reply.response {
        ResourceResponse::Error { error } => Err(error),
        reply => Ok(reply),
    }
}
async fn candidate(
    context: LeadToolContext<'_>,
    id: &str,
) -> Result<Option<ResourceRecord>, String> {
    match resource(context, ResourceCall::Get { id: id.into() }).await {
        Ok(ResourceResponse::Record { record }) if record.id == id => {
            Ok(object(&record).is_ok().then_some(record))
        }
        Err(ResourceError::NotFound) => Ok(None),
        _ => Err(
            "The canvas candidates could not all be checked; no implicit target was chosen".into(),
        ),
    }
}
async fn get(context: LeadToolContext<'_>, id: &str) -> Result<ResourceRecord, String> {
    candidate(context, id)
        .await?
        .ok_or_else(|| "This block is no longer available".into())
}
/// Resolve against the live canvas on every call, never a model-supplied id alone.
async fn candidates(context: LeadToolContext<'_>) -> Result<Vec<String>, String> {
    let selection = context
        .run
        .blocks
        .selection
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone()
        .ok_or("No canvas context was admitted")?;
    let environment = crate::work_context::WorkContextAdmission::new(context.handle().clone())
        .environment(context.profile(), selection.environment)
        .await
        .map_err(|_| "The canvas is unavailable")?;
    if environment.lifecycle != zephium_core::work::WorkLifecycle::Active {
        return Err("The canvas is archived".into());
    }
    let selected: BTreeSet<_> = selection.items.iter().map(|i| i.element).collect();
    let ids: Vec<_> = environment
        .elements
        .iter()
        .filter(|e| {
            if selected.is_empty() {
                selection.blocks
            } else {
                selected.contains(&e.id)
            }
        })
        .filter_map(|e| match &e.reference {
            WorkEnvironmentReference::Resource { resource } => Some(resource.to_string()),
            _ => None,
        })
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    if ids.len() > 16 {
        return Err("Select the requested block; this canvas has too many candidates".into());
    }
    Ok(ids)
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ReadArgs {
    id: Option<String>,
    kind: Option<String>,
    #[serde(default)]
    offset: usize,
    limit: Option<usize>,
}
async fn read(context: LeadToolContext<'_>, args: Value) -> Result<String, String> {
    let args: ReadArgs = serde_json::from_value(args).map_err(|_| "Invalid read_block fields")?;
    let limit = args.limit.unwrap_or(20);
    if !(1..=MAX_ROWS).contains(&limit)
        || args.offset > 200
        || args
            .kind
            .as_deref()
            .is_some_and(|k| !["checklist", "table", "calendar"].contains(&k))
    {
        return Err("Use a supported kind and limit 1–50".into());
    }
    if args.id.is_none() && args.kind.is_none() {
        return Err("Name the requested kind or selected block id".into());
    }
    let implicit = context
        .run
        .blocks
        .implicit_kind
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone();
    if implicit
        .as_deref()
        .is_some_and(|kind| args.kind.as_deref().is_some_and(|asked| asked != kind))
    {
        return Err("Only the block kind referenced by this request is admitted".into());
    }
    let ids = candidates(context).await?;
    if args.id.as_ref().is_some_and(|id| !ids.contains(id)) {
        return Err("That block is not in the admitted canvas context".into());
    }
    let mut matches = Vec::new();
    for id in ids
        .into_iter()
        .filter(|id| args.id.as_ref().is_none_or(|asked| asked == id))
    {
        if context.cancelled().await {
            return Err("The run stopped before the block read".into());
        }
        if let Some(record) = candidate(context, &id).await? {
            if args
                .kind
                .as_deref()
                .or(implicit.as_deref())
                .is_none_or(|kind| {
                    object(&record)
                        .ok()
                        .and_then(|o| shape(&o.data))
                        .is_some_and(|s| s.0 == kind)
                })
            {
                matches.push(record);
            }
        }
    }
    if matches.len() != 1 {
        return Err(if matches.is_empty() {
            "No matching block is available"
        } else {
            "Several blocks match; ask the person to select one. No block content was disclosed"
        }
        .into());
    }
    let record = matches.pop().ok_or("No matching block is available")?;
    let object = object(&record)?;
    let (kind, key) = shape(&object.data).ok_or("Unsupported block")?;
    let mut data = serde_json::to_value(&object.data).map_err(|_| "Could not encode block")?;
    super::objects::strip_native_media(&mut data);
    let all = data[key].as_array().ok_or("Invalid block rows")?;
    let count = all.len();
    if args.offset > count {
        return Err("Offset is past the end of the block".into());
    }
    let mut rows = all[args.offset..]
        .iter()
        .take(limit)
        .cloned()
        .collect::<Vec<_>>();
    loop {
        data[key] = json!(rows);
        let reply=json!({"id":record.id,"revision":record.revision,"title":record.draft.title,"kind":kind,"offset":args.offset,"count":count,"returned":rows.len(),"data":data}).to_string();
        if reply.len() <= MAX_REPLY {
            crate::work_context::require_model_safe_text(&reply).map_err(|_| {
                "This block contains recognizable credentials; remove them before sharing it with the model".to_owned()
            })?;
            context
                .run
                .blocks
                .retain_private(object.data.plain_text())?;
            context.run.mark_private();
            context
                .probe()
                .commit_step(WorkRuntimeUpdate::Input {
                    execution: context.execution(),
                    attempt: context.attempt(),
                    input: zephium_core::work::parts::WorkInputFactV1 {
                        kind: zephium_core::work::parts::WorkInputKindV1::Work,
                        label: "Canvas block".into(),
                        count: Some(1),
                        reference: Some(record.id.clone()),
                    },
                })
                .await
                .map_err(|_| {
                    "The private block input could not be recorded; no content disclosed"
                })?;
            let mut cache = context
                .run
                .blocks
                .read
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            let entry = cache.entry(record.id.clone()).or_insert_with(|| ReadBlock {
                record: record.clone(),
                seen: BTreeSet::new(),
            });
            if entry.record.revision != record.revision {
                entry.seen.clear();
            }
            entry.seen.extend(args.offset..args.offset + rows.len());
            entry.record = record;
            return Ok(reply);
        }
        if rows.len() <= 1 {
            return Err("This row is too large to disclose safely; narrow it in the editor".into());
        }
        rows.pop();
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Change {
    index: usize,
    field: String,
    column: Option<usize>,
    value: Value,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ReviseArgs {
    id: String,
    revision: String,
    #[serde(default)]
    changes: Vec<Change>,
    #[serde(default)]
    append: Vec<Value>,
}

fn proposal(base: &ResourceRecord, args: &ReviseArgs) -> Result<ResourceDraft, String> {
    let old = object(base)?;
    let (kind, key) = shape(&old.data).ok_or("Unsupported block")?;
    if args.changes.len() + args.append.len() == 0
        || args.changes.len() + args.append.len() > MAX_CHANGES
    {
        return Err("Supply 1–32 changes or appended rows".into());
    }
    let mut data = serde_json::to_value(&old.data).map_err(|_| "Invalid block")?;
    let columns = data
        .get("columns")
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or(0);
    let rows = data[key].as_array_mut().ok_or("Invalid block rows")?;
    let mut touched = BTreeSet::new();
    for change in &args.changes {
        if !touched.insert((change.index, change.field.clone(), change.column)) {
            return Err("Each field may be changed only once".into());
        }
        let row = rows
            .get_mut(change.index)
            .ok_or("Row index is out of range")?;
        if kind == "table" {
            if change.field != "cell" || !change.value.is_string() {
                return Err("Table changes need field=cell, column and a string value".into());
            }
            let column = change
                .column
                .filter(|i| *i < columns)
                .ok_or("Column index is out of range")?;
            if row["cells"][column] == change.value {
                continue;
            }
            row["cells"][column] = change.value.clone();
        } else {
            let fields = if kind == "checklist" {
                &["title", "detail", "due", "done"][..]
            } else {
                &["title", "detail", "date", "when", "place", "cost", "kind"][..]
            };
            if change.column.is_some() || !fields.contains(&change.field.as_str()) {
                return Err("That field is not editable for this block".into());
            }
            if !(change.value.is_string()
                || change.value.is_null()
                || (change.field == "done" && change.value.is_boolean()))
            {
                return Err("Wrong field value type".into());
            }
            if row[&change.field] == change.value
                || (change.field == "done" && row.get("done").is_none() && change.value == false)
            {
                continue;
            }
            row[&change.field] = change.value.clone();
        }
        if let Some(row) = row.as_object_mut() {
            row.remove("source");
            row.remove("record_source");
            row.remove("pick");
            row.remove("from");
        }
    }
    for row in &args.append {
        let map = row
            .as_object()
            .ok_or("Append entries must be row objects")?;
        let fields = match kind {
            "table" => &["cells", "source"][..],
            "checklist" => &["title", "detail", "due", "done", "source"][..],
            _ => &[
                "title", "detail", "date", "when", "place", "cost", "kind", "source",
            ][..],
        };
        if !map.keys().all(|k| fields.contains(&k.as_str())) {
            return Err("Append contains unsupported fields or source claims".into());
        }
        rows.push(row.clone());
    }
    super::objects::strip_native_media(&mut data);
    let data: WorkArtifactDataV1 = serde_json::from_value(data)
        .map_err(|_| "The changes do not match this block's structure")?;
    let mut draft = base.draft.clone();
    draft.content = ResourceContent::Object {
        object: WorkObjectV1 {
            version: 1,
            data,
            evidence: old.evidence.clone(),
            provenance: None,
        },
    };
    if !draft.validate() {
        return Err("The edited block violates its row, date, cell or size constraints".into());
    }
    Ok(draft)
}

/// Merge only stable row identities. Without row ids a changed title/first
/// cell can mean replacement or reorder, so concurrent identity changes fail.
fn rebase(
    base: &ResourceRecord,
    proposed: &ResourceDraft,
    fresh: &ResourceRecord,
) -> Result<ResourceDraft, String> {
    let old = object(base)?;
    let now = object(fresh)?;
    let ResourceContent::Object { object: want } = &proposed.content else {
        return Err("Invalid proposed block".into());
    };
    if old.evidence != now.evidence || !want.evidence.starts_with(&old.evidence) {
        return Err("The block's citation table changed; read it again before editing".into());
    }
    let (_, key) = shape(&old.data).ok_or("Unsupported block")?;
    if shape(&now.data) != shape(&old.data) || shape(&want.data) != shape(&old.data) {
        return Err("The block kind changed".into());
    }
    let a = serde_json::to_value(&old.data).map_err(|_| "Invalid original block")?;
    let b = serde_json::to_value(&want.data).map_err(|_| "Invalid proposed block")?;
    let mut c = serde_json::to_value(&now.data).map_err(|_| "Invalid current block")?;
    if a.get("columns") != c.get("columns") {
        return Err("Table columns changed; read the current structure again".into());
    }
    let ar = a[key].as_array().ok_or("Invalid original rows")?;
    let br = b[key].as_array().ok_or("Invalid proposed rows")?;
    let cr = c[key].as_array().ok_or("Invalid current rows")?;
    if cr.len() < ar.len() || br.len() < ar.len() {
        return Err("Rows were removed; read the block again".into());
    }
    let identity = |row: &Value| {
        row.get("title")
            .and_then(Value::as_str)
            .or_else(|| {
                row.get("cells")
                    .and_then(Value::as_array)
                    .and_then(|c| c.first())
                    .and_then(Value::as_str)
            })
            .unwrap_or("")
            .to_owned()
    };
    let mut seen = BTreeSet::new();
    for (old, now) in ar.iter().zip(cr) {
        let id = identity(old);
        if id.is_empty() || !seen.insert(id.clone()) || identity(now) != id {
            return Err(
                "Concurrent row identity changes or ambiguous rows require a fresh read".into(),
            );
        }
    }
    let mut merged = Vec::with_capacity(cr.len() + br.len() - ar.len());
    for i in 0..ar.len() {
        merged.push(merge_fields(&ar[i], &br[i], &cr[i])?);
    }
    merged.extend_from_slice(&cr[ar.len()..]);
    for appended in &br[ar.len()..] {
        if cr[ar.len()..].contains(appended) {
            return Err("A concurrent append overlaps this append; read again".into());
        }
        merged.push(appended.clone());
    }
    let mut out = merge_fields(
        &without_rows(&a, key),
        &without_rows(&b, key),
        &without_rows(&c, key),
    )?;
    out[key] = json!(merged);
    c = out;
    let data = serde_json::from_value(c).map_err(|_| "Merged block is invalid")?;
    let mut draft = fresh.draft.clone();
    draft.content = ResourceContent::Object {
        object: WorkObjectV1 {
            version: 1,
            data,
            evidence: want.evidence.clone(),
            provenance: None,
        },
    };
    if !draft.validate() {
        return Err("Merged block exceeds its constraints".into());
    }
    Ok(draft)
}
fn without_rows(data: &Value, key: &str) -> Value {
    let mut data = data.clone();
    if let Some(object) = data.as_object_mut() {
        object.remove(key);
    }
    data
}
fn merge_fields(base: &Value, want: &Value, current: &Value) -> Result<Value, String> {
    if want == base {
        return Ok(current.clone());
    }
    if current == base || current == want {
        return Ok(want.clone());
    }
    if let (Some(a), Some(b), Some(c)) = (base.as_object(), want.as_object(), current.as_object()) {
        let mut out = serde_json::Map::new();
        let keys: BTreeSet<_> = a.keys().chain(b.keys()).chain(c.keys()).collect();
        for key in keys {
            let v = merge_fields(
                a.get(key).unwrap_or(&Value::Null),
                b.get(key).unwrap_or(&Value::Null),
                c.get(key).unwrap_or(&Value::Null),
            )?;
            if !v.is_null() {
                out.insert(key.clone(), v);
            }
        }
        return Ok(Value::Object(out));
    }
    if let (Some(a), Some(b), Some(c)) = (base.as_array(), want.as_array(), current.as_array()) {
        if a.len() == b.len() && a.len() == c.len() {
            return Ok(Value::Array(
                (0..a.len())
                    .map(|i| merge_fields(&a[i], &b[i], &c[i]))
                    .collect::<Result<_, _>>()?,
            ));
        }
    }
    Err("A user changed the same field; the block was not overwritten".into())
}

fn cite_appends(
    base: &ResourceRecord,
    args: &mut ReviseArgs,
    lookup: impl Fn(&str) -> Option<WorkEvidenceLink>,
) -> Result<ResourceRecord, String> {
    let mut cited = base.clone();
    if let ResourceContent::Object { object } = &mut cited.draft.content {
        for row in &mut args.append {
            if let Some(source) = row.get("source") {
                let key = source
                    .as_str()
                    .ok_or("Appended source must be a known run source key")?;
                let link = lookup(key).ok_or("Unknown source key")?;
                let index = match object.evidence.iter().position(|known| known == &link) {
                    Some(index) => index,
                    None if object.evidence.len() < 64 => {
                        object.evidence.push(link);
                        object.evidence.len() - 1
                    }
                    None => return Err("The block's citation table is full".into()),
                };
                row["source"] = json!(index);
            }
        }
    }
    Ok(cited)
}

async fn revise(context: LeadToolContext<'_>, args: Value) -> Result<String, String> {
    let mut args: ReviseArgs =
        serde_json::from_value(args).map_err(|_| "Invalid revise_block fields")?;
    if context
        .run
        .blocks
        .uncertain
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .contains(&args.id)
    {
        return Err("A prior edit has an unknown outcome; do not retry or append again".into());
    }
    let history = context
        .probe()
        .runtime_projection()
        .await
        .map_err(|_| "Could not check prior edit outcomes")?;
    if history.executions.iter().flat_map(|e| &e.steps).any(|s| {
        matches!(&s.kind, WorkStepKindV1::EditBlock { resource, .. } if resource == &args.id)
            && s.has_unconfirmed_effect()
    }) {
        return Err(
            "An earlier edit of this block has an unresolved outcome; do not repeat it".into(),
        );
    }
    let read = context
        .run
        .blocks
        .read
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .get(&args.id)
        .cloned()
        .ok_or("Read this block before editing")?;
    if args
        .changes
        .iter()
        .any(|change| !read.seen.contains(&change.index))
    {
        return Err("Read each affected row before changing it".into());
    }
    let base = read.record;
    if base.revision != args.revision {
        return Err("Use the exact revision returned by read_block".into());
    }
    if !candidates(context).await?.contains(&args.id) {
        return Err("The block is no longer in the admitted canvas context".into());
    }
    let cited = cite_appends(&base, &mut args, |key| {
        context.run.source(key).map(|source| source.link)
    })?;
    let mut draft = proposal(&cited, &args)?;
    if let ResourceContent::Object { object: wanted } = &draft.content {
        if wanted.data == object(&base)?.data && wanted.evidence == object(&base)?.evidence {
            return Ok(json!({"id":args.id,"revision":args.revision,"updated":false}).to_string());
        }
    }
    if context.cancelled().await {
        return Err("The run stopped before the edit".into());
    }
    let step = context
        .begin_step(
            WorkStepKindV1::EditBlock {
                resource: args.id.clone(),
                expected_revision: args.revision.clone(),
            },
            WorkStepStatus::Running,
            None,
            None,
        )
        .await
        .map_err(|_| "The edit could not be recorded")?;
    let mut expected = args.revision.clone();
    let result = async {
        for retry in 0..2 {
            if !candidates(context)
                .await
                .map_err(|_| ResourceError::Conflict)?
                .contains(&args.id)
            {
                return Err(ResourceError::Conflict);
            }
            if context.cancelled().await {
                return Err(ResourceError::Conflict);
            }
            let request = WorkCommandId::generate().to_string();
            let response = resource(
                context,
                ResourceCall::Mutate {
                    command: Box::new(ResourceCommand {
                        version: 1,
                        request_id: request.clone(),
                        intent: ResourceIntent::Replace {
                            id: args.id.clone(),
                            expected_revision: expected.clone(),
                            draft: draft.clone(),
                        },
                    }),
                },
            )
            .await;
            match response {
                Ok(ResourceResponse::Applied {
                    request_id,
                    applied_revision,
                    record,
                }) if request_id == request
                    && record.id == args.id
                    && record.revision == applied_revision
                    && record.draft == draft =>
                {
                    context
                        .run
                        .blocks
                        .read
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner)
                        .remove(&args.id);
                    return Ok(applied_revision);
                }
                Err(ResourceError::Conflict) if retry == 0 => {
                    let fresh = get(context, &args.id)
                        .await
                        .map_err(|_| ResourceError::Conflict)?;
                    draft = rebase(&base, &draft, &fresh).map_err(|_| ResourceError::Conflict)?;
                    expected = fresh.revision;
                }
                Err(error) => return Err(error),
                _ => return Err(ResourceError::OutcomeUnknown),
            }
        }
        Err(ResourceError::Conflict)
    }
    .await;
    let (status, note) = match &result {
        Ok(_) => (WorkStepStatus::Succeeded, "Updated the block"),
        Err(ResourceError::OutcomeUnknown | ResourceError::Unavailable) => {
            context
                .run
                .blocks
                .uncertain
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .insert(args.id.clone());
            (
                WorkStepStatus::OutcomeUnknown,
                "The block edit outcome is unknown; do not retry",
            )
        }
        Err(_) => (
            WorkStepStatus::Failed,
            "The block edit was refused; read its current state before another edit",
        ),
    };
    if context
        .settle_step(step, status, Some(note.into()), None)
        .await
        .is_err()
    {
        context
            .run
            .blocks
            .uncertain
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(args.id.clone());
        return Err("The edit receipt could not be durably recorded; do not retry".into());
    }
    match result {
        Ok(revision) => Ok(json!({"id":args.id,"revision":revision,"updated":true}).to_string()),
        Err(_) => Err(note.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn record(data: Value) -> ResourceRecord {
        serde_json::from_value(json!({"id":"01M4K000000000000000000001","revision":"1","created_at":"1","updated_at":"1","trashed":false,"draft":{"title":"My block","pinned":false,"related":[],"content":{"kind":"object","object":{"version":1,"data":data,"evidence":[]}}}})).unwrap()
    }
    fn args(changes: Value, append: Value) -> ReviseArgs {
        serde_json::from_value(json!({"id":"01M4K000000000000000000001","revision":"1","changes":changes,"append":append})).unwrap()
    }
    fn value(draft: &ResourceDraft) -> Value {
        let ResourceContent::Object { object } = &draft.content else {
            panic!()
        };
        serde_json::to_value(&object.data).unwrap()
    }
    #[test]
    fn implicit_blocks_require_one_concrete_reference() {
        assert_eq!(referenced_kind("hello, summarize the news"), None);
        assert_eq!(referenced_kind("Explain what a calendar is"), None);
        assert_eq!(
            referenced_kind("Append lunch to my calendar"),
            Some("calendar")
        );
        assert_eq!(referenced_kind("Update this table and my checklist"), None);
        let scope = BlockScope::default();
        scope.bind(
            Some(WorkContextSelectionV1 {
                environment: 1.into(),
                items: vec![],
                tabs: false,
                blocks: true,
            }),
            "Hello",
        );
        assert!(!scope.available());
    }
    #[test]
    fn checklist_edit_keeps_unmentioned_dates_and_completion() {
        let base = record(
            json!({"kind":"list","style":"todo","items":[{"title":"Pack","done":true,"due":"2026-11-21"}]}),
        );
        let result = proposal(
            &base,
            &args(
                json!([{"index":0,"field":"detail","value":"Bring warm clothes"}]),
                json!([{ "title":"Tickets","done":false}]),
            ),
        )
        .unwrap();
        let data = value(&result);
        assert_eq!(data["items"][0]["done"], true);
        assert_eq!(data["items"][0]["due"], "2026-11-21");
        assert_eq!(data["items"].as_array().unwrap().len(), 2);
        assert!(proposal(
            &base,
            &args(json!([{"index":0,"field":"source","value":1}]), json!([]))
        )
        .is_err());
    }
    #[test]
    fn edited_list_rows_drop_record_provenance_and_all_model_pixel_refs() {
        use zephium_core::{
            ids::ProfileId,
            work::{media::*, *},
        };
        let link = WorkEvidenceLink {
            extraction_id: WorkArtifactId::generate(),
            source_id: 1,
        };
        let media = WorkRecordMediaRefV1 {
            profile: ProfileId::generate(),
            work: WorkId::generate(),
            execution: WorkExecutionId::generate(),
            attempt: WorkAttemptId::generate(),
            step: WorkStepId::generate(),
            extraction: link.extraction_id,
            record: 0,
            source: "a".repeat(64),
            digest: "b".repeat(64),
            width: 128,
            height: 96,
            origin: WorkRecordMediaOriginV1::NativeCrop,
        };
        let mut base = record(json!({"kind":"list","style":"todo","items":[
            {"title":"Original row","source":0,"record_source":0,"record_media":media,"media_attempted":true},
            {"title":"Untouched row","source":0,"record_source":0,"record_media":media,"media_attempted":true}
        ]}));
        let ResourceContent::Object { object } = &mut base.draft.content else {
            panic!()
        };
        object.evidence.push(link);
        assert!(base.draft.validate());
        let changed = proposal(
            &base,
            &args(
                json!([{"index":0,"field":"title","value":"Changed row"}]),
                json!([]),
            ),
        )
        .unwrap();
        let out = value(&changed);
        assert_eq!(out["items"][0]["title"], "Changed row");
        assert!(out["items"][0].get("source").is_none());
        assert!(out["items"][0].get("record_source").is_none());
        assert_eq!(out["items"][1]["record_source"], 0);
        assert!(!out.to_string().contains("record_media"));
        assert!(!out.to_string().contains("media_attempted"));
        assert!(!out.to_string().contains("native_crop"));
        assert!(proposal(
            &base,
            &args(json!([]), json!([{"title":"Forged row","record_source":0}]))
        )
        .is_err());
    }

    #[test]
    fn table_rebase_keeps_other_cells_columns_and_concurrent_appends() {
        let base = record(
            json!({"kind":"sheet","columns":[{"label":"Name","kind":"text"},{"label":"Count","kind":"number"},{"label":"Note","kind":"text"}],"rows":[{"cells":["A","1","old"]}]}),
        );
        let wanted = proposal(
            &base,
            &args(
                json!([{"index":0,"field":"cell","column":1,"value":"2"}]),
                json!([{ "cells":["Agent","3",""]}]),
            ),
        )
        .unwrap();
        let mut fresh = base.clone();
        let mut changed = value(&fresh.draft);
        changed["rows"][0]["cells"][2] = json!("User note");
        changed["rows"]
            .as_array_mut()
            .unwrap()
            .push(json!({"cells":["User","4",""]}));
        fresh.draft.content = ResourceContent::Object {
            object: WorkObjectV1 {
                version: 1,
                data: serde_json::from_value(changed).unwrap(),
                evidence: vec![],
                provenance: None,
            },
        };
        let merged = rebase(&base, &wanted, &fresh).unwrap();
        let out = value(&merged);
        assert_eq!(out["columns"], value(&base.draft)["columns"]);
        assert_eq!(out["rows"][0]["cells"], json!(["A", "2", "User note"]));
        assert_eq!(out["rows"][1]["cells"][0], "User");
        assert_eq!(out["rows"][2]["cells"][0], "Agent");
    }
    #[test]
    fn overlap_reorder_deleted_rows_and_changed_columns_refuse_merge() {
        let base = record(
            json!({"kind":"sheet","columns":[{"label":"Name","kind":"text"},{"label":"Value","kind":"text"}],"rows":[{"cells":["A","old"]},{"cells":["B","old"]}]}),
        );
        let wanted = proposal(
            &base,
            &args(
                json!([{"index":0,"field":"cell","column":1,"value":"agent"}]),
                json!([]),
            ),
        )
        .unwrap();
        for variant in 0..4 {
            let mut fresh = base.clone();
            let mut data = value(&base.draft);
            match variant {
                0 => data["rows"][0]["cells"][1] = json!("user"),
                1 => data["rows"].as_array_mut().unwrap().swap(0, 1),
                2 => {
                    data["rows"].as_array_mut().unwrap().pop();
                }
                _ => data["columns"][1]["label"] = json!("Changed"),
            }
            if let ResourceContent::Object { object } = &mut fresh.draft.content {
                object.data = serde_json::from_value(data).unwrap();
            }
            assert!(rebase(&base, &wanted, &fresh).is_err());
        }
    }
    #[test]
    fn calendar_keeps_dates_and_rejects_invalid_days() {
        let base = record(
            json!({"kind":"plan","calendar":true,"steps":[{"title":"Lunch","kind":"event","date":"2026-11-21","when":"12:00"}]}),
        );
        let wanted = proposal(
            &base,
            &args(
                json!([{"index":0,"field":"when","value":"13:00"}]),
                json!([]),
            ),
        )
        .unwrap();
        assert_eq!(value(&wanted)["steps"][0]["date"], "2026-11-21");
        assert!(proposal(
            &base,
            &args(
                json!([{"index":0,"field":"date","value":"2026-99-99"}]),
                json!([])
            )
        )
        .is_err());
    }
    #[test]
    fn duplicate_row_identity_and_overlapping_append_are_not_guessed() {
        let base = record(json!({"kind":"list","style":"todo","items":[{"title":"A"}]}));
        let wanted = proposal(&base, &args(json!([]), json!([{ "title":"B"}]))).unwrap();
        let mut fresh = base.clone();
        fresh.draft = wanted.clone();
        assert!(rebase(&base, &wanted, &fresh).is_err());
        let duplicate =
            record(json!({"kind":"list","style":"todo","items":[{"title":"A"},{"title":"A"}]}));
        let wanted = proposal(
            &duplicate,
            &args(json!([{"index":0,"field":"done","value":true}]), json!([])),
        )
        .unwrap();
        assert!(rebase(&duplicate, &wanted, &duplicate).is_err());
    }
    #[test]
    fn production_append_source_mapping_is_zero_based_and_survives_rebase() {
        let link = |id| WorkEvidenceLink {
            extraction_id: zephium_core::work::WorkArtifactId::from(id),
            source_id: 1,
        };
        let mut base =
            record(json!({"kind":"list","style":"todo","items":[{"title":"Original","source":0}]}));
        if let ResourceContent::Object { object } = &mut base.draft.content {
            object.evidence = vec![link(1)];
        }
        let mut edits = args(
            json!([]),
            json!([{"title":"Known","source":"s1"},{"title":"New","source":"s2"}]),
        );
        let mapped = cite_appends(&base, &mut edits, |key| match key {
            "s1" => Some(link(1)),
            "s2" => Some(link(2)),
            _ => None,
        })
        .unwrap();
        assert_eq!(edits.append[0]["source"], 0);
        assert_eq!(edits.append[1]["source"], 1);
        let proposed = proposal(&mapped, &edits).unwrap();
        let mut fresh = base.clone();
        if let ResourceContent::Object { object } = &mut fresh.draft.content {
            let mut data = serde_json::to_value(&object.data).unwrap();
            data["items"]
                .as_array_mut()
                .unwrap()
                .push(json!({"title":"User append","source":0}));
            object.data = serde_json::from_value(data).unwrap();
        }
        let merged = rebase(&base, &proposed, &fresh).unwrap();
        let ResourceContent::Object { object } = &merged.content else {
            panic!()
        };
        assert_eq!(object.evidence, vec![link(1), link(2)]);
        let data = value(&merged);
        assert_eq!(data["items"][1]["source"], 0);
        assert_eq!(data["items"][2]["source"], 0);
        assert_eq!(data["items"][3]["source"], 1);
        if let ResourceContent::Object { object } = &mut fresh.draft.content {
            object.evidence.push(link(3));
        }
        assert!(rebase(&base, &proposed, &fresh).is_err());
        for source in [json!(0), json!("unknown")] {
            let mut bad = args(json!([]), json!([{"title":"Forged","source":source}]));
            assert!(cite_appends(&base, &mut bad, |_| None).is_err());
        }
    }

    #[test]
    fn private_block_text_remains_guarded_after_edit_cache_is_released() {
        let scope = BlockScope::default();
        let secret = "Confidential fictional client budget is 71329 euros";
        scope.retain_private(secret.into()).unwrap();
        scope.read.lock().unwrap().clear();
        assert!(crate::work_agent::query_discloses(
            secret,
            &scope.private_texts()
        ));
        assert!(scope.retain_private("x".repeat(512 * 1024)).is_err());
    }

    #[test]
    fn derived_block_artifacts_remain_private_in_followup_hydration() {
        use zephium_core::{ids::ProfileId, work::*};
        let execution = |id: u128, body: &str, private: bool| {
            let limits = json!({"model_tokens":1000,"cost_micro_usd":1000,"operations":8,"timeout_seconds":60,"max_workers":1});
            let context = private.then(|| json!({"version":1,"environment":WorkEnvironmentId::from(1),"environment_revision":"1","purpose":"agent","items":[],"total_bytes":0,"blocks":true}));
            let mut fact: WorkExecutionFact = serde_json::from_value(json!({
                "authorization":"user_directed_agent","id":WorkExecutionId::from(id),"approved_revision":"3",
                "spec":{"plan_revision":"2","limits":limits,"context":context,"nodes":[{"node":WorkPlanNodeId::from(1),"parent":null,"limits":limits,"capability":{"kind":"agent","grant":{"provider":"open_ai","model":"gpt-6-luna","max_turns":4,"max_steps":4,"browse_hops":1}}}]},
                "status":"needs_review","attempts":[],"artifacts":[],"provider_evidence":[],"user_artifacts":[],"steps":[],"parts":[],"inputs":[]
            })).unwrap();
            fact.artifacts
                .push(zephium_core::work::artifact::WorkArtifactV1 {
                    version: 1,
                    id: WorkArtifactId::from(id),
                    execution: fact.id,
                    attempt: WorkAttemptId::from(id),
                    node: 1.into(),
                    output: "Result".into(),
                    title: "Block summary".into(),
                    data: WorkArtifactDataV1::Reply {
                        headline: "Block summary".into(),
                        text: body.into(),
                        figures: vec![],
                        points: vec![],
                    },
                    review: WorkOutputReview::SourceMappedNeedsReview,
                    presentation:
                        zephium_core::work::artifact::WorkArtifactPresentationV1::Automatic,
                    evidence: vec![],
                    general_knowledge: true,
                    part: None,
                    revises: None,
                });
            fact
        };
        let secret = "Confidential fictional client budget is 71329 euros";
        let mut projection = WorkRuntimeProjection {
            version: 1,
            work: WorkSnapshot::create(1.into(), ProfileId::generate(), "Synthetic context".into())
                .unwrap(),
            executions: vec![
                execution(1, secret, true),
                execution(
                    2,
                    "The fictional client's secret budget remains unchanged",
                    false,
                ),
            ],
            interrupted: vec![],
            owners: vec![],
        };
        let texts = crate::work_agent::projection_private_artifact_texts(&projection);
        assert_eq!(texts.len(), 2);
        assert!(crate::work_agent::query_discloses(secret, &texts));
        projection.executions[0].spec.context = None;
        assert!(crate::work_agent::projection_private_artifact_texts(&projection).is_empty());
    }
}
