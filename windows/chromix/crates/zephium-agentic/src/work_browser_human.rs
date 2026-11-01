//! Human input and actor execution are mutually exclusive on a retained page.
use super::*;

/// Maximum total waiting/presentation interval; caller deadlines can shorten it.
/// A sign-in with a second factor takes minutes; the wait never spends the run.
pub const MAX_WORK_HUMAN_WAIT_MILLIS: u64 = 540_000;

/// Active-time deadline with one bounded human-wait allowance across every
/// handoff of the original owner. Generic stalls never call `set_held`.
#[derive(Clone, Debug)]
pub struct WorkBrowserHumanTime {
    original: std::time::Instant,
    credited: std::time::Duration,
    since: Option<std::time::Instant>,
}
impl WorkBrowserHumanTime {
    /// Starts with the original admitted active deadline and no pause credit.
    pub fn new(deadline: std::time::Instant) -> Self {
        Self {
            original: deadline,
            credited: std::time::Duration::ZERO,
            since: None,
        }
    }
    fn limit() -> std::time::Duration {
        std::time::Duration::from_millis(MAX_WORK_HUMAN_WAIT_MILLIS)
    }
    fn pending(&self, now: std::time::Instant) -> std::time::Duration {
        self.since
            .map_or(std::time::Duration::ZERO, |since| {
                now.saturating_duration_since(since)
            })
            .min(Self::limit().saturating_sub(self.credited))
    }
    /// Current active deadline. Total extension cannot exceed the human cap.
    pub fn deadline(&self, now: std::time::Instant) -> std::time::Instant {
        self.original + self.credited + self.pending(now)
    }
    /// Enters/leaves a genuine human handoff. Expired active time cannot revive.
    pub fn set_held(&mut self, held: bool, now: std::time::Instant) -> bool {
        if held {
            if self.since.is_some() {
                return now < self.deadline(now) && now < self.handoff_deadline(now);
            }
            if now >= self.deadline(now) || self.credited >= Self::limit() {
                return false;
            }
            self.since = Some(now);
        } else if self.since.is_some() {
            self.credited += self.pending(now);
            self.since = None;
        }
        true
    }
    /// Absolute end of the remaining human allowance, never a fresh cap for a
    /// later generation. Waiting without progress ends at this boundary.
    pub fn handoff_deadline(&self, now: std::time::Instant) -> std::time::Instant {
        self.since.unwrap_or(now) + Self::limit().saturating_sub(self.credited)
    }
}

/// Human navigation stays on the original scheme, port and registrable site.
/// Private suffixes keep unrelated hosted tenants separate; IPs stay exact.
pub fn same_work_human_site(
    source: &ContextNavigationTarget,
    target: &ContextNavigationTarget,
) -> bool {
    let (source, target) = (source.as_url(), target.as_url());
    if source.scheme() != target.scheme()
        || source.port_or_known_default() != target.port_or_known_default()
    {
        return false;
    }
    if source.host() == target.host() {
        return true;
    }
    let (Some(url::Host::Domain(source)), Some(url::Host::Domain(target))) =
        (source.host(), target.host())
    else {
        return false;
    };
    fn domain(host: &str) -> Option<psl::Domain<'_>> {
        psl::domain(host.as_bytes()).filter(|domain| domain.suffix().is_known())
    }
    domain(source)
        .zip(domain(target))
        .is_some_and(|(source_domain, target_domain)| {
            source_domain == target_domain
                || brand_family(source_domain.as_bytes(), target_domain.as_bytes()).is_some()
                || shared_sign_in(source, target_domain.as_bytes())
                || shared_sign_in(target, source_domain.as_bytes())
        })
}

/// Sites whose session passes through their owner's sign-in host: a
/// signed-in YouTube page loads through accounts.google.com and back. Only
/// that exact host joins the site, never the owner's other pages.
const SHARED_SIGN_IN: [(&str, &str); 1] = [("youtube.com", "accounts.google.com")];

fn shared_sign_in(host: &str, domain: &[u8]) -> bool {
    SHARED_SIGN_IN
        .iter()
        .any(|(site, sign_in)| host == *sign_in && domain == site.as_bytes())
}

/// Brands whose one site spans country domains: kayak.com and kayak.pl,
/// skyscanner.net and skyscanner.pl, amazon.com and amazon.de. A closed
/// list, matched on the whole label before an ICANN suffix, never a
/// substring.
const BRAND_FAMILIES: [&str; 28] = [
    "airbnb",
    "aliexpress",
    "amazon",
    "agoda",
    "booking",
    "decathlon",
    "ebay",
    "expedia",
    "google",
    "hotels",
    "ikea",
    "kayak",
    "lego",
    "mediamarkt",
    "momondo",
    "notion",
    "opodo",
    "rakuten",
    "skyscanner",
    "tripadvisor",
    "trivago",
    "uber",
    "vrbo",
    "wizzair",
    "ryanair",
    "yelp",
    "zalando",
    "zara",
];

