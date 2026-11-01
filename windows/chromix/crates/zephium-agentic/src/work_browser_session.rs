//! Attempt-owned anonymous storage lifetime; never an account or action grant.
use crate::{ContextRunId, WorkId};
use std::{
    fmt,
    sync::{Arc, Mutex, Weak},
    time::Instant,
};
use zephium_core::ids::ProfileId;

/// Process-local anonymous storage scope owned by one active Work attempt.
#[derive(Clone)]
pub struct WorkBrowserSession(Arc<State>);
/// Native cache witness that cannot extend the owning attempt.
pub struct WeakWorkBrowserSession(Weak<State>);
struct State {
    id: ContextRunId,
    profile: ProfileId,
    work: WorkId,
    retirement: Mutex<Retirement>,
}
struct Retirement {
    closed: bool,
    registered: bool,
    callback: Option<Box<dyn FnOnce() + Send>>,
    time: crate::WorkBrowserHumanTime,
    human_holds: u32,
    visual_lineage_lost: bool,
    visual_loss: Option<Box<dyn FnOnce() + Send>>,
}
impl WorkBrowserSession {
    /// Creates a fresh storage scope, without allocating native resources.
    pub fn new(profile: ProfileId, work: WorkId, deadline: Instant) -> Self {
        Self(Arc::new(State {
            id: ContextRunId::generate(),
            profile,
            work,
            retirement: Mutex::new(Retirement {
                closed: false,
                registered: false,
                callback: None,
                time: crate::WorkBrowserHumanTime::new(deadline),
                human_holds: 0,
                visual_lineage_lost: false,
                visual_loss: None,
            }),
        }))
    }
    /// Opaque storage key; never a native resource or execution capability.
    pub fn id(&self) -> ContextRunId {
        self.0.id
    }
    /// Profile owning policy and erasure for this anonymous scope.
    pub fn profile(&self) -> ProfileId {
        self.0.profile
    }
    /// Checks exact profile, Work ownership, deadline and retirement.
    pub fn admits(&self, profile: ProfileId, work: WorkId) -> bool {
        self.0.profile == profile && self.0.work == work && self.is_current()
    }
    /// Whether the original session is alive and within its deadline.
    pub fn is_current(&self) -> bool {
        self.0.retirement.lock().is_ok_and(|state| {
            let now = Instant::now();
            !state.closed && now < state.time.deadline(now)
        })
    }
    /// Observes lifetime without keeping the scope alive.
    pub fn downgrade(&self) -> WeakWorkBrowserSession {
        WeakWorkBrowserSession(Arc::downgrade(&self.0))
    }
    /// Native storage has one owner. Registration racing closure refuses reuse.
    pub fn register_retirement(&self, callback: Box<dyn FnOnce() + Send>) -> bool {
        let Ok(mut state) = self.0.retirement.lock() else {
            return false;
        };
        if state.closed || state.registered || Instant::now() >= state.time.deadline(Instant::now())
        {
            return false;
        }
        state.registered = true;
        state.callback = Some(callback);
        true
    }
    /// Registers the one native store's revocation-only listener. It issues no
    /// storage/public/image proof. A prior handoff or close refuses registration.
    pub fn register_visual_lineage_loss(&self, callback: Box<dyn FnOnce() + Send>) -> bool {
        let Ok(mut state) = self.0.retirement.lock() else {
            return false;
        };
        if state.closed
            || state.visual_lineage_lost
            || state.visual_loss.is_some()
            || Instant::now() >= state.time.deadline(Instant::now())
        {
            return false;
        }
        state.visual_loss = Some(callback);
        true
    }
    /// Negative history factor only; false permanently excludes automatic
    /// public visuals. True does not prove fresh native storage or sign-out.
    pub fn visual_lineage_untouched(&self) -> bool {
        self.0.retirement.lock().is_ok_and(|state| {
            !state.closed
                && !state.visual_lineage_lost
                && Instant::now() < state.time.deadline(Instant::now())
        })
    }
    /// Keeps the same anonymous storage scope during a genuine retained human
    /// handoff, within one total human-time cap. Closed/expired scopes refuse it.
    pub fn hold_for_person(&self) -> Option<WorkBrowserSessionHumanHold> {
        let mut state = self.0.retirement.lock().ok()?;
        if state.closed || !state.time.set_held(true, Instant::now()) {
            return None;
        }
        state.human_holds = state.human_holds.checked_add(1)?;
        state.visual_lineage_lost = true;
        let notify = state.visual_loss.take();
        drop(state);
        if let Some(notify) = notify {
            notify();
        }
        Some(WorkBrowserSessionHumanHold(self.clone()))
    }
    /// Revokes future attachment immediately; existing resources still drain normally.
    pub fn close(&self) {
        self.0.close();
    }
}
/// Original session's bounded human hold; dropping it returns active time.
#[must_use]
pub struct WorkBrowserSessionHumanHold(WorkBrowserSession);
impl Drop for WorkBrowserSessionHumanHold {
    fn drop(&mut self) {
        if let Ok(mut state) = self.0 .0.retirement.lock() {
            state.human_holds = state.human_holds.saturating_sub(1);
            if state.human_holds == 0 {
                state.time.set_held(false, Instant::now());
            }
        }
    }
}
impl State {
    fn close(&self) {
        let (callback, visual_loss) = {
            let mut state = self
                .retirement
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            state.closed = true;
            state.visual_lineage_lost = true;
            (state.callback.take(), state.visual_loss.take())
        };
        if let Some(notify) = visual_loss {
            notify();
        }
        if let Some(callback) = callback {
            callback();
        }
    }
}
impl Drop for State {
    fn drop(&mut self) {
        self.close();
    }
}
impl WeakWorkBrowserSession {
    /// Whether the original session is alive and within its deadline.
    pub fn is_current(&self) -> bool {
        self.0
            .upgrade()
            .is_some_and(|state| WorkBrowserSession(state).is_current())
    }
}
impl fmt::Debug for WorkBrowserSession {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("WorkBrowserSession([anonymous, redacted])")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        sync::atomic::{AtomicUsize, Ordering},
        time::Duration,
    };

    fn session() -> WorkBrowserSession {
        WorkBrowserSession::new(
            1_u128.into(),
            WorkId::from(2_u128),
            Instant::now() + Duration::from_secs(60),
        )
    }

    #[test]
    fn anonymous_human_hold_keeps_the_same_session_past_active_deadline_and_stop_still_revokes() {
        let now = Instant::now();
        let start = now - Duration::from_secs(90);
        let session = WorkBrowserSession::new(
            1_u128.into(),
            WorkId::generate(),
            start + Duration::from_secs(30),
        );
        {
            let mut state = session.0.retirement.lock().unwrap();
            // Inject controlled monotonic time for the original handoff,
            // rather than sleeping through a person's sign-in in a unit test.
            assert!(state.time.set_held(true, start + Duration::from_secs(5)));
        }
        let original = session.id();
        let hold = session
            .hold_for_person()
            .expect("same active-time remainder after the human wait");
        assert!(session.is_current());
        assert_eq!(session.id(), original);
        session.close();
        assert!(
            !session.is_current(),
            "Stop is independent of human clock credit"
        );
        assert!(session.hold_for_person().is_none());
        drop(hold);
        assert!(
            !session.is_current(),
            "dropping a hold never resurrects the closed scope"
        );
        let expired = WorkBrowserSession::new(
            1_u128.into(),
            WorkId::generate(),
            now - Duration::from_secs(1),
        );
        assert!(expired.hold_for_person().is_none());
    }

    #[test]
    fn anonymous_session_revokes_clones_without_extending_deadline_or_ownership() {
        let session = session();
        let child = session.clone();
        let weak = session.downgrade();
        assert!(child.admits(1_u128.into(), WorkId::from(2_u128)));
        assert!(!child.admits(3_u128.into(), WorkId::from(2_u128)));
        assert!(!child.admits(1_u128.into(), WorkId::from(3_u128)));
        assert_ne!(
            session.id(),
            WorkBrowserSession::new(session.profile(), WorkId::from(2_u128), Instant::now()).id()
        );
        assert!(
            !WorkBrowserSession::new(session.profile(), WorkId::from(2_u128), Instant::now())
                .is_current()
        );
        session.close();
        assert!(!child.is_current());
        assert!(!weak.is_current());
        assert!(
            !child.register_retirement(Box::new(|| panic!("closed session acquired a new store")))
        );
    }

    #[test]
    fn anonymous_session_retires_once_on_close_or_last_owner_drop() {
        for explicit_close in [false, true] {
            let session = session();
            let child = session.clone();
            let calls = Arc::new(AtomicUsize::new(0));
            let count = calls.clone();
            assert!(session.register_retirement(Box::new(move || {
                count.fetch_add(1, Ordering::SeqCst);
            })));
            assert!(!child.register_retirement(Box::new(|| panic!("duplicate store owner"))));
            drop(session);
            assert_eq!(calls.load(Ordering::SeqCst), 0);
            if explicit_close {
                child.close();
                child.close();
            }
            drop(child);
            assert_eq!(calls.load(Ordering::SeqCst), 1);
        }
    }
    #[test]
    fn every_human_hold_poisons_shared_visual_history_before_reacquisition() {
        let session = session();
        let sibling = session.clone();
        let count = Arc::new(AtomicUsize::new(0));
        let notified = count.clone();
        let weak = Arc::downgrade(&session.0);
        assert!(session.register_visual_lineage_loss(Box::new(move || {
            assert!(
                weak.upgrade().unwrap().retirement.try_lock().is_ok(),
                "callback runs outside session lock"
            );
            notified.fetch_add(1, Ordering::SeqCst);
        })));
        assert!(!session.register_visual_lineage_loss(Box::new(|| panic!("duplicate listener"))));
        assert!(session.visual_lineage_untouched());
        let hold = sibling.hold_for_person().unwrap();
        assert!(!session.visual_lineage_untouched());
        assert_eq!(count.load(Ordering::SeqCst), 1);
        drop(hold);
        assert!(!session.visual_lineage_untouched());
        assert!(!session.register_visual_lineage_loss(Box::new(|| panic!("late listener"))));
        drop(sibling.hold_for_person().unwrap());
        session.close();
        assert_eq!(count.load(Ordering::SeqCst), 1);
    }
    #[test]
    fn visual_loss_registration_after_unobserved_handoff_or_close_stays_closed() {
        let session = session();
        drop(session.hold_for_person().unwrap());
        assert!(!session.register_visual_lineage_loss(Box::new(|| panic!("lost history"))));
        let fresh = super::tests::session();
        let count = Arc::new(AtomicUsize::new(0));
        let notified = count.clone();
        assert!(fresh.register_visual_lineage_loss(Box::new(move || {
            notified.fetch_add(1, Ordering::SeqCst);
        })));
        fresh.close();
        assert_eq!(count.load(Ordering::SeqCst), 1);
        assert!(!fresh.visual_lineage_untouched());
        assert!(!fresh.register_visual_lineage_loss(Box::new(|| panic!("closed session"))));
    }
}
