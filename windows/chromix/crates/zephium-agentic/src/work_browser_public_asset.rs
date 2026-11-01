//! One anonymous fetch exchange per source record, inside its original media grant.
use super::*;
use std::sync::{mpsc, Weak};

/// Maximum encoded body before native decoding and thumbnail sanitization.
pub const MAX_PUBLIC_RECORD_IMAGE_BYTES: usize = 512 * 1024;
#[derive(Default)]
pub(super) struct Exchange {
    pub(super) authority: Option<MediaRetryAuthority>,
    pub(super) plans: Vec<crate::SemanticRecordMediaPlan>,
    pub(super) pending: Option<WorkBrowserPublicAssetRequest>,
    used: Vec<(u16, [u8; 32])>,
}

/// A move-only native-source request. No model can manufacture this through IPC.
pub struct WorkBrowserPublicAssetRequest {
    owner: Weak<Progress>,
    authority: MediaRetryAuthority,
    context: crate::ContextJoin,
    deadline: AgentPolicyInstant,
    url: crate::ContextNavigationTarget,
    reply: Option<mpsc::SyncSender<Option<Vec<u8>>>>,
}
impl fmt::Debug for WorkBrowserPublicAssetRequest {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("WorkBrowserPublicAssetRequest([redacted])")
    }
}
impl WorkBrowserPublicAssetRequest {
    /// Rechecked before transport and publication; the original task remains authoritative.
    pub fn current(&self, now: AgentPolicyInstant) -> bool {
        now < self.deadline
            && now < self.authority.deadline
            && self.owner.upgrade().is_some_and(|owner| {
                !owner.cancelled.load(Ordering::Acquire) && !owner.completed.load(Ordering::Acquire)
            })
            && self.context.identity().id() == self.authority.resource.identity().context()
            && self.context.context_generation().get() == self.authority.generation
            && self
                .authority
                .original
                .matches(self.context.identity(), now)
    }
    /// Exact observed address; transport must neither attach credentials nor rewrite it.
    pub fn url(&self) -> &str {
        self.url.as_url().as_str()
    }
    /// Completes once. Oversized bytes, expiry and cancellation all yield no image.
    pub fn complete(mut self, now: AgentPolicyInstant, bytes: Option<Vec<u8>>) {
        let bytes = if self.current(now) {
            bytes.filter(|bytes| !bytes.is_empty() && bytes.len() <= MAX_PUBLIC_RECORD_IMAGE_BYTES)
        } else {
            None
        };
        if let Some(reply) = self.reply.take() {
            let _ = reply.try_send(bytes);
        }
    }
}
impl Drop for WorkBrowserPublicAssetRequest {
    fn drop(&mut self) {
        if let Some(reply) = self.reply.take() {
            let _ = reply.try_send(None);
        }
    }
}
/// The native owner polls only while its existing optional media batch is active.
pub struct WorkBrowserPublicAssetReply(mpsc::Receiver<Option<Vec<u8>>>);
impl WorkBrowserPublicAssetReply {
    /// None is pending; Some(None) is terminal unavailability.
    pub fn poll(&self) -> Option<Option<Vec<u8>>> {
        match self.0.try_recv() {
            Ok(result) => Some(result),
            Err(mpsc::TryRecvError::Empty) => None,
            Err(mpsc::TryRecvError::Disconnected) => Some(None),
        }
    }
}
impl WorkBrowserMediaProgress {
    /// Uses the retained page's existing application wake; no additional polling service.
    pub fn set_public_asset_waker(&self, waker: std::task::Waker) {
        if let Ok(mut slot) = self.0.waker.lock() {
            *slot = Some(waker);
        }
        if self
            .0
            .public_asset
            .lock()
            .ok()
            .is_some_and(|exchange| exchange.pending.is_some())
        {
            self.wake_public_asset();
        }
    }
    fn wake_public_asset(&self) {
        let waker = self.0.waker.lock().ok().and_then(|slot| slot.clone());
        if let Some(waker) = waker {
            if std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| waker.wake())).is_err() {
                self.cancel();
            }
        }
    }
    /// Native-only call after the retained runtime attests a CORS/network failure.
    /// The supplied source plan must belong to this exact admitted media batch.
    pub fn request_public_asset(
        &self,
        plan: &crate::SemanticRecordMediaPlan,
        raw: &str,
        now: AgentPolicyInstant,
        deadline: AgentPolicyInstant,
    ) -> Option<WorkBrowserPublicAssetReply> {
        if !self.current()
            || self.0.completed.load(Ordering::Acquire)
            || deadline <= now
            || deadline.millis().saturating_sub(now.millis()) > 1500
        {
            return None;
        }
        let url = crate::ContextNavigationTarget::parse(raw).ok()?;
        if url.as_url().scheme() != "https"
            || url.as_url().as_str() != raw
            || !crate::semantic_wire::model_safe_public_url(&url)
        {
            return None;
        }
        let mut exchange = self.0.public_asset.lock().ok()?;
        let authority = exchange.authority.as_ref()?.clone();
        if deadline > authority.deadline
            || exchange.pending.is_some()
            || exchange.used.len() >= 12
            || exchange.used.contains(&(plan.record(), plan.source()))
            || !exchange.plans.iter().any(|allowed| {
                allowed.record() == plan.record()
                    && allowed.source() == plan.source()
                    && allowed.frame() == plan.frame()
                    && allowed.native_invocation() == plan.native_invocation()
            })
        {
            return None;
        }
        let (reply, receiver) = mpsc::sync_channel(1);
        let request = WorkBrowserPublicAssetRequest {
            owner: Arc::downgrade(&self.0),
            authority,
            context: plan.frame().context(),
            deadline,
            url,
            reply: Some(reply),
        };
        if !request.current(now) {
            return None;
        }
        exchange.used.push((plan.record(), plan.source()));
        exchange.pending = Some(request);
        drop(exchange);
        self.wake_public_asset();
        Some(WorkBrowserPublicAssetReply(receiver))
    }
    /// Application transport takes the one queued request; there is no model-facing URL API.
    pub fn take_public_asset(&self) -> Option<WorkBrowserPublicAssetRequest> {
        self.0.public_asset.lock().ok()?.pending.take()
    }
}