/// The brand two registrable domains share when both are that brand's own
/// label under a public ICANN suffix (kayak.com, kayak.co.uk).
pub fn brand_family(source: &[u8], target: &[u8]) -> Option<&'static str> {
    fn brand(domain: &[u8]) -> Option<&str> {
        let parsed = psl::domain(domain)?;
        if !parsed.suffix().is_known() || parsed.suffix().typ() != Some(psl::Type::Icann) {
            return None;
        }
        let label_end = domain
            .len()
            .checked_sub(parsed.suffix().as_bytes().len() + 1)?;
        std::str::from_utf8(domain.get(..label_end)?).ok()
    }
    let (source, target) = (brand(source)?, brand(target)?);
    (source == target)
        .then(|| {
            BRAND_FAMILIES
                .iter()
                .copied()
                .find(|brand| *brand == source)
        })
        .flatten()
}

/// Logical points from the top-left of the native host's content region.
/// The native adapter additionally checks containment in the actual window.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct WorkBrowserHumanRegion {
    x: u32,
    y: u32,
    width: u32,
    height: u32,
}
impl WorkBrowserHumanRegion {
    /// Reject empty, overflowing or unbounded presentation requests.
    pub fn try_new(x: u32, y: u32, width: u32, height: u32) -> Option<Self> {
        (width >= 64
            && height >= 64
            && x.checked_add(width).is_some_and(|edge| edge <= 8192)
            && y.checked_add(height).is_some_and(|edge| edge <= 8192))
        .then_some(Self {
            x,
            y,
            width,
            height,
        })
    }
    /// Validated top-left position and size in logical points.
    pub const fn components(self) -> [u32; 4] {
        [self.x, self.y, self.width, self.height]
    }
}

#[derive(Clone, Debug)]
pub(super) struct HumanWindow {
    /// Absent when the page is handed over without being shown: the person
    /// decides elsewhere and the page only needs a fresh actor lease.
    pub(super) region: Option<WorkBrowserHumanRegion>,
    pub(super) deadline: AgentPolicyInstant,
    pub(super) source: Arc<ContextNavigationTarget>,
    pub(super) progress: WorkBrowserHumanProgress,
    /// A sign-in: the person may pass through another site's sign-in pages.
    pub(super) sign_in: bool,
}

/// Content-free native document revision; observational, never execution authority.
#[derive(Clone, Debug, Default)]
pub struct WorkBrowserHumanProgress(Arc<HumanProgress>);
#[derive(Debug, Default)]
struct HumanProgress {
    revision: std::sync::atomic::AtomicU64,
    ready: std::sync::atomic::AtomicBool,
    wall_proof: std::sync::Mutex<Option<std::time::Instant>>,
    probe_pending: std::sync::atomic::AtomicBool,
    continuation_revision: std::sync::Mutex<Option<u64>>,
    check: std::sync::Mutex<Option<WorkBrowserHumanCheck>>,
    check_wake: std::sync::Mutex<Option<WallCheckWake>>,
}
#[derive(Clone)]
struct WallCheckWake(Arc<dyn Fn() + Send + Sync>);
impl std::fmt::Debug for WallCheckWake {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("WallCheckWake")
    }
}
/// One coalesced request for a fresh native survey. It grants no continuation.
#[derive(Clone, Debug)]
pub struct WorkBrowserHumanCheck(Arc<HumanCheck>);
#[derive(Debug)]
struct HumanCheck {
    requested: std::time::Instant,
    revision: u64,
    result: std::sync::Mutex<Option<Option<bool>>>,
}
/// The native answer to an explicit recheck, never a user attestation.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WorkBrowserHumanCheckState {
    /// Waiting for a survey started after the request.
    Pending,
    /// A fresh native sample still sees the wall.
    Waiting,
    /// The existing stamped native proof verifies clearance.
    Clear,
    /// The page changed, disappeared, or did not answer within the bound.
    Unavailable,
}
impl WorkBrowserHumanCheck {
    /// Current bounded result, joined to the still-current document revision.
    pub fn state(&self, revision: u64) -> WorkBrowserHumanCheckState {
        if revision != self.0.revision
            || self.0.requested.elapsed() >= std::time::Duration::from_secs(2)
        {
            return WorkBrowserHumanCheckState::Unavailable;
        }
        match self.0.result.lock().ok().and_then(|result| *result) {
            Some(Some(true)) => WorkBrowserHumanCheckState::Clear,
            Some(Some(false)) => WorkBrowserHumanCheckState::Waiting,
            Some(None) => WorkBrowserHumanCheckState::Unavailable,
            None if self.0.requested.elapsed() < std::time::Duration::from_secs(2) => {
                WorkBrowserHumanCheckState::Pending
            }
            None => WorkBrowserHumanCheckState::Unavailable,
        }
    }
    /// Native callback settles once; no result can revive an expired request.
    pub fn finish(&self, result: Option<bool>) {
        if let Ok(mut value) = self.0.result.lock() {
            if value.is_none() {
                *value = Some(
                    if self.0.requested.elapsed() < std::time::Duration::from_secs(2) {
                        result
                    } else {
                        None
                    },
                );
            }
        }
    }
}
impl WorkBrowserHumanProgress {
    /// Coalesce pending clicks and bound new surveys to at most two per second.
    pub fn request_wall_check(&self) -> Option<WorkBrowserHumanCheck> {
        let mut slot = self.0.check.lock().ok()?;
        if let Some(check) = slot.as_ref() {
            if check.state(self.revision()) == WorkBrowserHumanCheckState::Pending {
                return Some(check.clone());
            }
            if check.0.requested.elapsed() < std::time::Duration::from_millis(500) {
                return None;
            }
        }
        let check = WorkBrowserHumanCheck(Arc::new(HumanCheck {
            requested: std::time::Instant::now(),
            revision: self.revision(),
            result: std::sync::Mutex::new(None),
        }));
        *slot = Some(check.clone());
        drop(slot);
        let wake = self.0.check_wake.lock().ok().and_then(|wake| wake.clone());
        if let Some(wake) = wake {
            (wake.0)();
        }
        Some(check)
    }
    /// Native host installs the same-page dispatch wake. One newly admitted
    /// request schedules verification immediately; repeated clicks coalesce.
    pub fn bind_wall_check_wake(&self, wake: Arc<dyn Fn() + Send + Sync>) {
        if let Ok(mut slot) = self.0.check_wake.lock() {
            *slot = Some(WallCheckWake(wake));
        }
    }
    /// Navigation or retirement invalidates even an already answered request.
    /// Late callbacks cannot overwrite this refusal.
    pub fn invalidate_wall_check(&self) {
        if let Ok(slot) = self.0.check.lock() {
            if let Some(check) = slot.as_ref() {
                if let Ok(mut result) = check.0.result.lock() {
                    *result = Some(None);
                }
            }
        }
    }
    /// Captured only when a new native survey begins; an older in-flight
    /// callback cannot answer a request made after that survey started.
    pub fn pending_wall_check(&self) -> Option<WorkBrowserHumanCheck> {
        self.0
            .check
            .lock()
            .ok()?
            .as_ref()
            .filter(|check| check.state(self.revision()) == WorkBrowserHumanCheckState::Pending)
            .cloned()
    }

