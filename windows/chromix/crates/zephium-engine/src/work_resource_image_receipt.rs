//! One native owner's capture receipt. Only a private, bracketed native capture
//! can populate the slot; read-only image metadata cannot mint this receipt.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]
use super::*;
use crate::platform::semantic_pixel_privacy::ModelCapture;
use zephium_agentic::{
    SemanticScreenshot, SemanticScreenshotNativeCapture, SemanticScreenshotNativeFailure,
    SemanticScreenshotRequestId,
};

#[derive(Default)]
pub(super) struct NativeImageSlot {
    pending: Option<NativeImageReceipt>,
    last: Option<(WorkBrowserExecutionLease, u64)>,
    sources: Vec<std::sync::Weak<NativeImageSource>>,
}
struct NativeImageReceipt {
    id: SemanticScreenshotRequestId,
    context: zephium_agentic::ContextJoin,
    request_guard: [u8; 32],
    native_digest: [u8; 32],
    public: bool,
    lease: WorkBrowserExecutionLease,
    deadline: Instant,
}
/// Engine-private, one-use result. This is only native source evidence; consent
/// and model-disclosure policy are still independently required.
pub(crate) struct ClaimedNativeImage {
    pub(super) context: zephium_agentic::ContextJoin,
    pub(super) lease: WorkBrowserExecutionLease,
    pub(super) public: bool,
}
impl std::fmt::Debug for ClaimedNativeImage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ClaimedNativeImage([original owner])")
    }
}
impl WorkResourceGuard {
    pub(crate) fn public_image_candidate(
        &self,
        lease: &WorkBrowserExecutionLease,
        context: zephium_agentic::ContextJoin,
    ) -> bool {
        work_browser_monotonic_now()
            .and_then(|now| self.image_lease(context, now))
            .as_ref()
            == Some(lease)
            && self
                .fresh_native_store
                .lock()
                .is_ok_and(|proof| proof.as_ref().is_some_and(|proof| proof.current()))
    }

    fn image_lease(
        &self,
        context: zephium_agentic::ContextJoin,
        now: AgentPolicyInstant,
    ) -> Option<WorkBrowserExecutionLease> {
        if !self.session_current() || !self.port_open() || !self.health_current() {
            return None;
        }
        let state = self.state.lock().ok()?;
        let lease = state.lease.as_ref()?;
        (!state.uncertain
            && state.phase == Phase::Leased
            && lease.resource() == &self.resource
            && now < lease.deadline()
            && self.resource.identity().context() == context.identity().id()
            && self.resource.identity().profile() == context.identity().profile()
            && lease.run() == context.identity().owner()
            && state.observed == Some(context)
            && state.document_epoch == context.navigation_epoch().get()
            && state.document_epoch == context.frame_generation().get()
            && state.retirement_delivery.is_none()
            && state.human_delivery.is_none()
            && state.navigation.is_none()
            && state.action.is_none()
            && state.callbacks == 0
            && state.reads == 0)
            .then(|| lease.clone())
    }
    /// Called only by the original native screenshot owner after its physical
    /// document-stamp check. The wrapper cannot be constructed by app/controller.
    pub(crate) fn record_model_capture(
        &self,
        id: SemanticScreenshotRequestId,
        context: zephium_agentic::ContextJoin,
        deadline: Instant,
        proof: ModelCapture<SemanticScreenshotNativeCapture>,
    ) -> Result<SemanticScreenshotNativeCapture, SemanticScreenshotNativeFailure> {
        let now = work_browser_monotonic_now().ok_or(SemanticScreenshotNativeFailure::Stale)?;
        let lease = self
            .image_lease(context, now)
            .ok_or(SemanticScreenshotNativeFailure::Stale)?;
        let capture = proof.capture();
        if capture.id() != id
            || capture.context() != context
            || Instant::now() >= deadline
            || proof.public_survey() != capture.requires_public_page()
        {
            return Err(SemanticScreenshotNativeFailure::Stale);
        }
        let native_digest = capture
            .native_image_digest()
            .ok_or(SemanticScreenshotNativeFailure::ResourceExhausted)?;
        let receipt = NativeImageReceipt {
            id,
            context,
            request_guard: capture.native_request_guard(),
            native_digest,
            public: proof.public_survey(),
            lease,
            deadline,
        };
        let mut slot = self
            .image_receipt
            .lock()
            .map_err(|_| SemanticScreenshotNativeFailure::Stale)?;
        if slot
            .last
            .as_ref()
            .is_some_and(|(lease, last)| *lease == receipt.lease && id.get() <= *last)
        {
            return Err(SemanticScreenshotNativeFailure::Stale);
        }
        slot.last = Some((receipt.lease.clone(), id.get()));
        // A later original capture supersedes an unclaimed failed attempt.
        // Every old lookup still fails exact ID/lease/guard/digest matching.
        slot.pending = Some(receipt);
        Ok(proof.into_capture())
    }
    /// Takes only a receipt held by this original native owner. Wrong, expired
    /// or replayed lookups consume/refuse the slot; they cannot probe until a
    /// caller finds matching metadata. No screenshot permission is returned.
    pub(crate) fn take_model_capture(
        &self,
        image: &SemanticScreenshot,
    ) -> Option<ClaimedNativeImage> {
        self.take_receipt(
            image.id(),
            image.context(),
            image.native_request_guard(),
            image.native_image_digest(),
            image.requires_public_page(),
        )
    }
    fn take_receipt(
        &self,
        id: SemanticScreenshotRequestId,
        context: zephium_agentic::ContextJoin,
        request_guard: [u8; 32],
        native_digest: [u8; 32],
        public: bool,
    ) -> Option<ClaimedNativeImage> {
        let receipt = self.image_receipt.lock().ok()?.pending.take()?;
        let lease = self.image_lease(context, work_browser_monotonic_now()?)?;
        if Instant::now() >= receipt.deadline
            || receipt.lease != lease
            || receipt.id != id
            || receipt.context != context
            || receipt.request_guard != request_guard
            || receipt.native_digest != native_digest
            || receipt.public != public
        {
            return None;
        }
        Some(ClaimedNativeImage {
            context: receipt.context,
            lease,
            public: receipt.public,
        })
    }
}

