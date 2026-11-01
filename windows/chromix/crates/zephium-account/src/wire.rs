//! What the account service answers, read leniently: a newer server may add
//! fields, and a self-hosted one may leave optional ones out.
//!
//! Amounts stay decimal strings of integer units, as the server sends them.

use serde::{Deserialize, Serialize};

/// One display credit, in the integer units every amount is counted in.
pub const UNIT_SCALE: u64 = 1_000_000;

/// `GET /v1/client-config`: what this server offers, before signing in.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
pub struct ClientConfig {
    #[serde(default)]
    pub cloud_enabled: bool,
    #[serde(default = "yes")]
    pub signup_open: bool,
    #[serde(default)]
    pub billing_enabled: bool,
    #[serde(default)]
    pub min_client_version: Option<String>,
    #[serde(default)]
    pub notice: Option<Notice>,
    /// Who may create an account here; absent from older servers.
    #[serde(default)]
    pub signup_mode: Option<SignupMode>,
}

/// How a server takes new accounts. Existing accounts sign in under any mode.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SignupMode {
    Open,
    /// Only invited addresses.
    Allowlist,
    Closed,
    #[serde(other)]
    Unknown,
}

fn yes() -> bool {
    true
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct Notice {
    pub id: String,
    pub text: String,
    #[serde(default)]
    pub severity: Option<String>,
}

/// `GET /v1/account`.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct Profile {
    pub id: String,
    pub email: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default, rename = "createdAt", alias = "created_at")]
    pub created_at: Option<String>,
    /// The account picture's private, versioned address on the account
    /// service; fetched natively with the bearer, never handed to a webview.
    #[serde(default)]
    pub avatar_url: Option<String>,
}

#[derive(Deserialize)]
pub(crate) struct Name {
    pub(crate) name: Option<String>,
}

/// One row of `GET /v1/sessions`.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct Session {
    pub id: String,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
    #[serde(default)]
    pub expires_at: Option<String>,
    #[serde(default)]
    pub device: Option<String>,
    #[serde(default)]
    pub current: bool,
}

/// `PUT` and `DELETE /v1/account/avatar`.
#[derive(Deserialize)]
pub(crate) struct AvatarLink {
    pub(crate) avatar_url: Option<String>,
}

#[derive(Deserialize)]
pub(crate) struct Sessions {
    pub(crate) sessions: Vec<Session>,
}

/// `GET /v1/billing`.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
pub struct Billing {
    #[serde(default)]
    pub subscription: Subscription,
    #[serde(default)]
    pub paid: bool,
    #[serde(default)]
    pub capabilities: Capabilities,
    /// Null when this server sells nothing.
    #[serde(default)]
    pub offers: Option<Offers>,
}

