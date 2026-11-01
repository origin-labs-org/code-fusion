//! Trackpad feedback for gestures that commit, played from the engine's one
//! rate-limited performer. A no-op where the platform has none.

use super::*;

#[derive(Clone, Copy, Debug, Deserialize, specta::Type, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum HapticKind {
    Align,
    Level,
}

#[tauri::command]
#[specta::specta]
pub(crate) fn haptic(caller: WebviewWindow, kind: HapticKind) {
    if !authorize(&caller, CallerPolicy::Main, "haptic") {
        return;
    }
    zephium_engine::haptic(match kind {
        HapticKind::Align => zephium_engine::Haptic::Align,
        HapticKind::Level => zephium_engine::Haptic::Level,
    });
}
