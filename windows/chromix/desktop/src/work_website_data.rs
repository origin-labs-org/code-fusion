//! Settings: Work's own website data, the cookies and storage of the sites
//! Work visited without the person's session.
use tauri::WebviewWindow;

/// Clears Work's website data for the profile. The profile's own browsing
/// data is untouched. True when Work's store is empty afterwards.
#[tauri::command]
#[specta::specta]
pub(crate) async fn work_clear_website_data(
    caller: WebviewWindow,
    app: tauri::AppHandle,
    expected_profile: String,
) -> bool {
    if !super::authorize(
        &caller,
        super::CallerPolicy::Main,
        "work_clear_website_data",
    ) || super::shutdown_started(&app)
    {
        return false;
    }
    let Some(profile) = zephium_core::ids::ProfileId::parse(&expected_profile)
        .filter(|id| id.to_string() == expected_profile)
    else {
        return false;
    };
    clear(&app, profile).await
}

#[cfg(all(
    feature = "work-product",
    any(target_os = "macos", target_os = "windows")
))]
async fn clear(app: &tauri::AppHandle, profile: zephium_core::ids::ProfileId) -> bool {
    use tauri::Manager;
    let Some(state) = app.try_state::<super::work_product::WorkProductState>() else {
        return false;
    };
    let answer = state.clear_website_data(profile);
    tokio::task::spawn_blocking(move || {
        answer
            .recv_timeout(std::time::Duration::from_secs(15))
            .unwrap_or(false)
    })
    .await
    .unwrap_or(false)
}

#[cfg(not(all(
    feature = "work-product",
    any(target_os = "macos", target_os = "windows")
)))]
async fn clear(_app: &tauri::AppHandle, _profile: zephium_core::ids::ProfileId) -> bool {
    false
}