struct NativeImageSource {
    id: SemanticScreenshotRequestId,
    request_guard: [u8; 32],
    native_digest: [u8; 32],
    public: bool,
    owner: std::sync::Weak<WorkResourceGuard>,
    context: zephium_agentic::ContextJoin,
    lease: WorkBrowserExecutionLease,
    deadline: Instant,
    fresh: Option<crate::host::FreshNativeStore>,
    fresh_loss: Option<crate::host::FreshStoreLoss>,
    lost: AtomicBool,
    wake: Mutex<Option<std::task::Waker>>,
}
impl NativeImageSource {
    fn revoke(&self) {
        self.lost.store(true, Ordering::Release);
        let wake = self.wake.lock().ok().and_then(|mut wake| wake.take());
        if let Some(wake) = wake {
            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| wake.wake()));
        }
    }
}
impl zephium_agentic::SemanticScreenshotSource for NativeImageSource {
    fn authenticates(&self, image: &SemanticScreenshot) -> bool {
        self.id == image.id()
            && self.context == image.context()
            && self.request_guard == image.native_request_guard()
            && self.native_digest == image.native_image_digest()
            && self.public == image.requires_public_page()
    }
    fn while_current(&self, operation: &mut dyn FnMut()) -> bool {
        if self.lost.load(Ordering::Acquire) || Instant::now() >= self.deadline {
            return false;
        }
        let Some(owner) = self.owner.upgrade() else {
            return false;
        };
        let Some(now) = work_browser_monotonic_now() else {
            return false;
        };
        if owner.image_receipt.is_poisoned()
            || !owner.session_current()
            || !owner.port_open()
            || !owner.health_current()
        {
            return false;
        }
        let Ok(state) = owner.state.lock() else {
            return false;
        };
        if state.uncertain
            || state.phase != Phase::Leased
            || state.lease.as_ref() != Some(&self.lease)
            || now >= self.lease.deadline()
            || state.observed != Some(self.context)
            || state.document_epoch != self.context.navigation_epoch().get()
            || state.document_epoch != self.context.frame_generation().get()
            || state.retirement_delivery.is_some()
            || state.human_delivery.is_some()
            || state.navigation.is_some()
            || state.action.is_some()
            || state.callbacks != 0
            || state.reads != 0
        {
            return false;
        }
        if let Some(fresh) = &self.fresh {
            fresh.while_current(operation)
        } else {
            operation();
            true
        }
    }
    fn poll_lost(&self, cx: &mut std::task::Context<'_>) -> std::task::Poll<()> {
        if !self.while_current(&mut || {}) {
            self.revoke();
            return std::task::Poll::Ready(());
        }
        let Ok(mut wake) = self.wake.lock() else {
            return std::task::Poll::Ready(());
        };
        let old = wake.replace(cx.waker().clone());
        drop(wake);
        drop(old);
        if self
            .fresh_loss
            .as_ref()
            .is_some_and(|loss| loss.poll(cx).is_ready())
            || !self.while_current(&mut || {})
        {
            self.revoke();
            std::task::Poll::Ready(())
        } else {
            std::task::Poll::Pending
        }
    }
    fn deadline(&self) -> Instant {
        self.deadline
    }
}
impl WorkResourceGuard {
    pub(crate) fn invalidate_image_sources(&self) {
        let sources = self
            .image_receipt
            .lock()
            .map(|mut slot| std::mem::take(&mut slot.sources))
            .unwrap_or_default();
        for source in sources.into_iter().filter_map(|source| source.upgrade()) {
            source.revoke();
        }
    }
    pub(crate) fn claim_image_source(
        self: &Arc<Self>,
        expected: &WorkBrowserExecutionLease,
        image: &SemanticScreenshot,
    ) -> Option<Arc<dyn zephium_agentic::SemanticScreenshotSource>> {
        let receipt = self.take_model_capture(image)?;
        if &receipt.lease != expected {
            return None;
        }
        let fresh = if receipt.public {
            Some(self.fresh_native_store.lock().ok()?.clone()?)
        } else {
            None
        };
        let fresh_loss = match fresh.as_ref() {
            Some(fresh) => Some(fresh.watch()?),
            None => None,
        };
        let now = work_browser_monotonic_now()?;
        let remaining = receipt
            .lease
            .deadline()
            .millis()
            .checked_sub(now.millis())?;
        let deadline = Instant::now().checked_add(std::time::Duration::from_millis(remaining))?;
        let source = Arc::new(NativeImageSource {
            id: image.id(),
            request_guard: image.native_request_guard(),
            native_digest: image.native_image_digest(),
            public: image.requires_public_page(),
            owner: Arc::downgrade(self),
            context: receipt.context,
            lease: receipt.lease,
            deadline,
            fresh,
            fresh_loss,
            lost: AtomicBool::new(false),
            wake: Mutex::new(None),
        });
        {
            let mut slot = self.image_receipt.lock().ok()?;
            slot.sources.retain(|source| source.strong_count() > 0);
            if slot.sources.len() >= 32 {
                return None;
            }
            slot.sources.push(Arc::downgrade(&source));
        }
        use zephium_agentic::SemanticScreenshotSource;
        source
            .while_current(&mut || {})
            .then_some(source as Arc<dyn SemanticScreenshotSource>)
    }
}

