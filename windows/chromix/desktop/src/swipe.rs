//! A sideways swipe over the sidebar column as the trackpad itself reports it.
//! Native reads the fingers' phases and forwards only when they land, how far
//! they travel and when they lift, so the frame never has to guess a gesture's
//! edges from wheel timing.
use super::*;

#[derive(Clone, Copy, Debug, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum SwipePhase {
    /// Fingers landed: a new gesture, even in the middle of the last one's momentum.
    Began,
    Changed,
    /// Fingers lifted. What follows is momentum and is not sent.
    Lifted,
}

/// Fingers' travel since the last event, positive to the right and down, in
/// points; `time` is the event's own clock in milliseconds.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
#[tauri_specta(event_name = "zephium:swipe")]
#[allow(dead_code)]
pub(crate) struct SwipeScroll {
    pub(crate) phase: SwipePhase,
    pub(crate) dx: f64,
    pub(crate) dy: f64,
    pub(crate) time: f64,
}

/// The sidebar column in chrome points from the chrome's top-left corner.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, specta::Type)]
pub(crate) struct SwipeRegion {
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) width: f64,
    pub(crate) height: f64,
}

/// Where the sidebar column stands, or `null` when swipes should not be read.
/// Resolves whether the native stream is live; when it is not, the frame reads
/// the swipe from wheel events as before.
#[tauri::command]
#[specta::specta]
pub(crate) async fn swipe_region(caller: WebviewWindow, region: Option<SwipeRegion>) -> bool {
    if !authorize(&caller, CallerPolicy::Main, "swipe_region") {
        return false;
    }
    #[cfg(target_os = "macos")]
    {
        let region = region.map(|region| [region.x, region.y, region.width, region.height]);
        platform::imp::configure_swipe(&caller, region).await
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (caller, region);
        false
    }
}
