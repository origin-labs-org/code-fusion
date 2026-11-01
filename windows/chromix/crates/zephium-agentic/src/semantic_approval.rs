//! Private native element continuity for one reviewed action.
use std::fmt;

/// Opaque native target identities carried only by trusted policy and execution.
/// They are not model references, serializable artifacts, or public IPC data.
///
/// ```compile_fail
/// fn expose(value: zephium_agentic::SemanticApprovalBinding) {
///     let _ = serde_json::to_string(&value);
/// }
/// ```
#[derive(Clone, Copy, Eq, PartialEq)]
pub struct SemanticApprovalBinding {
    target: SemanticApprovalIdentity,
    option: Option<SemanticApprovalIdentity>,
}

#[derive(Clone, Copy, Eq, PartialEq)]
pub(crate) struct SemanticApprovalIdentity {
    nonce: [u8; 16],
    element: u16,
}

impl SemanticApprovalIdentity {
    pub(crate) fn nonce(value: &str) -> Option<[u8; 16]> {
        if value.len() != 32 {
            return None;
        }
        let digit = |byte| match byte {
            b'0'..=b'9' => Some(byte - b'0'),
            b'a'..=b'f' => Some(byte - b'a' + 10),
            _ => None,
        };
        let mut result = [0; 16];
        for (index, pair) in value.as_bytes().chunks_exact(2).enumerate() {
            result[index] = digit(pair[0])? * 16 + digit(pair[1])?;
        }
        result.iter().any(|byte| *byte != 0).then_some(result)
    }
    pub(crate) fn new(nonce: [u8; 16], element: u16) -> Option<Self> {
        (element > 0 && element <= 2048 && nonce.iter().any(|byte| *byte != 0))
            .then_some(Self { nonce, element })
    }
}

impl SemanticApprovalBinding {
    pub(crate) fn new(
        target: Option<SemanticApprovalIdentity>,
        option: Option<SemanticApprovalIdentity>,
        selection: bool,
    ) -> Option<Self> {
        let target = target?;
        if selection != option.is_some()
            || option.is_some_and(|option| {
                option.nonce != target.nonce || option.element == target.element
            })
        {
            return None;
        }
        Some(Self { target, option })
    }
    /// Whether both identities come from one page instance: its elements may be
    /// replaced, but a reload or a new document restarts the keyspace.
    pub fn same_keyspace(&self, other: &Self) -> bool {
        self.target.nonce == other.target.nonce
    }
    pub(crate) fn guard_bytes(self) -> [u8; 20] {
        let mut bytes = [0; 20];
        bytes[..16].copy_from_slice(&self.target.nonce);
        bytes[16..18].copy_from_slice(&self.target.element.to_be_bytes());
        bytes[18..].copy_from_slice(&self.option.map_or(0, |value| value.element).to_be_bytes());
        bytes
    }
    pub(crate) fn wire(self) -> (String, u16, Option<u16>) {
        use std::fmt::Write;
        let mut nonce = String::with_capacity(32);
        for byte in self.target.nonce {
            let _ = write!(nonce, "{byte:02x}");
        }
        (
            nonce,
            self.target.element,
            self.option.map(|value| value.element),
        )
    }
}

impl fmt::Debug for SemanticApprovalIdentity {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("SemanticApprovalIdentity([redacted])")
    }
}
impl fmt::Debug for SemanticApprovalBinding {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("SemanticApprovalBinding([redacted])")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn private_nonce_is_strict_nonzero_and_bounded() {
        for invalid in [
            "",
            "0",
            "00000000000000000000000000000000",
            "000102030405060708090A0B0C0D0E0F",
            "gg0102030405060708090a0b0c0d0e0f",
            "000102030405060708090a0b0c0d0e0f00",
        ] {
            assert!(SemanticApprovalIdentity::nonce(invalid).is_none());
        }
        let nonce = SemanticApprovalIdentity::nonce("000102030405060708090a0b0c0d0e0f").unwrap();
        assert!(SemanticApprovalIdentity::new(nonce, 0).is_none());
        assert!(SemanticApprovalIdentity::new(nonce, 2049).is_none());
        assert!(SemanticApprovalIdentity::new([0; 16], 1).is_none());
    }
    #[test]
    fn private_binding_requires_exact_distinct_option_in_same_keyspace() {
        let a = SemanticApprovalIdentity::new([1; 16], 1);
        let b = SemanticApprovalIdentity::new([1; 16], 2);
        let foreign = SemanticApprovalIdentity::new([2; 16], 2);
        assert!(SemanticApprovalBinding::new(None, None, false).is_none());
        assert!(SemanticApprovalBinding::new(a, None, true).is_none());
        assert!(SemanticApprovalBinding::new(a, a, true).is_none());
        assert!(SemanticApprovalBinding::new(a, foreign, true).is_none());
        assert!(SemanticApprovalBinding::new(a, b, false).is_none());
        assert!(SemanticApprovalBinding::new(a, b, true).is_some());
    }
    #[test]
    fn private_binding_debug_never_renders_the_native_seal() {
        let target = SemanticApprovalIdentity::new([0x12; 16], 1);
        let binding = SemanticApprovalBinding::new(target, None, false).unwrap();
        assert_eq!(
            format!("{binding:?}"),
            "SemanticApprovalBinding([redacted])"
        );
        assert!(!format!("{target:?}").contains("121212"));
    }
}
