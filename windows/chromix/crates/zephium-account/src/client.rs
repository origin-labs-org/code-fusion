//! HTTP calls to the account service. Bodies are bounded, redirects refused,
//! and nothing a server says is logged or passed on as text.

use std::time::Duration;

use reqwest::header::{
    HeaderMap, HeaderValue, AUTHORIZATION, CACHE_CONTROL, CONTENT_TYPE, ETAG, IF_NONE_MATCH,
    RETRY_AFTER,
};
use reqwest::{Method, StatusCode};
use serde::de::DeserializeOwned;
use serde_json::{json, Value};
use url::Url;

use crate::wire::{
    self, AvatarLink, Billing, ClientConfig, PlanChange, Profile, Purchase, Receipt, Session,
    Usage, UsageHistory,
};
use crate::{AccountError, AccountToken};

const MAX_BODY_BYTES: usize = 1024 * 1024;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const TIMEOUT: Duration = Duration::from_secs(25);
const MAX_RETRY_AFTER: u32 = 15 * 60;
const TOKEN_HEADER: &str = "set-auth-token";
/// The contract's ceiling on how long client config may be reused.
pub(crate) const CONFIG_MAX_AGE: Duration = Duration::from_secs(300);
const MAX_ETAG_BYTES: usize = 256;
const MAX_CURSOR_BYTES: usize = 200;
const MAX_EXPORT_BYTES: usize = 512 * 1024;
/// Checkout and the billing portal must open on the billing provider itself.
const BILLING_HOSTS: [&str; 2] = ["polar.sh", "sandbox.polar.sh"];
/// The largest picture the service takes; anything bigger is refused here.
pub const MAX_AVATAR_UPLOAD_BYTES: usize = 2 * 1024 * 1024;
/// The service's stored pictures are at most 256 KiB; twice that is refused.
const MAX_AVATAR_BYTES: usize = 512 * 1024;
const AVATAR: &str = "/v1/account/avatar";

/// The account service's origin: https, or plain http on loopback for a
/// server running on this machine.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Origin(Url);

impl Origin {
    pub fn parse(text: &str) -> Result<Self, AccountError> {
        let url = Url::parse(text.trim()).map_err(|_| AccountError::Invalid)?;
        let loopback = matches!(
            url.host(),
            Some(url::Host::Domain("localhost"))
                | Some(url::Host::Ipv4(std::net::Ipv4Addr::LOCALHOST))
                | Some(url::Host::Ipv6(std::net::Ipv6Addr::LOCALHOST))
        );
        let scheme_ok = url.scheme() == "https" || (url.scheme() == "http" && loopback);
        if !scheme_ok
            || url.host().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || url.path() != "/"
        {
            return Err(AccountError::Invalid);
        }
        Ok(Self(url))
    }

    pub fn as_str(&self) -> &str {
        self.0.as_str().trim_end_matches('/')
    }

    fn join(&self, path: &str) -> Url {
        let mut url = self.0.clone();
        url.set_path(path);
        url
    }
}

/// What `GET /v1/client-config` answered.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ConfigReply {
    Fresh {
        config: ClientConfig,
        etag: Option<String>,
        max_age: Duration,
    },
    /// 304: the copy held is still current.
    Unchanged { max_age: Duration },
}

/// What a private picture fetch answered.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AvatarReply {
    Fresh {
        bytes: Vec<u8>,
        etag: Option<String>,
    },
    /// 304: the bytes held are still the account's picture.
    Unchanged,
}

pub struct Client {
    origin: Origin,
    http: reqwest::Client,
}

/// A request body other than JSON.
struct Payload {
    content_type: HeaderValue,
    bytes: Vec<u8>,
}

impl Client {
    pub fn new(origin: Origin) -> Result<Self, AccountError> {
        let http = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(TIMEOUT)
            .https_only(origin.0.scheme() == "https")
            .build()
            .map_err(|_| AccountError::Unavailable)?;
        Ok(Self { origin, http })
    }

    pub fn origin(&self) -> &Origin {
        &self.origin
    }

    /// `etag` is the validator of the copy already held; a 304 keeps it.
    pub async fn client_config(&self, etag: Option<&str>) -> Result<ConfigReply, AccountError> {
        let mut headers = HeaderMap::new();
        if let Some(value) = etag.and_then(|etag| HeaderValue::from_str(etag).ok()) {
            headers.insert(IF_NONE_MATCH, value);
        }
        let reply = self
            .request(Method::GET, "/v1/client-config", None, None, headers)
            .await?;
        let max_age = max_age(&reply.headers);
        if reply.status == StatusCode::NOT_MODIFIED {
            return Ok(ConfigReply::Unchanged { max_age });
        }
        let config = serde_json::from_slice(&reply.body).map_err(|_| AccountError::Protocol)?;
        let etag = reply
            .headers
            .get(ETAG)
            .and_then(|value| value.to_str().ok())
            .filter(|value| value.len() <= MAX_ETAG_BYTES)
            .map(str::to_owned);
        Ok(ConfigReply::Fresh {
            config,
            etag,
            max_age,
        })
    }

