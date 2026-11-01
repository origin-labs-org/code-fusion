//! QA only: visits sites in a durable profile's own website data, as a
//! person browsing normally would, so a probe profile holds the cookies a
//! real profile does. Pages load off screen; nothing is read from them.
use std::cell::RefCell;

use objc2::rc::Retained;
use objc2::MainThreadOnly;
use objc2_foundation::{
    MainThreadMarker, NSPoint, NSRect, NSSize, NSString, NSURLRequest, NSURL, NSUUID,
};
use objc2_web_kit::{WKWebView, WKWebViewConfiguration, WKWebsiteDataStore};
use zephium_core::ids::ProfileId;

thread_local! {
    static VISITS: RefCell<Vec<Retained<WKWebView>>> = const { RefCell::new(Vec::new()) };
}

/// Starts loading each address in the profile's own store; how many started.
pub(crate) fn start(profile: ProfileId, urls: Vec<String>) -> usize {
    let Some(mtm) = MainThreadMarker::new() else {
        return 0;
    };
    let identifier = NSUUID::from_bytes(profile.bytes());
    // SAFETY: main thread (`mtm`); every retained object outlives its calls.
    let store = unsafe { WKWebsiteDataStore::dataStoreForIdentifier(&identifier, mtm) };
    // SAFETY: as above.
    if !unsafe { store.isPersistent() } {
        return 0;
    }
    let mut started = 0;
    for url in urls {
        let Some(address) = NSURL::URLWithString(&NSString::from_str(&url)) else {
            continue;
        };
        // SAFETY: main thread; the configuration and store stay live while
        // the view is built, and the view owns its configuration copy.
        let view = unsafe {
            let configuration = WKWebViewConfiguration::new(mtm);
            configuration.setApplicationNameForUserAgent(Some(&NSString::from_str(
                zephium_webext_macos::application_name(),
            )));
            configuration.setWebsiteDataStore(&store);
            let frame = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(1280.0, 900.0));
            let view = WKWebView::initWithFrame_configuration(
                WKWebView::alloc(mtm),
                frame,
                &configuration,
            );
            view.loadRequest(&NSURLRequest::requestWithURL(&address));
            view
        };
        VISITS.with(|visits| visits.borrow_mut().push(view));
        started += 1;
    }
    started
}

/// Stops and releases every visiting page.
pub(crate) fn finish() {
    let views = VISITS.with(|visits| std::mem::take(&mut *visits.borrow_mut()));
    for view in views {
        // SAFETY: called on the main thread that created the view.
        unsafe { view.stopLoading() };
    }
}
