//! Settings list of sites the agent may work on as the person.
use super::*;
use zephium_core::ids::ProfileId;
use zephium_core::work::WorkError;
use zephium_ipc::work::{WorkSiteAccessResponseV1, WorkSiteChangeV1, WorkSiteRowV1};

async fn sites(
    caller: WebviewWindow,
    app: tauri::AppHandle,
    expected_profile: String,
    change: Option<WorkSiteChangeV1>,
) -> WorkSiteAccessResponseV1 {
    let result = async {
        if !authorize(&caller, CallerPolicy::Main, "work_sites") {
            return Err(WorkError::Unavailable);
        }
        if shutdown_started(&app) {
            return Err(WorkError::Shutdown);
        }
        let profile = ProfileId::parse(&expected_profile)
            .filter(|id| id.to_string() == expected_profile)
            .ok_or(WorkError::Invalid)?;
        #[cfg(feature = "work-product")]
        {
            use zephium_app::work_sites::*;
            let shell = app.state::<zephium_app::Handle>();
            let entries = match change {
                Some(change) => set_standing(&shell, profile, change.site, change.access).await?,
                None => standing(&shell, profile).await?,
            };
            Ok(entries
                .into_iter()
                .map(|entry| WorkSiteRowV1 {
                    name: site_name(&entry.site),
                    sensitive: is_sensitive(&entry.site),
                    site: entry.site,
                    access: entry.access,
                })
                .collect())
        }
        #[cfg(not(feature = "work-product"))]
        {
            let _ = (profile, change);
            Err(WorkError::Unavailable)
        }
    }
    .await;
    let (sites, error) = match result {
        Ok(sites) => (sites, None),
        Err(error) => (Vec::new(), Some(error.into())),
    };
    WorkSiteAccessResponseV1 {
        version: 1,
        profile: expected_profile,
        sites,
        error,
    }
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn work_sites(
    caller: WebviewWindow,
    app: tauri::AppHandle,
    expected_profile: String,
) -> WorkSiteAccessResponseV1 {
    sites(caller, app, expected_profile, None).await
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn work_set_site(
    caller: WebviewWindow,
    app: tauri::AppHandle,
    expected_profile: String,
    change: WorkSiteChangeV1,
) -> WorkSiteAccessResponseV1 {
    sites(caller, app, expected_profile, Some(change)).await
}

async fn screenshot_sites(
    caller: WebviewWindow,
    app: tauri::AppHandle,
    expected_profile: String,
    change: Option<zephium_ipc::work::WorkScreenshotSiteChangeV1>,
) -> zephium_ipc::work::WorkScreenshotSitesResponseV1 {
    let result = async {
        if !authorize(&caller, CallerPolicy::Main, "work_screenshot_sites") {
            return Err(WorkError::Unavailable);
        }
        if shutdown_started(&app) {
            return Err(WorkError::Shutdown);
        }
        let profile = ProfileId::parse(&expected_profile)
            .filter(|id| id.to_string() == expected_profile)
            .ok_or(WorkError::Invalid)?;
        #[cfg(feature = "work-product")]
        {
            use zephium_app::work_screenshots::sites;
            let shell = app.state::<zephium_app::Handle>();
            let entries = match change {
                Some(change) => {
                    sites::set_standing(&shell, profile, change.origin, change.allow).await?
                }
                None => sites::standing(&shell, profile).await?,
            };
            Ok(entries
                .into_iter()
                .map(|entry| zephium_ipc::work::WorkScreenshotSiteRowV1 {
                    // Exact origin, including port, stays visible. Do not broaden a
                    // screenshot grant to the vendor's registrable domain label.
                    name: entry.origin.clone(),
                    origin: entry.origin,
                    unconfirmed: entry.unconfirmed,
                })
                .collect())
        }
        #[cfg(not(feature = "work-product"))]
        {
            let _ = (profile, change);
            Err(WorkError::Unavailable)
        }
    }
    .await;
    let (sites, error) = match result {
        Ok(sites) => (sites, None),
        Err(error) => (Vec::new(), Some(error.into())),
    };
    zephium_ipc::work::WorkScreenshotSitesResponseV1 {
        version: 1,
        profile: expected_profile,
        sites,
        error,
    }
}
#[tauri::command]
#[specta::specta]
pub(crate) async fn work_screenshot_sites(
    caller: WebviewWindow,
    app: tauri::AppHandle,
    expected_profile: String,
) -> zephium_ipc::work::WorkScreenshotSitesResponseV1 {
    screenshot_sites(caller, app, expected_profile, None).await
}
#[tauri::command]
#[specta::specta]
pub(crate) async fn work_set_screenshot_site(
    caller: WebviewWindow,
    app: tauri::AppHandle,
    expected_profile: String,
    change: zephium_ipc::work::WorkScreenshotSiteChangeV1,
) -> zephium_ipc::work::WorkScreenshotSitesResponseV1 {
    screenshot_sites(caller, app, expected_profile, Some(change)).await
}