    pub async fn send_code(&self, email: &str) -> Result<(), AccountError> {
        let body = json!({ "email": email, "type": "sign-in" });
        self.call(
            Method::POST,
            "/api/auth/email-otp/send-verification-otp",
            None,
            Some(body),
        )
        .await
        .map(drop)
    }

    /// Signs in; `device` names this install in the account's session list.
    pub async fn verify_code(
        &self,
        email: &str,
        code: &str,
        device: &str,
    ) -> Result<AccountToken, AccountError> {
        let mut body = json!({ "email": email, "otp": code });
        if !device.trim().is_empty() {
            body["device"] = Value::String(device.to_owned());
        }
        let reply = self
            .call(
                Method::POST,
                "/api/auth/sign-in/email-otp",
                None,
                Some(body),
            )
            .await?;
        let token = reply
            .headers
            .get(TOKEN_HEADER)
            .and_then(|value| value.to_str().ok())
            .ok_or(AccountError::Protocol)?;
        AccountToken::new(token.to_owned())
    }

    pub async fn profile(&self, token: &AccountToken) -> Result<Profile, AccountError> {
        self.json(Method::GET, "/v1/account", Some(token), None)
            .await
    }

    pub async fn set_name(
        &self,
        token: &AccountToken,
        name: Option<&str>,
    ) -> Result<Option<String>, AccountError> {
        let body = json!({ "name": name });
        let reply: wire::Name = self
            .json(Method::PATCH, "/v1/account", Some(token), Some(body))
            .await?;
        Ok(reply.name)
    }

    pub async fn send_email_change_code(
        &self,
        token: &AccountToken,
        email: &str,
    ) -> Result<(), AccountError> {
        let body = json!({ "email": email });
        self.call(
            Method::POST,
            "/v1/account/email/code",
            Some(token),
            Some(body),
        )
        .await
        .map(drop)
    }

    pub async fn change_email(
        &self,
        token: &AccountToken,
        email: &str,
        code: &str,
    ) -> Result<(), AccountError> {
        let body = json!({ "email": email, "otp": code });
        self.call(Method::PATCH, "/v1/account/email", Some(token), Some(body))
            .await
            .map(drop)
    }

    /// The server's export, checked to be the document it promises.
    pub async fn export(&self, token: &AccountToken) -> Result<Value, AccountError> {
        let export: Value = self
            .json(Method::GET, "/v1/account/export", Some(token), None)
            .await?;
        let ok = export.get("schemaVersion").and_then(Value::as_u64) == Some(1)
            && export.get("account").is_some_and(Value::is_object)
            && serde_json::to_vec(&export).is_ok_and(|bytes| bytes.len() <= MAX_EXPORT_BYTES);
        ok.then_some(export).ok_or(AccountError::Protocol)
    }

    pub async fn sessions(&self, token: &AccountToken) -> Result<Vec<Session>, AccountError> {
        let sessions: wire::Sessions = self
            .json(Method::GET, "/v1/sessions", Some(token), None)
            .await?;
        Ok(sessions.sessions)
    }

    pub async fn revoke_session(&self, token: &AccountToken, id: &str) -> Result<(), AccountError> {
        if id.is_empty()
            || !id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        {
            return Err(AccountError::Invalid);
        }
        let path = format!("/v1/sessions/{id}");
        self.call(Method::DELETE, &path, Some(token), None)
            .await
            .map(drop)
    }

    pub async fn sign_out(&self, token: &AccountToken) -> Result<(), AccountError> {
        self.call(Method::POST, "/v1/logout", Some(token), None)
            .await
            .map(drop)
    }

    pub async fn sign_out_everywhere(&self, token: &AccountToken) -> Result<(), AccountError> {
        self.call(Method::POST, "/v1/logout-all", Some(token), None)
            .await
            .map(drop)
    }

    pub async fn billing(&self, token: &AccountToken) -> Result<Billing, AccountError> {
        self.json(Method::GET, "/v1/billing", Some(token), None)
            .await
    }

    pub async fn refresh_billing(&self, token: &AccountToken) -> Result<Billing, AccountError> {
        self.json(Method::POST, "/v1/billing/refresh", Some(token), None)
            .await
    }

