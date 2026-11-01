//! Zephium Cloud's accounting around a provider-native call: the request id
//! and policy revision headers, the `: zephium` trailer after a stream, and
//! which refusals prove nothing was generated.
//!
//! A call that may have reached a provider is never sent again on its own:
//! its outcome is reported, and the caller's receipt lookup decides the rest.

use std::sync::Arc;
use std::time::{Duration, SystemTime};

use reqwest::header::HeaderMap;
use reqwest::StatusCode;
use serde_json::Value;
use zephium_core::work::model::{HostedRefusal, WorkModelError};

const REQUEST_ID_HEADER: &str = "x-zephium-request-id";
const POLICY_HEADER: &str = "x-zephium-policy-revision";
const USAGE_HEADER: &str = "x-zephium-usage";
const MAX_ID_BYTES: usize = 64;
const MAX_UNITS_DIGITS: usize = 20;

/// What one logical Cloud call left for accounting. Content-free.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LeadCloudRecord {
    /// The `Idempotency-Key` the call was sent with.
    pub idempotency_key: String,
    /// The server's id for the admitted request, when it admitted one.
    pub request_id: Option<String>,
    /// The policy revision that priced the call.
    pub policy_revision: Option<String>,
    /// What is known about the charge.
    pub accounting: LeadCloudAccounting,
}

impl LeadCloudRecord {
    /// Whether the charge is still open: the receipt is the way to learn it.
    pub fn unsettled(&self) -> bool {
        self.request_id.is_some()
            && !matches!(
                self.accounting,
                LeadCloudAccounting::Settled { .. } | LeadCloudAccounting::Refused
            )
    }
}

/// What a Cloud call is known to have cost.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LeadCloudAccounting {
    /// Final.
    Settled {
        /// In integer units, when the server stated it.
        charged: Option<String>,
    },
    /// Admitted and generated; the charge is still being confirmed.
    Pending,
    /// The server reported the call interrupted after it was admitted.
    Interrupted,
    /// The call may have reached a provider and nothing says what happened.
    Unknown,
    /// Refused before anything was generated; nothing is charged.
    Refused,
}

/// Receives each Cloud call's record once the call ends.
pub type LeadCloudObserver = Arc<dyn Fn(LeadCloudRecord) + Send + Sync>;

/// Headers of an answered Cloud call.
#[derive(Default)]
pub(crate) struct Answered {
    pub(crate) request_id: Option<String>,
    pub(crate) policy_revision: Option<String>,
    pub(crate) usage: Option<LeadCloudAccounting>,
}

impl Answered {
    pub(crate) fn read(headers: &HeaderMap) -> Self {
        let text = |name: &str| {
            headers
                .get(name)
                .and_then(|value| value.to_str().ok())
                .map(str::trim)
                .filter(|value| token(value))
                .map(str::to_owned)
        };
        Self {
            request_id: text(REQUEST_ID_HEADER),
            policy_revision: text(POLICY_HEADER),
            usage: match text(USAGE_HEADER).as_deref() {
                Some("settled") => Some(LeadCloudAccounting::Settled { charged: None }),
                Some("pending") => Some(LeadCloudAccounting::Pending),
                _ => None,
            },
        }
    }
}

/// The trailer comment a Cloud stream ends with, parsed apart from the
/// provider's events.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Trailer {
    pub(crate) request_id: Option<String>,
    pub(crate) accounting: LeadCloudAccounting,
}

impl Trailer {
    /// `line` is a whole SSE comment line, such as `: zephium {...}`.
    pub(crate) fn parse(line: &str) -> Option<Self> {
        let json = line
            .strip_prefix(':')?
            .trim_start()
            .strip_prefix("zephium")?
            .trim();
        let value: Value = serde_json::from_str(json).ok()?;
        let field = |key: &str| value.get(key).and_then(Value::as_str);
        let accounting = if field("error").is_some() {
            LeadCloudAccounting::Interrupted
        } else {
            match field("usage")? {
                "settled" => LeadCloudAccounting::Settled {
                    charged: field("charged")
                        .filter(|units| units_text(units))
                        .map(str::to_owned),
                },
                "pending" => LeadCloudAccounting::Pending,
                _ => return None,
            }
        };
        Some(Self {
            request_id: field("request_id")
                .filter(|id| token(id))
                .map(str::to_owned),
            accounting,
        })
    }
}

