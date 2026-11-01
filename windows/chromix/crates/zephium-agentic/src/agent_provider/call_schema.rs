//! Where a tool call's arguments leave the JSON schema the model was given.
//!
//! Only the keywords Zephium's own browser tool schemas use are read (`$ref`
//! into `$defs`, `anyOf`, `type`, `enum`, `properties`, `required`,
//! `additionalProperties`, `items`, `minItems`, `maxItems`, `minLength`,
//! `maxLength`, `minimum`, `maximum`); any other keyword is not checked. The
//! answer names the exact field, so a model without strict tool calling can
//! correct the one thing it got wrong.

use serde_json::Value;

/// Nesting deeper than any browser tool schema; a guard, not a limit models meet.
const MAX_DEPTH: usize = 24;

/// The first place `value` breaks `schema`, as `path: what is wrong`.
pub(crate) fn schema_problem(schema: &Value, value: &Value) -> Option<String> {
    check(schema, schema, value, "arguments", 0)
}

fn resolve<'a>(root: &'a Value, schema: &'a Value) -> &'a Value {
    match schema.get("$ref").and_then(Value::as_str) {
        Some(reference) => reference
            .strip_prefix("#/")
            .and_then(|pointer| root.pointer(&format!("/{pointer}")))
            .unwrap_or(schema),
        None => schema,
    }
}