    pub async fn usage(&self, token: &AccountToken) -> Result<Usage, AccountError> {
        self.json(Method::GET, "/v1/usage", Some(token), None).await
    }

    /// One page of request history, newest first; `cursor` is the previous
    /// page's, passed back unchanged.
    pub async fn usage_history(
        &self,
        token: &AccountToken,
        cursor: Option<&str>,
    ) -> Result<UsageHistory, AccountError> {
        if cursor.is_some_and(|cursor| cursor.is_empty() || cursor.len() > MAX_CURSOR_BYTES) {
            return Err(AccountError::Invalid);
        }
        let mut url = self.origin.join("/v1/usage/requests");
        if let Some(cursor) = cursor {
            url.query_pairs_mut().append_pair("cursor", cursor);
        }
        let reply = self
            .send(Method::GET, url, Some(token), None, HeaderMap::new())
            .await?;
        serde_json::from_slice(&reply.body).map_err(|_| AccountError::Protocol)
    }

    /// The accounting of one request this account made.
    pub async fn receipt(&self, token: &AccountToken, id: &str) -> Result<Receipt, AccountError> {
        if !uuid(id) {
            return Err(AccountError::Invalid);
        }
        let path = format!("/v1/usage/requests/{id}");
        let receipt: Receipt = self.json(Method::GET, &path, Some(token), None).await?;
        if !receipt.id.eq_ignore_ascii_case(id) {
            return Err(AccountError::Protocol);
        }
        Ok(receipt)
    }

    pub async fn checkout(
        &self,
        token: &AccountToken,
        purchase: &Purchase,
    ) -> Result<Url, AccountError> {
        let body = match purchase {
            Purchase::Plan { plan, interval } => json!({ "plan": plan, "interval": interval }),
            Purchase::TopUp { id } => json!({ "topup": id }),
        };
        let link: wire::Link = self
            .json(
                Method::POST,
                "/v1/billing/checkout",
                Some(token),
                Some(body),
            )
            .await?;
        billing_link(&link.url)
    }

    /// Sets the daily spending limit in units, or removes it with `None`. The
    /// service refuses one above the plan's own cap.
    pub async fn set_daily_limit(
        &self,
        token: &AccountToken,
        units: Option<&str>,
    ) -> Result<(), AccountError> {
        if units.is_some_and(|units| wire::amount(Some(units)).is_none()) {
            return Err(AccountError::Invalid);
        }
        let body = json!({ "daily_limit_units": units });
        self.call(Method::PUT, "/v1/usage/limits", Some(token), Some(body))
            .await
            .map(drop)
    }

    /// A five-minute quote for moving between paid plans. Charges nothing.
    pub async fn preview_plan_change(
        &self,
        token: &AccountToken,
        plan: &str,
        interval: &str,
    ) -> Result<PlanChange, AccountError> {
        if !plan_id(plan) || !matches!(interval, "monthly" | "yearly") {
            return Err(AccountError::Invalid);
        }
        let body = json!({ "plan": plan, "interval": interval });
        let change: PlanChange = self
            .json(
                Method::POST,
                "/v1/billing/subscription/preview",
                Some(token),
                Some(body),
            )
            .await?;
        checked(change, None)
    }

    /// Confirms a quote. The quote id is the idempotency key, so asking again
    /// after a lost answer returns the same operation. The first confirmation
    /// needs a session from the last ten minutes.
    pub async fn confirm_plan_change(
        &self,
        token: &AccountToken,
        quote: &str,
    ) -> Result<PlanChange, AccountError> {
        if !uuid(quote) {
            return Err(AccountError::Invalid);
        }
        let body = json!({ "quote_id": quote });
        let change: PlanChange = self
            .json(
                Method::POST,
                "/v1/billing/subscription/change",
                Some(token),
                Some(body),
            )
            .await?;
        checked(change, Some(quote))
    }

    /// Where a plan change stands.
    pub async fn plan_change(
        &self,
        token: &AccountToken,
        id: &str,
    ) -> Result<PlanChange, AccountError> {
        if !uuid(id) {
            return Err(AccountError::Invalid);
        }
        let path = format!("/v1/billing/subscription/changes/{id}");
        let change: PlanChange = self.json(Method::GET, &path, Some(token), None).await?;
        checked(change, Some(id))
    }

    pub async fn portal(&self, token: &AccountToken) -> Result<Url, AccountError> {
        let link: wire::Link = self
            .json(Method::POST, "/v1/billing/portal", Some(token), None)
            .await?;
        billing_link(&link.url)
    }