    /// Native readiness is advisory; continuation rechecks the live document.
    pub fn ready(&self) -> bool {
        self.0.ready.load(std::sync::atomic::Ordering::Acquire)
    }
    /// Native owner reports completion of the current main-document navigation.
    pub fn record_ready(&self, ready: bool) {
        self.0
            .ready
            .store(ready, std::sync::atomic::Ordering::Release);
    }
    /// Monotonic revision for frontend document-change events.
    pub fn revision(&self) -> u64 {
        self.0.revision.load(std::sync::atomic::Ordering::Acquire)
    }
    /// Fresh native document and DOM observations found the handed-over wall
    /// absent. This is an observation, never a grant to perform an effect.
    pub fn verified_wall_clear(&self) -> bool {
        self.0
            .wall_proof
            .lock()
            .is_ok_and(|at| at.is_some_and(|at| at.elapsed() <= std::time::Duration::from_secs(2)))
    }
    /// Only the native owner can join wall observations to its live document.
    pub fn record_verified_wall_clear(&self, clear: bool) {
        if let Ok(mut at) = self.0.wall_proof.lock() {
            *at = clear.then(std::time::Instant::now);
        }
    }
    /// Captures fresh wall evidence at the exact admitted human continuation.
    /// Native handback must still check this revision against its live document.
    pub fn capture_wall_continuation(&self) -> bool {
        if !self.ready() || !self.verified_wall_clear() {
            return false;
        }
        let Ok(mut captured) = self.0.continuation_revision.lock() else {
            return false;
        };
        *captured = Some(self.revision());
        true
    }
    /// Document revision captured by the owner of the human continuation.
    pub fn wall_continuation_revision(&self) -> Option<u64> {
        *self.0.continuation_revision.lock().ok()?
    }
    /// At most one bounded wall survey runs for this human presentation.
    pub fn begin_wall_probe(&self) -> bool {
        self.0
            .probe_pending
            .compare_exchange(
                false,
                true,
                std::sync::atomic::Ordering::AcqRel,
                std::sync::atomic::Ordering::Acquire,
            )
            .is_ok()
    }
    /// Releases the one survey slot after its native callback settles.
    pub fn finish_wall_probe(&self) {
        self.0
            .probe_pending
            .store(false, std::sync::atomic::Ordering::Release);
    }
    /// Native owner publishes only increasing revisions of its retained page.
    pub fn record_revision(&self, revision: u64) {
        self.0
            .revision
            .fetch_max(revision, std::sync::atomic::Ordering::Release);
    }
}

