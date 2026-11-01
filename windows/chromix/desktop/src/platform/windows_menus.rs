//! Owner-drawn rows in the existing HMENU. Windows still tracks and dispatches it.
use std::collections::HashMap;
use tauri::WebviewWindow;
use windows::core::PWSTR;
use windows::Win32::Foundation::*;
use windows::Win32::Graphics::Dwm::{
    DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
};
use windows::Win32::Graphics::Gdi::*;
use windows::Win32::UI::Accessibility::{SetWinEventHook, UnhookWinEvent, HWINEVENTHOOK};
use windows::Win32::UI::Controls::{
    DRAWITEMSTRUCT, MEASUREITEMSTRUCT, ODS_CHECKED, ODS_DISABLED, ODS_GRAYED, ODS_NOACCEL,
    ODS_SELECTED, ODT_MENU,
};
use windows::Win32::UI::HiDpi::{GetDpiForWindow, SystemParametersInfoForDpi};
use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::*;

const SUBCLASS: usize = 0x5a4d454e;
// The appearance of the menu being opened, for the popup's own border.
static MENU_DARK: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(true);
struct Row {
    text: Vec<u16>,
    kind: MENU_ITEM_TYPE,
    previous: usize,
    position: u32,
    /// The item's own picture, such as an extension's icon. Owned by the menu.
    bitmap: HBITMAP,
}
struct Menu {
    handle: HMENU,
    // HMENU retains each row address while the Vec may grow.
    #[allow(clippy::vec_box)]
    rows: Vec<Box<Row>>,
    brush: HBRUSH,
    old_brush: HBRUSH,
    font: HFONT,
    scale: f64,
    dark: bool,
}
struct State {
    window: WebviewWindow,
    menus: HashMap<isize, Menu>,
    popup_hook: HWINEVENTHOOK,
}
impl Drop for State {
    fn drop(&mut self) {
        if !self.popup_hook.0.is_null() {
            unsafe {
                let _ = UnhookWinEvent(self.popup_hook);
            }
        }
    }
}
// A process/thread-scoped notification gives the real system popup HWND, including submenus.
unsafe extern "system" fn popup_started(
    _: HWINEVENTHOOK,
    _: u32,
    hwnd: HWND,
    _: i32,
    _: i32,
    _: u32,
    _: u32,
) {
    let mut class = [0u16; 32];
    let length = GetClassNameW(hwnd, &mut class);
    if String::from_utf16_lossy(&class[..length.max(0) as usize]) != "#32768" {
        return;
    }
    let preference = DWMWCP_ROUND;
    // Windows 10 simply declines this optional Windows 11 decoration.
    let _ = DwmSetWindowAttribute(
        hwnd,
        DWMWA_WINDOW_CORNER_PREFERENCE,
        (&preference as *const windows::Win32::Graphics::Dwm::DWM_WINDOW_CORNER_PREFERENCE).cast(),
        size_of_val(&preference) as u32,
    );
    // A hairline in the menu's own key instead of the system accent border.
    let border = if MENU_DARK.load(std::sync::atomic::Ordering::Relaxed) {
        rgb(64, 64, 70)
    } else {
        rgb(212, 212, 218)
    };
    let _ = DwmSetWindowAttribute(
        hwnd,
        DWMWA_BORDER_COLOR,
        (&border as *const COLORREF).cast(),
        size_of_val(&border) as u32,
    );
}
impl Drop for Menu {
    fn drop(&mut self) {
        unsafe {
            if IsMenu(self.handle).as_bool() {
                for row in &self.rows {
                    let info = MENUITEMINFOW {
                        cbSize: size_of::<MENUITEMINFOW>() as u32,
                        fMask: MIIM_FTYPE | MIIM_DATA,
                        fType: row.kind,
                        dwItemData: row.previous,
                        ..Default::default()
                    };
                    let _ = SetMenuItemInfoW(self.handle, row.position, true, &info);
                }
                let info = MENUINFO {
                    cbSize: size_of::<MENUINFO>() as u32,
                    fMask: MIM_BACKGROUND,
                    hbrBack: self.old_brush,
                    ..Default::default()
                };
                let _ = SetMenuInfo(self.handle, &info);
            }
            let _ = DeleteObject(self.brush.into());
            let _ = DeleteObject(self.font.into());
        }
    }
}
fn rgb(r: u32, g: u32, b: u32) -> COLORREF {
    COLORREF(r | g << 8 | b << 16)
}
fn background(dark: bool) -> COLORREF {
    if dark {
        rgb(40, 40, 45)
    } else {
        rgb(249, 249, 251)
    }
}
pub fn install(window: &WebviewWindow) -> bool {
    let Ok(hwnd) = window.hwnd() else {
        return false;
    };
    let state = Box::new(State {
        window: window.clone(),
        menus: HashMap::new(),
        popup_hook: unsafe {
            SetWinEventHook(
                EVENT_SYSTEM_MENUPOPUPSTART,
                EVENT_SYSTEM_MENUPOPUPSTART,
                None,
                Some(popup_started),
                std::process::id(),
                GetWindowThreadProcessId(HWND(hwnd.0), None),
                WINEVENT_OUTOFCONTEXT,
            )
        },
    });
    let pointer = Box::into_raw(state);
    if unsafe { SetWindowSubclass(HWND(hwnd.0), Some(procedure), SUBCLASS, pointer as usize) }
        .as_bool()
    {
        true
    } else {
        unsafe {
            drop(Box::from_raw(pointer));
        }
        false
    }
}
pub(super) fn high_contrast() -> bool {
    // SAFETY: SPI_GETHIGHCONTRAST writes only the sized stack structure.
    unsafe {
        use windows::Win32::UI::Accessibility::{HCF_HIGHCONTRASTON, HIGHCONTRASTW};
        let mut contrast = HIGHCONTRASTW {
            cbSize: size_of::<HIGHCONTRASTW>() as u32,
            ..Default::default()
        };
        let _ = SystemParametersInfoW(
            SPI_GETHIGHCONTRAST,
            contrast.cbSize,
            Some((&mut contrast as *mut HIGHCONTRASTW).cast()),
            SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
        );
        contrast.dwFlags.contains(HCF_HIGHCONTRASTON)
    }
}
unsafe fn prepare(hwnd: HWND, handle: HMENU, dark: bool) -> Option<Menu> {
    if high_contrast() {
        return None;
    }
    let dpi = GetDpiForWindow(hwnd).max(96);
    let mut metrics = NONCLIENTMETRICSW {
        cbSize: size_of::<NONCLIENTMETRICSW>() as u32,
        ..Default::default()
    };
    if SystemParametersInfoForDpi(
        SPI_GETNONCLIENTMETRICS.0,
        metrics.cbSize,
        Some((&mut metrics as *mut NONCLIENTMETRICSW).cast()),
        0,
        dpi,
    )
    .is_err()
    {
        return None;
    }
    let font = CreateFontIndirectW(&metrics.lfMenuFont);
    if font.0.is_null() {
        return None;
    }
    let brush = CreateSolidBrush(background(dark));
    let mut info = MENUINFO {
        cbSize: size_of::<MENUINFO>() as u32,
        fMask: MIM_BACKGROUND,
        ..Default::default()
    };
    let _ = GetMenuInfo(handle, &mut info);
    let mut menu = Menu {
        handle,
        rows: Vec::new(),
        brush,
        old_brush: info.hbrBack,
        font,
        scale: dpi as f64 / 96.0,
        dark,
    };
    info.hbrBack = brush;
    let _ = SetMenuInfo(handle, &info);
    for position in 0..GetMenuItemCount(Some(handle)).max(0) as u32 {
        let mut text = vec![0u16; 2048];
        let mut item = MENUITEMINFOW {
            cbSize: size_of::<MENUITEMINFOW>() as u32,
            fMask: MIIM_FTYPE | MIIM_STRING | MIIM_DATA | MIIM_BITMAP,
            dwTypeData: PWSTR(text.as_mut_ptr()),
            cch: (text.len() - 1) as u32,
            ..Default::default()
        };
        if GetMenuItemInfoW(handle, position, true, &mut item).is_err()
            || item.fType.contains(MFT_OWNERDRAW)
        {
            continue;
        }
        text.truncate(item.cch as usize);
        // The predefined HBMMENU_* values are small integers, not bitmaps.
        let bitmap = if (item.hbmpItem.0 as isize) > 11 {
            item.hbmpItem
        } else {
            HBITMAP::default()
        };
        let mut row = Box::new(Row {
            text,
            kind: item.fType,
            previous: item.dwItemData,
            position,
            bitmap,
        });
        item.fMask = MIIM_FTYPE | MIIM_DATA;
        item.fType |= MFT_OWNERDRAW;
        item.dwItemData = (&mut *row as *mut Row) as usize;
        if SetMenuItemInfoW(handle, position, true, &item).is_ok() {
            menu.rows.push(row);
        }
    }
    Some(menu)
}
unsafe extern "system" fn procedure(
    hwnd: HWND,
    msg: u32,
    w: WPARAM,
    l: LPARAM,
    _: usize,
    data: usize,
) -> LRESULT {
    let state = data as *mut State;
    match msg {
        WM_INITMENUPOPUP if (l.0 as usize >> 16) == 0 => {
            let handle = HMENU(w.0 as *mut _);
            // The app's own appearance, which may differ from the system's.
            let dark = !crate::appearance_is_light(&(*state).window);
            MENU_DARK.store(dark, std::sync::atomic::Ordering::Relaxed);
            // Do not retain a map entry borrow across reentrant Win32 calls.
            #[allow(clippy::map_entry)]
            if !(*state).menus.contains_key(&(handle.0 as isize)) {
                if let Some(menu) = prepare(hwnd, handle, dark) {
                    (*state).menus.insert(handle.0 as isize, menu);
                }
            }
        }
        WM_MEASUREITEM if l.0 != 0 => {
            let measure = &mut *(l.0 as *mut MEASUREITEMSTRUCT);
            if measure.CtlType == ODT_MENU {
                for menu in (*state).menus.values() {
                    if let Some(row) = menu
                        .rows
                        .iter()
                        .find(|r| (&***r as *const Row) as usize == measure.itemData)
                    {
                        let dc = GetDC(Some(hwnd));
                        let old = SelectObject(dc, menu.font.into());
                        let tab = row.text.iter().position(|c| *c == 9);
                        let measure_text = |text: &[u16]| {
                            let mut bounds = RECT::default();
                            let mut text = text.to_vec();
                            draw_text(dc, &mut text, &mut bounds, DT_CALCRECT | DT_SINGLELINE);
                            bounds
                        };
                        let label = measure_text(&row.text[..tab.unwrap_or(row.text.len())]);
                        let hint = tab.map(|tab| measure_text(&row.text[tab + 1..]));
                        SelectObject(dc, old);
                        ReleaseDC(Some(hwnd), dc);
                        let pad = (menu.scale * 16.0).round() as u32;
                        measure.itemHeight = if row.kind.contains(MFT_SEPARATOR) {
                            (menu.scale * 9.0).round() as u32
                        } else {
                            ((label.bottom - label.top) as u32 + pad)
                                .max((menu.scale * 32.0).round() as u32)
                        };
                        // Label, then a clear gap, then the shortcut, so the
                        // two never run into each other.
                        let hint_width = hint.map_or(0, |hint| {
                            (hint.right - hint.left).max(0) as u32
                                + (menu.scale * 28.0).round() as u32
                        });
                        measure.itemWidth = (label.right - label.left).max(0) as u32
                            + hint_width
                            + (menu.scale * 64.0).round() as u32;
                        return LRESULT(1);
                    }
                }
            }
        }
        WM_DRAWITEM if l.0 != 0 => {
            let draw = &*(l.0 as *const DRAWITEMSTRUCT);
            if draw.CtlType == ODT_MENU {
                for menu in (*state).menus.values() {
                    if let Some(row) = menu
                        .rows
                        .iter()
                        .find(|r| (&***r as *const Row) as usize == draw.itemData)
                    {
                        paint(menu, row, draw);
                        return LRESULT(1);
                    }
                }
            }
        }
        WM_MENUCHAR => {
            if let Some(menu) = (*state).menus.get(&l.0) {
                let key = char::from_u32((w.0 & 0xffff) as u32)
                    .unwrap_or_default()
                    .to_lowercase()
                    .to_string();
                let matches: Vec<_> = menu
                    .rows
                    .iter()
                    .filter(|row| {
                        mnemonic(&row.text).as_deref() == Some(&key)
                            && GetMenuState(menu.handle, row.position, MF_BYPOSITION)
                                & (MF_DISABLED.0 | MF_GRAYED.0)
                                == 0
                    })
                    .collect();
                if !matches.is_empty() {
                    let highlighted = matches.iter().position(|row| {
                        GetMenuState(menu.handle, row.position, MF_BYPOSITION) & MF_HILITE.0 != 0
                    });
                    let row = matches[highlighted.map_or(0, |index| (index + 1) % matches.len())];
                    let action = if matches.len() == 1 {
                        MNC_EXECUTE
                    } else {
                        MNC_SELECT
                    };
                    return LRESULT((row.position | (action << 16)) as isize);
                }
            }
        }
        WM_UNINITMENUPOPUP => {
            (*state).menus.remove(&(w.0 as isize));
        }
        WM_NCDESTROY => {
            let _ = RemoveWindowSubclass(hwnd, Some(procedure), SUBCLASS);
            drop(Box::from_raw(data as *mut State));
            return DefSubclassProc(hwnd, msg, w, l);
        }
        _ => {}
    }
    DefSubclassProc(hwnd, msg, w, l)
}
/// USER32 can dereference the string before checking its count. An empty Rust
/// slice may have a dangling non-null pointer (0x2); never pass it to DrawTextW.
unsafe fn draw_text(dc: HDC, text: &mut [u16], bounds: &mut RECT, format: DRAW_TEXT_FORMAT) -> i32 {
    if text.is_empty() {
        return 0;
    }
    DrawTextW(dc, text, bounds, format)
}
unsafe fn paint(menu: &Menu, row: &Row, draw: &DRAWITEMSTRUCT) {
    let dc = draw.hDC;
    let saved = SaveDC(dc);
    FillRect(dc, &draw.rcItem, menu.brush);
    let px = |v: f64| (v * menu.scale).round() as i32;
    let mut rect = draw.rcItem;
    let selected = draw.itemState.0 & ODS_SELECTED.0 != 0;
    if selected && !row.kind.contains(MFT_SEPARATOR) {
        // A rounded plate inset from the menu's edge, as Windows 11 draws its own.
        let brush = CreateSolidBrush(if menu.dark {
            rgb(60, 60, 66)
        } else {
            rgb(230, 230, 235)
        });
        let radius = px(8.0);
        let old_brush = SelectObject(dc, brush.into());
        let old_pen = SelectObject(dc, GetStockObject(NULL_PEN));
        let _ = RoundRect(
            dc,
            rect.left + px(5.0),
            rect.top + px(2.0),
            rect.right - px(5.0) + 1,
            rect.bottom - px(2.0) + 1,
            radius,
            radius,
        );
        SelectObject(dc, old_pen);
        SelectObject(dc, old_brush);
        let _ = DeleteObject(brush.into());
    }
    if row.kind.contains(MFT_SEPARATOR) {
        rect = draw.rcItem;
        rect.left += px(12.0);
        rect.right -= px(12.0);
        rect.top = (rect.top + rect.bottom) / 2;
        rect.bottom = rect.top + 1;
        let brush = CreateSolidBrush(if menu.dark {
            rgb(65, 65, 70)
        } else {
            rgb(215, 215, 220)
        });
        FillRect(dc, &rect, brush);
        let _ = DeleteObject(brush.into());
    } else {
        SelectObject(dc, menu.font.into());
        SetBkMode(dc, TRANSPARENT);
        let disabled = draw.itemState.0 & (ODS_DISABLED.0 | ODS_GRAYED.0) != 0;
        SetTextColor(
            dc,
            match (disabled, menu.dark) {
                (true, true) => rgb(108, 108, 115),
                (true, false) => rgb(166, 166, 172),
                (false, true) => rgb(240, 240, 243),
                (false, false) => rgb(28, 28, 31),
            },
        );
        if !row.bitmap.0.is_null() {
            draw_bitmap(dc, row.bitmap, &draw.rcItem, px(16.0), px(10.0), disabled);
        }
        rect = draw.rcItem;
        rect.left += px(32.0);
        rect.right -= px(20.0);
        let tab = row.text.iter().position(|c| *c == 9);
        let mut label = row.text[..tab.unwrap_or(row.text.len())].to_vec();
        draw_text(
            dc,
            &mut label,
            &mut rect,
            DT_SINGLELINE
                | DT_VCENTER
                | DT_LEFT
                | if draw.itemState.0 & ODS_NOACCEL.0 != 0 {
                    DT_HIDEPREFIX
                } else {
                    DRAW_TEXT_FORMAT(0)
                },
        );
        if let Some(tab) = tab {
            // The shortcut is a caption on its row, a step quieter than the label.
            if !disabled {
                SetTextColor(
                    dc,
                    if menu.dark {
                        rgb(150, 150, 158)
                    } else {
                        rgb(118, 118, 126)
                    },
                );
            }
            let mut hint = row.text[tab + 1..].to_vec();
            draw_text(
                dc,
                &mut hint,
                &mut rect,
                DT_SINGLELINE | DT_VCENTER | DT_RIGHT | DT_NOPREFIX,
            );
        }
        // Windows draws the submenu arrow after this callback.
        if draw.itemState.0 & ODS_CHECKED.0 != 0 {
            let mut mark = vec![0x2713];
            rect = draw.rcItem;
            rect.left += px(10.0);
            rect.right = rect.left + px(18.0);
            draw_text(dc, &mut mark, &mut rect, DT_SINGLELINE | DT_VCENTER);
        }
    }
    let _ = RestoreDC(dc, saved);
}

