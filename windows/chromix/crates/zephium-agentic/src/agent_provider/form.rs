//! Bounded form data from the model; this never grants an action or submission.
use crate::{SemanticActionText, SemanticReferenceId};
use serde::Deserialize;
use std::fmt;

/// Maximum fields in one bounded native form proposal.
pub const MAX_FORM_FIELDS: usize = 8;
const MAX_FORM_TEXT_BYTES: usize = 8192;

/// One untrusted target/value pair, still requiring fresh binding and policy.
#[derive(Clone, Eq, PartialEq)]
pub struct FormField {
    target: SemanticReferenceId,
    value: SemanticActionText,
}
impl FormField {
    /// The proposed observation-local target.
    pub fn target(&self) -> SemanticReferenceId {
        self.target
    }
    /// Private model-proposed data, never diagnostic text.
    pub fn value(&self) -> &SemanticActionText {
        &self.value
    }
}

/// A bounded proposal; fields and submission are independently authorized later.
#[derive(Clone, Eq, PartialEq)]
pub struct FormProposal {
    fields: Vec<FormField>,
    submit: Option<SemanticReferenceId>,
}
impl FormProposal {
    /// Proposed fields in requested order.
    pub fn fields(&self) -> &[FormField] {
        &self.fields
    }
    /// Optional read-only submission target; never payment or send authority.
    pub fn submit(&self) -> Option<SemanticReferenceId> {
        self.submit
    }
}
impl fmt::Debug for FormProposal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("FormProposal")
            .field("fields", &self.fields.len())
            .field("submit", &self.submit.is_some())
            .field("content", &"[redacted]")
            .finish()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
/// Content-free validation failure.
pub enum FormFault {
    /// Unexpected or missing fields.
    Shape,
    /// Field count is outside the fixed bound.
    Count,
    /// Target is not a canonical reference.
    Reference,
    /// One target has conflicting proposed uses.
    Duplicate,
    /// Value cannot be represented safely.
    Value,
    /// Aggregate text exceeds its bound.
    TextLimit,
    /// The proposed target is absent, unsupported or outside advertised operations.
    Target,
    /// A retained field no longer has the same native identity and meaning.
    Stale,
    /// Native policy requires a separately admitted action, not another form attempt.
    SeparateActionRequired,
    /// Native preflight refused before mutation; the next look may safely replan.
    ChangedBeforeAction,
    /// A dispatched operation did not establish its requested postcondition.
    Unverified,
    /// The bounded native preparation exhausted its action or time allowance.
    Limit,
    /// The form does not belong to the acknowledged provider call and capability.
    Authority,
    /// The field has no uniquely matching observed option yet.
    OptionPending,
    /// Several options match, so choosing one would guess.
    AmbiguousOption,
}
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
/// Exact failing field without leaking its proposed content.
pub struct FormError {
    /// One-based field index, absent for envelope or submit errors.
    pub field: Option<u8>,
    /// Closed validation reason.
    pub fault: FormFault,
}

