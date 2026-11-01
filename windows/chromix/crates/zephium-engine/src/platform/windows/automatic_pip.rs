//! Browser-owned video presentation; never evaluate privileged gestures in the page world.
use std::rc::Rc;
use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2;
use windows::core::HSTRING;
use wry::WebViewExtWindows;

pub(crate) fn automatic_pip(view: &wry::WebView, script: String, current: Rc<dyn Fn() -> bool>) {
    let core = view.webview();
    let next = core.clone();
    call(
        &core,
        "Page.getFrameTree",
        serde_json::json!({}),
        move |response| {
            if !current() {
                return;
            }
            let Some(frame) = response
                .as_ref()
                .and_then(|value| value.pointer("/frameTree/frame/id"))
                .and_then(|value| value.as_str())
            else {
                return;
            };
            let last = next.clone();
            call(
                &next,
                "Page.createIsolatedWorld",
                serde_json::json!({
                    "frameId": frame, "worldName": "zephium-automatic-video-pip",
                }),
                move |response| {
                    if !current() {
                        return;
                    }
                    let Some(context) = response
                        .as_ref()
                        .and_then(|value| value.get("executionContextId"))
                        .and_then(|value| value.as_i64())
                        .filter(|id| *id > 0)
                    else {
                        return;
                    };
                    call(
                        &last,
                        "Runtime.evaluate",
                        serde_json::json!({
                            "expression": script, "contextId": context,
                            "userGesture": true, "awaitPromise": true, "returnByValue": true,
                        }),
                        |_| {},
                    );
                },
            );
        },
    );
}

fn call(
    core: &ICoreWebView2,
    method: &str,
    parameters: serde_json::Value,
    done: impl FnOnce(Option<serde_json::Value>) + 'static,
) {
    let handler =
        CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |status, response| {
            done(
                status
                    .is_ok()
                    .then(|| serde_json::from_str(&response).ok())
                    .flatten(),
            );
            Ok(())
        }));
    // A failed or stale request simply leaves inline playback untouched.
    let _ = unsafe {
        core.CallDevToolsProtocolMethod(
            &HSTRING::from(method),
            &HSTRING::from(parameters.to_string()),
            &handler,
        )
    };
}