/// How a refused Cloud call may continue.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Refusal {
    /// Nothing was admitted: the same key may be sent again.
    Again,
    /// Admitted and released unspent: another try is a new logical call.
    AgainWithNewKey,
    /// Final, and nothing generated.
    Final,
    /// It may have reached a provider. Never sent again automatically.
    Uncertain,
}

/// Reads a non-2xx Cloud answer. Only a 429, or a server error from before
/// admission, is shown to have generated nothing; any other server error
/// after admission, and a 409 on the key, leave the outcome open.
pub(crate) fn refusal(status: StatusCode, request_id: Option<&str>) -> Refusal {
    match (status.as_u16(), request_id.is_some()) {
        (429, false) => Refusal::Again,
        (429, true) => Refusal::AgainWithNewKey,
        (409, _) => Refusal::Uncertain,
        (408 | 500..=599, false) => Refusal::Again,
        (408 | 500..=599, true) => Refusal::Uncertain,
        _ => Refusal::Final,
    }
}

/// The request id in a Cloud error body, or its header.
pub(crate) fn error_request_id(body: &[u8], headers: &Answered) -> Option<String> {
    serde_json::from_slice::<Value>(body)
        .ok()
        .and_then(|json| json.get("request_id")?.as_str().map(str::to_owned))
        .filter(|id| token(id))
        .or_else(|| headers.request_id.clone())
}

