//! Native check of pointer-inert pages: a page kept painted beneath another
//! view holds no tracking areas and is skipped by hit-testing through
//! everything WebKit and AppKit do to it, and gets them back when released.
#[cfg(target_os = "macos")]
fn main() {
    use objc2::rc::Retained;
    use objc2_app_kit::{
        NSApplication, NSApplicationActivationPolicy, NSBackingStoreType, NSEventMask,
        NSTrackingArea, NSTrackingAreaOptions, NSView, NSWindow, NSWindowOrderingMode,
        NSWindowStyleMask,
    };
    use objc2_foundation::{
        MainThreadMarker, NSDate, NSDefaultRunLoopMode, NSPoint, NSRect, NSSize,
    };
    use raw_window_handle::{
        AppKitWindowHandle, HandleError, HasWindowHandle, RawWindowHandle, WindowHandle,
    };
    use std::ptr::NonNull;
    use wry::{
        dpi::{LogicalPosition, LogicalSize},
        Rect, WebViewBuilder, WebViewExtMacOS,
    };

    struct Host(NonNull<std::ffi::c_void>);
    impl HasWindowHandle for Host {
        fn window_handle(&self) -> Result<WindowHandle<'_>, HandleError> {
            let handle = AppKitWindowHandle::new(self.0);
            // SAFETY: the content view outlives every use of this handle.
            Ok(unsafe { WindowHandle::borrow_raw(RawWindowHandle::AppKit(handle)) })
        }
    }

    let mtm = MainThreadMarker::new().expect("main thread");
    let app = NSApplication::sharedApplication(mtm);
    app.setActivationPolicy(NSApplicationActivationPolicy::Regular);
    app.finishLaunching();
    let pump = |secs: f64| {
        let until = NSDate::dateWithTimeIntervalSinceNow(secs);
        // SAFETY: plain event pump on the main thread.
        while let Some(event) = unsafe {
            app.nextEventMatchingMask_untilDate_inMode_dequeue(
                NSEventMask::Any,
                Some(&until),
                NSDefaultRunLoopMode,
                true,
            )
        } {
            app.sendEvent(&event);
            if until.timeIntervalSinceNow() <= 0.0 {
                break;
            }
        }
    };
    let window = unsafe {
        NSWindow::initWithContentRect_styleMask_backing_defer(
            mtm.alloc(),
            NSRect::new(NSPoint::new(200.0, 300.0), NSSize::new(600.0, 400.0)),
            NSWindowStyleMask::Titled | NSWindowStyleMask::Closable,
            NSBackingStoreType::Buffered,
            false,
        )
    };
    let content = window.contentView().expect("content view");
    let host = Host(NonNull::new(Retained::as_ptr(&content) as *mut _).expect("view"));
    let bounds = || Rect {
        position: LogicalPosition::new(0.0, 0.0).into(),
        size: LogicalSize::new(600.0, 400.0).into(),
    };
    let build = |html: &str| {
        WebViewBuilder::new()
            .with_html(html)
            .with_bounds(bounds())
            .build_as_child(&host)
            .expect("webview")
    };
    let agent = build("<body style='cursor:crosshair'>agent</body>");
    let canvas = build("<body style='cursor:grab'>canvas</body>");
    #[allow(deprecated)]
    app.activateIgnoringOtherApps(true);
    window.makeKeyAndOrderFront(None);
    pump(2.0);

    let page = agent.webview();
    let inside = NSPoint::new(100.0, 100.0);
    let areas = || page.trackingAreas().len();
    let live = areas();
    let mut failures = Vec::new();
    let mut check = |name: &str, ok: bool| {
        println!("{} {name}", if ok { "ok  " } else { "FAIL" });
        if !ok {
            failures.push(name.to_owned());
        }
    };
    check("page has tracking areas while live", live > 0);
    check("page is hit while live", page.hitTest(inside).is_some());

    page.set_pointer_inert(true);
    check("inert page holds no tracking areas", areas() == 0);
    check("inert page is not hit", page.hitTest(inside).is_none());
    check(
        "covering view is still hit",
        content.hitTest(inside).is_some(),
    );

    page.setHidden(true);
    pump(0.3);
    page.setHidden(false);
    pump(0.3);
    page.setFrameSize(NSSize::new(500.0, 300.0));
    pump(0.3);
    page.setFrameSize(NSSize::new(600.0, 400.0));
    // SAFETY: main-thread read of the page's own parent.
    let parent: Retained<NSView> = unsafe { page.superview() }.expect("parent");
    parent.addSubview_positioned_relativeTo(&page, NSWindowOrderingMode::Below, None);
    pump(0.3);
    window.makeKeyAndOrderFront(None);
    page.setHidden(true);
    page.setHidden(false);
    pump(0.5);
    check(
        "no tracking areas after hide, resize, reparent, rekey",
        areas() == 0,
    );
    check("still not hit afterwards", page.hitTest(inside).is_none());

    let stray = unsafe {
        NSTrackingArea::initWithRect_options_owner_userInfo(
            mtm.alloc(),
            NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(10.0, 10.0)),
            NSTrackingAreaOptions::MouseMoved | NSTrackingAreaOptions::ActiveAlways,
            Some(&page),
            None,
        )
    };
    page.addTrackingArea(&stray);
    check("an area added while inert is held out", areas() == 0);

    page.set_pointer_inert(false);
    check("released page has its areas back", areas() == live + 1);
    check("released page is hit again", page.hitTest(inside).is_some());
    page.removeTrackingArea(&stray);
    check("released page edits its areas normally", areas() == live);
    page.set_pointer_inert(false);
    check("releasing twice changes nothing", areas() == live);

    drop(canvas);
    window.close();
    if !failures.is_empty() {
        eprintln!("failed: {failures:?}");
        std::process::exit(1);
    }
}

#[cfg(not(target_os = "macos"))]
fn main() {}
