//! Schema-directed normalization of hostile extraction output.
//!
//! Models, and providers that turn a constrained schema into a forced tool
//! call, return harmless variations of the closed envelope: fields in another
//! order or as an object map, a missing version or kind tag, a citation
//! spelled `r12` or as a number, a price written `1 299,00 zł`. This pass
//! rewrites only those forms into the canonical envelope the strict decoder
//! reads. It never invents a value or a citation and never reads evidence;
//! every value it keeps is still admitted against the delivered read.

use serde_json::{Map, Value};

use crate::{
    SemanticExtractionFieldSchema, SemanticExtractionSchema, SemanticExtractionValueKind,
    SemanticReadFragmentId, MAX_SEMANTIC_EXTRACTION_SOURCES_PER_VALUE,
    SEMANTIC_EXTRACTION_SCHEMA_VERSION,
};

/// Output rewritten into the canonical envelope, and how many supplied
/// fields it had to leave out because the trusted schema has no such field.
pub(crate) struct NormalizedExtraction {
    pub(crate) value: Value,
    pub(crate) dropped: usize,
    pub(crate) ambiguous_records: bool,
}

/// `None` when the bytes hold no JSON object at all.
pub(crate) fn normalize_extraction_output(
    schema: &SemanticExtractionSchema,
    bytes: &[u8],
) -> Option<NormalizedExtraction> {
    let mut root = parse_object(bytes)?;
    let mut dropped = 0;
    let version = root
        .remove("v")
        .filter(Value::is_u64)
        .unwrap_or_else(|| SEMANTIC_EXTRACTION_SCHEMA_VERSION.into());
    let schema_id = root
        .remove("schema")
        .filter(Value::is_u64)
        .unwrap_or_else(|| schema.id().get().into());
    let fields_value = match root.remove("fields") {
        Some(fields) => fields,
        // A bare record list is the one rows field it fills; a bare map
        // names its fields.
        None => match schema.fields() {
            [only] if only.kind() == SemanticExtractionValueKind::Rows => {
                let rows = root
                    .remove(only.name())
                    .or_else(|| root.remove("items"))
                    .or_else(|| root.remove("rows"))
                    .or_else(|| root.remove("records"))?;
                Value::Array(vec![
                    serde_json::json!({"name": only.name(), "value": rows}),
                ])
            }
            _ => Value::Object(root),
        },
    };
    let mut ambiguous_records = false;
    let fields = normalize_fields(
        schema.fields(),
        fields_value,
        &mut dropped,
        &mut ambiguous_records,
    );
    let mut output = Map::new();
    output.insert("v".into(), version);
    output.insert("schema".into(), schema_id);
    output.insert("fields".into(), Value::Array(fields));
    Some(NormalizedExtraction {
        value: Value::Object(output),
        dropped,
        ambiguous_records,
    })
}

/// The first JSON object in the output: bare, fenced, or behind prose.
fn parse_object(bytes: &[u8]) -> Option<Map<String, Value>> {
    if let Ok(Value::Object(object)) = serde_json::from_slice(bytes) {
        return Some(object);
    }
    let text = std::str::from_utf8(bytes).ok()?;
    let start = text.find('{')?;
    let mut stream = serde_json::Deserializer::from_str(&text[start..]).into_iter::<Value>();
    match stream.next()? {
        Ok(Value::Object(object)) => Some(object),
        _ => None,
    }
}

fn field_key(name: &str) -> String {
    name.trim()
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .map(|ch| ch.to_ascii_lowercase())
        .collect()
}

