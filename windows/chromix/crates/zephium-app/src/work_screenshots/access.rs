//! Host permission epochs for one sealed durable page admission. Native image
//! proof is consumed independently by the policy's original source broker.
use super::{
    consent::{RunScreenshots, ScreenshotChoice},
    sites::OriginEpoch,
};
use std::{
    sync::{
        atomic::{AtomicU8, Ordering},
        Arc, Mutex,
    },
    time::Instant,
};
use zephium_agentic::{
    ContextIdentity, ContextJoin, SemanticModelImageHost, SemanticModelImagePlan as Plan,
    SemanticScreenshotRequestId,
};
use zephium_core::work::{
    model::WorkModelImageFence, runtime::WorkPageImageDisclosureV1, WorkStepId,
};

#[derive(Clone)]
struct Reservation {
    id: SemanticScreenshotRequestId,
    context: ContextJoin,
    origin: String,
    public: bool,
    global: Arc<dyn WorkModelImageFence>,
    epoch: OriginEpoch,
}
#[derive(Default)]
struct State {
    last: Option<(ContextJoin, u64)>,
    prepared: Option<Reservation>,
    question: Option<String>,
    history: Option<(String, Arc<HostFence>)>,
}
/// Original page's screenshot choice and possible-disclosure receipt. No
/// public constructor, native view, screenshot bytes or account grant.
pub struct WorkScreenshotAccess {
    probe: crate::work_runtime::WorkAttemptProbe,
    step: WorkStepId,
    context: zephium_agentic::ContextId,
    entry_blocked: bool,
    entry: Option<crate::work_agent::WorkConfirmPort>,
    choices: Arc<RunScreenshots>,
    state: Mutex<State>,
    disclosure: AtomicU8,
}
/// Builds a host only from the exact move-only durable page admission that the
/// same invocation transfers to its retained native owner.
pub fn for_page(
    probe: &crate::work_runtime::WorkAttemptProbe,
    page: &crate::RetainedPageAdmission,
    context: ContextIdentity,
    entry_blocked: bool,
    entry: Option<crate::work_agent::WorkConfirmPort>,
) -> Option<Arc<WorkScreenshotAccess>> {
    if page.profile != probe.profile()
        || page.work != probe.work()
        || page.execution != probe.execution()
        || page.attempt != probe.attempt()
        || Instant::now() >= page.deadline
        || page.deadline > probe.deadline()
        || context.profile() != page.profile
        || context.kind() != zephium_agentic::ContextKind::Owned
    {
        return None;
    }
    Some(Arc::new(WorkScreenshotAccess {
        probe: probe.clone(),
        step: page.step,
        context: context.id(),
        entry_blocked,
        entry,
        choices: probe.screenshot_choices().clone(),
        state: Mutex::new(State::default()),
        disclosure: AtomicU8::new(0),
    }))
}
impl WorkScreenshotAccess {
    /// Conservative possible disclosure, not proof of byte delivery or billing.
    pub fn possible_disclosure(&self) -> Option<WorkPageImageDisclosureV1> {
        match self.disclosure.load(Ordering::Acquire) {
            1 => Some(WorkPageImageDisclosureV1::PublicIsolated),
            2 => Some(WorkPageImageDisclosureV1::SiteConsent),
            _ => None,
        }
    }
    fn entry_current(&self) -> bool {
        !self.entry_blocked
            && self.entry.as_ref().is_none_or(|port| {
                matches!(
                    port.entry(),
                    Some(
                        crate::work_agent::WorkSiteEntry::SignedOut
                            | crate::work_agent::WorkSiteEntry::Allow
                            | crate::work_agent::WorkSiteEntry::Always
                    )
                )
            })
    }
    fn accepts(&self, context: ContextJoin, origin: &str) -> bool {
        context.identity().id() == self.context
            && context.identity().profile() == self.probe.profile()
            && zephium_core::work::screenshots::validate_origin(origin).is_ok()
    }
    fn ask(&self, context: ContextJoin, origin: &str) -> Plan {
        if !self.enabled() || !self.entry_current() || !self.accepts(context, origin) {
            return Plan::Unavailable;
        }
        let plan = match self.choices.request(origin, self.step) {
            Ok(ScreenshotChoice::Allowed) => Plan::Consented,
            Ok(ScreenshotChoice::Checking | ScreenshotChoice::Asking) => Plan::Waiting,
            _ => Plan::Unavailable,
        };
        if plan == Plan::Waiting {
            if let Ok(mut state) = self.state.lock() {
                state.question = Some(origin.into());
            } else {
                return Plan::Unavailable;
            }
        }
        plan
    }
}
impl SemanticModelImageHost for WorkScreenshotAccess {
    fn private_disclosure_recorded(&self) -> bool {
        self.disclosure.load(Ordering::Acquire) == 2
    }
    fn admits_source(&self, source: &zephium_agentic::WorkBrowserExecutionLease) -> bool {
        let identity = source.resource().identity();
        identity.profile() == self.probe.profile()
            && identity.work() == self.probe.work()
            && identity.context() == self.context
    }
    fn enabled(&self) -> bool {
        super::enabled()
            && self.probe.cached_cancellation().is_none()
            && Instant::now() < self.probe.deadline()
            && self.state.lock().is_ok_and(|state| {
                state
                    .history
                    .as_ref()
                    .is_none_or(|(_, fence)| fence.while_current(&mut || {}))
            })
    }
    fn prepare(
        &self,
        id: SemanticScreenshotRequestId,
        context: ContextJoin,
        origin: &str,
        public_candidate: bool,
    ) -> Plan {
        if !self.enabled() || !self.entry_current() || !self.accepts(context, origin) {
            return Plan::Unavailable;
        }
        {
            let Ok(mut state) = self.state.lock() else {
                return Plan::Unavailable;
            };
            if state
                .last
                .is_some_and(|(old, last)| old == context && id.get() <= last)
            {
                return Plan::Unavailable;
            }
            state.last = Some((context, id.get()));
            state.prepared = None;
        }
        let (plan, global, epoch) =
            if public_candidate && self.choices.choice(origin) != Some(ScreenshotChoice::Allowed) {
                let Some(global) = super::gate().fence() else {
                    return Plan::Unavailable;
                };
                let Ok(epoch) = super::sites::origin_epoch(self.probe.profile(), origin) else {
                    return Plan::Unavailable;
                };
                (Plan::Public, global, epoch)
            } else {
                let plan = self.ask(context, origin);
                if plan != Plan::Consented {
                    return plan;
                }
                let Some((global, epoch)) = self.choices.permission(origin) else {
                    return Plan::Unavailable;
                };
                (Plan::Consented, global, epoch)
            };
        if !global.while_current(&mut || {}) || !epoch.current() {
            return Plan::Unavailable;
        }
        let Ok(mut state) = self.state.lock() else {
            return Plan::Unavailable;
        };
        if state.last != Some((context, id.get())) {
            return Plan::Unavailable;
        }
        state.prepared = Some(Reservation {
            id,
            context,
            origin: origin.into(),
            public: plan == Plan::Public,
            global,
            epoch,
        });
        plan
    }
    fn require_consent(&self, context: ContextJoin, origin: &str) -> Plan {
        self.ask(context, origin)
    }
    fn handoff(&self) -> Option<Plan> {
        let origin = self.state.lock().ok()?.question.clone()?;
        Some(if !self.enabled() {
            Plan::Unavailable
        } else {
            match self.choices.choice(&origin) {
                Some(ScreenshotChoice::Allowed) => Plan::Consented,
                Some(ScreenshotChoice::Checking | ScreenshotChoice::Asking) => Plan::Waiting,
                _ => Plan::Unavailable,
            }
        })
    }
    fn finish_handoff(&self) {
        if let Ok(mut state) = self.state.lock() {
            state.question = None;
            state.prepared = None;
        }
    }
    fn before_disclosure<'a>(
        &'a self,
        id: SemanticScreenshotRequestId,
        context: ContextJoin,
        origin: &'a str,
        public: bool,
        deadline: Instant,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = Option<Arc<dyn WorkModelImageFence>>> + Send + 'a>,
    > {
        Box::pin(async move {
            let reservation = self.state.lock().ok()?.prepared.take()?;
            if reservation.id != id
                || reservation.context != context
                || reservation.origin != origin
                || reservation.public != public
                || !self.accepts(context, origin)
                || (!public && self.entry_blocked)
                || !self.enabled()
                || !reservation.global.while_current(&mut || {})
                || !reservation.epoch.current()
            {
                return None;
            }
            let deadline = deadline.min(self.probe.deadline());
            if !self.entry_current() || Instant::now() >= deadline {
                return None;
            }
            let mode = if public {
                WorkPageImageDisclosureV1::PublicIsolated
            } else {
                WorkPageImageDisclosureV1::SiteConsent
            };
            self.probe
                .record_image_disclosure(self.step, mode)
                .await
                .ok()?;
            // Persisted privacy remains sticky even if permission/Stop changes
            // immediately after the ACK and prevents actual transmission.
            self.disclosure
                .fetch_max(if public { 1 } else { 2 }, Ordering::AcqRel);
            if !self.enabled()
                || !self.entry_current()
                || Instant::now() >= deadline
                || !reservation.global.while_current(&mut || {})
                || !reservation.epoch.current()
            {
                return None;
            }
            let mut state = self.state.lock().ok()?;
            if let Some((old, fence)) = &state.history {
                if old != origin
                    || !fence.epoch.same(&reservation.epoch)
                    || !fence.while_current(&mut || {})
                {
                    return None;
                }
                return Some(fence.clone() as Arc<dyn WorkModelImageFence>);
            }
            let fence = Arc::new(HostFence {
                probe: self.probe.clone(),
                global: reservation.global,
                epoch: reservation.epoch,
                deadline,
            });
            state.history = Some((origin.into(), fence.clone()));
            Some(fence as Arc<dyn WorkModelImageFence>)
        })
    }
}
struct HostFence {
    probe: crate::work_runtime::WorkAttemptProbe,
    global: Arc<dyn WorkModelImageFence>,
    epoch: OriginEpoch,
    deadline: Instant,
}
impl WorkModelImageFence for HostFence {
    fn while_current(&self, operation: &mut dyn FnMut()) -> bool {
        if Instant::now() >= self.deadline || self.probe.cached_cancellation().is_some() {
            return false;
        }
        let mut current = false;
        self.global
            .while_current(&mut || current = self.epoch.while_current(operation))
            && current
    }
    fn revoked(&self) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send + '_>> {
        Box::pin(async move {
            tokio::select! {biased;
                ()=self.global.revoked()=>{}, ()=self.epoch.changed()=>{},
                ()=self.probe.wait_image_cancelled()=>{},
                ()=tokio::time::sleep_until(tokio::time::Instant::from_std(self.deadline))=>{},
            }
        })
    }
}