fn type_name(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(number) if number.is_i64() || number.is_u64() => "integer",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

fn fits_type(expected: &str, value: &Value) -> bool {
    let actual = type_name(value);
    actual == expected || (expected == "number" && actual == "integer")
}

fn check(root: &Value, schema: &Value, value: &Value, path: &str, depth: usize) -> Option<String> {
    if depth > MAX_DEPTH {
        return None;
    }
    let schema = resolve(root, schema);
    if let Some(branches) = schema.get("anyOf").and_then(Value::as_array) {
        let problems: Vec<String> = branches
            .iter()
            .map(|branch| check(root, branch, value, path, depth + 1))
            .collect::<Option<Vec<_>>>()?;
        // A union told apart by its `kind`: report the branch that kind names.
        let kind = value.get("kind");
        let named = branches.iter().zip(&problems).find(|(branch, _)| {
            let branch = resolve(root, branch);
            kind.is_some_and(|kind| {
                branch
                    .pointer("/properties/kind/enum")
                    .and_then(Value::as_array)
                    .is_some_and(|kinds| kinds.contains(kind))
            })
        });
        if let Some((_, problem)) = named {
            return Some(problem.clone());
        }
        let kinds: Vec<String> = branches
            .iter()
            .filter_map(|branch| resolve(root, branch).pointer("/properties/kind/enum"))
            .filter_map(Value::as_array)
            .flatten()
            .filter_map(Value::as_str)
            .map(|kind| format!("\"{kind}\""))
            .collect();
        return Some(if kinds.is_empty() {
            problems
                .into_iter()
                .next()
                .unwrap_or_else(|| format!("{path}: matches no allowed form"))
        } else {
            format!("{path}.kind: must be one of {}", kinds.join(", "))
        });
    }
    if let Some(expected) = schema.get("type") {
        let fits = match expected {
            Value::String(expected) => fits_type(expected, value),
            Value::Array(types) => types
                .iter()
                .filter_map(Value::as_str)
                .any(|expected| fits_type(expected, value)),
            _ => true,
        };
        if !fits {
            return Some(format!(
                "{path}: must be {}, not {}",
                match expected {
                    Value::String(expected) => format!("a {expected}"),
                    other => format!("one of {other}"),
                },
                type_name(value)
            ));
        }
    }
    if let Some(allowed) = schema.get("enum").and_then(Value::as_array) {
        if !allowed.contains(value) {
            let listed: Vec<String> = allowed.iter().map(Value::to_string).collect();
            return Some(format!("{path}: must be one of {}", listed.join(", ")));
        }
    }
    match value {
        Value::Object(fields) => {
            let properties = schema.get("properties").and_then(Value::as_object);
            for required in schema
                .get("required")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
            {
                if !fields.contains_key(required) {
                    return Some(format!("{path}.{required}: is required but missing"));
                }
            }
            if schema.get("additionalProperties") == Some(&Value::Bool(false)) {
                if let Some(unknown) = fields
                    .keys()
                    .find(|key| properties.is_none_or(|properties| !properties.contains_key(*key)))
                {
                    return Some(format!("{path}.{unknown}: is not a field of this object"));
                }
            }
            for (key, field) in fields {
                if let Some(property) = properties.and_then(|properties| properties.get(key)) {
                    if let Some(problem) =
                        check(root, property, field, &format!("{path}.{key}"), depth + 1)
                    {
                        return Some(problem);
                    }
                }
            }
            None
        }
        Value::Array(items) => {
            let count = items.len() as u64;
            if let Some(min) = schema.get("minItems").and_then(Value::as_u64) {
                if count < min {
                    return Some(format!("{path}: needs at least {min} items"));
                }
            }
            if let Some(max) = schema.get("maxItems").and_then(Value::as_u64) {
                if count > max {
                    return Some(format!("{path}: takes at most {max} items"));
                }
            }
            let item = schema.get("items")?;
            items.iter().enumerate().find_map(|(index, element)| {
                check(root, item, element, &format!("{path}[{index}]"), depth + 1)
            })
        }
        Value::String(text) => {
            let length = text.chars().count() as u64;
            if let Some(min) = schema.get("minLength").and_then(Value::as_u64) {
                if length < min {
                    return Some(format!("{path}: needs at least {min} characters"));
                }
            }
            if let Some(max) = schema.get("maxLength").and_then(Value::as_u64) {
                if length > max {
                    return Some(format!("{path}: takes at most {max} characters"));
                }
            }
            None
        }
        Value::Number(number) => {
            let number = number.as_f64()?;
            if let Some(min) = schema.get("minimum").and_then(Value::as_f64) {
                if number < min {
                    return Some(format!("{path}: must be at least {min}"));
                }
            }
            if let Some(max) = schema.get("maximum").and_then(Value::as_f64) {
                if number > max {
                    return Some(format!("{path}: must be at most {max}"));
                }
            }
            None
        }
        Value::Null | Value::Bool(_) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn act() -> Value {
        json!({
            "$defs": {"action_ref": {"type": "string", "maxLength": 5}},
            "type": "object", "additionalProperties": false, "required": ["actions"],
            "properties": {"actions": {"type": "array", "minItems": 1, "maxItems": 8, "items": {"anyOf": [
                {"type": "object", "additionalProperties": false,
                 "required": ["kind", "target", "settle_millis"],
                 "properties": {"kind": {"type": "string", "enum": ["click"]},
                     "target": {"$ref": "#/$defs/action_ref"},
                     "settle_millis": {"type": "integer", "minimum": 2000, "maximum": 30000}}},
                {"type": "object", "additionalProperties": false,
                 "required": ["kind", "target", "value"],
                 "properties": {"kind": {"type": "string", "enum": ["fill"]},
                     "target": {"$ref": "#/$defs/action_ref"},
                     "value": {"type": "string"}}}
            ]}}}
        })
    }

    #[test]
    fn names_the_exact_field_a_call_got_wrong() {
        let schema = act();
        let problem = |value: Value| schema_problem(&schema, &value);
        assert_eq!(
            problem(
                json!({"actions": [{"kind": "fill", "target": {"ref": "@a13"}, "value": "x"}]})
            ),
            Some("arguments.actions[0].target: must be a string, not object".to_owned())
        );
        assert_eq!(
            problem(json!({"actions": [{"kind": "click", "target": "@a1", "settle_millis": 100}]})),
            Some("arguments.actions[0].settle_millis: must be at least 2000".to_owned())
        );
        assert_eq!(
            problem(json!({"actions": [{"kind": "tap", "target": "@a1"}]})),
            Some("arguments.actions[0].kind: must be one of \"click\", \"fill\"".to_owned())
        );
        assert_eq!(
            problem(json!({"actions": [{"kind": "fill", "target": "@a1"}]})),
            Some("arguments.actions[0].value: is required but missing".to_owned())
        );
        assert_eq!(
            problem(json!({"actions": [], "why": 1})),
            Some("arguments.why: is not a field of this object".to_owned())
        );
        assert_eq!(
            problem(json!({"actions": [{"kind": "fill", "target": "@a1", "value": "x"}]})),
            None
        );
    }
}
