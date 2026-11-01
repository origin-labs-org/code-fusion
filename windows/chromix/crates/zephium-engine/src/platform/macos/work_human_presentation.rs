//! Exclusive native input owner, retained before exposing the agent page.
#![deny(unsafe_op_in_unsafe_fn, clippy::undocumented_unsafe_blocks)]
use objc2::rc::Retained;
use objc2_app_kit::{NSView, NSWindow, NSWindowOrderingMode};
use objc2_foundation::{MainThreadMarker, NSPoint, NSRect, NSSize};
use objc2_quartz_core::CACornerMask;
use objc2_web_kit::WKWebView;
use std::time::Instant;
use zephium_agentic::WorkBrowserHumanRegion;

use super::pointer_cover::PointerCover;

/// The takeover well's foot: `--radius-card` less the pane's 1px border
/// (`TakeoverPane.svelte`). Its head is square against the header above it.
const WELL_FOOT_RADIUS: f64 = 17.0;

pub(crate) struct WorkHumanPresentation {
    shape: Option<(f64, CACornerMask)>,
    page: Retained<WKWebView>,
    parent: Retained<NSView>,
    window: Retained<NSWindow>,
    original: NSRect,
    requested: WorkBrowserHumanRegion,
    region: NSRect,
    parent_geometry: HumanParentGeometry,
    deadline: Instant,
    presented: bool,
    retired: bool,
    cover: Option<PointerCover>,
}
impl WorkHumanPresentation {
    pub(crate) fn prepare(
        view: &wry::WebView,
        region: WorkBrowserHumanRegion,
        deadline: Instant,
    ) -> Option<Self> {
        MainThreadMarker::new()?;
        let page = super::native_webview(view);
        let window = page.window()?;
        // SAFETY: the view is retained on its owning AppKit thread.
        let parent = unsafe { page.superview() }?;
        if !page.isHidden()
            || !window.isVisible()
            || window.isMiniaturized()
            || Instant::now() >= deadline
        {
            return None;
        }
        let parent_geometry = HumanParentGeometry::capture(&parent);
        let requested = region;
        let region = parent_geometry.region(region)?;
        let original = page.frame();
        Some(Self {
            page,
            parent,
            window,
            original,
            requested,
            shape: None,
            region,
            parent_geometry,
            deadline,
            presented: false,
            retired: false,
            cover: None,
        })
    }
    pub(crate) fn present(&mut self) -> bool {
        if self.presented
            || self.retired
            || Instant::now() >= self.deadline
            || self.parent_geometry != HumanParentGeometry::capture(&self.parent)
        {
            return false;
        }
        self.parent
            .addSubview_positioned_relativeTo(&self.page, NSWindowOrderingMode::Above, None);
        self.page.setFrame(self.region);
        self.round_foot();
        super::passive_page::unregister(&self.page);
        self.page.setHidden(false);
        self.cover = PointerCover::attach(&self.page);
        self.presented = true;
        #[cfg(feature = "agentic-browser-qa")]
        record_cookie_facts(&self.page, "Presented");
        self.current()
    }
    /// The page is still the person's, in its window. A resized or minimized
    /// window does not end the hand-over: the person may be looking for a
    /// password elsewhere, and `refit` keeps the page in its well.
    pub(crate) fn current(&self) -> bool {
        self.presented && !self.retired && Instant::now() < self.deadline
            && !self.page.isHidden()
            && self.page.window().is_some_and(|window| std::ptr::eq(&*window, &*self.window))
            // SAFETY: retained native identities on the main thread.
            && unsafe { self.page.superview() }.is_some_and(|parent| std::ptr::eq(&*parent, &*self.parent))
    }
    /// Puts the page back over its well after the window changed size: the
    /// well keeps its place from the top left, moved in only as far as the
    /// smaller window needs.
    pub(crate) fn refit(&mut self) {
        if !self.presented || self.retired {
            return;
        }
        let geometry = HumanParentGeometry::capture(&self.parent);
        if geometry != self.parent_geometry {
            let Some(region) = geometry.fit(self.requested) else {
                return;
            };
            self.parent_geometry = geometry;
            self.region = region;
        }
        if self.page.frame() != self.region {
            self.page.setFrame(self.region);
        }
        if let Some(cover) = &self.cover {
            cover.sync();
        }
    }
    pub(crate) fn visible_for_audit(&self) -> bool {
        !self.page.isHidden()
    }
    #[cfg(all(
        feature = "agentic-browser-qa",
        feature = "native-agentic-semantic-probe"
    ))]
    pub(crate) fn qualify_geometry_invalidation(&self) -> bool {
        if !self.current() {
            return false;
        }
        let bounds = self.parent.bounds();
        let mut resized = bounds;
        resized.size.width += 1.0;
        self.parent.setBounds(resized);
        let kept_resize = self.current();
        let mut shifted = bounds;
        shifted.origin.y += 1.0;
        self.parent.setBounds(shifted);
        let kept_shift = self.current();
        self.parent.setBounds(bounds);
        kept_resize && kept_shift && self.current()
    }
    /// The page sits in a pane whose foot is rounded, so its own corners
    /// follow: square under the header, the pane's radius at the bottom.
    fn round_foot(&mut self) {
        let Some(layer) = self.page.layer() else {
            return;
        };
        if self.shape.is_none() {
            self.shape = Some((layer.cornerRadius(), layer.maskedCorners()));
        }
        layer.setCornerRadius(WELL_FOOT_RADIUS);
        layer.setMaskedCorners(
            CACornerMask::LayerMinXMinYCorner | CACornerMask::LayerMaxXMinYCorner,
        );
    }
    fn restore_shape(&mut self) {
        if let (Some((radius, corners)), Some(layer)) = (self.shape.take(), self.page.layer()) {
            layer.setCornerRadius(radius);
            layer.setMaskedCorners(corners);
        }
    }
    pub(crate) fn retire(&mut self) -> bool {
        if self.retired {
            return self.page.isHidden();
        }
        #[cfg(feature = "agentic-browser-qa")]
        if self.presented {
            use std::io::Write;
            let _ = writeln!(
                std::io::stderr(),
                "agent_view human_retire expired={} window_visible={} minimized={} page_hidden={} page_geometry={} parent_geometry={} current={}",
                Instant::now() >= self.deadline,
                self.window.isVisible(),
                self.window.isMiniaturized(),
                self.page.isHidden(),
                self.page.frame() == self.region,
                self.parent_geometry == HumanParentGeometry::capture(&self.parent),
                self.current()
            );
            record_cookie_facts(&self.page, "Retiring");
        }
        // Before the page parks its own tracking areas, ours among them.
        self.cover = None;
        let fenced = super::passive_page::register(&self.page);
        self.page.setHidden(true);
        let owns_responder = self.window.firstResponder().is_some_and(|responder| {
            responder.downcast_ref::<NSView>().is_some_and(|view| {
                std::ptr::eq(view, &**self.page) || view.isDescendantOf(&self.page)
            })
        });
        let responder_released = !owns_responder || self.window.makeFirstResponder(None);
        self.page.setFrame(self.original);
        self.restore_shape();
        self.parent
            .addSubview_positioned_relativeTo(&self.page, NSWindowOrderingMode::Below, None);
        self.retired = fenced
            && responder_released
            && self.page.isHidden()
            && self.page.frame() == self.original;
        self.retired
    }
}