    /// Replaces the account picture with `bytes`, a still PNG, JPEG or WebP of
    /// at most 2 MiB; anything else is refused before it is sent. The service
    /// re-encodes it and answers with the new picture's address.
    pub async fn upload_avatar(
        &self,
        token: &AccountToken,
        bytes: &[u8],
    ) -> Result<String, AccountError> {
        let (content_type, extension) = avatar_upload_type(bytes)?;
        let boundary = boundary(bytes);
        let mut body = Vec::with_capacity(bytes.len() + 256);
        // A fixed file name: the person's own is never sent.
        body.extend_from_slice(
            format!(
                "--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"avatar.{extension}\"\r\nContent-Type: {content_type}\r\n\r\n"
            )
            .as_bytes(),
        );
        body.extend_from_slice(bytes);
        body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
        let payload = Payload {
            content_type: HeaderValue::from_str(&format!(
                "multipart/form-data; boundary={boundary}"
            ))
            .map_err(|_| AccountError::Invalid)?,
            bytes: body,
        };
        let reply = self
            .exchange(
                Method::PUT,
                self.origin.join(AVATAR),
                Some(token),
                Some(payload),
                HeaderMap::new(),
            )
            .await?;
        if !reply.status.is_success() {
            return Err(classify_avatar(reply.status, &reply.headers, &reply.body));
        }
        let link: AvatarLink =
            serde_json::from_slice(&reply.body).map_err(|_| AccountError::Protocol)?;
        let url = link.avatar_url.ok_or(AccountError::Protocol)?;
        self.avatar_address(&url)?;
        Ok(url)
    }

    /// Removes the account picture; removing none is not a failure.
    pub async fn remove_avatar(&self, token: &AccountToken) -> Result<(), AccountError> {
        let reply = self
            .exchange(
                Method::DELETE,
                self.origin.join(AVATAR),
                Some(token),
                None,
                HeaderMap::new(),
            )
            .await?;
        if !reply.status.is_success() {
            return Err(classify_avatar(reply.status, &reply.headers, &reply.body));
        }
        Ok(())
    }

    /// The picture at `url`, exactly as the service named it and only on this
    /// origin: the bearer goes nowhere else. `etag` is the validator of the
    /// bytes already held; a 304 keeps them.
    pub async fn avatar(
        &self,
        token: &AccountToken,
        url: &str,
        etag: Option<&str>,
    ) -> Result<AvatarReply, AccountError> {
        let url = self.avatar_address(url)?;
        let mut headers = HeaderMap::new();
        if let Some(value) = etag.and_then(|etag| HeaderValue::from_str(etag).ok()) {
            headers.insert(IF_NONE_MATCH, value);
        }
        let reply = self
            .send(Method::GET, url, Some(token), None, headers)
            .await?;
        if reply.status == StatusCode::NOT_MODIFIED {
            return Ok(AvatarReply::Unchanged);
        }
        if reply.body.len() > MAX_AVATAR_BYTES || !webp(&reply.body) {
            return Err(AccountError::Protocol);
        }
        let etag = reply
            .headers
            .get(ETAG)
            .and_then(|value| value.to_str().ok())
            .filter(|value| value.len() <= MAX_ETAG_BYTES)
            .map(str::to_owned);
        Ok(AvatarReply::Fresh {
            bytes: reply.body,
            etag,
        })
    }

    /// A picture address the service gave, held to this origin and the
    /// avatar path. It is checked, never built.
    fn avatar_address(&self, text: &str) -> Result<Url, AccountError> {
        let url = Url::parse(text).map_err(|_| AccountError::Protocol)?;
        let ours = &self.origin.0;
        let version = url
            .path()
            .strip_prefix(AVATAR)
            .and_then(|rest| rest.strip_prefix('/'))
            .unwrap_or_default();
        let same_origin = url.scheme() == ours.scheme()
            && url.host() == ours.host()
            && url.port_or_known_default() == ours.port_or_known_default();
        if !same_origin
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || version.is_empty()
            || version.contains('/')
        {
            return Err(AccountError::Protocol);
        }
        Ok(url)
    }

    pub async fn send_deletion_code(&self, token: &AccountToken) -> Result<(), AccountError> {
        self.call(Method::POST, "/v1/account/deletion/code", Some(token), None)
            .await
            .map(drop)
    }

    pub async fn delete_account(
        &self,
        token: &AccountToken,
        code: &str,
    ) -> Result<(), AccountError> {
        let body = json!({ "otp": code });
        self.call(
            Method::POST,
            "/v1/account/deletion",
            Some(token),
            Some(body),
        )
        .await
        .map(drop)
    }

    async fn json<T: DeserializeOwned>(
        &self,
        method: Method,
        path: &str,
        token: Option<&AccountToken>,
        body: Option<Value>,
    ) -> Result<T, AccountError> {
        let reply = self.call(method, path, token, body).await?;
        serde_json::from_slice(&reply.body).map_err(|_| AccountError::Protocol)
    }

