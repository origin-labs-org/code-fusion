//! The trackpad's own account of a sideways swipe over the sidebar column.
//! A local scroll monitor reads the phases the DOM never sees and forwards
//! only what a swipe needs: when the fingers land, where they travel and when
//! they lift. Momentum belongs to the gesture that made it and is not sent, so
//! fingers landing mid-momentum begin a new gesture at once.
use std::cell::RefCell;
use std::ptr::NonNull;

use objc2::rc::{Retained, Weak};
use objc2::runtime::AnyObject;
use objc2_app_kit::{NSEvent, NSEventMask, NSEventPhase};
use objc2_foundation::{MainThreadMarker, NSString};
use objc2_web_kit::WKWebView;

use crate::swipe::{SwipePhase, SwipeScroll};

/// Travel before the gesture's axis is judged, and how much more sideways
/// than vertical it must then be; the same judgment the frame makes.
const PROBE: f64 = 6.0;
const DOMINANCE: f64 = 2.0;

#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct Region {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Region {
    fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x && x < self.x + self.width && y >= self.y && y < self.y + self.height
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Stance {
    Idle,
    Probing { sx: f64, sy: f64 },
    Forwarding,
    Declined,
}

/// What the fingers just did, as the monitor reads it.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Touch {
    began: bool,
    ended: bool,
    dx: f64,
    dy: f64,
    inside: bool,
}

/// Advances the stance by one scroll event and says what to forward.
fn step(stance: Stance, touch: Touch) -> (Stance, Option<SwipePhase>) {
    let mut stance = stance;
    let mut forward = None;
    if touch.began {
        let landed = matches!(stance, Stance::Probing { sx, sy } if sx == 0.0 && sy == 0.0);
        if !landed {
            stance = if touch.inside {
                Stance::Probing { sx: 0.0, sy: 0.0 }
            } else {
                Stance::Declined
            };
            if touch.inside {
                forward = Some(SwipePhase::Began);
            }
        }
    }
    match stance {
        Stance::Probing { sx, sy } if touch.dx != 0.0 || touch.dy != 0.0 => {
            let (sx, sy) = (sx + touch.dx, sy + touch.dy);
            stance = if sx.abs() + sy.abs() < PROBE {
                Stance::Probing { sx, sy }
            } else if sx.abs() >= DOMINANCE * sy.abs() {
                Stance::Forwarding
            } else {
                Stance::Declined
            };
            if stance != Stance::Declined {
                forward = Some(if touch.began && forward.is_some() {
                    SwipePhase::Began
                } else {
                    SwipePhase::Changed
                });
            }
        }
        Stance::Forwarding if touch.dx != 0.0 || touch.dy != 0.0 => {
            forward = Some(SwipePhase::Changed)
        }
        _ => {}
    }
    if touch.ended {
        if matches!(stance, Stance::Probing { .. } | Stance::Forwarding) {
            forward = Some(SwipePhase::Lifted);
        }
        stance = Stance::Idle;
    }
    (stance, forward)
}

struct Live {
    monitor: Retained<AnyObject>,
    chrome: Weak<WKWebView>,
    generation: u64,
    region: Region,
    stance: Stance,
}

thread_local! {
    static LIVE: RefCell<Option<Live>> = const { RefCell::new(None) };
}

fn observe(event: &NSEvent) {
    if !event.hasPreciseScrollingDeltas() || !event.momentumPhase().is_empty() {
        return;
    }
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    let phase = event.phase();
    let script = LIVE.with(|live| {
        let mut live = live.try_borrow_mut().ok()?;
        let live = live.as_mut()?;
        let chrome = live.chrome.load()?;
        let window = chrome.window()?;
        if !event
            .window(mtm)
            .is_some_and(|w| std::ptr::eq(&*w, &*window))
        {
            return None;
        }
        let at = chrome.convertPoint_fromView(event.locationInWindow(), None);
        let y = if chrome.isFlipped() {
            at.y
        } else {
            chrome.bounds().size.height - at.y
        };
        let fingers = if event.isDirectionInvertedFromDevice() {
            1.0
        } else {
            -1.0
        };
        let touch = Touch {
            began: phase.intersects(NSEventPhase::Began | NSEventPhase::MayBegin),
            ended: phase.intersects(NSEventPhase::Ended | NSEventPhase::Cancelled),
            dx: event.scrollingDeltaX() * fingers,
            dy: event.scrollingDeltaY(),
            inside: live.region.contains(at.x, y),
        };
        let (stance, forward) = step(live.stance, touch);
        live.stance = stance;
        let forward = forward?;
        let detail = SwipeScroll {
            phase: forward,
            dx: touch.dx,
            dy: touch.dy,
            time: event.timestamp() * 1000.0,
        };
        let detail = serde_json::to_string(&detail).ok()?;
        Some((
            chrome,
            format!("window.dispatchEvent(new CustomEvent('zephium:swipe',{{detail:{detail}}}))"),
        ))
    });
    if let Some((chrome, script)) = script {
        // SAFETY: main-thread evaluation in the chrome view that owns the region.
        unsafe { chrome.evaluateJavaScript_completionHandler(&NSString::from_str(&script), None) };
    }
}