/// Canonical `[{name, value}]` in trusted schema order: unknown names are
/// dropped and counted, a repeated name keeps its first value.
fn normalize_fields(
    schemas: &[SemanticExtractionFieldSchema],
    raw: Value,
    dropped: &mut usize,
    ambiguous_records: &mut bool,
) -> Vec<Value> {
    let entries: Vec<(String, Value)> = match raw {
        Value::Array(items) => items
            .into_iter()
            .filter_map(|item| match item {
                Value::Object(mut object) => {
                    let name = object
                        .remove("name")
                        .and_then(|name| name.as_str().map(str::to_owned));
                    match name {
                        Some(name) => Some((
                            name,
                            object.remove("value").unwrap_or(Value::Object(object)),
                        )),
                        None => {
                            *dropped += 1;
                            None
                        }
                    }
                }
                _ => {
                    *dropped += 1;
                    None
                }
            })
            .collect(),
        Value::Object(object) => object.into_iter().collect(),
        _ => Vec::new(),
    };
    let mut slots: Vec<Option<Value>> = vec![None; schemas.len()];
    for (name, value) in entries {
        let key = field_key(&name);
        let Some(index) = schemas
            .iter()
            .position(|field| field.name() == name)
            .or_else(|| {
                schemas
                    .iter()
                    .position(|field| field_key(field.name()) == key)
            })
        else {
            *dropped += 1;
            continue;
        };
        if slots[index].is_some() || value.is_null() {
            continue;
        }
        if let Some(value) = normalize_value(&schemas[index], value, dropped, ambiguous_records) {
            slots[index] = Some(value);
        }
    }
    schemas
        .iter()
        .zip(slots)
        .filter_map(|(field, value)| {
            value.map(|value| serde_json::json!({"name": field.name(), "value": value}))
        })
        .collect()
}

const SOURCE_KEYS: [&str; 6] = ["sources", "source", "refs", "ref", "citations", "evidence"];

fn take_sources(object: &mut Map<String, Value>) -> Vec<Value> {
    let mut found = Vec::new();
    for key in SOURCE_KEYS {
        if let Some(value) = object.remove(key) {
            if found.is_empty() {
                found = canonical_sources(&value);
            }
        }
    }
    found
}

/// Citation tokens in canonical `@rN` spelling, ordered and de-duplicated.
/// Tokens that cannot name a read fragment are left out; admission decides
/// whether what remains resolves.
pub(crate) fn canonical_sources(value: &Value) -> Vec<Value> {
    let mut ids = Vec::new();
    let mut push = |token: &str| {
        for part in token.split(|ch: char| ch == ',' || ch.is_whitespace()) {
            if let Some(id) = parse_source_token(part) {
                ids.push(id);
            }
        }
    };
    match value {
        Value::Array(items) => {
            for item in items {
                match item {
                    Value::String(token) => push(token),
                    Value::Number(number) => push(&number.to_string()),
                    _ => {}
                }
            }
        }
        Value::String(token) => push(token),
        Value::Number(number) => push(&number.to_string()),
        _ => {}
    }
    ids.sort_unstable();
    ids.dedup();
    ids.into_iter()
        .map(|id| Value::String(id.model_token()))
        .collect()
}

/// `@r12`, `r12`, `@R12`, `[@r12]`, `@r012` and a bare `12` all name `@r12`.
pub(crate) fn parse_source_token(token: &str) -> Option<SemanticReadFragmentId> {
    let token = token.trim().trim_matches(|ch: char| {
        matches!(
            ch,
            '[' | ']' | '(' | ')' | '"' | '\'' | '`' | '.' | ';' | ':'
        )
    });
    let digits = token
        .strip_prefix('@')
        .unwrap_or(token)
        .trim_start_matches(['r', 'R']);
    if digits.is_empty() || digits.len() > 8 || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let value = digits.parse::<u16>().ok()?;
    SemanticReadFragmentId::parse_model_token(&format!("@r{value}"))
}

fn kind_tag(kind: SemanticExtractionValueKind) -> &'static str {
    match kind {
        SemanticExtractionValueKind::Text => "text",
        SemanticExtractionValueKind::Url => "url",
        SemanticExtractionValueKind::ImageUrl => "image_url",
        SemanticExtractionValueKind::Money => "money",
        SemanticExtractionValueKind::Boolean => "boolean",
        SemanticExtractionValueKind::Unsigned => "unsigned",
        SemanticExtractionValueKind::TextList => "text_list",
        SemanticExtractionValueKind::Rows => "rows",
    }
}