/// Native field identities bound to the exact advertised form proposal.
/// This grants no effects; each resolved operation still needs fresh policy admission.
pub struct FormBinding {
    proposal: FormProposal,
    fields: Vec<BoundTarget>,
    submit: Option<BoundTarget>,
}
struct BoundTarget {
    frame: crate::SemanticFrameJoin,
    key: crate::semantic::SemanticNodeKey,
    role: crate::SemanticRole,
    name: Option<crate::SemanticText>,
    allowed: crate::SemanticOperations,
    populated_choice: bool,
}
impl fmt::Debug for FormBinding {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("FormBinding")
            .field("fields", &self.fields.len())
            .field("submit", &self.submit.is_some())
            .finish()
    }
}
impl FormBinding {
    /// Number of fields in the original proposal, at most eight.
    pub fn field_count(&self) -> usize {
        self.fields.len()
    }
    /// The value the planner asked for in this field.
    pub fn field_value(&self, index: usize) -> Option<&str> {
        self.proposal
            .fields
            .get(index)
            .map(|field| field.value.as_str())
    }
    /// Whether this field is a picker's button: clicked open, its value is
    /// typed into the box it opens or found among the choices it shows.
    pub fn is_picker(&self, index: usize) -> bool {
        self.fields
            .get(index)
            .is_some_and(|field| field.role == crate::SemanticRole::Button)
    }
    /// Whether this field requires a committed option rather than typed text.
    pub fn is_choice(&self, index: usize) -> bool {
        self.fields.get(index).is_some_and(|field| {
            matches!(
                field.role,
                crate::SemanticRole::Combobox | crate::SemanticRole::Listbox
            )
        })
    }
    /// Exact fresh field value. For a choice this is necessary but not sufficient:
    /// the controller must also have independently verified its option activation.
    pub fn value_matches(&self, index: usize, observation: &crate::SemanticObservation) -> bool {
        let Some(field) = self.proposal.fields.get(index) else {
            return false;
        };
        let Some(bound) = self.fields.get(index) else {
            return false;
        };
        observation.frames().iter().find(|frame| frame.frame() == &bound.frame)
            .and_then(|frame| frame.nodes().iter().find(|node| node.key() == bound.key))
            .is_some_and(|node| node.role() == bound.role && node.name() == bound.name.as_ref()
                && node.sensitivity() != crate::SemanticSensitivity::Secret && node.fields_complete() == Some(true)
                && matches!(node.value(), Some(crate::SemanticValueSummary::Text(value)) if value.as_str() == field.value.as_str()))
    }

    /// A custom option click committed a displayed value only when its own
    /// previously open combobox is now closed and still shows that exact value.
    pub fn choice_collapsed(
        &self,
        index: usize,
        before: &crate::SemanticObservation,
        after: &crate::SemanticObservation,
    ) -> bool {
        let Some(bound) = self
            .fields
            .get(index)
            .filter(|bound| bound.role == crate::SemanticRole::Combobox)
        else {
            return false;
        };
        let expanded = |look: &crate::SemanticObservation| {
            look.frames()
                .iter()
                .find(|frame| frame.frame() == &bound.frame)
                .and_then(|frame| frame.nodes().iter().find(|node| node.key() == bound.key))
                .filter(|node| {
                    node.role() == bound.role
                        && node.name() == bound.name.as_ref()
                        && node.fields_complete() == Some(true)
                        && node.sensitivity() != crate::SemanticSensitivity::Secret
                })
                .map(|node| node.states().contains(crate::SemanticState::Expanded))
        };
        expanded(before) == Some(true)
            && expanded(after) == Some(false)
            && self.value_matches(index, after)
    }

