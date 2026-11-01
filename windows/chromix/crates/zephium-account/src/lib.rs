//! The optional Zephium account: passwordless email sign-in, the session
//! bearer in the OS vault, and the plan, usage and billing a signed-in person
//! sees.
//!
//! Everything here is native. The bearer never leaves this crate except as an
//! `Authorization` header to the origin it was issued by, and no server text is
//! logged or shown. Each origin keeps its own vault entry.

mod client;
mod service;
mod tasks;
mod vault;
mod version;
pub mod wire;

use reqwest::header::HeaderValue;
use zeroize::Zeroizing;

pub use client::{AvatarReply, Client, ConfigReply, Origin, MAX_AVATAR_UPLOAD_BYTES};
pub use service::{AccountSettings, Service, View};
pub use tasks::CallSource;
pub use vault::{AccountVault, SystemVault, VaultFault};
pub use version::older_than;

/// The production account service.
pub const DEFAULT_ORIGIN: &str = "https://api.zephium.app";

const MAX_TOKEN_BYTES: usize = 4096;

/// Why an account action did not happen. Closed; carries no server text.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AccountError {
    /// The service could not be reached.
    Offline,
    /// The session ended: expired, revoked, or signed out elsewhere.
    SignedOut,
    /// Too many attempts; try again after this many seconds.
    RateLimited { retry_after: u32 },
    /// The code is wrong or expired.
    InvalidCode,
    /// This server does not take new accounts now.
    SignupClosed,
    /// The service or this part of it is turned off.
    Unavailable,
    /// Nothing has been bought yet, so there is nothing to manage.
    NoBillingAccount,
    /// The service failed.
    Server,
    /// The service answered with something unexpected.
    Protocol,
    /// The OS vault refused.
    Vault,
    /// The input was refused before or by the service.
    Invalid,
    /// This change needs a session started in the last few minutes: sign in
    /// again first. The current session stays valid.
    ReauthRequired,
    /// Another account already uses that address.
    EmailTaken,
    /// The service does not know that request, or it is someone else's.
    NotFound,
    /// The account is under billing review: no new purchase or upgrade, while
    /// export, the portal and downgrades still work.
    BillingReview,
    /// A subscription checkout is already open for this account.
    CheckoutInProgress,
    /// The account already has a subscription: change it, do not buy another.
    SubscriptionChangeRequired,
    /// Billing is behind the provider; read it again before trying.
    BillingRefreshRequired,
    /// Another plan change is still being carried out.
    PlanChangeInProgress,
    /// The quote has run out; ask for a new one.
    PlanChangeExpired,
    /// This subscription cannot be changed that way right now.
    PlanChangeUnavailable,
    /// The picture is missing, empty or could not be decoded.
    AvatarInvalid,
    /// The upload took too long or was cut off.
    AvatarTimedOut,
    /// The picture is over the 2 MiB limit.
    AvatarTooLarge,
    /// Not a still PNG, JPEG or WebP picture.
    AvatarUnsupported,
    /// The picture has more pixels than the service takes.
    AvatarDimensions,
    /// The service could not convert the picture within its limits.
    AvatarProcessing,
    /// The service is converting other pictures; try again after this many
    /// seconds. The current picture is unchanged.
    AvatarBusy { retry_after: u32 },
    /// The upload was cancelled here, by a removal or by the person.
    AvatarCancelled,
}

/// The session bearer, zeroized on drop and never printed.
pub struct AccountToken(Zeroizing<String>);

impl AccountToken {
    pub fn new(token: String) -> Result<Self, AccountError> {
        let token = Zeroizing::new(token);
        let trimmed = token.trim();
        if trimmed.is_empty()
            || trimmed.len() > MAX_TOKEN_BYTES
            || !trimmed.bytes().all(|byte| matches!(byte, 0x21..=0x7e))
        {
            return Err(AccountError::Protocol);
        }
        Ok(Self(Zeroizing::new(trimmed.to_owned())))
    }

    /// The bearer, for the hosted gateway's own client.
    pub fn expose(&self) -> &str {
        &self.0
    }

    fn header(&self) -> Result<HeaderValue, AccountError> {
        let value = Zeroizing::new(format!("Bearer {}", self.expose()));
        let mut header = HeaderValue::from_str(&value).map_err(|_| AccountError::Protocol)?;
        header.set_sensitive(true);
        Ok(header)
    }
}

impl std::fmt::Debug for AccountToken {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("AccountToken([redacted])")
    }
}

#[cfg(test)]
mod tests;