    async fn call(
        &self,
        method: Method,
        path: &str,
        token: Option<&AccountToken>,
        body: Option<Value>,
    ) -> Result<Reply, AccountError> {
        self.request(method, path, token, body, HeaderMap::new())
            .await
    }

    async fn request(
        &self,
        method: Method,
        path: &str,
        token: Option<&AccountToken>,
        body: Option<Value>,
        headers: HeaderMap,
    ) -> Result<Reply, AccountError> {
        self.send(method, self.origin.join(path), token, body, headers)
            .await
    }

    async fn send(
        &self,
        method: Method,
        url: Url,
        token: Option<&AccountToken>,
        body: Option<Value>,
        headers: HeaderMap,
    ) -> Result<Reply, AccountError> {
        let payload = match body {
            Some(body) => Some(Payload {
                content_type: HeaderValue::from_static("application/json"),
                bytes: serde_json::to_vec(&body).map_err(|_| AccountError::Invalid)?,
            }),
            None => None,
        };
        let reply = self.exchange(method, url, token, payload, headers).await?;
        if reply.status.is_success() || reply.status == StatusCode::NOT_MODIFIED {
            return Ok(reply);
        }
        Err(classify(reply.status, &reply.headers, &reply.body))
    }

    /// One request and its bounded answer, whatever its status.
    async fn exchange(
        &self,
        method: Method,
        url: Url,
        token: Option<&AccountToken>,
        payload: Option<Payload>,
        mut headers: HeaderMap,
    ) -> Result<Reply, AccountError> {
        if let Some(token) = token {
            headers.insert(AUTHORIZATION, token.header()?);
        }
        let mut request = self.http.request(method, url).headers(headers);
        if let Some(payload) = payload {
            request = request
                .header(CONTENT_TYPE, payload.content_type)
                .body(payload.bytes);
        }
        let mut response = request.send().await.map_err(|error| {
            if error.is_timeout() || error.is_connect() || error.is_request() {
                AccountError::Offline
            } else {
                AccountError::Protocol
            }
        })?;
        let status = response.status();
        let headers = response.headers().clone();
        let mut body = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| AccountError::Offline)? {
            if body.len() + chunk.len() > MAX_BODY_BYTES {
                return Err(AccountError::Protocol);
            }
            body.extend_from_slice(&chunk);
        }
        Ok(Reply {
            status,
            headers,
            body,
        })
    }
}

struct Reply {
    status: StatusCode,
    headers: HeaderMap,
    body: Vec<u8>,
}

/// A plan id as the service names them: short, no spaces or separators that
/// could change the request.
fn plan_id(text: &str) -> bool {
    (1..=40).contains(&text.len())
        && text
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// A change the service described, held to the id it was asked about.
fn checked(change: PlanChange, expected: Option<&str>) -> Result<PlanChange, AccountError> {
    let same = expected.is_none_or(|id| change.id.eq_ignore_ascii_case(id));
    (uuid(&change.id) && same)
        .then_some(change)
        .ok_or(AccountError::Protocol)
}

fn billing_link(text: &str) -> Result<Url, AccountError> {
    let url = Url::parse(text).map_err(|_| AccountError::Protocol)?;
    let host = url.host_str().unwrap_or_default();
    if url.scheme() != "https" || !BILLING_HOSTS.contains(&host) {
        return Err(AccountError::Protocol);
    }
    Ok(url)
}

/// The media type and extension of a picture the service takes, read from
/// its bytes; empty, oversized and other pictures are refused unsent.
pub(crate) fn avatar_upload_type(
    bytes: &[u8],
) -> Result<(&'static str, &'static str), AccountError> {
    if bytes.is_empty() {
        return Err(AccountError::AvatarInvalid);
    }
    if bytes.len() > MAX_AVATAR_UPLOAD_BYTES {
        return Err(AccountError::AvatarTooLarge);
    }
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Ok(("image/png", "png"))
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Ok(("image/jpeg", "jpg"))
    } else if webp(bytes) {
        Ok(("image/webp", "webp"))
    } else {
        Err(AccountError::AvatarUnsupported)
    }
}

fn webp(bytes: &[u8]) -> bool {
    bytes.len() > 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP"
}

/// A multipart boundary that does not occur in the picture.
fn boundary(content: &[u8]) -> String {
    let seed = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_nanos());
    (0u32..)
        .map(|n| format!("zephium-avatar-{seed:x}-{n}"))
        .find(|boundary| {
            !content
                .windows(boundary.len())
                .any(|window| window == boundary.as_bytes())
        })
        .unwrap_or_default()
}