    /// Resolves one zero-based field in a new capture of the same document.
    /// Re-rendered or renamed controls refuse rather than falling back to a similar label.
    pub fn field_reference(
        &self,
        index: usize,
        operation: crate::SemanticActionKind,
        observation: &crate::SemanticObservation,
    ) -> Result<SemanticReferenceId, FormError> {
        self.fields
            .get(index)
            .and_then(|target| target.resolve(operation, observation))
            .ok_or(FormError {
                field: index.checked_add(1).and_then(|n| u8::try_from(n).ok()),
                fault: FormFault::Stale,
            })
    }
    /// Resolves the original optional submit control; this is never submit permission.
    pub fn submit_reference(
        &self,
        observation: &crate::SemanticObservation,
    ) -> Result<Option<SemanticReferenceId>, FormError> {
        self.submit
            .as_ref()
            .map(|target| {
                target
                    .resolve(crate::SemanticActionKind::Click, observation)
                    .ok_or(FormError {
                        field: None,
                        fault: FormFault::Stale,
                    })
            })
            .transpose()
    }
}
impl FormBinding {
    /// Proposes the next bounded primitive for one field from fresh native state.
    /// None means its exact value/selection is observed. The returned proposal
    /// still requires the ordinary task, scope, privacy and effect admission.
    pub fn field_action(
        &self,
        index: usize,
        observation: &crate::SemanticObservation,
    ) -> Result<Option<crate::SemanticActionProposal>, FormError> {
        use crate::{
            SemanticActionIntent as Intent, SemanticActionKind as Action,
            SemanticEffectClass as Effect, SemanticRole as Role, SemanticState as State,
            SemanticVerification as Verify, SemanticWaitCondition as Wait,
        };
        let fail = |fault| FormError {
            field: index.checked_add(1).and_then(|n| u8::try_from(n).ok()),
            fault,
        };
        let field = self
            .proposal
            .fields
            .get(index)
            .ok_or_else(|| fail(FormFault::Stale))?;
        let bound = self
            .fields
            .get(index)
            .ok_or_else(|| fail(FormFault::Stale))?;
        let frame = observation
            .frames()
            .iter()
            .find(|frame| frame.frame() == &bound.frame)
            .ok_or_else(|| fail(FormFault::Stale))?;
        let (target_index, target) = frame
            .nodes()
            .iter()
            .enumerate()
            .find(|(_, node)| node.key() == bound.key)
            .ok_or_else(|| fail(FormFault::Stale))?;
        if target.role() != bound.role
            || target.name() != bound.name.as_ref()
            || target.sensitivity() == crate::SemanticSensitivity::Secret
            || target.fields_complete() != Some(true)
        {
            return Err(fail(FormFault::Stale));
        }
        let exact = matches!(target.value(), Some(crate::SemanticValueSummary::Text(value))
            if value.as_str() == field.value.as_str());
        // Opening a dropdown or choosing its option commits nothing.
        let make = |intent: Intent, verification| {
            let effect = if matches!(intent, Intent::Click { .. }) {
                Effect::Read
            } else {
                Effect::LocalWrite
            };
            crate::SemanticActionProposal::try_new(
                intent,
                effect,
                Wait::Immediate,
                verification,
                crate::SemanticSettleBudget::try_new(
                    crate::MIN_AGENT_BROWSER_SNAPSHOT_SETTLE_MILLIS,
                )
                .expect("fixed bound"),
            )
            .map(Some)
            .map_err(|_| fail(FormFault::Target))
        };
        if !self.is_choice(index) || field.value.is_empty() {
            if exact {
                return Ok(None);
            }
            let reference = self.field_reference(index, Action::Fill, observation)?;
            return make(
                Intent::Fill {
                    target: reference,
                    value: field.value.clone(),
                },
                Verify::TargetValueMatchesInput,
            );
        }
        // Options must belong to this field's native semantic subtree. A
        // similarly named option elsewhere on the page is never a candidate.
        let options: Vec<_> = frame
            .nodes()
            .iter()
            .enumerate()
            .filter(|(option_index, node)| {
                if node.role() != Role::Option
                    || node.fields_complete() != Some(true)
                    || node.sensitivity() == crate::SemanticSensitivity::Secret
                {
                    return false;
                }
                let mut at = *option_index;
                while let Some(parent) = frame.nodes()[at].parent() {
                    at = usize::from(parent);
                    if at == target_index {
                        return true;
                    }
                }
                false
            })
            .map(|(_, node)| node)
            .collect();
        let matching: Vec<_> = options
            .iter()
            .filter(|node| {
                node.name()
                    .is_some_and(|name| name.as_str() == field.value.as_str())
                    || node
                        .text()
                        .is_some_and(|text| text.as_str() == field.value.as_str())
            })
            .copied()
            .collect();
        if matching.len() > 1
            || options
                .iter()
                .filter(|node| node.states().contains(State::Selected))
                .count()
                > 1
        {
            return Err(fail(FormFault::AmbiguousOption));
        }
        if let Some(option) = matching.first() {
            if option.states().contains(State::Disabled) {
                return Err(fail(FormFault::Target));
            }
            if option.states().contains(State::Selected) {
                return Ok(None);
            }
            if let Ok(reference) = self.field_reference(index, Action::Select, observation) {
                return make(
                    Intent::Select {
                        target: reference,
                        option: option.reference(),
                    },
                    Verify::TargetSelectionMatchesOption,
                );
            }
            // A custom ARIA combobox uses its observed child option. The
            // controller must project fresh authority for this newly visible control.
            if option
                .operations()
                .contains(crate::SemanticOperationClass::Click)
            {
                return make(
                    Intent::Click {
                        target: option.reference(),
                    },
                    Verify::PageChanged,
                );
            }
            return Err(fail(FormFault::Target));
        }
        if bound.populated_choice
            && exact
            && !target.states().contains(State::Expanded)
            && !target.states().contains(State::Invalid)
        {
            return Ok(None);
        }
        if !exact {
            if let Ok(reference) = self.field_reference(index, Action::Fill, observation) {
                return make(
                    Intent::Fill {
                        target: reference,
                        value: field.value.clone(),
                    },
                    Verify::TargetValueMatchesInput,
                );
            }
        }
        if !target.states().contains(State::Expanded) {
            if let Ok(reference) = self.field_reference(index, Action::Click, observation) {
                return make(
                    Intent::Click { target: reference },
                    Verify::TargetState {
                        state: State::Expanded,
                        present: true,
                    },
                );
            }
        }
        // Typing an autocomplete label is not evidence that its option was committed.
        Err(fail(FormFault::OptionPending))
    }
}

