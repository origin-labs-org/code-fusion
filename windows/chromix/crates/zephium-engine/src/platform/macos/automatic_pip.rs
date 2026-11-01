//! Native video PiP in a dedicated content world, scoped to an ordinary tab.
use objc2::runtime::AnyObject;
use objc2_foundation::{MainThreadMarker, NSError, NSString};
use objc2_web_kit::WKContentWorld;
use std::rc::Rc;

pub(crate) fn automatic_pip(view: &wry::WebView, script: String, current: Rc<dyn Fn() -> bool>) {
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    if !current() {
        return;
    }
    let page = super::native_webview(view);
    let done = block2::RcBlock::new(|_: *mut AnyObject, _: *mut NSError| {});
    unsafe {
        let world =
            WKContentWorld::worldWithName(&NSString::from_str("zephium-automatic-video-pip"), mtm);
        page.evaluateJavaScript_inFrame_inContentWorld_completionHandler(
            &NSString::from_str(&script),
            None,
            &world,
            Some(&done),
        );
    }
}