#[derive(Clone, Copy, PartialEq)]
struct HumanParentGeometry {
    bounds: NSRect,
    flipped: bool,
}
impl HumanParentGeometry {
    fn capture(parent: &NSView) -> Self {
        Self {
            bounds: parent.bounds(),
            flipped: parent.isFlipped(),
        }
    }
    fn region(self, region: WorkBrowserHumanRegion) -> Option<NSRect> {
        let bounds = self.bounds;
        let [x, y, width, height] = region.components().map(f64::from);
        if ![
            bounds.origin.x,
            bounds.origin.y,
            bounds.size.width,
            bounds.size.height,
        ]
        .into_iter()
        .all(f64::is_finite)
            || x + width > bounds.size.width
            || y + height > bounds.size.height
        {
            return None;
        }
        let y = if self.flipped {
            y
        } else {
            bounds.size.height - y - height
        };
        Some(NSRect::new(
            NSPoint::new(bounds.origin.x + x, bounds.origin.y + y),
            NSSize::new(width, height),
        ))
    }
    /// `region`, shrunk and moved in as far as these bounds need.
    fn fit(self, region: WorkBrowserHumanRegion) -> Option<NSRect> {
        let [x, y, width, height] = region.components();
        let (bounds_width, bounds_height) = (
            self.bounds.size.width.max(0.0).floor() as u32,
            self.bounds.size.height.max(0.0).floor() as u32,
        );
        let (width, height) = (width.min(bounds_width), height.min(bounds_height));
        let fitted = WorkBrowserHumanRegion::try_new(
            x.min(bounds_width - width),
            y.min(bounds_height - height),
            width,
            height,
        )?;
        self.region(fitted)
    }
}