/// Starts reading swipes over `region` of this chrome, or stops when it is
/// `None`. Returns whether the native stream is live.
pub(super) fn configure(
    chrome: &Retained<WKWebView>,
    generation: u64,
    region: Option<Region>,
) -> bool {
    let region = region.filter(|region| {
        [region.x, region.y, region.width, region.height]
            .iter()
            .all(|value| value.is_finite())
            && region.width > 0.0
            && region.height > 0.0
    });
    let Some(region) = region else {
        dispose(None);
        return false;
    };
    let updated = LIVE.with(|live| {
        let mut live = live.try_borrow_mut().ok()?;
        let live = live.as_mut().filter(|live| live.generation == generation)?;
        live.region = region;
        Some(())
    });
    if updated.is_some() {
        return true;
    }
    dispose(None);
    let handler = block2::RcBlock::new(move |event: NonNull<NSEvent>| -> *mut NSEvent {
        // SAFETY: the local monitor lends its event throughout this callback.
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            observe(unsafe { event.as_ref() })
        }));
        event.as_ptr()
    });
    // SAFETY: an app-local main-thread monitor; it never consumes an event.
    let Some(monitor) = (unsafe {
        NSEvent::addLocalMonitorForEventsMatchingMask_handler(NSEventMask::ScrollWheel, &handler)
    }) else {
        return false;
    };
    LIVE.with(|live| {
        *live.borrow_mut() = Some(Live {
            monitor,
            chrome: Weak::from_retained(chrome),
            generation,
            region,
            stance: Stance::Idle,
        });
    });
    true
}

/// Stops the monitor, for this chrome generation only when one is named.
pub(super) fn dispose(generation: Option<u64>) {
    let old = LIVE.with(|live| {
        let mut live = live.try_borrow_mut().ok()?;
        if generation.is_some_and(|generation| {
            live.as_ref()
                .is_some_and(|live| live.generation != generation)
        }) {
            return None;
        }
        live.take()
    });
    if let Some(old) = old {
        // SAFETY: this exact main-thread registration is removed once.
        unsafe { NSEvent::removeMonitor(&old.monitor) };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DOWN: Touch = Touch {
        began: true,
        ended: false,
        dx: 0.0,
        dy: 0.0,
        inside: true,
    };
    const UP: Touch = Touch {
        began: false,
        ended: true,
        dx: 0.0,
        dy: 0.0,
        inside: true,
    };
    fn drag(dx: f64, dy: f64) -> Touch {
        Touch {
            began: false,
            ended: false,
            dx,
            dy,
            inside: true,
        }
    }

    #[test]
    fn a_sideways_swipe_is_forwarded_from_landing_to_lifting() {
        let (stance, sent) = step(Stance::Idle, DOWN);
        assert_eq!(sent, Some(SwipePhase::Began));
        let (stance, sent) = step(stance, drag(4.0, 0.0));
        assert_eq!(sent, Some(SwipePhase::Changed));
        let (stance, sent) = step(stance, drag(4.0, 1.0));
        assert_eq!(
            (stance, sent),
            (Stance::Forwarding, Some(SwipePhase::Changed))
        );
        let (stance, sent) = step(stance, drag(9.0, 0.0));
        assert_eq!(sent, Some(SwipePhase::Changed));
        assert_eq!(step(stance, UP), (Stance::Idle, Some(SwipePhase::Lifted)));
    }

    #[test]
    fn a_vertical_scroll_is_judged_once_and_then_stays_quiet() {
        let (stance, _) = step(Stance::Idle, DOWN);
        let (stance, sent) = step(stance, drag(1.0, 8.0));
        assert_eq!((stance, sent), (Stance::Declined, None));
        assert_eq!(step(stance, drag(0.0, 12.0)), (Stance::Declined, None));
        assert_eq!(step(stance, UP), (Stance::Idle, None));
    }

    #[test]
    fn fingers_landing_mid_gesture_begin_a_new_one() {
        let (stance, _) = step(Stance::Idle, DOWN);
        let (stance, _) = step(stance, drag(20.0, 0.0));
        assert_eq!(stance, Stance::Forwarding);
        let (stance, sent) = step(stance, DOWN);
        assert_eq!(
            (stance, sent),
            (
                Stance::Probing { sx: 0.0, sy: 0.0 },
                Some(SwipePhase::Began)
            )
        );
    }

    #[test]
    fn a_touch_before_the_scroll_begins_is_not_a_second_landing() {
        let (stance, sent) = step(Stance::Idle, DOWN);
        assert_eq!(sent, Some(SwipePhase::Began));
        assert_eq!(step(stance, DOWN), (stance, None));
    }

    #[test]
    fn a_gesture_that_lands_outside_the_region_is_never_forwarded() {
        let outside = Touch {
            inside: false,
            ..DOWN
        };
        let (stance, sent) = step(Stance::Idle, outside);
        assert_eq!((stance, sent), (Stance::Declined, None));
        assert_eq!(step(stance, drag(30.0, 0.0)), (Stance::Declined, None));
    }

    #[test]
    fn a_swipe_cancelled_before_it_is_judged_still_lifts() {
        let (stance, _) = step(Stance::Idle, DOWN);
        assert_eq!(step(stance, UP), (Stance::Idle, Some(SwipePhase::Lifted)));
    }
}
