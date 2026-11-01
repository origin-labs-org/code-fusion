//! Global screenshot preference: pending writes revoke active model-image input.
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, OnceLock,
};
use zephium_agentic::lead::ModelImageGate;
use zephium_core::ports::store::{AppSettingReadback, Store};

const KEY: &str = "work.screenshots";
static OWNER: OnceLock<Arc<Preferences>> = OnceLock::new();
struct Preferences {
    gate: ModelImageGate,
    pending: Mutex<Option<u64>>,
    initialized: AtomicBool,
    bootstrap_epoch: Option<u64>,
}
impl Preferences {
    #[cfg(test)]
    fn new(readback: AppSettingReadback) -> Arc<Self> {
        let enabled = match readback {
            AppSettingReadback::Missing => Some(true),
            AppSettingReadback::Value(value) if value == "true" => Some(true),
            AppSettingReadback::Value(value) if value == "false" => Some(false),
            _ => None,
        };
        Arc::new(Self {
            gate: ModelImageGate::new(enabled),
            pending: Mutex::new(None),
            initialized: AtomicBool::new(true),
            bootstrap_epoch: None,
        })
    }
    fn uninitialized() -> Arc<Self> {
        let gate = ModelImageGate::new(None);
        let bootstrap_epoch = gate.begin_change();
        Arc::new(Self {
            gate,
            pending: Mutex::new(None),
            initialized: AtomicBool::new(false),
            bootstrap_epoch,
        })
    }
    fn initialize(&self, readback: AppSettingReadback) {
        let Ok(pending) = self.pending.lock() else {
            return;
        };
        if pending.is_some() || self.initialized.swap(true, Ordering::AcqRel) {
            return;
        }
        let enabled = match readback {
            AppSettingReadback::Missing => true,
            AppSettingReadback::Value(value) if value == "true" => true,
            AppSettingReadback::Value(value) if value == "false" => false,
            _ => return,
        };
        if let Some(epoch) = self.bootstrap_epoch {
            self.gate.confirm(epoch, enabled);
        }
    }
    fn begin(self: &Arc<Self>, enabled: bool) -> Option<PreferenceChange> {
        // Revocation must precede even a busy queue refusal. A pending Allow
        // acknowledgement cannot overwrite an intervening Off request.
        self.initialized.store(true, Ordering::Release);
        let epoch = self.gate.begin_change()?;
        let mut pending = self.pending.try_lock().ok()?;
        if pending.is_some() {
            return None;
        }
        *pending = Some(epoch);
        Some(PreferenceChange(Arc::new(Change {
            owner: self.clone(),
            epoch,
            enabled,
        })))
    }
}
/// Initializes from an exact Store reply before Work/provider admission.
/// An unavailable store never inherits the default-on preference.
pub fn initialize(readback: AppSettingReadback) {
    owner().initialize(readback);
}
fn owner() -> &'static Arc<Preferences> {
    OWNER.get_or_init(Preferences::uninitialized)
}
/// Shared by every concurrent Work run; it does not grant any image/source.
pub fn gate() -> ModelImageGate {
    owner().gate.clone()
}
/// Actual current state, including fail-closed pending/unconfirmed writes.
pub fn enabled() -> bool {
    owner().gate.enabled()
}
/// Starts the revocation before the desktop queues a setting mutation.
pub fn begin_preference(enabled: bool) -> Option<PreferenceChange> {
    owner().begin(enabled)
}

