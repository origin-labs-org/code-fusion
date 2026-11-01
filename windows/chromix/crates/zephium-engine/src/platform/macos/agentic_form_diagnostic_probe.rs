//! Exact probe-only boolean envelope; shipping action bytes remain byte-for-byte intact.
use crate::platform::form_qualification::{selection, MASK};

pub(super) fn select<'a>(
    original: &'a str,
    selected: Option<(&str, &str)>,
) -> std::borrow::Cow<'a, str> {
    selected
        .and_then(|(case, url)| source(original, case, url))
        .map(std::borrow::Cow::Owned)
        .unwrap_or(std::borrow::Cow::Borrowed(original))
}
fn source(original: &str, case: &str, url: &str) -> Option<String> {
    if crate::platform::form_qualification::target(case) != Some((case, url)) {
        return None;
    }
    let helper = include_str!("agentic_form_diagnostic_probe.js")
        .replace("__FORM_CASE__", &format!("\"{case}\""))
        .replace("__FORM_URL__", &format!("\"{url}\""));
    let submit = crate::platform::form_qualification::SUBMIT_SOURCE
        .replace("__FORM_URL__", &format!("\"{url}\""));
    compose(original, &helper, &submit)
}
fn compose(original: &str, helper: &str, submit: &str) -> Option<String> {
    // Independent, probe-only helpers. Shipping primary/helper ceilings stay fixed.
    if helper.len() > 4096 || submit.len() > 4096 {
        return None;
    }
    let anchor = "  function runAction(request) {";
    let checked = "    if (descriptor.role !== request.r) return actionFault(\"target_changed\");";
    let result = "      const result = typeof invoked === \"string\" ? invoked : await invoked;";
    if [anchor, checked, result]
        .iter()
        .any(|needle| original.matches(needle).count() != 1)
    {
        return None;
    }
    let source = original.replacen(anchor, &format!("{helper}\n{anchor}\n    formQualificationBits=0;formQualificationTarget=null;"), 1)
        .replacen(checked, &format!("{checked}\n    formQualificationStart(request,target);"), 1)
        .replacen(result, "      const result = formQualificationResult(typeof invoked === \"string\" ? invoked : await invoked);", 1);
    // Both passive listener and action witness live in the one existing private
    // script/world; native inventory and exact-source attestation stay unchanged.
    let source = format!("{submit}\n{source}");
    (source.len() <= original.len() + 8192).then_some(source)
}
pub(super) fn split(bytes: &[u8]) -> Option<(u16, &[u8])> {
    let body = bytes.strip_prefix(b"FQ1:")?;
    let end = body.iter().take(5).position(|byte| *byte == b'\n')?;
    let value = std::str::from_utf8(&body[..end]).ok()?;
    if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let bits: u16 = value.parse().ok()?;
    let payload = &body[end + 1..];
    (bits <= MASK && (payload.starts_with(b"{") || payload.starts_with(b"E2:")))
        .then_some((bits, payload))
}
pub(super) fn normalize(bytes: &[u8]) -> (Option<u16>, &[u8]) {
    if selection().is_some() {
        if let Some((bits, payload)) = split(bytes) {
            return (Some(bits), payload);
        }
    }
    (None, bytes)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn form_caps_refuse_overflow_and_unselected_source_is_identical() {
        let original = zephium_agentic::SEMANTIC_RUNTIME_PROGRAM.source();
        assert!(
            matches!(select(original,None),std::borrow::Cow::Borrowed(value) if value.as_ptr()==original.as_ptr() && value==original)
        );
        assert!(compose(original, &"x".repeat(4097), "").is_none());
        assert!(compose(original, "", &"x".repeat(4097)).is_none());
        assert!(
            compose(original, &"x".repeat(4096), &"x".repeat(4096)).is_none(),
            "total delta includes wrapper bytes"
        );
    }
    #[test]
    fn form_envelope_preserves_exact_action_bytes_and_rejects_unbounded_or_opaque_data() {
        let payload = b"{\"v\":1,\"a\":123}";
        let mut envelope = b"FQ1:137\n".to_vec();
        envelope.extend_from_slice(payload);
        assert_eq!(split(&envelope), Some((137, payload.as_slice())));
        for invalid in [
            b"FQ1:2048\n{}".as_slice(),
            b"FQ1:1,2\n{}",
            b"FQ1:1\nprivate",
            b"FQ1:123456\n{}",
        ] {
            assert!(split(invalid).is_none());
        }
    }
    #[test]
    fn form_source_anchors_are_closed_and_leave_shipping_source_unchanged_on_drift() {
        let original = zephium_agentic::SEMANTIC_RUNTIME_PROGRAM.source();
        let (case, url) =
            crate::platform::form_qualification::target("form-expand-inputs").unwrap();
        let qualified = source(original, case, url).unwrap();
        assert!(qualified.contains("formQualificationStart(request,target)"));
        assert!(qualified.len() <= original.len() + 8192);
        assert!(qualified.starts_with("// Probe-only passive event accounting"));
        assert_eq!(
            qualified.matches("new MutationObserver(mutations)").count(),
            1
        );
        assert!(source(
            &original.replace("  function runAction(request) {", "changed"),
            case,
            url
        )
        .is_none());
        assert!(!original.contains("formQualificationBits"));
    }
}