fn scalar_text(value: Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text),
        Value::Number(number) => Some(number.to_string()),
        Value::Bool(value) => Some(value.to_string()),
        _ => None,
    }
}

fn split_complete_record_groups(
    schemas: &[SemanticExtractionFieldSchema],
    fields: &Value,
) -> Option<Vec<Value>> {
    let fields = fields.as_array()?;
    let width = schemas.len();
    if width == 0 || fields.len() <= width || !fields.len().is_multiple_of(width) {
        return None;
    }
    if !fields.chunks_exact(width).all(|group| {
        group
            .iter()
            .zip(schemas)
            .all(|(field, schema)| field.get("name").and_then(Value::as_str) == Some(schema.name()))
    }) {
        return None;
    }
    let mut identities = Vec::new();
    for group in fields.chunks_exact(width) {
        if identities.contains(&&group[0]) {
            return None;
        }
        identities.push(&group[0]);
    }
    Some(
        fields
            .chunks_exact(width)
            .map(|group| Value::Array(group.to_vec()))
            .collect(),
    )
}

fn duplicate_record_fields(schemas: &[SemanticExtractionFieldSchema], fields: &Value) -> bool {
    let Some(fields) = fields.as_array() else {
        return false;
    };
    let mut seen = std::collections::BTreeSet::new();
    fields.iter().any(|field| {
        if field.get("value").is_some_and(Value::is_null) {
            return false;
        }
        let Some(name) = field.get("name").and_then(Value::as_str) else {
            return false;
        };
        let key = field_key(name);
        schemas
            .iter()
            .position(|schema| field_key(schema.name()) == key)
            .is_some_and(|index| !seen.insert(index))
    })
}