/// Draws a 32-bit premultiplied bitmap, such as the one muda makes for an
/// icon item, square in the row's leading column.
unsafe fn draw_bitmap(dc: HDC, bitmap: HBITMAP, row: &RECT, size: i32, left: i32, faded: bool) {
    let mut info = BITMAP::default();
    if GetObjectW(
        bitmap.into(),
        size_of::<BITMAP>() as i32,
        Some((&mut info as *mut BITMAP).cast()),
    ) == 0
        || info.bmBitsPixel != 32
    {
        return;
    }
    let source = CreateCompatibleDC(Some(dc));
    if source.0.is_null() {
        return;
    }
    let old = SelectObject(source, bitmap.into());
    let top = row.top + (row.bottom - row.top - size) / 2;
    let _ = AlphaBlend(
        dc,
        row.left + left,
        top,
        size,
        size,
        source,
        0,
        0,
        info.bmWidth,
        info.bmHeight.abs(),
        BLENDFUNCTION {
            BlendOp: AC_SRC_OVER as u8,
            BlendFlags: 0,
            SourceConstantAlpha: if faded { 110 } else { 255 },
            AlphaFormat: AC_SRC_ALPHA as u8,
        },
    );
    SelectObject(source, old);
    let _ = DeleteDC(source);
}

