//! Native allocation lineage, never a screenshot or account permission.
use std::sync::{Arc, Mutex, Weak};
use std::task::{Context, Poll, Waker};
use zephium_agentic::{WeakWorkBrowserSession, WorkBrowserSession};

#[derive(Clone)]
pub(crate) struct FreshNativeStore(Arc<Lineage>);
struct Lineage {
    session: WeakWorkBrowserSession,
    state: Mutex<State>,
}
struct State {
    lost: bool,
    listeners: Vec<Weak<Mutex<Option<Waker>>>>,
}
pub(crate) struct FreshStoreLoss {
    owner: FreshNativeStore,
    wake: Arc<Mutex<Option<Waker>>>,
}
impl FreshNativeStore {
    // Only the actual native allocator, after new-store pointer checks, can
    // construct this type. Session metadata alone cannot do so.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    pub(super) fn after_native_allocation(session: &WorkBrowserSession) -> Option<Self> {
        if !session.visual_lineage_untouched() {
            return None;
        }
        let value = Self(Arc::new(Lineage {
            session: session.downgrade(),
            state: Mutex::new(State {
                lost: false,
                listeners: Vec::new(),
            }),
        }));
        let notify = value.clone();
        session
            .register_visual_lineage_loss(Box::new(move || notify.revoke()))
            .then_some(value)
    }
    pub(crate) fn current(&self) -> bool {
        self.0.session.is_current() && self.0.state.lock().is_ok_and(|state| !state.lost)
    }
    pub(crate) fn while_current(&self, operation: &mut dyn FnMut()) -> bool {
        let Ok(state) = self.0.state.lock() else {
            return false;
        };
        if state.lost || !self.0.session.is_current() {
            return false;
        }
        operation();
        true
    }
    pub(crate) fn revoke(&self) {
        let listeners = match self.0.state.lock() {
            Ok(mut state) => {
                state.lost = true;
                std::mem::take(&mut state.listeners)
            }
            Err(_) => return,
        };
        for listener in listeners.into_iter().filter_map(|value| value.upgrade()) {
            let wake = listener.lock().ok().and_then(|mut slot| slot.take());
            if let Some(wake) = wake {
                let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| wake.wake()));
            }
        }
    }
    pub(crate) fn watch(&self) -> Option<FreshStoreLoss> {
        let wake = Arc::new(Mutex::new(None));
        let mut state = self.0.state.lock().ok()?;
        state
            .listeners
            .retain(|listener| listener.strong_count() > 0);
        if state.lost || !self.0.session.is_current() {
            return None;
        }
        if state.listeners.len() >= 32 {
            drop(state);
            self.revoke();
            return None;
        }
        state.listeners.push(Arc::downgrade(&wake));
        Some(FreshStoreLoss {
            owner: self.clone(),
            wake,
        })
    }
}
impl FreshStoreLoss {
    pub(crate) fn poll(&self, cx: &mut Context<'_>) -> Poll<()> {
        if !self.owner.current() {
            return Poll::Ready(());
        }
        let Ok(mut wake) = self.wake.lock() else {
            return Poll::Ready(());
        };
        let old = wake.replace(cx.waker().clone());
        drop(wake);
        drop(old);
        if self.owner.current() {
            Poll::Pending
        } else {
            Poll::Ready(())
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};
    fn session() -> WorkBrowserSession {
        WorkBrowserSession::new(
            1u128.into(),
            2u128.into(),
            Instant::now() + Duration::from_secs(60),
        )
    }
    #[test]
    fn shared_lineage_never_returns_after_hidden_handoff() {
        let session = session();
        let first = FreshNativeStore::after_native_allocation(&session).unwrap();
        let sibling = first.clone();
        assert!(first.current());
        assert!(FreshNativeStore::after_native_allocation(&session).is_none());
        let hold = session.hold_for_person().unwrap();
        assert!(!first.current());
        assert!(!sibling.current());
        drop(hold);
        assert!(session.is_current());
        assert!(!first.current());
        assert!(FreshNativeStore::after_native_allocation(&session).is_none());
    }
    #[test]
    fn credential_denial_revokes_all_store_pages_without_changing_session_or_other_stores() {
        let session = session();
        let store = FreshNativeStore::after_native_allocation(&session).unwrap();
        let sibling = store.clone();
        let other_session = WorkBrowserSession::new(
            3u128.into(),
            4u128.into(),
            Instant::now() + Duration::from_secs(60),
        );
        let other = FreshNativeStore::after_native_allocation(&other_session).unwrap();
        // This is the zero-data notification used by the native denial hooks.
        let denied = || store.revoke();
        denied();
        denied();
        assert!(!store.current() && !sibling.current());
        assert!(session.is_current() && other.current());
        assert!(!store.while_current(&mut || panic!("denied lineage disclosed")));
        assert!(FreshNativeStore::after_native_allocation(&session).is_none());
    }
    #[test]
    fn late_registration_closed_session_and_listener_exhaustion_refuse() {
        let late = session();
        let hold = late.hold_for_person().unwrap();
        drop(hold);
        assert!(FreshNativeStore::after_native_allocation(&late).is_none());
        let closed = session();
        closed.close();
        assert!(FreshNativeStore::after_native_allocation(&closed).is_none());
        let live = session();
        let proof = FreshNativeStore::after_native_allocation(&live).unwrap();
        let watches: Vec<_> = (0..32).map(|_| proof.watch().unwrap()).collect();
        assert!(proof.watch().is_none());
        assert!(!proof.current());
        drop(watches);
    }
}