#[cfg(test)]
mod tests {
    use super::super::tests::{leased, setup, tick};
    use super::*;
    use zephium_agentic::SemanticScreenshotSource;
    fn ready() -> (
        Arc<WorkResourceGuard>,
        Arc<AgentPortAdmission>,
        WorkBrowserExecutionLease,
        zephium_agentic::ContextJoin,
    ) {
        let (mut rows, admission, guard) = setup();
        let lease = leased(&mut rows, &guard);
        let read = rows.observe_initial(&lease, tick(2)).unwrap();
        let context = read.invocation().frame().context();
        guard.state.lock().unwrap().observed = Some(context);
        (guard, admission, lease, context)
    }
    fn insert(
        guard: &WorkResourceGuard,
        lease: &WorkBrowserExecutionLease,
        context: zephium_agentic::ContextJoin,
    ) {
        guard.image_receipt.lock().unwrap().pending = Some(NativeImageReceipt {
            id: SemanticScreenshotRequestId::new(1).unwrap(),
            context,
            request_guard: [1; 32],
            native_digest: [2; 32],
            public: false,
            lease: lease.clone(),
            deadline: Instant::now() + std::time::Duration::from_secs(5),
        });
    }
    #[test]
    fn native_image_receipt_is_exact_consumed_and_cannot_be_replayed() {
        let (guard, _admission, lease, context) = ready();
        for mutation in 0..5 {
            insert(&guard, &lease, context);
            let id = SemanticScreenshotRequestId::new(if mutation == 0 { 2 } else { 1 }).unwrap();
            let request_guard = if mutation == 1 { [3; 32] } else { [1; 32] };
            let digest = if mutation == 2 { [4; 32] } else { [2; 32] };
            if mutation == 4 {
                guard
                    .image_receipt
                    .lock()
                    .unwrap()
                    .pending
                    .as_mut()
                    .unwrap()
                    .deadline = Instant::now();
            }
            assert!(guard
                .take_receipt(id, context, request_guard, digest, mutation == 3)
                .is_none());
            assert!(guard
                .take_receipt(
                    SemanticScreenshotRequestId::new(1).unwrap(),
                    context,
                    [1; 32],
                    [2; 32],
                    false
                )
                .is_none());
        }
        insert(&guard, &lease, context);
        assert!(guard
            .take_receipt(
                SemanticScreenshotRequestId::new(1).unwrap(),
                context,
                [1; 32],
                [2; 32],
                false
            )
            .is_some());
        assert!(guard
            .take_receipt(
                SemanticScreenshotRequestId::new(1).unwrap(),
                context,
                [1; 32],
                [2; 32],
                false
            )
            .is_none());
    }
    #[test]
    fn native_image_receipt_refuses_wrong_owner_cancelled_and_unknown_document() {
        let (guard, _admission, lease, context) = ready();
        let (other, _other_admission, _other_lease, _) = ready();
        insert(&guard, &lease, context);
        other.image_receipt.lock().unwrap().pending =
            guard.image_receipt.lock().unwrap().pending.take();
        assert!(other
            .take_receipt(
                SemanticScreenshotRequestId::new(1).unwrap(),
                context,
                [1; 32],
                [2; 32],
                false
            )
            .is_none());
        insert(&guard, &lease, context);
        guard.state.lock().unwrap().observed = None;
        assert!(guard
            .take_receipt(
                SemanticScreenshotRequestId::new(1).unwrap(),
                context,
                [1; 32],
                [2; 32],
                false
            )
            .is_none());
        guard.state.lock().unwrap().observed = Some(context);
        insert(&guard, &lease, context);
        guard.fail();
        assert!(guard
            .take_receipt(
                SemanticScreenshotRequestId::new(1).unwrap(),
                context,
                [1; 32],
                [2; 32],
                false
            )
            .is_none());
    }
    #[test]
    fn native_source_loss_is_sticky_and_does_not_retain_view_owner() {
        let (guard, admission, lease, context) = ready();
        let source = Arc::new(NativeImageSource {
            id: SemanticScreenshotRequestId::new(1).unwrap(),
            request_guard: [1; 32],
            native_digest: [2; 32],
            public: false,
            owner: Arc::downgrade(&guard),
            context,
            lease,
            deadline: Instant::now() + std::time::Duration::from_secs(5),
            fresh: None,
            fresh_loss: None,
            lost: AtomicBool::new(false),
            wake: Mutex::new(None),
        });
        guard
            .image_receipt
            .lock()
            .unwrap()
            .sources
            .push(Arc::downgrade(&source));
        assert!(source.while_current(&mut || {}));
        guard.invalidate_image_sources();
        assert!(!source.while_current(&mut || panic!("lost source cannot dispatch")));
        // Restoring a page/lease can never revive this old source.
        guard.state.lock().unwrap().observed = Some(context);
        assert!(!source.while_current(&mut || {}));
        let weak = Arc::downgrade(&guard);
        drop(guard);
        drop(admission);
        assert!(weak.upgrade().is_none());
    }
}