impl Drop for WorkHumanPresentation {
    fn drop(&mut self) {
        self.retire();
        super::passive_page::unregister(&self.page);
    }
}

#[cfg(feature = "agentic-browser-qa")]
fn record_cookie_facts(page: &WKWebView, phase: &'static str) {
    use objc2_foundation::{NSArray, NSHTTPCookie};
    use std::{io::Write, ptr::NonNull};
    let callback = block2::RcBlock::new(move |values: NonNull<NSArray<NSHTTPCookie>>| {
        // SAFETY: WebKit owns the cookie array for the duration of its callback.
        let values = unsafe { values.as_ref() };
        let mut clearance = false;
        let mut bot_management = false;
        for cookie in values.iter().take(4096) {
            let name = cookie.name();
            clearance |= name.isEqualToString(objc2_foundation::ns_string!("cf_clearance"));
            bot_management |= name.isEqualToString(objc2_foundation::ns_string!("__cf_bm"));
        }
        let _ = writeln!(
            std::io::stderr(),
            "agent_view human_phase={phase} cookies={} clearance={clearance} bot_management={bot_management}",
            values.len()
        );
    });
    // SAFETY: the retained page is on the AppKit thread; WebKit copies the callback.
    unsafe {
        page.configuration()
            .websiteDataStore()
            .httpCookieStore()
            .getAllCookies(&callback);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn human_region_uses_parent_coordinates_and_rejects_invalid_bounds() {
        let region = WorkBrowserHumanRegion::try_new(20, 30, 600, 400).unwrap();
        let geometry = HumanParentGeometry {
            bounds: NSRect::new(NSPoint::new(7.0, 11.0), NSSize::new(800.0, 700.0)),
            flipped: true,
        };
        assert_eq!(
            geometry.region(region),
            Some(NSRect::new(
                NSPoint::new(27.0, 41.0),
                NSSize::new(600.0, 400.0)
            ))
        );
        assert_eq!(
            HumanParentGeometry {
                flipped: false,
                ..geometry
            }
            .region(region),
            Some(NSRect::new(
                NSPoint::new(27.0, 281.0),
                NSSize::new(600.0, 400.0)
            ))
        );
        for width in [619.0, 0.0, -1.0, f64::NAN, f64::INFINITY] {
            let changed = HumanParentGeometry {
                bounds: NSRect::new(geometry.bounds.origin, NSSize::new(width, 700.0)),
                ..geometry
            };
            assert!(changed.region(region).is_none());
        }
    }
}