/// Exact internal queue operand. Clones retain one pending change; stale/drop
/// cleanup never re-enables a permission or discards a newer change.
#[derive(Clone)]
pub struct PreferenceChange(Arc<Change>);
struct Change {
    owner: Arc<Preferences>,
    epoch: u64,
    enabled: bool,
}
impl PreferenceChange {
    /// Performs the setting write, durability barrier and exact readback. Only
    /// this original pending epoch may be confirmed. Failure stays disabled.
    pub(crate) fn persist(&self, store: &dyn Store) -> bool {
        let Ok(mut pending) = self.0.owner.pending.lock() else {
            return false;
        };
        if *pending != Some(self.0.epoch) {
            return false;
        }
        let desired = self.0.enabled.to_string();
        let persisted = store.set_app_setting(KEY.into(), desired.clone())
            && store.flush_until(std::time::Instant::now() + std::time::Duration::from_secs(2))
            && matches!(store.app_setting_readback(KEY), AppSettingReadback::Value(value) if value == desired);
        let confirmed = persisted && self.0.owner.gate.confirm(self.0.epoch, self.0.enabled);
        *pending = None;
        confirmed
    }
    /// Current effective state; never an optimistic desired value.
    pub(crate) fn effective(&self) -> bool {
        self.0.owner.gate.enabled()
    }
}
impl Drop for Change {
    fn drop(&mut self) {
        if let Ok(mut pending) = self.owner.pending.lock() {
            if *pending == Some(self.epoch) {
                *pending = None;
            }
        }
    }
}
impl std::fmt::Debug for PreferenceChange {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ScreenshotPreferenceChange([pending])")
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn busy_off_revokes_inflight_allow_and_original_bootstrap_ack() {
        let owner = Preferences::uninitialized();
        let bootstrap = owner.bootstrap_epoch.unwrap();
        let pending = owner.pending.lock().unwrap();
        assert!(owner.begin(false).is_none());
        assert!(!owner.gate.confirm(bootstrap, true));
        assert!(!owner.gate.enabled());
        drop(pending);
        let allow = owner.begin(true).unwrap();
        let epoch = allow.0.epoch;
        let pending = owner.pending.lock().unwrap();
        assert!(owner.begin(false).is_none());
        assert!(!owner.gate.confirm(epoch, true));
        assert!(!owner.gate.enabled());
        drop(pending);
        drop(allow);
    }
    #[test]
    fn confirmed_absence_is_on_but_failed_readback_is_off() {
        assert!(Preferences::new(AppSettingReadback::Missing).gate.enabled());
        assert!(!Preferences::new(AppSettingReadback::Unavailable)
            .gate
            .enabled());
        assert!(
            !Preferences::new(AppSettingReadback::Value("unknown".into()))
                .gate
                .enabled()
        );
    }
    #[test]
    fn early_lookup_is_closed_but_bootstrap_readback_can_initialize_once() {
        let owner = Preferences::uninitialized();
        assert!(!owner.gate.enabled());
        assert!(owner.gate.fence().is_none());
        owner.initialize(AppSettingReadback::Missing);
        assert!(owner.gate.enabled());
        let pending = owner.begin(false).unwrap();
        owner.initialize(AppSettingReadback::Missing);
        assert!(!owner.gate.enabled());
        drop(pending);
        owner.initialize(AppSettingReadback::Missing);
        assert!(!owner.gate.enabled());
        let owner = Preferences::uninitialized();
        let pending = owner.begin(false).unwrap();
        owner.initialize(AppSettingReadback::Missing);
        assert!(!owner.gate.enabled());
        drop(pending);
        owner.initialize(AppSettingReadback::Missing);
        assert!(!owner.gate.enabled());
    }
    #[test]
    fn queue_admission_revokes_all_runs_and_dropped_queue_stays_closed() {
        let owner = Preferences::new(AppSettingReadback::Missing);
        let first = owner.gate.fence().unwrap();
        let second = owner.gate.fence().unwrap();
        let pending = owner.begin(false).unwrap();
        assert!(!owner.gate.enabled());
        assert!(owner.begin(true).is_none());
        assert!(!first.while_current(&mut || {}));
        assert!(!second.while_current(&mut || {}));
        let cloned = pending.clone();
        drop(pending);
        assert!(owner.begin(true).is_none());
        drop(cloned);
        assert!(!owner.gate.enabled());
        assert!(owner.begin(true).is_some());
    }
}

/// Separate standing screenshot origins. No account-entry authority.
#[cfg(feature = "work-runtime")]
pub mod sites;

#[cfg(feature = "work-runtime")]
pub(crate) mod consent;

#[cfg(feature = "work-execution")]
mod access;
#[cfg(feature = "work-execution")]
pub use access::{for_page, WorkScreenshotAccess};