/// One value in the canonical tagged shape of its trusted field kind, or
/// `None` when nothing of that kind can be read from it.
fn normalize_value(
    field: &SemanticExtractionFieldSchema,
    raw: Value,
    dropped: &mut usize,
    ambiguous_records: &mut bool,
) -> Option<Value> {
    let kind = field.kind();
    if kind == SemanticExtractionValueKind::Rows {
        let items = match raw {
            Value::Array(items) => items,
            Value::Object(mut object) => match object
                .remove("items")
                .or_else(|| object.remove("rows"))
                .or_else(|| object.remove("records"))
            {
                Some(Value::Array(items)) => items,
                _ => return None,
            },
            _ => return None,
        };
        let children = field.row_fields().unwrap_or_default();
        let mut rows = Vec::new();
        for item in items {
            let fields = match item {
                Value::Object(mut object) => match object.remove("fields") {
                    Some(fields) => fields,
                    None => Value::Object(object),
                },
                Value::Array(fields) => Value::Array(fields),
                _ => {
                    *dropped += 1;
                    continue;
                }
            };
            // Only complete, ordered repetitions of the declared columns have
            // unambiguous record boundaries. Every source/value is still admitted.
            if let Some(groups) = split_complete_record_groups(children, &fields) {
                for group in groups {
                    rows.push(serde_json::json!({"fields": normalize_fields(children, group, dropped, ambiguous_records)}));
                }
            } else {
                *ambiguous_records |= duplicate_record_fields(children, &fields);
                rows.push(serde_json::json!({"fields": normalize_fields(children, fields, dropped, ambiguous_records)}));
            }
        }
        let items = rows;
        return Some(serde_json::json!({"k": "rows", "items": items}));
    }
    let mut object = match raw {
        Value::Object(object) => object,
        Value::Array(items) if kind == SemanticExtractionValueKind::TextList => {
            let mut object = Map::new();
            object.insert("items".into(), Value::Array(items));
            object
        }
        scalar => {
            let mut object = Map::new();
            object.insert("value".into(), scalar);
            object
        }
    };
    // A kind tag naming another kind is a different claim and is left out;
    // only a scalar written as text is re-read as its field's kind.
    if let Some(tag) = object.get("k").and_then(Value::as_str) {
        if tag != kind_tag(kind)
            && !(tag == "text" && kind != SemanticExtractionValueKind::TextList)
        {
            *dropped += 1;
            return None;
        }
    }
    let sources = take_sources(&mut object);
    let mut output = Map::new();
    output.insert("k".into(), kind_tag(kind).into());
    match kind {
        SemanticExtractionValueKind::Text => {
            let value = object
                .remove("value")
                .or_else(|| object.remove("text"))
                .and_then(scalar_text);
            if let Some(value) = value {
                output.insert("value".into(), value.into());
            }
        }
        SemanticExtractionValueKind::Url | SemanticExtractionValueKind::ImageUrl => {
            let value = object
                .remove("value")
                .or_else(|| object.remove("url"))
                .and_then(scalar_text)
                .map(|value| value.trim().to_owned())
                .filter(|value| !value.is_empty());
            if let Some(value) = value {
                output.insert("value".into(), value.into());
            }
        }
        SemanticExtractionValueKind::Money => {
            let currency = object
                .remove("currency")
                .and_then(scalar_text)
                .unwrap_or_default();
            let amount = object
                .remove("amount")
                .or_else(|| object.remove("value"))
                .and_then(scalar_text)?;
            let currency = normalize_currency(
                if currency.trim().is_empty() {
                    &amount
                } else {
                    &currency
                },
                field.currencies().unwrap_or_default(),
            )?;
            let amount = normalize_amount(&amount)?;
            output.insert("amount".into(), amount.into());
            output.insert("currency".into(), currency.into());
        }
        SemanticExtractionValueKind::Boolean => {
            let value = match object.remove("value")? {
                Value::Bool(value) => value,
                Value::String(text) => match text.trim().to_ascii_lowercase().as_str() {
                    "true" | "yes" => true,
                    "false" | "no" => false,
                    _ => return None,
                },
                _ => return None,
            };
            output.insert("value".into(), value.into());
        }
        SemanticExtractionValueKind::Unsigned => {
            let value = match object.remove("value")? {
                Value::Number(number) => number.as_u64().or_else(|| {
                    number
                        .as_f64()
                        .filter(|value| value.fract() == 0.0 && *value >= 0.0 && *value < 1e18)
                        .map(|value| value as u64)
                })?,
                Value::String(text) => parse_unsigned(&text)?,
                _ => return None,
            };
            output.insert("value".into(), value.into());
        }
        SemanticExtractionValueKind::TextList => {
            let Some(Value::Array(items)) = object.remove("items") else {
                return None;
            };
            let items: Vec<Value> = items
                .into_iter()
                .filter_map(|item| {
                    let mut item = match item {
                        Value::Object(object) => object,
                        scalar => {
                            let mut object = Map::new();
                            object.insert("value".into(), scalar);
                            object
                        }
                    };
                    let value = item.remove("value").and_then(scalar_text)?;
                    let mut item_sources = take_sources(&mut item);
                    if item_sources.is_empty() {
                        item_sources.clone_from(&sources);
                    }
                    item_sources.truncate(MAX_SEMANTIC_EXTRACTION_SOURCES_PER_VALUE);
                    Some(serde_json::json!({"value": value, "sources": item_sources}))
                })
                .collect();
            let mut list_sources = sources.clone();
            if list_sources.is_empty() {
                let mut gathered: Vec<Value> = items
                    .iter()
                    .flat_map(|item| item["sources"].as_array().cloned().unwrap_or_default())
                    .collect();
                gathered.dedup();
                list_sources = canonical_sources(&Value::Array(gathered));
            }
            list_sources.truncate(MAX_SEMANTIC_EXTRACTION_SOURCES_PER_VALUE);
            output.insert("items".into(), Value::Array(items));
            output.insert("sources".into(), Value::Array(list_sources));
            return Some(Value::Object(output));
        }
        SemanticExtractionValueKind::Rows => return None,
    }
    output.insert("sources".into(), Value::Array(sources));
    Some(Value::Object(output))
}