impl Billing {
    /// Whether anything can be bought or managed here. A server with billing
    /// off still reports a subscription, as `not_applicable`.
    pub fn sells(&self) -> bool {
        self.offers.is_some() && self.subscription.status != "not_applicable"
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
pub struct Capabilities {
    #[serde(default, rename = "hostedAI", alias = "hosted_ai")]
    pub hosted_ai: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
pub struct Subscription {
    /// `active`, `inactive`, `unknown` (not reconciled lately), or
    /// `not_applicable` when the server has billing off.
    #[serde(default)]
    pub status: String,
    #[serde(default, rename = "paidUntil", alias = "paid_until")]
    pub paid_until: Option<String>,
    #[serde(default, rename = "cancelAtPeriodEnd", alias = "cancel_at_period_end")]
    pub cancel_at_period_end: bool,
    #[serde(default)]
    pub plan: Option<String>,
    #[serde(default)]
    pub interval: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
pub struct Offers {
    #[serde(default)]
    pub subscriptions: Vec<PlanOffer>,
    #[serde(default)]
    pub topups: Vec<TopUpOffer>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct PlanOffer {
    pub plan: String,
    pub interval: String,
    #[serde(default)]
    pub product_name: Option<String>,
    #[serde(default)]
    pub price: Option<Price>,
    #[serde(default)]
    pub features: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct TopUpOffer {
    pub id: String,
    #[serde(default)]
    pub units: Option<String>,
    #[serde(default)]
    pub expires_days: Option<u32>,
    #[serde(default)]
    pub product_name: Option<String>,
    #[serde(default)]
    pub price: Option<Price>,
}

/// A price as the billing provider states it, in the currency's minor unit.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct Price {
    pub amount_minor: u64,
    pub currency: String,
}

/// `GET /v1/usage`. Every amount is a decimal string of integer units.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
pub struct Usage {
    #[serde(default)]
    pub cloud_enabled: bool,
    #[serde(default)]
    pub plan: Option<String>,
    #[serde(default)]
    pub period_end: Option<String>,
    #[serde(default)]
    pub allowance: Allowance,
    #[serde(default)]
    pub purchased_remaining: Option<String>,
    #[serde(default)]
    pub unit_scale: Option<u64>,
    #[serde(default)]
    pub credits_remaining: Option<String>,
    /// Held for calls still running; never a settled charge.
    #[serde(default)]
    pub reserved_units: Option<String>,
    #[serde(default)]
    pub spent_today: Option<String>,
    #[serde(default)]
    pub daily_limit_units: Option<String>,
    #[serde(default)]
    pub bonus_remaining: Option<String>,
    #[serde(default)]
    pub bonus_expires_at: Option<String>,
    #[serde(default)]
    pub by_model: Vec<ModelUsage>,
    /// Units in one credit, a decimal string. Credits exist only where the
    /// server states this; nothing here assumes a factor.
    #[serde(default)]
    pub credit_units: Option<String>,
    /// The free allowance is exhausted for now; purchased credit still works.
    #[serde(default)]
    pub free_usage_paused: bool,
    #[serde(default)]
    pub purchased_usage_available: Option<bool>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
pub struct Allowance {
    #[serde(default)]
    pub total_units: Option<String>,
    #[serde(default)]
    pub used_units: Option<String>,
    #[serde(default)]
    pub reserved_units: Option<String>,
    /// False for the one-time free allowance, which never refills.
    #[serde(default)]
    pub renews: Option<bool>,
    #[serde(default)]
    pub expires_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct ModelUsage {
    pub model_id: String,
    #[serde(default)]
    pub units: Option<String>,
    #[serde(default)]
    pub requests: u64,
}

impl Usage {
    /// Share of the plan's allowance used or held, 0–100. None without an allowance.
    pub fn used_percent(&self) -> Option<u8> {
        let total = units(self.allowance.total_units.as_deref())?;
        if total == 0 {
            return None;
        }
        let spent = units(self.allowance.used_units.as_deref()).unwrap_or(0)
            + units(self.allowance.reserved_units.as_deref()).unwrap_or(0);
        Some((spent.min(total) * 100 / total) as u8)
    }

    /// What the plan's allowance still holds, in units: its total less what
    /// is used and held. None without an allowance.
    pub fn allowance_left(&self) -> Option<String> {
        let total = units(self.allowance.total_units.as_deref())?;
        let spent = units(self.allowance.used_units.as_deref()).unwrap_or(0)
            + units(self.allowance.reserved_units.as_deref()).unwrap_or(0);
        Some(total.saturating_sub(spent).to_string())
    }

    /// Whether bought usage remains beyond the plan's allowance.
    pub fn has_extra(&self) -> bool {
        units(self.purchased_remaining.as_deref()).is_some_and(|units| units > 0)
    }

    /// Units to one credit, when the server states a usable factor.
    pub fn credit_units(&self) -> Option<u64> {
        let units = units(self.credit_units.as_deref())?;
        u64::try_from(units).ok().filter(|units| *units > 0)
    }

    /// Whether the allowance is a one-time grant rather than a plan's monthly one.
    pub fn one_time_allowance(&self) -> bool {
        self.allowance.renews == Some(false)
    }

    /// The scale amounts are counted in; the contract fixes it, so anything
    /// else is read as the contract's.
    pub fn scale(&self) -> u64 {
        self.unit_scale
            .filter(|scale| *scale > 0)
            .unwrap_or(UNIT_SCALE)
    }
}

/// An amount as the server sent it, when it is a well-formed unit count.
pub fn amount(value: Option<&str>) -> Option<String> {
    units(value).map(|units| units.to_string())
}

fn units(value: Option<&str>) -> Option<u128> {
    let value = value?.trim();
    if value.is_empty() || value.len() > 38 || !value.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    value.parse().ok()
}

/// One page of `GET /v1/usage/requests`.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
pub struct UsageHistory {
    #[serde(default)]
    pub requests: Vec<UsageRequest>,
    /// Opaque; passed back unchanged for the next page.
    #[serde(default)]
    pub next_cursor: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct UsageRequest {
    pub id: String,
    #[serde(default)]
    pub model_id: Option<String>,
    pub state: String,
    /// Charged so far; final only when `state` is `settled`.
    #[serde(default)]
    pub units: Option<String>,
    #[serde(default)]
    pub reserved: Option<String>,
    #[serde(default)]
    pub started_at: Option<String>,
    #[serde(default)]
    pub finished_at: Option<String>,
    /// Which balance paid: `allowance`, `purchased` or `mixed`; null for
    /// legacy rows and calls that were never funded.
    #[serde(default)]
    pub funding_source: Option<String>,
}

/// `GET /v1/usage/requests/{id}`: one call's accounting, never its content.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct Receipt {
    pub id: String,
    pub state: String,
    #[serde(default)]
    pub model_id: Option<String>,
    #[serde(default)]
    pub policy_revision: Option<u64>,
    #[serde(default)]
    pub reserved: Option<String>,
    #[serde(default)]
    pub charged: Option<String>,
    #[serde(default)]
    pub error_class: Option<String>,
    #[serde(default)]
    pub started_at: Option<String>,
    #[serde(default)]
    pub finished_at: Option<String>,
    #[serde(default)]
    pub funding_source: Option<String>,
}

impl Receipt {
    /// Only a settled request has a final charge.
    pub fn settled(&self) -> bool {
        self.state == "settled"
    }
}

/// A quote or receipt of a Pro/Max change, as `preview`, `change` and
/// `changes/{id}` all state it. Holds no credential.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct PlanChange {
    pub id: String,
    /// `quoted`, `queued`, `executing`, `uncertain`, `applied`, `scheduled`, `failed`.
    pub status: String,
    #[serde(default)]
    pub current_plan: String,
    #[serde(default)]
    pub target_plan: String,
    #[serde(default)]
    pub interval: String,
    /// `upgrade` or `downgrade`.
    #[serde(default)]
    pub direction: String,
    /// Null for an immediate upgrade; the renewal for a downgrade.
    #[serde(default)]
    pub effective_at: Option<String>,
    /// Only an estimate from product prices, with no customer tax worked out:
    /// the provider decides the final charge and any tax on it.
    #[serde(default)]
    pub amount_due_estimate: Option<Price>,
    #[serde(default)]
    pub recurring_price: Option<Price>,
    #[serde(default)]
    pub expires_at: Option<String>,
    #[serde(default)]
    pub error: Option<ChangeFault>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct ChangeFault {
    pub code: String,
}

impl PlanChange {
    /// Nothing more will happen to this change.
    pub fn finished(&self) -> bool {
        matches!(self.status.as_str(), "applied" | "scheduled" | "failed")
    }

    /// The service is acting on it, or deciding whether it did; another
    /// payment must not be started meanwhile.
    pub fn in_flight(&self) -> bool {
        matches!(self.status.as_str(), "queued" | "executing" | "uncertain")
    }
}

/// What the person picked to buy.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Purchase {
    Plan { plan: String, interval: String },
    TopUp { id: String },
}

#[derive(Deserialize)]
pub(crate) struct Link {
    pub(crate) url: String,
}

#[derive(Deserialize)]
pub(crate) struct ErrorBody {
    pub(crate) error: ErrorCode,
}

#[derive(Deserialize)]
pub(crate) struct ErrorCode {
    pub(crate) code: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn usage_percent_counts_holds_and_never_exceeds_the_allowance() {
        let mut usage: Usage = serde_json::from_value(serde_json::json!({
            "allowance": {"total_units": "4000000", "used_units": "1000000", "reserved_units": "500000"},
            "purchased_remaining": "0"
        }))
        .unwrap();
        assert_eq!(usage.used_percent(), Some(37));
        assert!(!usage.has_extra());
        usage.allowance.used_units = Some("9000000".into());
        assert_eq!(usage.used_percent(), Some(100));
        usage.allowance.total_units = Some("0".into());
        assert_eq!(usage.used_percent(), None);
        usage.allowance.total_units = Some("-1".into());
        assert_eq!(usage.used_percent(), None);
    }

    #[test]
    fn usage_reads_the_full_contract_and_keeps_amounts_as_strings() {
        let usage: Usage = serde_json::from_value(serde_json::json!({
            "schema_version": 1, "cloud_enabled": true, "policy_revision": 3, "plan": "free",
            "unit_scale": 1_000_000, "credits_remaining": "2500000", "reserved_units": "120000",
            "spent_today": "300000", "bonus_remaining": "1000000",
            "bonus_expires_at": "2026-10-20T00:00:00.000Z", "purchased_remaining": "0",
            "period_end": "2026-10-16T00:00:00.000Z", "daily_limit_units": null,
            "by_model": [{"model_id": "fast", "units": "300000", "requests": 4}],
            "allowance": {"total_units": "2000000", "used_units": "300000", "reserved_units": "120000"}
        }))
        .unwrap();
        assert_eq!(usage.credits_remaining.as_deref(), Some("2500000"));
        assert_eq!(usage.bonus_remaining.as_deref(), Some("1000000"));
        assert_eq!(usage.daily_limit_units, None);
        assert_eq!(usage.by_model[0].requests, 4);
        assert_eq!(usage.scale(), UNIT_SCALE);
        assert_eq!(amount(Some("007")), Some("7".into()));
        assert_eq!(amount(Some("1.5")), None);
    }

    #[test]
    fn billing_reads_the_servers_camel_case_and_missing_offers() {
        let billing: Billing = serde_json::from_value(serde_json::json!({
            "subscription": {"status": "active", "paidUntil": "2026-11-01T00:00:00Z", "cancelAtPeriodEnd": true, "plan": "pro", "interval": "yearly"},
            "paid": true,
            "capabilities": {"hostedAI": true, "synchronization": false},
            "offers": null
        }))
        .unwrap();
        assert!(billing.paid);
        assert!(billing.capabilities.hosted_ai);
        assert!(billing.subscription.cancel_at_period_end);
        assert_eq!(billing.subscription.plan.as_deref(), Some("pro"));
        assert_eq!(billing.subscription.interval.as_deref(), Some("yearly"));
        assert_eq!(billing.offers, None);
        assert!(!billing.sells());
    }

    #[test]
    fn billing_off_sells_nothing_even_with_an_empty_offer_list() {
        let billing: Billing = serde_json::from_value(serde_json::json!({
            "subscription": {"status": "not_applicable", "paidUntil": null, "cancelAtPeriodEnd": false},
            "paid": false,
            "capabilities": {"hostedAI": true, "synchronization": false},
            "offers": {"subscriptions": [], "topups": [], "unit_scale": 1_000_000}
        }))
        .unwrap();
        assert!(!billing.sells());
        assert_eq!(billing.subscription.plan, None);
        assert_eq!(billing.subscription.interval, None);
    }

    #[test]
    fn credits_exist_only_where_the_server_states_a_factor() {
        let staging: Usage = serde_json::from_value(serde_json::json!({
            "plan": "free", "unit_scale": 1_000_000, "credit_units": "10000",
            "credits_remaining": "1880000", "free_usage_paused": true,
            "purchased_usage_available": true,
            "period_end": null,
            "allowance": {"total_units": "2000000", "used_units": "120000", "reserved_units": "0",
                          "renews": false, "expires_at": null}
        }))
        .unwrap();
        assert_eq!(staging.credit_units(), Some(10_000));
        assert!(staging.free_usage_paused);
        assert_eq!(staging.purchased_usage_available, Some(true));
        assert!(staging.one_time_allowance());
        assert_eq!(staging.period_end, None);
        assert_eq!(staging.used_percent(), Some(6));
        assert_eq!(staging.allowance_left().as_deref(), Some("1880000"));

        let older: Usage = serde_json::from_value(serde_json::json!({"plan": "free"})).unwrap();
        assert_eq!(older.credit_units(), None);
        assert!(!older.free_usage_paused);
        assert!(!older.one_time_allowance());
        for bad in ["0", "-5", "1.5", "", "abc"] {
            let usage = Usage {
                credit_units: Some(bad.into()),
                ..Default::default()
            };
            assert_eq!(usage.credit_units(), None, "{bad}");
        }
    }

    #[test]
    fn signup_mode_is_read_and_an_unknown_one_is_not_a_failure() {
        for (text, mode) in [
            ("open", SignupMode::Open),
            ("allowlist", SignupMode::Allowlist),
            ("closed", SignupMode::Closed),
            ("invite_code", SignupMode::Unknown),
        ] {
            let config: ClientConfig = serde_json::from_value(serde_json::json!({
                "schema_version": 1, "cloud_enabled": true, "signup_open": true,
                "min_client_version": "1.0.0", "billing_enabled": true, "notice": null,
                "signup_mode": text
            }))
            .unwrap();
            assert_eq!(config.signup_mode, Some(mode), "{text}");
        }
        let older: ClientConfig =
            serde_json::from_value(serde_json::json!({"cloud_enabled": true})).unwrap();
        assert_eq!(older.signup_mode, None);
    }

    #[test]
    fn history_and_receipts_carry_the_funding_source_when_there_is_one() {
        let page: UsageHistory = serde_json::from_value(serde_json::json!({
            "requests": [
                {"id": "a", "model_id": "m", "state": "settled", "units": "10", "reserved": "20",
                 "started_at": "2026-10-19T10:00:00Z", "finished_at": "2026-10-19T10:00:01Z",
                 "funding_source": "mixed"},
                {"id": "b", "model_id": "m", "state": "settled", "units": "10", "reserved": "20",
                 "started_at": "2026-10-19T10:00:00Z", "finished_at": null, "funding_source": null},
                {"id": "c", "model_id": "m", "state": "settled", "units": "10", "reserved": "20",
                 "started_at": "2026-10-19T10:00:00Z", "finished_at": null}
            ],
            "next_cursor": null
        }))
        .unwrap();
        let sources: Vec<_> = page
            .requests
            .iter()
            .map(|r| r.funding_source.as_deref())
            .collect();
        assert_eq!(sources, [Some("mixed"), None, None]);
    }

    #[test]
    fn a_plan_change_reads_as_the_contract_states_it() {
        let quote: PlanChange = serde_json::from_value(serde_json::json!({
            "id": "7d3c1f0e-5a42-4c8e-9b61-0f2d8a4e6b13", "status": "quoted",
            "current_plan": "pro", "target_plan": "max", "interval": "monthly",
            "direction": "upgrade", "effective_at": null,
            "amount_due_estimate": {"amount_minor": 6500, "currency": "USD", "tax_excluded": true},
            "recurring_price": {"amount_minor": 10000, "currency": "USD"},
            "expires_at": "2026-10-20T12:05:00.000Z", "error": null
        }))
        .unwrap();
        assert!(!quote.finished() && !quote.in_flight());
        assert_eq!(quote.amount_due_estimate.unwrap().amount_minor, 6500);
        for (status, finished, in_flight) in [
            ("queued", false, true),
            ("executing", false, true),
            ("uncertain", false, true),
            ("applied", true, false),
            ("scheduled", true, false),
            ("failed", true, false),
        ] {
            let change = PlanChange {
                id: "x".into(),
                status: status.into(),
                current_plan: String::new(),
                target_plan: String::new(),
                interval: String::new(),
                direction: String::new(),
                effective_at: None,
                amount_due_estimate: None,
                recurring_price: None,
                expires_at: None,
                error: None,
            };
            assert_eq!(
                (change.finished(), change.in_flight()),
                (finished, in_flight)
            );
        }
        let failed: PlanChange = serde_json::from_value(serde_json::json!({
            "id": "i", "status": "failed", "error": {"code": "payment_failed"}
        }))
        .unwrap();
        assert_eq!(failed.error.unwrap().code, "payment_failed");
    }
}