fn mnemonic(text: &[u16]) -> Option<String> {
    let text = String::from_utf16_lossy(text);
    let mut chars = text.chars();
    while let Some(character) = chars.next() {
        if character == '&' {
            let next = chars.next()?;
            if next != '&' {
                return Some(next.to_lowercase().to_string());
            }
        }
    }
    None
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn empty_menu_labels_are_safe_during_measurement_and_paint() {
        unsafe {
            let dc = CreateCompatibleDC(None);
            assert!(!dc.0.is_null());
            let mut bounds = RECT::default();
            assert_eq!(
                draw_text(dc, &mut [], &mut bounds, DT_CALCRECT | DT_SINGLELINE),
                0
            );
            assert_eq!(
                draw_text(dc, &mut [], &mut bounds, DT_SINGLELINE | DT_VCENTER),
                0
            );
            let mut label: Vec<u16> = "Menu item".encode_utf16().collect();
            assert!(draw_text(dc, &mut label, &mut bounds, DT_CALCRECT | DT_SINGLELINE) > 0);
            assert!(bounds.right > bounds.left);
            assert!(DeleteDC(dc).as_bool());
        }
    }
    #[test]
    fn menu_mnemonics_preserve_literal_ampersands() {
        assert_eq!(
            mnemonic(&"Save && &Close".encode_utf16().collect::<Vec<_>>()),
            Some("c".into())
        );
        assert_eq!(
            mnemonic(&"Save && close".encode_utf16().collect::<Vec<_>>()),
            None
        );
    }
}