/// Zephium Cloud's own refusals come before the provider's: only a 401 means
/// the session is over, and a model outside the plan is not a bad bearer.
pub(crate) fn classify_cloud(status: StatusCode, body: &[u8]) -> WorkModelError {
    let json: Value = serde_json::from_slice(body).unwrap_or(Value::Null);
    let code = json
        .get("error")
        .and_then(|error| error.get("code"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    let hosted = |refusal| WorkModelError::Hosted {
        refusal,
        retry_after_ms: None,
    };
    match (status.as_u16(), code) {
        (401, _) => WorkModelError::Unauthorized,
        (_, "plan_required") => hosted(HostedRefusal::PlanRequired),
        (_, "billing_review_required") => hosted(HostedRefusal::BillingReview),
        (_, "insufficient_credits") => hosted(HostedRefusal::OutOfCredits),
        (_, "daily_limit_reached") => hosted(HostedRefusal::DailyLimit),
        (_, "free_usage_limit_reached") => hosted(HostedRefusal::FreeUsagePaused),
        (_, "usage_confirmation_limited") => hosted(HostedRefusal::ConfirmationLimited),
        (_, "cloud_budget_exhausted") => hosted(HostedRefusal::Paused),
        (_, "invalid_audio") => hosted(HostedRefusal::InvalidAudio),
        (_, "unsupported_audio_format") => hosted(HostedRefusal::UnsupportedAudio),
        (_, "audio_too_long") => hosted(HostedRefusal::AudioTooLong),
        (402, _) => hosted(HostedRefusal::OutOfCredits),
        (409, _) => hosted(HostedRefusal::AlreadySent),
        (403, _) => WorkModelError::BadRequest,
        (
            _,
            "input_limit_exceeded"
            | "body_too_large"
            | "request_structure_limit"
            | "context_limit_exceeded",
        ) => WorkModelError::ContextTooLong,
        _ => super::classify(status, body),
    }
}

/// How long the server said to wait: the larger of `Retry-After(-Ms)` and,
/// for Cloud, the error body's `retry_after` seconds.
pub(crate) fn server_wait(headers: &HeaderMap, body: &[u8], cloud: bool) -> Option<Duration> {
    let header = super::retry_after(headers);
    let in_body = cloud
        .then(|| {
            let json: Value = serde_json::from_slice(body).ok()?;
            let seconds = json.get("error")?.get("retry_after")?.as_f64()?;
            (seconds.is_finite() && seconds >= 0.0)
                .then(|| Duration::from_secs_f64(seconds.min(86_400.0)))
        })
        .flatten();
    header.max(in_body)
}

/// Puts the server's wait on the error that can carry one. A Cloud 503 that
/// names a wait says when to come back, so it reads as a wait, not an outage.
pub(crate) fn with_wait(
    error: WorkModelError,
    wait: Option<Duration>,
    cloud: bool,
) -> WorkModelError {
    with_wait_at(error, wait, cloud, SystemTime::now())
}

pub(super) fn with_wait_at(
    error: WorkModelError,
    wait: Option<Duration>,
    cloud: bool,
    now: SystemTime,
) -> WorkModelError {
    let ms = wait.map(|wait| u64::try_from(wait.as_millis()).unwrap_or(u64::MAX));
    match error {
        WorkModelError::RateLimited { .. } => WorkModelError::RateLimited { retry_after_ms: ms },
        WorkModelError::Overloaded if cloud && ms.is_some() => {
            WorkModelError::RateLimited { retry_after_ms: ms }
        }
        // The daily limit counts UTC days, so its reset is known without being told.
        WorkModelError::Hosted {
            refusal: HostedRefusal::DailyLimit,
            ..
        } => WorkModelError::Hosted {
            refusal: HostedRefusal::DailyLimit,
            retry_after_ms: ms.or_else(|| until_utc_midnight(now)),
        },
        WorkModelError::Hosted { refusal, .. } => WorkModelError::Hosted {
            refusal,
            retry_after_ms: ms,
        },
        other => other,
    }
}

fn until_utc_midnight(now: SystemTime) -> Option<u64> {
    let since = now.duration_since(SystemTime::UNIX_EPOCH).ok()?.as_secs();
    Some((86_400 - since % 86_400) * 1_000)
}

/// After a Cloud stream started, a failure the caller would retry must not
/// read as retryable: the call was dispatched.
pub(crate) fn dispatched(error: WorkModelError) -> WorkModelError {
    match error {
        WorkModelError::RateLimited { .. }
        | WorkModelError::Overloaded
        | WorkModelError::Network => WorkModelError::Protocol,
        other => other,
    }
}

fn token(text: &str) -> bool {
    !text.is_empty()
        && text.len() <= MAX_ID_BYTES
        && text
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
}

fn units_text(text: &str) -> bool {
    !text.is_empty() && text.len() <= MAX_UNITS_DIGITS && text.bytes().all(|b| b.is_ascii_digit())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trailers_read_settled_pending_and_interrupted_accounting() {
        let settled = Trailer::parse(
            r#": zephium {"request_id":"0b3c6a3e-8f7d-4a59-9a3c-1d2e3f4a5b6c","usage":"settled","charged":"812"}"#,
        )
        .unwrap();
        assert_eq!(
            settled.request_id.as_deref(),
            Some("0b3c6a3e-8f7d-4a59-9a3c-1d2e3f4a5b6c")
        );
        assert_eq!(
            settled.accounting,
            LeadCloudAccounting::Settled {
                charged: Some("812".into())
            }
        );
        let pending = Trailer::parse(r#":zephium {"request_id":"r1","usage":"pending"}"#).unwrap();
        assert_eq!(pending.accounting, LeadCloudAccounting::Pending);
        let broken =
            Trailer::parse(r#": zephium {"request_id":"r1","error":"provider_idle_timeout"}"#)
                .unwrap();
        assert_eq!(broken.accounting, LeadCloudAccounting::Interrupted);
        assert_eq!(Trailer::parse(": keepalive"), None);
        assert_eq!(Trailer::parse(": zephium {not json"), None);
        assert_eq!(
            Trailer::parse(r#": zephium {"request_id":"r1","usage":"settled","charged":"-1"}"#)
                .unwrap()
                .accounting,
            LeadCloudAccounting::Settled { charged: None }
        );
    }

    #[test]
    fn only_refusals_that_prove_nothing_ran_may_be_sent_again() {
        let status = |code| StatusCode::from_u16(code).unwrap();
        assert_eq!(refusal(status(429), None), Refusal::Again);
        assert_eq!(refusal(status(429), Some("r")), Refusal::AgainWithNewKey);
        assert_eq!(refusal(status(503), None), Refusal::Again);
        assert_eq!(refusal(status(502), Some("r")), Refusal::Uncertain);
        assert_eq!(refusal(status(504), Some("r")), Refusal::Uncertain);
        assert_eq!(refusal(status(409), None), Refusal::Uncertain);
        assert_eq!(refusal(status(402), None), Refusal::Final);
        assert_eq!(refusal(status(400), Some("r")), Refusal::Final);
    }
}