impl WorkBrowserResources {
    /// Descriptive current document only when no actor or human operation owns it.
    pub fn retained_document(
        &self,
        resource: &WorkBrowserResourceJoin,
    ) -> Option<&ContextNavigationTarget> {
        let row = self.rows.get(&resource.identity.resource)?;
        (row.join == *resource
            && row.phase == WorkBrowserResourcePhase::Retained
            && row.failure.is_none()
            && row.document_available
            && row.pending.is_none()
            && row.lease.is_none())
        .then_some(row.effective_document.as_deref())
        .flatten()
    }
    /// Read the original native presentation's content-free progress.
    pub fn human_progress(
        &self,
        resource: &WorkBrowserResourceJoin,
    ) -> Option<WorkBrowserHumanProgress> {
        let row = self.rows.get(&resource.identity.resource)?;
        (row.join == *resource)
            .then(|| row.human.as_ref().map(|human| human.progress.clone()))
            .flatten()
    }
    /// Reserve human presentation only after the actor lease and its work ended.
    /// The application must independently prove the original human-handoff ACK.
    pub fn present_human(
        &mut self,
        resource: &WorkBrowserResourceJoin,
        region: WorkBrowserHumanRegion,
        now: AgentPolicyInstant,
        deadline: AgentPolicyInstant,
    ) -> Result<WorkBrowserResourceRequest, WorkBrowserResourceError> {
        self.present_human_for(resource, region, now, deadline, false)
    }
    /// Presents a page for a sign-in: the person's navigation may pass through
    /// another site's sign-in pages but must settle back on the page's site.
    pub fn present_human_for(
        &mut self,
        resource: &WorkBrowserResourceJoin,
        region: WorkBrowserHumanRegion,
        now: AgentPolicyInstant,
        deadline: AgentPolicyInstant,
        sign_in: bool,
    ) -> Result<WorkBrowserResourceRequest, WorkBrowserResourceError> {
        self.hand_over(resource, Some(region), now, deadline, sign_in)
    }
    /// Hands the page over without showing it, for a decision the person
    /// makes elsewhere; continuing it re-admits the unchanged document.
    pub fn hand_over_unpresented(
        &mut self,
        resource: &WorkBrowserResourceJoin,
        now: AgentPolicyInstant,
        deadline: AgentPolicyInstant,
    ) -> Result<WorkBrowserResourceRequest, WorkBrowserResourceError> {
        self.hand_over(resource, None, now, deadline, false)
    }
    fn hand_over(
        &mut self,
        resource: &WorkBrowserResourceJoin,
        region: Option<WorkBrowserHumanRegion>,
        now: AgentPolicyInstant,
        deadline: AgentPolicyInstant,
        sign_in: bool,
    ) -> Result<WorkBrowserResourceRequest, WorkBrowserResourceError> {
        if self.sealed {
            return Err(WorkBrowserResourceError::Sealed);
        }
        if deadline <= now || deadline.millis() - now.millis() > MAX_WORK_HUMAN_WAIT_MILLIS {
            return Err(WorkBrowserResourceError::Expired);
        }
        let sequence = self.next()?;
        let row = self.row_mut(resource)?;
        row.tick(now)?;
        if row.failure.is_some() {
            return Err(WorkBrowserResourceError::Quarantined);
        }
        if row.phase != WorkBrowserResourcePhase::Retained
            || row.pending.is_some()
            || row.lease.is_some()
            || row.observation.is_some()
            || row.navigation.is_some()
            || row.action.is_some()
            || row.human.is_some()
            || !row.document_available
            || row.effective_document.is_none()
        {
            return Err(WorkBrowserResourceError::Phase);
        }
        // Any human interaction can change account state, including a check
        // or an approval. Original anonymous intent never revives on return.
        if let Some(proof) = &row.anonymous_read_authority {
            proof.revoke(WorkBrowserAnonymousReadStatus::HumanHandoff);
        }
        row.human = Some(Box::new(HumanWindow {
            progress: WorkBrowserHumanProgress::default(),
            region,
            deadline,
            source: row
                .effective_document
                .clone()
                .ok_or(WorkBrowserResourceError::Source)?,
            sign_in,
        }));
        row.document_available = false;
        row.observed = false;
        row.phase = WorkBrowserResourcePhase::PresentingHuman;
        Ok(request(
            row,
            sequence,
            WorkBrowserResourceOperation::PresentHuman,
        ))
    }

    /// Reserve one hide/rebind operation; it never starts or resumes an actor.
    pub fn continue_after_human(
        &mut self,
        resource: &WorkBrowserResourceJoin,
        now: AgentPolicyInstant,
    ) -> Result<WorkBrowserResourceRequest, WorkBrowserResourceError> {
        if self.sealed {
            return Err(WorkBrowserResourceError::Sealed);
        }
        let sequence = self.next()?;
        let row = self.row_mut(resource)?;
        row.tick(now)?;
        if row.phase != WorkBrowserResourcePhase::PresentedHuman || row.pending.is_some() {
            return Err(WorkBrowserResourceError::Phase);
        }
        if row.human.as_ref().is_none_or(|human| now >= human.deadline) {
            return Err(WorkBrowserResourceError::Expired);
        }
        row.phase = WorkBrowserResourcePhase::ContinuingAfterHuman;
        Ok(request(
            row,
            sequence,
            WorkBrowserResourceOperation::ContinueAfterHuman,
        ))
    }
}

