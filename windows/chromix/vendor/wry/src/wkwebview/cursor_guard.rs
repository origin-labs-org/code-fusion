// Copyright 2020-2024 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

//! Only the web view under the pointer sets the cursor.
//!
//! A web content process sends its cursor whenever a rendering update changes
//! what lies under the last pointer position it saw, long after the pointer
//! has left for a view covering it. WebKit before macOS 27 applies that cursor
//! as long as the window is key and under the pointer (WebKit 313907@main
//! added the hit test there), so a covered or hidden web view fights the one
//! the pointer is over. This applies the same hit test: right before WebKit
//! sets a cursor it converts the screen pointer location through the asking
//! view, `WryWebView` notes that conversion, and `-[NSCursor set]` drops the
//! cursor when that view is not the one hit at the pointer. Every other
//! cursor change passes untouched.

use std::cell::RefCell;
use std::sync::OnceLock;

use objc2::rc::Weak;
use objc2::runtime::{Imp, Sel};
use objc2::{sel, ClassType};
use objc2_app_kit::{NSCursor, NSEvent, NSView};
use objc2_foundation::{MainThreadMarker, NSPoint};

use super::WryWebView;

type CursorSet = unsafe extern "C-unwind" fn(&NSCursor, Sel);

static ORIGINAL: OnceLock<Option<Imp>> = OnceLock::new();

struct Conversion {
  view: Weak<WryWebView>,
  point: NSPoint,
}

thread_local! {
  /// The last screen pointer location a web view converted, until the next
  /// conversion or cursor change.
  static CONVERSION: RefCell<Option<Conversion>> = const { RefCell::new(None) };
}

/// Installs the guard once, on the main thread.
pub(crate) fn install() {
  ORIGINAL.get_or_init(|| {
    let method = NSCursor::class().instance_method(sel!(set))?;
    let replacement: CursorSet = guarded_set;
    // SAFETY: the replacement has the exact signature of -[NSCursor set];
    // the IMP type erases only the arguments.
    let imp: Imp = unsafe { std::mem::transmute(replacement) };
    // SAFETY: AppKit keeps calling -set with the same signature; the original
    // implementation is kept and forwarded every cursor the guard admits.
    Some(unsafe { method.set_implementation(imp) })
  });
}

/// Called for every `convertPoint:fromView:nil` on a web view.
pub(crate) fn note_conversion(view: &WryWebView, point: NSPoint) {
  if MainThreadMarker::new().is_none() {
    return;
  }
  let conversion = (point == NSEvent::mouseLocation()).then(|| Conversion {
    view: Weak::new(view),
    point,
  });
  CONVERSION.with_borrow_mut(|slot| *slot = conversion);
}

unsafe extern "C-unwind" fn guarded_set(cursor: &NSCursor, command: Sel) {
  if !admits() {
    return;
  }
  let Some(original) = ORIGINAL.get().copied().flatten() else {
    return;
  };
  // SAFETY: `install` stored the original -[NSCursor set] IMP.
  let original: CursorSet = unsafe { std::mem::transmute(original) };
  // SAFETY: forwarded with the exact arguments AppKit passed in.
  unsafe { original(cursor, command) }
}

/// False only for a cursor WebKit asks for on behalf of a web view that is not
/// the view hit at the pointer.
fn admits() -> bool {
  if MainThreadMarker::new().is_none() {
    return true;
  }
  let Some(conversion) = CONVERSION.with_borrow_mut(Option::take) else {
    return true;
  };
  let pointer = NSEvent::mouseLocation();
  if conversion.point != pointer {
    return true;
  }
  let Some(view) = conversion.view.load() else {
    return true;
  };
  hit_at(&view, pointer)
}

/// The view, or one of its descendants, is what its window hits at
/// `pointer`; a view outside any window is not judged.
fn hit_at(view: &NSView, pointer: NSPoint) -> bool {
  let Some(window) = view.window() else {
    return true;
  };
  let Some(content) = window.contentView() else {
    return true;
  };
  let in_window = window.convertPointFromScreen(pointer);
  // SAFETY: main-thread read of the content view's parent for conversion.
  let probe = match unsafe { content.superview() } {
    Some(frame) => frame.convertPoint_fromView(in_window, None),
    None => in_window,
  };
  content
    .hitTest(probe)
    .is_some_and(|hit| hit.isDescendantOf(view))
}
