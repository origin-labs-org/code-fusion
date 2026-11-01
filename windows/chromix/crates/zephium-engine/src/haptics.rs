//! Trackpad feedback for gestures that commit. Rate limited, and a no-op
//! where the platform has none.

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Haptic {
    /// Snapping into a slot.
    Align,
    /// Crossing into a new state: a gesture committing.
    Level,
}

#[cfg(target_os = "macos")]
const MIN_GAP_MS: u64 = 45;

#[cfg(target_os = "macos")]
pub fn haptic(kind: Haptic) {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::OnceLock;
    use std::time::Instant;

    static START: OnceLock<Instant> = OnceLock::new();
    static LAST: AtomicU64 = AtomicU64::new(0);
    let now = START.get_or_init(Instant::now).elapsed().as_millis() as u64 + MIN_GAP_MS;
    let last = LAST.load(Ordering::Relaxed);
    if now.saturating_sub(last) < MIN_GAP_MS
        || LAST
            .compare_exchange(last, now, Ordering::Relaxed, Ordering::Relaxed)
            .is_err()
    {
        return;
    }
    if objc2_foundation::MainThreadMarker::new().is_some() {
        perform(kind);
    } else {
        dispatch2::DispatchQueue::main().exec_async(move || perform(kind));
    }
}

#[cfg(target_os = "macos")]
fn perform(kind: Haptic) {
    use objc2_app_kit::{
        NSHapticFeedbackManager, NSHapticFeedbackPattern, NSHapticFeedbackPerformanceTime,
        NSHapticFeedbackPerformer,
    };
    let pattern = match kind {
        Haptic::Align => NSHapticFeedbackPattern::Alignment,
        Haptic::Level => NSHapticFeedbackPattern::LevelChange,
    };
    NSHapticFeedbackManager::defaultPerformer()
        .performFeedbackPattern_performanceTime(pattern, NSHapticFeedbackPerformanceTime::Now);
}

#[cfg(not(target_os = "macos"))]
pub fn haptic(_kind: Haptic) {}
