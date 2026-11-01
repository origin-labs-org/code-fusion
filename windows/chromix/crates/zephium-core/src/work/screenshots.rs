//! Screenshot-only standing consent. Account/session access is independent.
use super::WorkError;
use serde::{Deserialize, Serialize};

pub const MAX_SCREENSHOT_SITES: usize = 512;
/// One canonical origin whose page pictures the person explicitly allowed.
/// It does not authorize entering an account or executing any page action.
#[cfg_attr(feature = "ipc-types", derive(specta::Type))]
#[derive(Clone, Debug, Serialize, Deserialize, Eq, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct WorkScreenshotSiteV1 {
    pub origin: String,
}

/// Validates the exact scheme/host/port permission key, never a broad site suffix.
pub fn validate_origin(origin: &str) -> Result<(), WorkError> {
    if origin.is_empty() || origin.len() > 512 {
        return Err(WorkError::Invalid);
    }
    let parsed = url::Url::parse(origin).map_err(|_| WorkError::Invalid)?;
    if !matches!(parsed.scheme(), "http" | "https")
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.host_str().is_some_and(|host| host.len() > 253)
        || parsed.query().is_some()
        || parsed.fragment().is_some()
        || parsed.origin().ascii_serialization() != origin
    {
        return Err(WorkError::Invalid);
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn screenshot_consent_is_an_exact_origin_without_credentials_or_paths() {
        for valid in [
            "https://app.slack.com",
            "https://example.com:8443",
            "http://127.0.0.1:1234",
        ] {
            assert!(validate_origin(valid).is_ok());
        }
        for invalid in [
            "slack.com",
            "https://app.slack.com/",
            "https://example.com:443",
            "https://u:p@example.com",
            "https://example.com/a",
            "https://example.com?token=x",
            "file:///tmp/a",
        ] {
            assert!(validate_origin(invalid).is_err(), "{invalid}");
        }
    }
}