fn request(
    row: &mut Resource,
    sequence: u64,
    kind: WorkBrowserResourceOperation,
) -> WorkBrowserResourceRequest {
    let operation = OperationJoin {
        resource: row.join.clone(),
        sequence,
        kind,
        lease: None,
    };
    row.pending = Some(operation.clone());
    WorkBrowserResourceRequest {
        construction: None,
        media: None,
        operation: Box::new(operation),
        storage: row.storage,
        isolated_public: row.isolated_public,
        document: row.document.clone(),
        document_policy: row.document_policy,
        delivery: None,
        health: None,
        human: row.human.clone(),
    }
}

pub(super) fn settle(
    row: &mut Resource,
    completion: WorkBrowserResourceCompletion,
    now: AgentPolicyInstant,
    sealed: bool,
) -> WorkBrowserResourceEvent {
    use WorkBrowserResourceNativeOutcome as Outcome;
    use WorkBrowserResourceOperation as Operation;
    if !sealed && row.human.as_ref().is_some_and(|human| now < human.deadline) {
        match (completion.operation.kind, completion.outcome) {
            (Operation::PresentHuman, Outcome::HumanPresented)
                if row.phase == WorkBrowserResourcePhase::PresentingHuman =>
            {
                row.phase = WorkBrowserResourcePhase::PresentedHuman;
                return WorkBrowserResourceEvent::HumanPresented(row.join.clone());
            }
            (Operation::ContinueAfterHuman, Outcome::HumanContinued)
                if row.phase == WorkBrowserResourcePhase::ContinuingAfterHuman =>
            {
                if let Some((effective, epoch, generation)) = completion
                    .effective_document
                    .filter(|effective| {
                        row.effective_document
                            .as_ref()
                            .is_some_and(|prior| same_work_human_site(prior, effective))
                    })
                    .zip(row.navigation_epoch.next())
                    .zip(row.frame_generation.next())
                    .map(|((target, epoch), generation)| (target, epoch, generation))
                {
                    row.current_requested_document = Some(effective.clone());
                    row.admission_document = Some(effective.clone());
                    row.effective_document = Some(effective);
                    row.navigation_epoch = epoch;
                    row.admission_epoch = epoch;
                    row.frame_generation = generation;
                    row.document_available = true;
                    row.observed = false;
                    row.human = None;
                    row.phase = WorkBrowserResourcePhase::Retained;
                    return WorkBrowserResourceEvent::HumanContinued(row.join.clone());
                }
            }
            _ => {}
        }
    }
    let failure = if completion.outcome == Outcome::Refused {
        WorkBrowserResourceFailure::NativeRefused
    } else {
        WorkBrowserResourceFailure::Contract
    };
    row.quarantine(failure);
    WorkBrowserResourceEvent::Quarantined(failure)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explicit_wall_check_requires_a_fresh_native_answer_and_coalesces() {
        use WorkBrowserHumanCheckState as Check;
        let progress = WorkBrowserHumanProgress::default();
        let wakes = Arc::new(std::sync::atomic::AtomicU64::new(0));
        let observed = wakes.clone();
        progress.bind_wall_check_wake(Arc::new(move || {
            observed.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        }));
        assert!(
            progress.pending_wall_check().is_none(),
            "an earlier survey captures no later request"
        );
        let requested = progress.request_wall_check().unwrap();
        let repeated = progress.request_wall_check().unwrap();
        assert!(Arc::ptr_eq(&requested.0, &repeated.0));
        assert_eq!(wakes.load(std::sync::atomic::Ordering::Relaxed), 1);
        progress.record_verified_wall_clear(true);
        assert_eq!(
            requested.state(0),
            Check::Pending,
            "cached automatic proof cannot answer the request"
        );
        progress.pending_wall_check().unwrap().finish(Some(false));
        assert_eq!(requested.state(0), Check::Waiting);
        assert!(
            progress.request_wall_check().is_none(),
            "completed requests are rate bounded, never cached as fresh"
        );
        assert_eq!(
            requested.state(1),
            Check::Unavailable,
            "navigation invalidates a previously answered check"
        );
        progress.invalidate_wall_check();
        requested.finish(Some(false));
        assert_eq!(
            requested.state(0),
            Check::Unavailable,
            "native navigation invalidates before a revision is published"
        );
    }

    #[test]
    fn explicit_wall_check_timeout_and_stale_callback_never_report_a_wall_result() {
        use WorkBrowserHumanCheckState as Check;
        let expired = WorkBrowserHumanCheck(Arc::new(HumanCheck {
            requested: std::time::Instant::now() - std::time::Duration::from_secs(3),
            revision: 7,
            result: std::sync::Mutex::new(None),
        }));
        expired.finish(Some(false));
        assert_eq!(expired.state(7), Check::Unavailable);
        let progress = WorkBrowserHumanProgress::default();
        let requested = progress.request_wall_check().unwrap();
        requested.finish(None);
        requested.finish(Some(true));
        assert_eq!(
            requested.state(0),
            Check::Unavailable,
            "native refusal settles once"
        );
    }

    #[test]
    fn human_time_restores_active_budget_once_and_caps_all_handoffs() {
        use std::time::{Duration, Instant};
        let start = Instant::now();
        let original = start + Duration::from_secs(30);
        let mut time = WorkBrowserHumanTime::new(original);
        assert!(time.set_held(true, start + Duration::from_secs(5)));
        let returned = start + Duration::from_secs(90);
        assert_eq!(
            time.deadline(returned),
            returned + Duration::from_secs(25),
            "a real human wait can exceed the original active deadline"
        );
        assert!(time.set_held(false, returned));
        assert_eq!(
            time.deadline(start + Duration::from_secs(100)),
            returned + Duration::from_secs(25)
        );
        assert!(time.set_held(true, start + Duration::from_secs(100)));
        assert_eq!(
            time.handoff_deadline(start + Duration::from_secs(110)),
            start + Duration::from_secs(555),
            "later generations share the remaining allowance"
        );
        let exhausted = start + Duration::from_secs(1000);
        assert_eq!(
            time.deadline(exhausted),
            original + Duration::from_millis(MAX_WORK_HUMAN_WAIT_MILLIS)
        );
        assert!(!time.set_held(true, exhausted));
        time.set_held(false, exhausted);
        assert!(!time.set_held(true, exhausted));
        let mut stalled = WorkBrowserHumanTime::new(original);
        assert_eq!(
            stalled.deadline(returned),
            original,
            "generic no-progress waits earn nothing"
        );
        assert!(
            !stalled.set_held(true, returned),
            "expired active work cannot be revived as a new human wait"
        );
    }

    #[test]
    fn verified_wall_proof_expires_but_admitted_continuation_keeps_its_revision() {
        let progress = WorkBrowserHumanProgress::default();
        progress.record_ready(true);
        progress.record_revision(7);
        assert!(!progress.capture_wall_continuation());
        progress.record_verified_wall_clear(true);
        assert!(progress.capture_wall_continuation());
        *progress.0.wall_proof.lock().unwrap() =
            Some(std::time::Instant::now() - std::time::Duration::from_secs(3));
        assert!(!progress.verified_wall_clear());
        assert!(
            !progress.capture_wall_continuation(),
            "timer passage cannot replace fresh native DOM evidence"
        );
        assert_eq!(
            progress.wall_continuation_revision(),
            Some(7),
            "native handback uses the exact admitted revision"
        );
        progress.record_verified_wall_clear(false);
        assert!(!progress.verified_wall_clear());
        assert!(progress.begin_wall_probe());
        assert!(!progress.begin_wall_probe(), "one native survey at a time");
        progress.finish_wall_probe();
        assert!(progress.begin_wall_probe());
    }

    #[test]
    fn human_site_uses_private_suffixes_and_never_changes_scheme_port_or_ip() {
        for (source, target, allowed) in [
            (
                "https://travel.state.gov/",
                "https://login.state.gov/",
                true,
            ),
            (
                "https://www.example.co.uk/",
                "https://auth.example.co.uk/",
                true,
            ),
            ("https://alice.github.io/", "https://bob.github.io/", false),
            ("https://example.co.uk/", "https://attacker.co.uk/", false),
            (
                "https://example.com/",
                "https://example.com.attacker.test/",
                false,
            ),
            ("https://example.com/", "http://example.com/", false),
            ("https://example.com/", "https://example.com:8443/", false),
            ("http://127.0.0.1:8000/a", "http://127.0.0.1:8000/b", true),
            ("http://127.0.0.1:8000/", "http://127.0.0.2:8000/", false),
            (
                "https://a.example.invalid/",
                "https://b.example.invalid/",
                false,
            ),
            // A brand's own country domains are one site.
            ("https://kayak.com/", "https://www.kayak.pl/", true),
            (
                "https://www.skyscanner.com/",
                "https://www.skyscanner.co.uk/",
                true,
            ),
            ("https://www.airbnb.com/", "https://www.airbnb.co.uk/", true),
            // Never a lookalike, another brand or a hosted tenant.
            ("https://kayak.com/", "https://kayak-deals.pl/", false),
            ("https://kayak.com/", "https://kayak.github.io/", false),
            ("https://example.com/", "https://example.pl/", false),
            ("https://kayak.com/", "http://kayak.pl/", false),
            // A signed-in YouTube page passes through Google's sign-in host,
            // and only that host.
            (
                "https://www.youtube.com/watch?v=1",
                "https://accounts.google.com/ServiceLogin",
                true,
            ),
            (
                "https://accounts.google.com/CheckCookie",
                "https://www.youtube.com/",
                true,
            ),
            (
                "https://www.youtube.com/",
                "https://mail.google.com/",
                false,
            ),
            ("https://www.youtube.com/", "https://www.google.com/", false),
        ] {
            assert_eq!(
                same_work_human_site(
                    &ContextNavigationTarget::parse(source).unwrap(),
                    &ContextNavigationTarget::parse(target).unwrap()
                ),
                allowed
            );
        }
    }
    fn now(value: u64) -> AgentPolicyInstant {
        AgentPolicyInstant::from_millis(value)
    }
    fn region() -> WorkBrowserHumanRegion {
        WorkBrowserHumanRegion::try_new(200, 80, 900, 640).unwrap()
    }
    fn fixture() -> (WorkBrowserResources, WorkBrowserResourceJoin) {
        let mut rows = WorkBrowserResources::new(WorkId::generate(), ProfileId::generate());
        let request = rows
            .construct_document(
                WorkBrowserResourceId::generate(),
                ContextId::generate(),
                ContextProfileStorageClass::Ephemeral,
                ContextNavigationTarget::parse("https://example.test/challenge").unwrap(),
                now(0),
            )
            .unwrap();
        let resource = request.resource().clone();
        assert!(matches!(
            rows.settle_at(
                request.complete(WorkBrowserResourceNativeOutcome::Constructed),
                now(1)
            ),
            Ok(WorkBrowserResourceEvent::Retained(_))
        ));
        (rows, resource)
    }
    fn acquire(
        rows: &mut WorkBrowserResources,
        resource: &WorkBrowserResourceJoin,
        time: u64,
    ) -> Result<WorkBrowserResourceRequest, WorkBrowserResourceError> {
        rows.acquire(resource, ContextRunId::generate(), now(time), now(1000))
    }

    #[test]
    fn hidden_approval_handoff_preserves_resource_but_changes_execution_join() {
        let (mut rows, resource) = fixture();
        let request = acquire(&mut rows, &resource, 2).unwrap();
        let original = request.lease().unwrap().clone();
        let _ = rows
            .settle_at(
                request.complete(WorkBrowserResourceNativeOutcome::Acquired),
                now(3),
            )
            .unwrap();
        let before = rows
            .read_binding(&original, now(4))
            .unwrap()
            .frame()
            .clone();
        let revoke = rows.revoke(&original).unwrap();
        let _ = rows
            .settle_at(
                revoke.complete(WorkBrowserResourceNativeOutcome::Revoked {
                    debt: WorkBrowserLeaseNativeDebt::default(),
                    resource_retained: true,
                }),
                now(5),
            )
            .unwrap();
        let handoff = rows
            .hand_over_unpresented(&resource, now(6), now(900))
            .unwrap();
        assert!(handoff.human_region().is_none());
        let _ = rows
            .settle_at(
                handoff.complete(WorkBrowserResourceNativeOutcome::HumanPresented),
                now(7),
            )
            .unwrap();
        let resume = rows.continue_after_human(&resource, now(8)).unwrap();
        let document = resume.document().unwrap().clone();
        let _ = rows
            .settle_at(resume.complete_human_document(document), now(9))
            .unwrap();
        let request = acquire(&mut rows, &resource, 10).unwrap();
        let successor = request.lease().unwrap().clone();
        let _ = rows
            .settle_at(
                request.complete(WorkBrowserResourceNativeOutcome::Acquired),
                now(11),
            )
            .unwrap();
        let after = rows
            .read_binding(&successor, now(12))
            .unwrap()
            .frame()
            .clone();
        assert_eq!(original.resource(), successor.resource());
        assert_eq!(
            before.context().identity().id(),
            after.context().identity().id()
        );
        assert_eq!(
            before.context().identity().profile(),
            after.context().identity().profile()
        );
        assert_eq!(before.origin(), after.origin());
        assert_ne!(
            before.context().identity().owner(),
            after.context().identity().owner()
        );
        assert_ne!(
            before.context().context_generation(),
            after.context().context_generation()
        );
        assert_ne!(
            before.context().navigation_epoch(),
            after.context().navigation_epoch()
        );
        assert_ne!(before.frame_generation(), after.frame_generation());
    }

    #[test]
    fn human_and_actor_authority_never_overlap_and_continue_requires_fresh_observation() {
        let (mut rows, resource) = fixture();
        let request = acquire(&mut rows, &resource, 2).unwrap();
        assert!(rows
            .present_human(&resource, region(), now(3), now(900))
            .is_err());
        let lease = request.lease().unwrap().clone();
        let _ = rows
            .settle_at(
                request.complete(WorkBrowserResourceNativeOutcome::Acquired),
                now(4),
            )
            .unwrap();
        assert!(rows
            .present_human(&resource, region(), now(5), now(900))
            .is_err());
        let revoke = rows.revoke(&lease).unwrap();
        let _ = rows
            .settle_at(
                revoke.complete(WorkBrowserResourceNativeOutcome::Revoked {
                    debt: WorkBrowserLeaseNativeDebt::default(),
                    resource_retained: true,
                }),
                now(6),
            )
            .unwrap();
        let present = rows
            .present_human(&resource, region(), now(7), now(900))
            .unwrap();
        assert!(acquire(&mut rows, &resource, 8).is_err());
        let _ = rows
            .settle_at(
                present.complete(WorkBrowserResourceNativeOutcome::HumanPresented),
                now(9),
            )
            .unwrap();
        assert!(acquire(&mut rows, &resource, 10).is_err());
        let hide = rows.continue_after_human(&resource, now(11)).unwrap();
        assert_eq!(hide.document().unwrap().as_url().path(), "/challenge");
        assert!(rows.continue_after_human(&resource, now(12)).is_err());
        assert!(acquire(&mut rows, &resource, 13).is_err());
        let target = ContextNavigationTarget::parse("https://example.test/en.html").unwrap();
        assert!(matches!(
            rows.settle_at(hide.complete_human_document(target.clone()), now(14)),
            Ok(WorkBrowserResourceEvent::HumanContinued(_))
        ));
        assert!(rows.admits_lease(&lease, now(15)).is_err());
        assert_eq!(rows.retained_document(&resource), Some(&target));
        let request = acquire(&mut rows, &resource, 16).unwrap();
        assert_eq!(request.document().unwrap().as_url().path(), "/challenge");
        let fresh = request.lease().unwrap().clone();
        let _ = rows
            .settle_at(
                request.complete(WorkBrowserResourceNativeOutcome::Acquired),
                now(17),
            )
            .unwrap();
        let binding = rows.read_binding(&fresh, now(18)).unwrap();
        assert_eq!(binding.requested_document(), &target);
        assert!(binding.is_admission_document());
        assert_eq!(binding.frame().context().navigation_epoch().get(), 2);
        assert!(!rows
            .automation_state(&fresh, now(19))
            .unwrap()
            .can_automate());
        assert_eq!(
            rows.rows[&resource.identity.resource]
                .effective_document
                .as_deref(),
            Some(&target)
        );
    }

    #[test]
    fn foreign_origin_and_late_native_success_never_restore_agent_authority() {
        for (url, time) in [("https://other.test/", 4), ("https://example.test/", 100)] {
            let (mut rows, resource) = fixture();
            let request = rows
                .present_human(&resource, region(), now(2), now(100))
                .unwrap();
            let _ = rows
                .settle_at(
                    request.complete(WorkBrowserResourceNativeOutcome::HumanPresented),
                    now(3),
                )
                .unwrap();
            let request = rows.continue_after_human(&resource, now(4)).unwrap();
            assert!(matches!(
                rows.settle_at(
                    request.complete_human_document(ContextNavigationTarget::parse(url).unwrap()),
                    now(time)
                ),
                Ok(WorkBrowserResourceEvent::Quarantined(_))
            ));
            assert!(acquire(&mut rows, &resource, time + 1).is_err());
            let destroy = rows.destroy(&resource).unwrap();
            assert!(matches!(
                rows.settle_at(
                    destroy.complete(WorkBrowserResourceNativeOutcome::Destroyed),
                    now(time + 2)
                ),
                Ok(WorkBrowserResourceEvent::Destroyed(_))
            ));
        }
    }

    #[test]
    fn destruction_wins_over_pending_human_presentation_without_erasing_callback_debt() {
        let (mut rows, resource) = fixture();
        let present = rows
            .present_human(&resource, region(), now(2), now(100))
            .unwrap();
        let destroy = rows.destroy(&resource).unwrap();
        let _ = rows
            .settle_at(
                destroy.complete(WorkBrowserResourceNativeOutcome::Destroyed),
                now(3),
            )
            .unwrap();
        rows.seal();
        assert!(!rows.is_quiescent());
        assert!(matches!(
            rows.settle_at(
                present.complete(WorkBrowserResourceNativeOutcome::HumanPresented),
                now(4)
            ),
            Ok(WorkBrowserResourceEvent::DebtSettled(_))
        ));
        assert!(rows.is_quiescent());
    }

    #[test]
    fn human_window_is_bounded_and_cannot_be_reentered_or_renewed() {
        assert!(WorkBrowserHumanRegion::try_new(u32::MAX, 0, 64, 64).is_none());
        assert!(WorkBrowserHumanRegion::try_new(0, 0, 0, 64).is_none());
        let (mut rows, resource) = fixture();
        assert!(rows
            .present_human(&resource, region(), now(2), now(2))
            .is_err());
        assert!(rows
            .present_human(
                &resource,
                region(),
                now(2),
                now(3 + MAX_WORK_HUMAN_WAIT_MILLIS)
            )
            .is_err());
        let request = rows
            .present_human(&resource, region(), now(2), now(100))
            .unwrap();
        let _ = rows
            .settle_at(
                request.complete(WorkBrowserResourceNativeOutcome::HumanPresented),
                now(3),
            )
            .unwrap();
        assert!(rows
            .present_human(&resource, region(), now(4), now(200))
            .is_err());
        assert!(rows.continue_after_human(&resource, now(100)).is_err());
        assert!(rows.destroy(&resource).is_ok());
    }
}