/// A three-letter code for `text`: an explicit code, or a currency sign that
/// names exactly one of the permitted codes (`$` is any dollar).
pub(crate) fn normalize_currency(text: &str, permitted: &[String]) -> Option<String> {
    let upper = text.trim().to_uppercase();
    for code in permitted {
        if upper.contains(code.as_str()) {
            return Some(code.clone());
        }
    }
    if upper.len() == 3 && upper.bytes().all(|byte| byte.is_ascii_uppercase()) {
        return Some(upper);
    }
    let candidates = crate::semantic_money::sign_currencies(text);
    let mut permitted_matches = candidates
        .iter()
        .filter(|code| permitted.iter().any(|permitted| permitted == *code));
    match (permitted_matches.next(), permitted_matches.next()) {
        (Some(code), None) => Some((*code).to_owned()),
        _ => candidates.first().map(|code| (*code).to_owned()),
    }
}

/// The first displayed number in `text`: digits joined by single group or
/// decimal marks, each followed by a digit.
fn number_token(text: &str) -> Option<&str> {
    let start = text.find(|ch: char| ch.is_ascii_digit())?;
    let tail = &text[start..];
    let end = tail
        .char_indices()
        .take_while(|(index, ch)| {
            ch.is_ascii_digit()
                || ((matches!(ch, '.' | ',' | '\'') || crate::semantic_money::spacing(*ch))
                    && tail[index + ch.len_utf8()..]
                        .chars()
                        .next()
                        .is_some_and(|next| next.is_ascii_digit()))
        })
        .last()
        .map(|(index, ch)| index + ch.len_utf8())?;
    Some(&tail[..end])
}

/// A plain decimal amount from a displayed or locale-formatted price:
/// `1 299,00 zł`, `1.299,50`, `$1,299.00`, `od 249 zł`, `12,5`. An amount
/// already in plain form keeps its own precision.
pub(crate) fn normalize_amount(text: &str) -> Option<String> {
    let trimmed = text.trim();
    if crate::semantic_money::valid_amount(trimmed) {
        return Some(trimmed.to_owned());
    }
    crate::semantic_money::canonical_amount(number_token(text)?)
}

