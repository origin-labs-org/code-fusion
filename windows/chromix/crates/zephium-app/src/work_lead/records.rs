//! Immutable extraction rows addressed by run-local keys. The model selects
//! records; only native code copies their values and media into canvas objects.
use serde::Deserialize;
use serde_json::{json, Value};
use zephium_core::work::{artifact::*, objects::*, WorkArtifactId};

#[derive(Debug)]
pub(crate) struct RecordError {
    pub message: String,
    pub reason: super::objects::ObjectRefusal,
}
impl std::fmt::Display for RecordError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}
impl From<&str> for RecordError {
    fn from(message: &str) -> Self {
        Self {
            message: message.into(),
            reason: super::objects::ObjectRefusal::Source,
        }
    }
}

#[derive(Default)]
pub(crate) struct Records {
    rows: Vec<Record>,
    intents: Vec<(String, zephium_core::work::collection::WorkBrowseCollection)>,
}
struct Record {
    artifact: WorkArtifactId,
    collection: Option<zephium_core::work::collection::WorkBrowseCollection>,
    row: usize,
    part: Option<zephium_core::work::WorkPartId>,
    subject: WorkSubject,
    fields: Vec<(WorkCriterion, WorkCell)>,
    evidence: Vec<WorkEvidenceLink>,
}
impl Record {
    fn field_kind(&self, name: &str) -> Option<&zephium_core::work::collection::WorkBrowseValue> {
        self.collection
            .as_ref()?
            .columns
            .iter()
            .find(|column| column.name.replace('_', " ") == name)
            .map(|column| &column.value)
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Selection {
    pub source: String,
    pub annotation: Option<String>,
    #[serde(default)]
    pub recommended: bool,
    /// What the thing is, in a few words, when its name doesn't say it.
    pub subtitle: Option<String>,
    /// The details that decide the choice, as the lead read them. They come
    /// before the record's own columns; the record's name, price, link and
    /// pictures are never rewritten.
    #[serde(default)]
    pub facts: Vec<Fact>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Fact {
    pub label: String,
    pub value: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Presentation {
    pub title: String,
    pub layout: Layout,
    pub records: Vec<Selection>,
}
#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Layout {
    Picks,
    Table,
}

/// A text's words, folded, for telling whether one fact holds another.
fn words(text: &str) -> std::collections::BTreeSet<String> {
    text.split(|c: char| !c.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .map(str::to_lowercase)
        .collect()
}

/// Facts with a label that reads as one ("Model specs", not "model_specs"),
/// each saying something no other fact already says.
fn said_once(facts: Vec<Value>) -> Vec<Value> {
    let held: Vec<_> = facts
        .iter()
        .map(|fact| words(fact["value"].as_str().unwrap_or_default()))
        .collect();
    facts
        .into_iter()
        .enumerate()
        .filter(|(index, _)| {
            !held.iter().enumerate().any(|(other, more)| {
                other != *index
                    && more.is_superset(&held[*index])
                    && (more.len() > held[*index].len() || other < *index)
            })
        })
        .map(|(_, mut fact)| {
            let label = fact["label"].as_str().unwrap_or_default().replace('_', " ");
            let mut chars = label.chars();
            if let Some(first) = chars.next() {
                fact["label"] = json!(first.to_uppercase().chain(chars).collect::<String>());
            }
            fact
        })
        .collect()
}

/// Picks a card shows when the lead chose fewer from a read.
const FOUND_PICKS: usize = 6;

/// Whether the read showed the record's price: an offer filled in beside
/// the lead's choice needs one to be compared.
fn priced(row: &Record) -> bool {
    row.fields.iter().any(|(criterion, cell)| {
        super::found::price_rank(&criterion.name.to_lowercase()).is_some()
            && display(&cell.value).is_some()
    })
}

/// An offer no working need can use: damaged, broken or sold for parts.
fn unusable(row: &Record) -> bool {
    const WORDS: &[&str] = &[
        "damaged",
        "broken",
        "for parts",
        "parts only",
        "faulty",
        "defective",
        "uszkodz",
        "na części",
        "niesprawn",
        "defekt",
        "kaputt",
        "defectueux",
    ];
    row.fields.iter().any(|(_, cell)| {
        display(&cell.value).is_some_and(|text| {
            let text = text.to_lowercase();
            WORDS.iter().any(|word| text.contains(word))
        })
    })
}

impl Selection {
    fn copied(&self) -> Self {
        Self {
            source: self.source.clone(),
            annotation: self.annotation.clone(),
            recommended: self.recommended,
            subtitle: self.subtitle.clone(),
            facts: self
                .facts
                .iter()
                .map(|fact| Fact {
                    label: fact.label.clone(),
                    value: fact.value.clone(),
                })
                .collect(),
        }
    }
    /// A record the lead chose, read leniently: a bare key, or an object whose
    /// stray fields are dropped. The record's name, price, link and pictures
    /// come from the read, so nothing the lead adds can rewrite them.
    pub fn loose(value: &Value) -> Option<Self> {
        let text = |value: &Value| {
            value
                .as_str()
                .map(str::trim)
                .filter(|text| !text.is_empty())
                .map(str::to_owned)
        };
        if let Some(source) = text(value) {
            return Some(Self {
                source,
                annotation: None,
                recommended: false,
                subtitle: None,
                facts: vec![],
            });
        }
        let map = value.as_object()?;
        let field = |names: &[&str]| names.iter().find_map(|name| map.get(*name).and_then(text));
        let fact = |value: &Value| match value {
            Value::String(line) => line.split_once(':').and_then(|(label, value)| {
                let (label, value) = (label.trim(), value.trim());
                (!label.is_empty() && !value.is_empty()).then(|| Fact {
                    label: label.into(),
                    value: value.into(),
                })
            }),
            Value::Object(fact) => {
                let label = ["label", "name", "key"]
                    .iter()
                    .find_map(|name| fact.get(*name).and_then(text))?;
                let value = fact.get("value").and_then(|value| match value {
                    Value::Number(number) => Some(number.to_string()),
                    value => text(value),
                })?;
                Some(Fact { label, value })
            }
            _ => None,
        };
        let facts = match map.get("facts") {
            Some(Value::Array(facts)) => facts.iter().filter_map(fact).collect(),
            Some(Value::Object(facts)) => facts
                .iter()
                .filter_map(|(label, value)| {
                    Some(Fact {
                        label: label.trim().to_owned(),
                        value: text(value)?,
                    })
                })
                .collect(),
            _ => vec![],
        };
        Some(Self {
            source: field(&["source", "key", "record", "r", "id"])?,
            annotation: field(&["annotation", "note", "why", "reason"]),
            recommended: match map.get("recommended").or_else(|| map.get("top_pick")) {
                Some(Value::Bool(pick)) => *pick,
                Some(Value::String(pick)) => matches!(pick.trim(), "true" | "yes"),
                _ => false,
            },
            subtitle: field(&["subtitle", "descriptor"]),
            facts,
        })
    }
}

impl Records {
    /// Picks the lead chose lead the card; the other offers the same reads
    /// found follow, up to `FOUND_PICKS`, so the person sees what was found and
    /// not only the lead's short list. Damaged or parts-only offers never fill.
    fn with_more_found(&self, request: &Presentation) -> Vec<Selection> {
        let mut records: Vec<Selection> = request.records.iter().map(Selection::copied).collect();
        if !matches!(request.layout, Layout::Picks) || records.len() >= FOUND_PICKS {
            return records;
        }
        let index = |key: &str| {
            key.trim()
                .strip_prefix('r')
                .and_then(|s| s.parse::<usize>().ok())
                .and_then(|i| i.checked_sub(1))
        };
        let reads: Vec<WorkArtifactId> = records
            .iter()
            .filter_map(|record| self.rows.get(index(&record.source)?))
            .map(|row| row.artifact)
            .collect();
        for (at, row) in self.rows.iter().enumerate() {
            if records.len() >= FOUND_PICKS {
                break;
            }
            let key = format!("r{}", at + 1);
            if !reads.contains(&row.artifact)
                || records
                    .iter()
                    .any(|record| index(&record.source) == Some(at))
                || self.rows[..at]
                    .iter()
                    .any(|earlier| earlier.subject.name == row.subject.name)
                || unusable(row)
                || !priced(row)
            {
                continue;
            }
            records.push(Selection {
                source: key,
                annotation: None,
                recommended: false,
                subtitle: None,
                facts: vec![],
            });
        }
        records
    }

    /// The records a run read, in read order, for a run that stopped before
    /// it chose among them: a stall never hides what was found.
    pub fn read_so_far(&self) -> Option<Presentation> {
        let title = self
            .rows
            .iter()
            .find_map(|row| row.collection.as_ref().map(|c| c.title.clone()))?;
        Some(Presentation {
            title,
            layout: Layout::Picks,
            records: (1..=self.rows.len().min(MAX_PICKS))
                .map(|index| Selection {
                    source: format!("r{index}"),
                    annotation: None,
                    recommended: false,
                    subtitle: None,
                    facts: vec![],
                })
                .collect(),
        })
    }

    /// The name of the record a key names, as read.
    pub fn name_of(&self, key: &str) -> Option<&str> {
        let index = key
            .trim()
            .strip_prefix('r')?
            .parse::<usize>()
            .ok()?
            .checked_sub(1)?;
        self.rows.get(index).map(|row| row.subject.name.as_str())
    }

    /// The key of the one record this run read under `name`.
    pub fn key_of(&self, name: &str) -> Option<String> {
        let name = name.trim();
        let mut found = self
            .rows
            .iter()
            .enumerate()
            .filter(|(_, row)| row.subject.name.trim().eq_ignore_ascii_case(name));
        let (index, _) = found.next()?;
        found.next().is_none().then(|| format!("r{}", index + 1))
    }

    pub fn remember_site(
        &mut self,
        host: &str,
        collection: &zephium_core::work::collection::WorkBrowseCollection,
    ) {
        let host = host.trim_start_matches("www.").to_ascii_lowercase();
        if self.intents.len() < 32
            && !self
                .intents
                .iter()
                .any(|(known, schema)| known == &host && schema.columns == collection.columns)
        {
            self.intents.push((host, collection.clone()));
        }
    }

    pub fn collection_for_site(
        &self,
        url: &str,
    ) -> Option<zephium_core::work::collection::WorkBrowseCollection> {
        let target = url::Url::parse(url).ok()?;
        let host = target.host_str()?.trim_start_matches("www.");
        let mut matching = self.intents.iter().filter(|(site, _)| site == host);
        let (_, first) = matching.next()?;
        if matching.any(|(_, schema)| schema.columns != first.columns) {
            return None;
        }
        Some(first.clone())
    }

    /// Register only already-admitted native artifacts; repeated reads of the
    /// same artifact retain their keys. Equal names never merge different rows.
    pub fn register(
        &mut self,
        artifact: &WorkArtifactV1,
        collection: Option<&zephium_core::work::collection::WorkBrowseCollection>,
    ) -> Vec<String> {
        let WorkArtifactDataV1::ComparisonMatrix {
            subjects,
            criteria,
            cells,
            ..
        } = &artifact.data
        else {
            return vec![];
        };
        if artifact.validate().is_err() {
            return vec![];
        }
        let mut keys = Vec::new();
        for (row, subject) in subjects.iter().enumerate() {
            let index = if let Some(index) = self
                .rows
                .iter()
                .position(|r| r.artifact == artifact.id && r.row == row)
            {
                index
            } else {
                // A run cannot make an unbounded second copy of its extraction.
                if self.rows.len() >= 256 {
                    break;
                }
                self.rows.push(Record {
                    artifact: artifact.id,
                    collection: collection.cloned(),
                    row,
                    part: artifact.part,
                    subject: subject.clone(),
                    fields: criteria
                        .iter()
                        .cloned()
                        .zip(cells[row].iter().cloned())
                        .collect(),
                    evidence: artifact.evidence.clone(),
                });
                self.rows.len() - 1
            };
            keys.push(format!("r{}", index + 1));
        }
        keys
    }

    pub fn collection_for_document(
        &self,
        url: &str,
    ) -> Option<zephium_core::work::collection::WorkBrowseCollection> {
        let mut candidates = self
            .rows
            .iter()
            .filter(|row| row.subject.homepage.as_deref() == Some(url));
        let first = candidates.next()?;
        // The same address on two variants is not a unique record identity.
        if candidates.any(|row| {
            row.subject.name != first.subject.name
                || row.collection.as_ref().map(|c| &c.columns)
                    != first.collection.as_ref().map(|c| &c.columns)
        }) {
            return None;
        }
        let mut collection = first.collection.clone()?;
        collection.max_items = 1;
        Some(collection)
    }

    pub fn catalog(&self, part: zephium_core::work::WorkPartId) -> String {
        let mut out = String::new();
        for (index, row) in self
            .rows
            .iter()
            .enumerate()
            .filter(|(_, row)| row.part == Some(part))
        {
            let fields: Vec<String> = row
                .fields
                .iter()
                .map(|(c, v)| format!("{}: {}", c.name, shown(&v.value)))
                .collect();
            let line = format!(
                "r{}: {} — {}\n",
                index + 1,
                row.subject.name,
                fields.join(" · ")
            );
            if out.len() + line.len() > 16 * 1024 {
                break;
            }
            out.push_str(&line);
        }
        out
    }

    /// Builds picks or a table from the selected records. A selection that
    /// can't be used, or a value over a limit, is left out on its own and
    /// named in `left_out`; only a selection with nothing usable is refused.
    pub fn present(&self, request: &Presentation) -> Result<super::objects::Proposed, RecordError> {
        let title: String = super::call::plain(&request.title)
            .lines()
            .map(str::trim)
            .find(|line| !line.is_empty())
            .unwrap_or_default()
            .chars()
            .take(super::objects::MAX_TITLE_CHARS)
            .collect();
        let title = title.trim().to_owned();
        if title.is_empty() {
            return Err("records_title needs a few words naming what was found".into());
        }
        let mut left_out = Vec::new();
        let mut selected: Vec<(&str, &Record, u16, &Selection)> = Vec::new();
        let mut evidence: Vec<WorkEvidenceLink> = Vec::new();
        let records = self.with_more_found(request);
        for selection in &records {
            let key = selection.source.trim();
            if selected.iter().any(|(known, ..)| *known == key) {
                continue;
            }
            if selected.len() >= MAX_PICKS {
                left_out.push(format!("{key} (at most {MAX_PICKS} records)"));
                continue;
            }
            let Some(index) = key
                .strip_prefix('r')
                .and_then(|s| s.parse::<usize>().ok())
                .filter(|i| *i > 0 && key == format!("r{i}"))
                .map(|i| i - 1)
            else {
                left_out.push(format!("{key} (not a record key)"));
                continue;
            };
            let Some(record) = self.rows.get(index) else {
                left_out.push(format!("{key} (not returned in this run)"));
                continue;
            };
            let mut links: Vec<&WorkEvidenceLink> = record
                .fields
                .iter()
                .flat_map(|(_, cell)| &cell.evidence)
                .filter_map(|i| record.evidence.get(usize::from(*i)))
                .collect();
            // A record whose only value is its name still came from its read.
            if links.is_empty() {
                links = record.evidence.iter().take(1).collect();
            }
            let Some(first) = links.first() else {
                left_out.push(format!("{key} (no source)"));
                continue;
            };
            let added = links
                .iter()
                .filter(|link| !evidence.contains(**link))
                .count();
            if evidence.len() + added > MAX_ARTIFACT_EVIDENCE {
                left_out.push(format!("{key} (source limit)"));
                continue;
            }
            for link in &links {
                if !evidence.contains(*link) {
                    evidence.push((*link).clone());
                }
            }
            let source = evidence.iter().position(|link| link == *first).unwrap() as u16;
            selected.push((key, record, source, selection));
        }
        if selected.is_empty() {
            return Err(RecordError {
                message: format!(
                    "none of the selected records could be used: {}; select r keys a read returned",
                    left_out.join("; ")
                ),
                reason: super::objects::ObjectRefusal::Source,
            });
        }
        let data = match request.layout {
            Layout::Picks => {
                let mut items = Vec::new();
                for (_, record, source, selection) in &selected {
                    let mut value = json!({"name":record.subject.name, "image_candidates":record.subject.image_candidates, "media_attempted":record.subject.media_attempted, "source":source, "recommended":selection.recommended});
                    for (key, text) in [
                        ("subtitle", &record.subject.descriptor),
                        ("url", &record.subject.homepage),
                        ("why", &selection.annotation),
                    ] {
                        if let Some(text) = text {
                            value[key] = json!(text);
                        }
                    }
                    if let Some(media) = &record.subject.record_media {
                        value["record_media"] = json!(media);
                    }
                    if record.subject.descriptor.is_none() {
                        if let Some(subtitle) = selection.subtitle.as_deref().map(str::trim) {
                            if !subtitle.is_empty() {
                                value["subtitle"] = json!(subtitle);
                            }
                        }
                    }
                    let mut facts: Vec<Value> = selection
                        .facts
                        .iter()
                        .map(|fact| (fact.label.trim(), fact.value.trim()))
                        // The page's own value for a label stands over the lead's.
                        .filter(|(label, value)| {
                            !label.is_empty()
                                && !value.is_empty()
                                && !super::objects::says_not_found(value)
                                && super::found::price_rank(&label.to_lowercase()).is_none()
                                && !record.fields.iter().any(|(criterion, cell)| {
                                    criterion.name.eq_ignore_ascii_case(label)
                                        && display(&cell.value).is_some()
                                })
                        })
                        // A "fact" that only repeats the record's name says nothing.
                        .filter(|(_, value)| {
                            !words(&record.subject.name).is_superset(&words(value))
                        })
                        .map(|(label, value)| json!({"label":label,"value":value,"kind":"text"}))
                        .collect();
                    let mut has_price = false;
                    for (criterion, cell) in &record.fields {
                        let Some(text) = display(&cell.value) else {
                            continue;
                        };
                        if matches!(
                            record.field_kind(&criterion.name),
                            Some(zephium_core::work::collection::WorkBrowseValue::ImageUrl)
                        ) {
                            let images = value["image_candidates"]
                                .as_array_mut()
                                .expect("native image array");
                            if !images.iter().any(|image| image.as_str() == Some(&text)) {
                                images.push(json!(text));
                            }
                            continue;
                        }
                        // Skip only values already represented exactly, never a
                        // label-based guess that silently discards another URL.
                        if record.subject.homepage.as_ref() == Some(&text)
                            || record.subject.image_candidates.contains(&text)
                            || (text.split_whitespace().nth(1).is_some()
                                && words(&record.subject.name).is_superset(&words(&text)))
                        {
                            continue;
                        }
                        if !has_price
                            && super::found::price_rank(&criterion.name.to_lowercase()).is_some()
                        {
                            let mut price = json!({"display": super::objects::words_within(
                                &text,
                                zephium_core::work::objects::limit::PICK_PRICE,
                            )});
                            if let WorkCellValue::Money {
                                amount, currency, ..
                            } = &cell.value
                            {
                                price["amount"] = json!(amount);
                                price["currency"] = json!(currency);
                            }
                            value["price"] = price;
                            has_price = true;
                        } else if !facts.iter().any(|fact| {
                            fact["label"]
                                .as_str()
                                .is_some_and(|label| label.eq_ignore_ascii_case(&criterion.name))
                        }) {
                            facts.push(json!({"label":criterion.name,"value":text,"kind":"text"}));
                        }
                    }
                    let mut facts = said_once(facts);
                    facts.truncate(zephium_core::work::objects::limit::PICK_FACTS);
                    value["facts"] = json!(facts);
                    items.push(
                        serde_json::from_value::<WorkPickV1>(value)
                            .map_err(|_| "native pick projection failed")?,
                    );
                }
                WorkArtifactDataV1::Picks {
                    facet: WorkPickFacetV1::Other,
                    items,
                }
            }
            Layout::Table => {
                let mut names = Vec::new();
                for (_, record, ..) in &selected {
                    for (criterion, _) in &record.fields {
                        if !names.contains(&criterion.name) {
                            names.push(criterion.name.clone());
                        }
                    }
                }
                let mut columns = vec![json!({"label":"Name","kind":"text"})];
                for name in &names {
                    let link = selected
                        .iter()
                        .filter(|(_, record, ..)| {
                            record
                                .fields
                                .iter()
                                .any(|(criterion, _)| criterion.name == *name)
                        })
                        .all(|(_, record, ..)| {
                            matches!(
                                record.field_kind(name),
                                Some(
                                    zephium_core::work::collection::WorkBrowseValue::Url
                                        | zephium_core::work::collection::WorkBrowseValue::ImageUrl
                                )
                            )
                        });
                    columns.push(json!({"label":name,"kind":if link { "link" } else { "text" }}));
                }
                columns.push(json!({"label":"Source link","kind":"link"}));
                let annotate = selected.iter().any(|(.., r)| r.annotation.is_some());
                if annotate {
                    columns.push(json!({"label":"Annotation","kind":"text"}));
                }
                let mut rows = Vec::new();
                for (_, record, source, selection) in &selected {
                    let mut cells = vec![record.subject.name.clone()];
                    for name in &names {
                        cells.push(
                            record
                                .fields
                                .iter()
                                .find(|(c, _)| c.name == *name)
                                .and_then(|(_, c)| display(&c.value))
                                .unwrap_or_default(),
                        );
                    }
                    cells.push(record.subject.homepage.clone().unwrap_or_default());
                    if annotate {
                        cells.push(selection.annotation.clone().unwrap_or_default());
                    }
                    let mut row = json!({"cells":cells,"source":source});
                    if record.subject.media_attempted || record.subject.record_media.is_some() {
                        row["entity"] = json!({"media_attempted":record.subject.media_attempted});
                        if let Some(media) = &record.subject.record_media {
                            row["entity"]["record_media"] = json!(media);
                        }
                    }
                    if !record.subject.media_attempted && record.subject.record_media.is_none() {
                        if let Some(image) = record.subject.image_candidates.first() {
                            row["entity"] = json!({"image": image});
                        }
                    }
                    rows.push(row);
                }
                serde_json::from_value(json!({"kind":"sheet","columns":columns,"rows":rows}))
                    .map_err(|_| "native table projection failed")?
            }
        };
        // Page values over a limit are left out one by one, never the whole set.
        let mut value = serde_json::to_value(&data).map_err(|_| "native projection failed")?;
        let data = loop {
            let parsed: WorkArtifactDataV1 =
                serde_json::from_value(value.clone()).map_err(|_| "native projection failed")?;
            let Some(fault) = parsed.lead_fault(evidence.len()) else {
                break parsed;
            };
            if left_out.len() >= 64 || !super::schema::drop(&mut value, &fault) {
                return Err(RecordError {
                    message: format!("native record presentation: {}", fault.describe()),
                    reason: super::objects::ObjectRefusal::Field(fault.field),
                });
            }
            left_out.push(fault.describe());
        };
        Ok(super::objects::Proposed {
            title,
            data,
            evidence,
            left_out,
        })
    }
}
/// A field as the lead reads it: a value the page did not show says so,
/// so a gap is never read as "none" or "not set".
fn shown(value: &WorkCellValue) -> String {
    display(value).unwrap_or_else(|| "unknown".into())
}
fn display(value: &WorkCellValue) -> Option<String> {
    Some(match value {
        WorkCellValue::Text { text } => text.clone(),
        WorkCellValue::Measurement { value } => value.clone(),
        WorkCellValue::Money {
            amount, currency, ..
        } => format!("{amount} {currency}"),
        WorkCellValue::Rating { value } => value.to_string(),
        WorkCellValue::Presence { present } => if *present { "yes" } else { "no" }.into(),
        WorkCellValue::Unknown => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_value_the_page_did_not_show_reads_as_unknown_in_the_catalog() {
        assert_eq!(shown(&WorkCellValue::Unknown), "unknown");
        assert_eq!(
            shown(&WorkCellValue::Text {
                text: "Friday".into()
            }),
            "Friday"
        );
    }

    #[test]
    fn facts_are_labelled_as_words_and_never_repeat_the_name_or_each_other() {
        let facts = said_once(vec![
            json!({"label":"Specs","value":"GDDR6X, 384-bit","kind":"text"}),
            json!({"label":"model_specs","value":"GeForce RTX 3xxx GDDR6X 1400 MHz 384-bit","kind":"text"}),
            json!({"label":"condition","value":"Używany","kind":"text"}),
            json!({"label":"Condition","value":"używany","kind":"text"}),
        ]);
        let labels: Vec<_> = facts.iter().map(|f| f["label"].as_str().unwrap()).collect();
        assert_eq!(labels, ["Model specs", "Condition"]);
        assert!(
            words("Karta graficzna MSI RTX 3090 24 GB").is_superset(&words("MSI RTX 3090 24 GB"))
        );
    }
    use zephium_core::{ids::ProfileId, work::*};

    fn fixture() -> WorkArtifactV1 {
        let extraction = WorkArtifactId::generate();
        let execution = WorkExecutionId::generate();
        let attempt = WorkAttemptId::generate();
        let profile = ProfileId::generate();
        let work = WorkId::generate();
        let subject = |row, name: String| {
            json!({
                "name":name,"homepage":format!("https://example.com/item?variant={row}&date=2026-11-14"),
                "image_candidates":[format!("https://example.com/image?variant={row}&width=400")],
                "media_attempted":true,"record_media":{
                    "profile":profile,"work":work,"execution":execution,"attempt":attempt,"step":WorkStepId::generate(),
                    "extraction":extraction,"record":row,"source":"a".repeat(64),"digest":format!("{row:x}").repeat(64),
                    "width":128,"height":96,"origin":"native_crop"
                }
            })
        };
        serde_json::from_value(json!({
            "version":1,"id":WorkArtifactId::generate(),"execution":execution,"node":WorkPlanNodeId::generate(),"attempt":attempt,
            "output":"result","title":"Native rows","review":"source_mapped_needs_review","presentation":"automatic","general_knowledge":false,
            "evidence":[{"extraction_id":extraction,"source_id":1}],
            "data":{"kind":"comparison_matrix", "subjects":[subject(0,"Żółć東京".repeat(16)),subject(1,"Same source, different record".into())],
                "criteria":[{"name":"Price","kind":{"kind":"text"}},{"name":"Stock","kind":{"kind":"text"}}],
                "cells":[
                    [{"value":{"kind":"text","text":"129,99 zł / sztuka — cena z podatkiem"},"evidence":[0]},{"value":{"kind":"text","text":"Dostępny — wysyłka w ciągu 2 dni"},"evidence":[0]}],
                    [{"value":{"kind":"money","amount":"100.00","currency":"PLN"},"evidence":[0]},{"value":{"kind":"text","text":"Out of stock"},"evidence":[0]}]
                ]}
        })).unwrap()
    }
    fn request(layout: &str) -> Presentation {
        serde_json::from_value(json!({"title":"Results","layout":layout,"records":[{"source":"r2","annotation":"Second source row first"},{"source":"r1"}]})).unwrap()
    }
    #[test]
    fn selection_preserves_verbatim_unicode_price_stock_query_and_exact_row_media() {
        let artifact = fixture();
        artifact.validate().unwrap();
        let mut records = Records::default();
        assert_eq!(records.register(&artifact, None), ["r1", "r2"]);
        assert_eq!(records.register(&artifact, None), ["r1", "r2"]);
        let proposed = records
            .present(&request("picks"))
            .unwrap_or_else(|e| panic!("{e}"));
        let WorkArtifactDataV1::Picks { items, .. } = &proposed.data else {
            panic!()
        };
        assert_eq!(items[0].record_media.as_ref().unwrap().record, 1);
        assert_eq!(items[1].record_media.as_ref().unwrap().record, 0);
        assert_eq!(items[1].name, "Żółć東京".repeat(16));
        assert_eq!(
            items[1].price.as_ref().unwrap().display,
            "129,99 zł / sztuka — cena z podatkiem"
        );
        assert_eq!(items[1].facts[0].value, "Dostępny — wysyłka w ciągu 2 dni");
        assert_eq!(
            items[1].url.as_deref(),
            Some("https://example.com/item?variant=0&date=2026-11-14")
        );
        assert_eq!(
            items[1].image_candidates,
            ["https://example.com/image?variant=0&width=400"]
        );
        assert_eq!(
            items[0].price.as_ref().unwrap().amount.as_deref(),
            Some("100.00")
        );
        assert_eq!(items[0].why.as_deref(), Some("Second source row first"));
        assert_eq!(proposed.evidence.len(), 1);
        assert!(proposed.data.validate(proposed.evidence.len()).is_ok());
    }
    #[test]
    fn table_preserves_full_query_and_values_without_numeric_reinterpretation() {
        let mut records = Records::default();
        records.register(&fixture(), None);
        let proposed = records
            .present(&request("table"))
            .unwrap_or_else(|e| panic!("{e}"));
        let WorkArtifactDataV1::Sheet { columns, rows, .. } = &proposed.data else {
            panic!()
        };
        assert_eq!(
            rows[0]
                .entity
                .as_ref()
                .unwrap()
                .record_media
                .as_ref()
                .unwrap()
                .record,
            1
        );
        assert_eq!(
            rows[1]
                .entity
                .as_ref()
                .unwrap()
                .record_media
                .as_ref()
                .unwrap()
                .record,
            0
        );
        let mut untrusted = proposed.data.clone();
        untrusted.clear_record_media();
        let WorkArtifactDataV1::Sheet { rows: cleared, .. } = untrusted else {
            panic!()
        };
        assert!(cleared
            .iter()
            .all(|row| row.entity.as_ref().unwrap().record_media.is_none()));
        let link = columns
            .iter()
            .position(|c| c.label == "Source link")
            .unwrap();
        assert_eq!(
            rows[1].cells[link],
            "https://example.com/item?variant=0&date=2026-11-14"
        );
        assert_eq!(rows[1].cells[0], "Żółć東京".repeat(16));
        assert_eq!(rows[1].cells[1], "129,99 zł / sztuka — cena z podatkiem");
        assert_eq!(rows[1].cells[2], "Dostępny — wysyłka w ciągu 2 dni");
    }
    #[test]
    fn exact_record_detail_read_keeps_requested_stock_columns_but_not_ambiguous_variants() {
        let artifact = fixture();
        let collection: zephium_core::work::collection::WorkBrowseCollection = serde_json::from_value(json!({
            "title":"Offers", "max_items":5,"columns":[
                {"name":"price","value":{"kind":"text"},"required":false,"extraction":"verbatim"},
                {"name":"stock","value":{"kind":"text"},"required":false,"extraction":"verbatim"}
            ]
        })).unwrap();
        let mut bank = Records::default();
        bank.register(&artifact, Some(&collection));
        let url = "https://example.com/item?variant=0&date=2026-11-14";
        let retained = bank.collection_for_document(url).unwrap();
        assert_eq!(retained.max_items, 1);
        assert_eq!(retained.columns, collection.columns);
        assert!(bank
            .collection_for_document("https://example.com/item")
            .is_none());
        bank.rows[1].subject.homepage = Some(url.into());
        assert!(bank.collection_for_document(url).is_none());
    }

    #[test]
    fn a_withheld_image_url_is_not_misclassified_as_an_oversized_text_fact() {
        let mut artifact = fixture();
        let image = format!(
            "https://images.example.com/{}.jpg?width=400",
            "a".repeat(180)
        );
        let WorkArtifactDataV1::ComparisonMatrix {
            subjects,
            criteria,
            cells,
            ..
        } = &mut artifact.data
        else {
            panic!()
        };
        for subject in subjects {
            subject.image_candidates.clear();
            subject.record_media = None;
        }
        criteria.push(WorkCriterion {
            name: "image".into(),
            kind: WorkCriterionKind::Text,
        });
        for row in cells {
            row.push(WorkCell {
                value: WorkCellValue::Text {
                    text: image.clone(),
                },
                evidence: vec![0],
                note: None,
                general_knowledge: false,
            });
        }
        let schema=serde_json::from_value(json!({"title":"Items","max_items":3,"columns":[{"name":"image","value":{"kind":"image_url"},"required":false}]})).unwrap();
        let mut bank = Records::default();
        bank.register(&artifact, Some(&schema));
        let picks = bank
            .present(&request("picks"))
            .unwrap_or_else(|e| panic!("{e}"));
        let WorkArtifactDataV1::Picks { items, .. } = picks.data else {
            panic!()
        };
        assert_eq!(items[0].image_candidates, std::slice::from_ref(&image));
        assert!(
            items[0].media_attempted && items[0].record_media.is_none(),
            "a withheld native image must stay withheld"
        );
        assert!(items[0].facts.iter().all(|fact| fact.label != "image"));
        let table = bank
            .present(&request("table"))
            .unwrap_or_else(|e| panic!("{e}"));
        let WorkArtifactDataV1::Sheet { columns, rows, .. } = table.data else {
            panic!()
        };
        let index = columns
            .iter()
            .position(|column| column.label == "image")
            .unwrap();
        assert_eq!(columns[index].kind, WorkSheetColumnKindV1::Link);
        assert_eq!(rows[0].cells[index], image);
    }

    #[test]
    fn the_leads_facts_lead_the_card_and_never_rewrite_page_values() {
        let mut records = Records::default();
        records.register(&fixture(), None);
        let selection: Presentation = serde_json::from_value(json!({"title":"GPUs","layout":"picks","records":[
            {"source":"r2","subtitle":"Triple-fan RTX 3090","recommended":true,"annotation":"Cheapest card in working order.",
             "facts":[{"label":"VRAM","value":"24 GB"},{"label":"Condition","value":"Used"},{"label":"Stock","value":"not shown"},
                      {"label":"price","value":"1 zł"}]}
        ]})).unwrap();
        let proposed = records
            .present(&selection)
            .unwrap_or_else(|e| panic!("{e}"));
        let WorkArtifactDataV1::Picks { items, .. } = proposed.data else {
            panic!()
        };
        let pick = &items[0];
        assert_eq!(pick.subtitle.as_deref(), Some("Triple-fan RTX 3090"));
        assert!(pick.recommended);
        let facts: Vec<(&str, &str)> = pick
            .facts
            .iter()
            .map(|fact| (fact.label.as_str(), fact.value.as_str()))
            .collect();
        // The record's own Stock stands over the lead's, and the page's price
        // is the price.
        assert_eq!(facts[..2], [("VRAM", "24 GB"), ("Condition", "Used")]);
        assert!(facts.contains(&("Stock", "Out of stock")));
        assert_eq!(
            pick.price.as_ref().unwrap().amount.as_deref(),
            Some("100.00")
        );
    }

    #[test]
    fn failed_catalog_read_cannot_erase_requested_columns_from_same_site_fallback() {
        let schema: zephium_core::work::collection::WorkBrowseCollection = serde_json::from_value(json!({
            "title":"Books", "max_items":3,"columns":[
                {"name":"price","value":{"kind":"text"},"required":false,"extraction":"verbatim"},
                {"name":"availability","value":{"kind":"text"},"required":false,"extraction":"verbatim"}
            ]
        })).unwrap();
        let mut bank = Records::default();
        bank.remember_site("shop.example.com", &schema);
        assert!(bank.rows.is_empty());
        let retained = bank
            .collection_for_site("https://www.shop.example.com/book?id=3")
            .unwrap();
        assert_eq!(retained.columns, schema.columns);
        assert!(bank
            .collection_for_site("https://other.example.com/book?id=3")
            .is_none());
        assert!(bank
            .collection_for_site("https://shop.example.com.attacker.test/book")
            .is_none());
        let mut conflicting = schema.clone();
        conflicting.columns[1].name = "publication_date".into();
        bank.remember_site("shop.example.com", &conflicting);
        assert!(bank
            .collection_for_site("https://shop.example.com/book?id=3")
            .is_none());
    }

    #[test]
    fn keys_cannot_invent_or_rewrite_records_and_overflow_is_never_truncated() {
        let mut records = Records::default();
        records.register(&fixture(), None);
        // A key that isn't a record is left out; the records it sits beside stand.
        for key in ["r0", "r1", "r3", "r01"] {
            let mut selection = request("picks");
            selection.records[0].source = key.into();
            let proposed = records
                .present(&selection)
                .unwrap_or_else(|e| panic!("{e}"));
            let WorkArtifactDataV1::Picks { items, .. } = proposed.data else {
                panic!()
            };
            // The read's other offers follow the one chosen.
            assert_eq!(items.len(), records.rows.len(), "{key}");
            assert_eq!(items[0].name, records.rows[0].subject.name);
            assert_eq!(proposed.left_out.is_empty(), key == "r1", "{key}");
        }
        let mut nothing = request("picks");
        nothing.records = vec![serde_json::from_value(json!({"source":"r9"})).unwrap()];
        assert!(records.present(&nothing).is_err());
        let rewrite = Selection::loose(&json!({"source":"r1","price":"free"})).unwrap();
        assert!(rewrite.facts.is_empty() && rewrite.annotation.is_none());
        assert_eq!(Selection::loose(&json!(" r2 ")).unwrap().source, "r2");
        let lead = Selection::loose(&json!({"key":"r3","note":"Like new","recommended":"true",
            "facts":["VRAM: 24 GB", {"name":"Condition","value":"Used"}, "loose words"]}))
        .unwrap();
        assert_eq!((lead.source.as_str(), lead.recommended), ("r3", true));
        assert_eq!(lead.annotation.as_deref(), Some("Like new"));
        assert_eq!(lead.facts.len(), 2);
        records.rows[0].subject.name = "界".repeat(200);
        assert!(records.present(&request("picks")).is_ok());
        records.rows[0].subject.name = "界".repeat(201);
        let error = records.present(&request("picks")).err().unwrap();
        assert!(matches!(
            error.reason,
            super::super::objects::ObjectRefusal::Field(WorkArtifactField::PickName)
        ));
        assert_eq!(records.rows[0].subject.name.chars().count(), 201);
    }
}