impl BoundTarget {
    fn resolve(
        &self,
        operation: crate::SemanticActionKind,
        observation: &crate::SemanticObservation,
    ) -> Option<SemanticReferenceId> {
        let frame = observation
            .frames()
            .iter()
            .find(|frame| frame.frame() == &self.frame)?;
        let node = frame.nodes().iter().find(|node| node.key() == self.key)?;
        (self.allowed.contains(operation.operation())
            && node.operations().contains(operation.operation())
            && node.role() == self.role
            && node.name() == self.name.as_ref()
            && node.sensitivity() != crate::SemanticSensitivity::Secret
            && node.fields_complete() == Some(true))
        .then_some(node.reference())
    }
}
impl FormProposal {
    pub(super) fn bind_targets(
        &self,
        observation: &crate::SemanticObservation,
        mut permits: impl FnMut(SemanticReferenceId, crate::SemanticActionKind) -> bool,
    ) -> Result<FormBinding, FormError> {
        use crate::{SemanticActionKind as Action, SemanticRole as Role};
        let mut bind = |reference, expected: Option<&str>| {
            observation.frames().iter().find_map(|frame| {
                let (index, node) = frame.nodes().iter().enumerate().find(|(_, node)| node.reference() == reference)?;
                (node.fields_complete() == Some(true)
                    && node.sensitivity() != crate::SemanticSensitivity::Secret)
                    .then(|| {
                        (
                            node,
                            BoundTarget {
                                frame: frame.frame().clone(),
                                key: node.key(),
                                role: node.role(),
                                name: node.name().cloned(),
                                populated_choice: node.role() == Role::Combobox
                                    && !node.states().contains(crate::SemanticState::Expanded)
                                    && !node.states().contains(crate::SemanticState::Invalid)
                                    && matches!(node.value(), Some(crate::SemanticValueSummary::Text(value)) if Some(value.as_str()) == expected && !value.is_empty())
                                    && !frame.nodes().iter().enumerate().any(|(child, candidate)| {
                                        if candidate.role() != Role::Option { return false; }
                                        let mut at = child;
                                        while let Some(parent) = frame.nodes()[at].parent() {
                                            at = usize::from(parent);
                                            if at == index { return true; }
                                        }
                                        false
                                    }),
                                allowed: crate::SemanticOperations::try_new(
                                    &[Action::Fill, Action::Select, Action::Click]
                                        .into_iter()
                                        .filter(|kind| {
                                            node.operations().contains(kind.operation())
                                                && permits(reference, *kind)
                                        })
                                        .map(Action::operation)
                                        .collect::<Vec<_>>(),
                                )
                                .expect("closed operations"),
                            },
                        )
                    })
            })
        };
        let mut fields = Vec::with_capacity(self.fields.len());
        for (index, field) in self.fields.iter().enumerate() {
            let failure = FormError {
                field: Some((index + 1) as u8),
                fault: FormFault::Target,
            };
            let (node, target) = bind(field.target, Some(field.value.as_str())).ok_or(failure)?;
            let permitted = if matches!(node.role(), Role::Combobox | Role::Listbox) {
                target.allowed.contains(Action::Fill.operation())
                    || target.allowed.contains(Action::Select.operation())
                    || target.allowed.contains(Action::Click.operation())
            } else if node.role() == Role::Button {
                // A picker: its button opens a text box or a calendar.
                target.allowed.contains(Action::Click.operation()) && !field.value.is_empty()
            } else {
                matches!(
                    node.role(),
                    Role::Textbox | Role::Searchbox | Role::Spinbutton
                ) && target.allowed.contains(Action::Fill.operation())
            };
            if !permitted {
                return Err(failure);
            }
            fields.push(target);
        }
        let submit = self
            .submit
            .map(|reference| {
                let failure = FormError {
                    field: None,
                    fault: FormFault::Target,
                };
                let (node, target) = bind(reference, None).ok_or(failure)?;
                if node.role() != Role::Button
                    || !target.allowed.contains(Action::Click.operation())
                {
                    return Err(failure);
                }
                Ok(target)
            })
            .transpose()?;
        Ok(FormBinding {
            proposal: self.clone(),
            fields,
            submit,
        })
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Wire {
    fields: Vec<serde_json::Value>,
    #[serde(default)]
    submit: Option<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct FieldWire {
    target: String,
    value: String,
}

pub(super) fn decode(arguments: &str) -> Result<FormProposal, FormError> {
    let fail = |fault| FormError { field: None, fault };
    if arguments.len() > super::MAX_AGENT_PROVIDER_TOOL_ARGUMENT_BYTES as usize {
        return Err(fail(FormFault::TextLimit));
    }
    let wire: Wire = serde_json::from_str(arguments).map_err(|_| fail(FormFault::Shape))?;
    if wire.fields.is_empty() || wire.fields.len() > MAX_FORM_FIELDS {
        return Err(fail(FormFault::Count));
    }
    let mut fields = Vec::with_capacity(wire.fields.len());
    let mut bytes = 0usize;
    for (index, raw) in wire.fields.into_iter().enumerate() {
        let fail = |fault| FormError {
            field: Some((index + 1) as u8),
            fault,
        };
        let field: FieldWire = serde_json::from_value(raw).map_err(|_| fail(FormFault::Shape))?;
        let target =
            SemanticReferenceId::parse(&field.target).ok_or_else(|| fail(FormFault::Reference))?;
        if fields
            .iter()
            .any(|field: &FormField| field.target == target)
        {
            return Err(fail(FormFault::Duplicate));
        }
        bytes += field.value.len();
        if bytes > MAX_FORM_TEXT_BYTES {
            return Err(fail(FormFault::TextLimit));
        }
        let value = SemanticActionText::try_new(field.value).map_err(|_| fail(FormFault::Value))?;
        fields.push(FormField { target, value });
    }
    let submit = wire
        .submit
        .as_deref()
        .map(|value| SemanticReferenceId::parse(value).ok_or_else(|| fail(FormFault::Reference)))
        .transpose()?;
    if submit.is_some_and(|target| fields.iter().any(|field| field.target == target)) {
        return Err(fail(FormFault::Duplicate));
    }
    Ok(FormProposal { fields, submit })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn invalid_fields_identify_the_exact_index_and_never_expose_values() {
        let input = json!({"fields":[{"target":"@a1","value":"Northport"},
            {"target":"@a2","value":42}],"submit":"@a3"});
        assert_eq!(
            decode(&input.to_string()).unwrap_err(),
            FormError {
                field: Some(2),
                fault: FormFault::Shape
            }
        );
        let input = json!({"fields":[{"target":"@a1","value":"Northport"}],"submit":"@a3"});
        let plan = decode(&input.to_string()).unwrap();
        assert!(!format!("{plan:?}").contains("Northport"));
        assert_eq!(plan.fields()[0].value().as_str(), "Northport");
    }
    #[test]
    fn references_counts_unknown_fields_and_duplicate_targets_are_closed() {
        for input in [
            json!({"fields":[]}),
            json!({"fields":[{"target":"#from","value":"A"}]}),
            json!({"fields":[{"target":"@a1","value":"A","selector":"input"}]}),
            json!({"fields":[{"target":"@a1","value":"A"}],"submit":"@a1"}),
            json!({"fields":[{"target":"@a1","value":"A"},{"target":"@a1","value":"B"}]}),
        ] {
            assert!(decode(&input.to_string()).is_err());
        }
    }
}