/// A count as pages print it: `3,745`, `1 299`, `1.299` (de), `12'500`;
/// never a fraction such as `4.5`.
pub(crate) fn parse_unsigned(text: &str) -> Option<u64> {
    let token = number_token(text)?;
    let groups: Vec<&str> = token.split(|ch: char| !ch.is_ascii_digit()).collect();
    if (groups.len() > 1 && groups[0].len() > 3)
        || groups.iter().skip(1).any(|group| group.len() != 3)
    {
        return None;
    }
    groups.concat().parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn three_listing_schema() -> SemanticExtractionSchema {
        SemanticExtractionSchema::try_new(
            crate::SemanticExtractionSchemaId::new(1).unwrap(),
            vec![SemanticExtractionFieldSchema::try_rows(
                "listings".into(),
                true,
                vec![
                    SemanticExtractionFieldSchema::try_text("name".into(), true, 200).unwrap(),
                    SemanticExtractionFieldSchema::try_url("url".into(), true, 2048).unwrap(),
                    SemanticExtractionFieldSchema::try_text("price".into(), false, 64).unwrap(),
                ],
                3,
            )
            .unwrap()],
        )
        .unwrap()
    }

    fn flattened_listings() -> Value {
        let fields: Vec<Value> = (0..3).flat_map(|index| [
            serde_json::json!({"name":"name","value":{"k":"text","value":format!("Listing {index}"),"sources":[format!("@r{}",index*3+1)]}}),
            serde_json::json!({"name":"url","value":{"k":"url","sources":[format!("@r{}",index*3+2)]}}),
            serde_json::json!({"name":"price","value":{"k":"text","value":format!("{} EUR",100+index),"sources":[format!("@r{}",index*3+3)]}}),
        ]).collect();
        serde_json::json!({"fields":[{"name":"listings","value":{"k":"rows","items":[{"fields":fields}]}}]})
    }

    #[test]
    fn complete_record_groups_flattened_into_one_row_are_not_collapsed() {
        let output = flattened_listings();
        let repaired = normalize_extraction_output(
            &three_listing_schema(),
            &serde_json::to_vec(&output).unwrap(),
        )
        .unwrap();
        let rows = repaired.value["fields"][0]["value"]["items"]
            .as_array()
            .unwrap();
        assert_eq!(
            rows.len(),
            3,
            "three supplied identities must not become one record"
        );
        for (index, row) in rows.iter().enumerate() {
            assert_eq!(
                row["fields"].as_array().unwrap(),
                &output["fields"][0]["value"]["items"][0]["fields"]
                    .as_array()
                    .unwrap()[index * 3..index * 3 + 3]
            );
        }
        assert_eq!(repaired.dropped, 0);
    }

    #[test]
    fn ambiguous_or_repeated_identity_groups_require_a_mapper_correction() {
        for repeated_identity in [false, true] {
            let mut output = flattened_listings();
            let fields = output["fields"][0]["value"]["items"][0]["fields"]
                .as_array_mut()
                .unwrap();
            if repeated_identity {
                fields[3] = fields[0].clone();
            } else {
                fields.remove(4);
            }
            let repaired = normalize_extraction_output(
                &three_listing_schema(),
                &serde_json::to_vec(&output).unwrap(),
            )
            .unwrap();
            assert!(repaired.ambiguous_records);
        }
    }

    #[test]
    fn citation_spellings_name_the_same_fragment() {
        for token in ["@r12", "r12", "@R12", "[@r12]", "@r012", "12", " @r12. "] {
            assert_eq!(
                parse_source_token(token).map(|id| id.model_token()),
                Some("@r12".to_owned()),
                "{token}"
            );
        }
        for token in ["", "@r", "@r0", "x12", "@rx", "@r99999999999"] {
            assert!(parse_source_token(token).is_none(), "{token}");
        }
        assert_eq!(
            canonical_sources(&serde_json::json!(["@r3", "r1", 3, "@r2, @r1", {"x":1}])),
            vec![Value::from("@r1"), Value::from("@r2"), Value::from("@r3")]
        );
        assert_eq!(
            canonical_sources(&serde_json::json!("@r4 @r2")),
            vec![Value::from("@r2"), Value::from("@r4")]
        );
    }

    #[test]
    fn counts_parse_in_common_locales_and_fractions_do_not() {
        for (text, value) in [
            ("3745", 3745),
            ("3,745", 3745),
            ("3.745", 3745),
            ("3 745", 3745),
            ("3\u{a0}745 pieces", 3745),
            ("12'500", 12500),
            ("1,234,567", 1_234_567),
            ("Pieces: 973", 973),
            ("44", 44),
        ] {
            assert_eq!(parse_unsigned(text), Some(value), "{text}");
        }
        for text in ["4.5", "12,3", "abc", "", "1,23,456"] {
            assert_eq!(parse_unsigned(text), None, "{text}");
        }
    }

    #[test]
    fn amounts_and_currencies_normalize_from_displayed_prices() {
        for (text, amount) in [
            ("1 299,00 zł", "1299"),
            ("1\u{a0}299,00\u{a0}zł", "1299"),
            ("od 249 zł", "249"),
            ("$1,299.99", "1299.99"),
            ("1.299,50 €", "1299.5"),
            ("12,5", "12.5"),
            ("€0,99", "0.99"),
            ("1299.00", "1299.00"),
            ("CHF 12'500.00", "12500"),
            ("349.99", "349.99"),
        ] {
            assert_eq!(normalize_amount(text).as_deref(), Some(amount), "{text}");
        }
        let usd = vec!["USD".to_owned(), "EUR".to_owned()];
        let pln = vec!["PLN".to_owned()];
        assert_eq!(normalize_currency("$", &usd).as_deref(), Some("USD"));
        assert_eq!(normalize_currency("zł", &pln).as_deref(), Some("PLN"));
        assert_eq!(normalize_currency("pln", &pln).as_deref(), Some("PLN"));
        assert_eq!(normalize_currency("€", &usd).as_deref(), Some("EUR"));
        assert_eq!(normalize_currency("1 299 zł", &pln).as_deref(), Some("PLN"));
        assert_eq!(normalize_currency("", &pln), None);
    }
}