/// The avatar endpoints' own statuses; anything else reads as any call's.
fn classify_avatar(status: StatusCode, headers: &HeaderMap, body: &[u8]) -> AccountError {
    match status.as_u16() {
        408 => AccountError::AvatarTimedOut,
        413 => AccountError::AvatarTooLarge,
        415 => AccountError::AvatarUnsupported,
        _ => classify(status, headers, body),
    }
}

/// How long the answer may be reused: the server's `max-age`, never past
/// the contract's ceiling, and not at all if the server says so.
fn max_age(headers: &HeaderMap) -> Duration {
    let Some(value) = headers.get(CACHE_CONTROL).and_then(|v| v.to_str().ok()) else {
        return CONFIG_MAX_AGE;
    };
    let mut age = CONFIG_MAX_AGE;
    for directive in value.split(',').map(str::trim) {
        let directive = directive.to_ascii_lowercase();
        if directive == "no-store" || directive == "no-cache" {
            return Duration::ZERO;
        }
        if let Some(seconds) = directive.strip_prefix("max-age=") {
            if let Ok(seconds) = seconds.trim_matches('"').parse::<u64>() {
                age = age.min(Duration::from_secs(seconds));
            }
        }
    }
    age
}

fn uuid(text: &str) -> bool {
    let bytes = text.as_bytes();
    bytes.len() == 36
        && bytes.iter().enumerate().all(|(index, byte)| match index {
            8 | 13 | 18 | 23 => *byte == b'-',
            _ => byte.is_ascii_hexdigit(),
        })
}

fn classify(status: StatusCode, headers: &HeaderMap, body: &[u8]) -> AccountError {
    let code = serde_json::from_slice::<wire::ErrorBody>(body)
        .map(|body| body.error.code)
        .unwrap_or_default();
    match (status.as_u16(), code.as_str()) {
        (_, "invalid_code" | "invalid_otp" | "otp_expired" | "too_many_attempts") => {
            AccountError::InvalidCode
        }
        // A valid session that is too old for this change; never a sign-out.
        (_, "reauthentication_required") => AccountError::ReauthRequired,
        (409, "email_unavailable") => AccountError::EmailTaken,
        (_, "signup_closed" | "signup_disabled") => AccountError::SignupClosed,
        (_, "no_billing_account") => AccountError::NoBillingAccount,
        (403, "billing_review_required") => AccountError::BillingReview,
        (409, "checkout_in_progress") => AccountError::CheckoutInProgress,
        (409, "subscription_change_required") => AccountError::SubscriptionChangeRequired,
        (409, "billing_refresh_required") => AccountError::BillingRefreshRequired,
        (409, "plan_change_in_progress") => AccountError::PlanChangeInProgress,
        (409, "plan_change_expired") => AccountError::PlanChangeExpired,
        (400, "invalid_plan_change") | (409, "subscription_change_unavailable") => {
            AccountError::PlanChangeUnavailable
        }
        (_, "billing_not_enabled" | "cloud_disabled") => AccountError::Unavailable,
        (_, "invalid_avatar") => AccountError::AvatarInvalid,
        (_, "unsupported_avatar_format") => AccountError::AvatarUnsupported,
        (_, "avatar_dimensions_exceeded") => AccountError::AvatarDimensions,
        (_, "avatar_processing_failed") => AccountError::AvatarProcessing,
        (_, "avatar_processing_busy") => AccountError::AvatarBusy {
            retry_after: retry_after(headers),
        },
        (401, _) => AccountError::SignedOut,
        (429, _) => AccountError::RateLimited {
            retry_after: retry_after(headers),
        },
        (404, _) => AccountError::NotFound,
        (400 | 405 | 409 | 413 | 415 | 422, _) => AccountError::Invalid,
        (503, _) => AccountError::Unavailable,
        _ => AccountError::Server,
    }
}

fn retry_after(headers: &HeaderMap) -> u32 {
    headers
        .get(RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.trim().parse::<u32>().ok())
        .unwrap_or(60)
        .clamp(1, MAX_RETRY_AFTER)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn origins_are_https_or_loopback_http_with_no_extras() {
        assert_eq!(
            Origin::parse("https://api.zephium.app").unwrap().as_str(),
            "https://api.zephium.app"
        );
        assert!(Origin::parse("http://127.0.0.1:8787").is_ok());
        assert!(Origin::parse("http://localhost:8787/").is_ok());
        for refused in [
            "http://api.zephium.app",
            "https://api.zephium.app/v1",
            "https://user@api.zephium.app",
            "https://api.zephium.app/?x=1",
            "ftp://api.zephium.app",
            "not a url",
        ] {
            assert_eq!(
                Origin::parse(refused),
                Err(AccountError::Invalid),
                "{refused}"
            );
        }
    }

    #[test]
    fn billing_links_must_open_on_the_billing_provider() {
        assert!(billing_link("https://polar.sh/checkout/abc").is_ok());
        assert!(billing_link("https://sandbox.polar.sh/portal").is_ok());
        assert!(billing_link("https://polar.sh.evil.example/x").is_err());
        assert!(billing_link("http://polar.sh/x").is_err());
    }

    #[test]
    fn errors_are_closed_and_honour_retry_after() {
        let mut headers = HeaderMap::new();
        let body = br#"{"error":{"code":"invalid_code"}}"#;
        assert_eq!(
            classify(StatusCode::UNAUTHORIZED, &headers, body),
            AccountError::InvalidCode
        );
        assert_eq!(
            classify(StatusCode::UNAUTHORIZED, &headers, b"{}"),
            AccountError::SignedOut
        );
        headers.insert(RETRY_AFTER, HeaderValue::from_static("42"));
        assert_eq!(
            classify(StatusCode::TOO_MANY_REQUESTS, &headers, b""),
            AccountError::RateLimited { retry_after: 42 }
        );
        assert_eq!(
            classify(StatusCode::BAD_GATEWAY, &HeaderMap::new(), b"<html>"),
            AccountError::Server
        );
        let reauth = br#"{"error":{"code":"reauthentication_required"},"request_id":null}"#;
        assert_eq!(
            classify(StatusCode::UNAUTHORIZED, &HeaderMap::new(), reauth),
            AccountError::ReauthRequired
        );
        let taken = br#"{"error":{"code":"email_unavailable"},"request_id":null}"#;
        assert_eq!(
            classify(StatusCode::CONFLICT, &HeaderMap::new(), taken),
            AccountError::EmailTaken
        );
        assert_eq!(
            classify(StatusCode::SERVICE_UNAVAILABLE, &HeaderMap::new(), taken),
            AccountError::Unavailable
        );
    }

    #[test]
    fn billing_and_plan_change_refusals_have_their_own_closed_faults() {
        let none = HeaderMap::new();
        let body = |code: &str| format!(r#"{{"error":{{"code":"{code}"}},"request_id":null}}"#);
        for (status, code, expected) in [
            (403, "billing_review_required", AccountError::BillingReview),
            (
                409,
                "checkout_in_progress",
                AccountError::CheckoutInProgress,
            ),
            (
                409,
                "subscription_change_required",
                AccountError::SubscriptionChangeRequired,
            ),
            (
                409,
                "billing_refresh_required",
                AccountError::BillingRefreshRequired,
            ),
            (
                409,
                "plan_change_in_progress",
                AccountError::PlanChangeInProgress,
            ),
            (409, "plan_change_expired", AccountError::PlanChangeExpired),
            (
                409,
                "subscription_change_unavailable",
                AccountError::PlanChangeUnavailable,
            ),
            (
                400,
                "invalid_plan_change",
                AccountError::PlanChangeUnavailable,
            ),
            (404, "plan_change_not_found", AccountError::NotFound),
            (
                401,
                "reauthentication_required",
                AccountError::ReauthRequired,
            ),
        ] {
            let status = StatusCode::from_u16(status).unwrap();
            assert_eq!(
                classify(status, &none, body(code).as_bytes()),
                expected,
                "{code}"
            );
        }
        // An unknown 409 stays a plain refusal, never one of these.
        assert_eq!(
            classify(
                StatusCode::CONFLICT,
                &none,
                body("something_new").as_bytes()
            ),
            AccountError::Invalid
        );
    }

    #[test]
    fn config_reuse_never_exceeds_five_minutes() {
        let mut headers = HeaderMap::new();
        assert_eq!(max_age(&headers), CONFIG_MAX_AGE);
        headers.insert(
            CACHE_CONTROL,
            HeaderValue::from_static("public, max-age=60, must-revalidate"),
        );
        assert_eq!(max_age(&headers), Duration::from_secs(60));
        headers.insert(CACHE_CONTROL, HeaderValue::from_static("max-age=86400"));
        assert_eq!(max_age(&headers), CONFIG_MAX_AGE);
        headers.insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
        assert_eq!(max_age(&headers), Duration::ZERO);
    }

    #[test]
    fn a_picture_is_refused_unsent_unless_it_is_a_small_png_jpeg_or_webp() {
        let mut png = b"\x89PNG\r\n\x1a\n".to_vec();
        assert_eq!(avatar_upload_type(&png), Ok(("image/png", "png")));
        assert_eq!(
            avatar_upload_type(&[0xff, 0xd8, 0xff, 0xe0]),
            Ok(("image/jpeg", "jpg"))
        );
        assert_eq!(
            avatar_upload_type(b"RIFF\0\0\0\0WEBPVP8 "),
            Ok(("image/webp", "webp"))
        );
        png.resize(MAX_AVATAR_UPLOAD_BYTES, 0);
        assert!(avatar_upload_type(&png).is_ok());
        png.push(0);
        assert_eq!(avatar_upload_type(&png), Err(AccountError::AvatarTooLarge));
        assert_eq!(avatar_upload_type(b""), Err(AccountError::AvatarInvalid));
        for refused in [&b"GIF89a"[..], b"<svg>", b"RIFF\0\0\0\0WAVE", b"BM"] {
            assert_eq!(
                avatar_upload_type(refused),
                Err(AccountError::AvatarUnsupported)
            );
        }
    }

    #[test]
    fn every_avatar_refusal_has_its_own_closed_fault() {
        let body = |code: &str| format!(r#"{{"error":{{"code":"{code}"}},"request_id":null}}"#);
        let mut busy = HeaderMap::new();
        busy.insert(RETRY_AFTER, HeaderValue::from_static("7"));
        for (status, code, expected) in [
            (400, "invalid_avatar", AccountError::AvatarInvalid),
            (408, "request_timeout", AccountError::AvatarTimedOut),
            (413, "body_too_large", AccountError::AvatarTooLarge),
            (
                415,
                "unsupported_avatar_format",
                AccountError::AvatarUnsupported,
            ),
            (
                422,
                "avatar_dimensions_exceeded",
                AccountError::AvatarDimensions,
            ),
            (
                422,
                "avatar_processing_failed",
                AccountError::AvatarProcessing,
            ),
            (404, "avatar_not_found", AccountError::NotFound),
            (
                429,
                "rate_limited",
                AccountError::RateLimited { retry_after: 7 },
            ),
            (
                503,
                "avatar_processing_busy",
                AccountError::AvatarBusy { retry_after: 7 },
            ),
            (401, "unauthorized", AccountError::SignedOut),
        ] {
            let status = StatusCode::from_u16(status).unwrap();
            assert_eq!(
                classify_avatar(status, &busy, body(code).as_bytes()),
                expected,
                "{code}"
            );
        }
        // Elsewhere a 413 or 408 is not about a picture.
        assert_eq!(
            classify(
                StatusCode::PAYLOAD_TOO_LARGE,
                &busy,
                body("body_too_large").as_bytes()
            ),
            AccountError::Invalid
        );
    }

    #[test]
    fn picture_addresses_must_be_on_this_origin_and_the_avatar_path() {
        let client =
            Client::new(Origin::parse("https://staging-api.zephium.app").unwrap()).unwrap();
        assert!(client
            .avatar_address("https://staging-api.zephium.app/v1/account/avatar/3f9a.webp")
            .is_ok());
        assert!(client
            .avatar_address("https://staging-api.zephium.app:443/v1/account/avatar/3f9a.webp")
            .is_ok());
        for refused in [
            "https://evil.example/v1/account/avatar/3f9a.webp",
            "https://staging-api.zephium.app.evil.example/v1/account/avatar/3f9a.webp",
            "http://staging-api.zephium.app/v1/account/avatar/3f9a.webp",
            "https://staging-api.zephium.app:8443/v1/account/avatar/3f9a.webp",
            "https://user@staging-api.zephium.app/v1/account/avatar/3f9a.webp",
            "https://staging-api.zephium.app/v1/account/avatar/3f9a.webp?token=x",
            "https://staging-api.zephium.app/v1/account/avatar/",
            "https://staging-api.zephium.app/v1/account/avatar/a/b.webp",
            "https://staging-api.zephium.app/v1/account/export",
            "/v1/account/avatar/3f9a.webp",
        ] {
            assert_eq!(
                client.avatar_address(refused).err(),
                Some(AccountError::Protocol),
                "{refused}"
            );
        }
    }

    #[test]
    fn a_boundary_never_occurs_in_the_picture() {
        let first = boundary(b"");
        let picture = format!("xx{first}yy");
        assert_ne!(boundary(picture.as_bytes()), first);
    }

    #[test]
    fn receipt_ids_must_be_uuids() {
        assert!(uuid("0b3c6a3e-8f7d-4a59-9a3c-1d2e3f4a5b6c"));
        assert!(!uuid("0b3c6a3e-8f7d-4a59-9a3c-1d2e3f4a5b6"));
        assert!(!uuid("0b3c6a3e/8f7d-4a59-9a3c-1d2e3f4a5b6c"));
    }
}
