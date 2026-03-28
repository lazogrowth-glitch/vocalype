//! Reads text immediately before the cursor in the focused text field.
//!
//! Used by smart paste to adapt capitalization, spacing and punctuation
//! to fit naturally into whatever the user is already typing.
//!
//! Strategy (tried in order):
//!   1. Windows: IUIAutomation TextPattern2 — no side-effects, no keyboard events,
//!      works on all apps that implement UIA (Win32, WPF, Electron, most modern apps).
//!   2. Clipboard trick — Shift+Home → Ctrl+C → read → Right → restore.
//!      Cross-platform fallback; temporarily borrows the clipboard for ~30 ms.
//!   3. Empty fallback — context unknown, adaptation is skipped.
//!
//! ⚠️  Never call `capture()` when the app category is Code (terminals).
//!    The clipboard trick sends Ctrl+C, which is SIGINT in a running process.

use enigo::{Direction, Enigo, Key, Keyboard};
use log::debug;
use std::time::Duration;
use tauri::AppHandle;
use tauri_plugin_clipboard_manager::ClipboardExt;

/// Maximum characters to read before the cursor.
pub const MAX_CONTEXT_CHARS: usize = 80;

/// How long to wait for Ctrl+C to settle in the clipboard.
const COPY_SETTLE_MS: u64 = 25;

// ── Public types ─────────────────────────────────────────────────────────── //

/// Text context immediately before the cursor.
#[derive(Debug, Default, Clone)]
pub struct CursorContext {
    /// Characters immediately before the cursor (at most `MAX_CONTEXT_CHARS`).
    /// An empty string means the cursor is at the very start of the field / line.
    pub preceding_text: String,
    /// `false` when context could not be read — all adaptation is skipped.
    pub is_available: bool,
}

impl CursorContext {
    pub fn available(text: String) -> Self {
        Self {
            preceding_text: text,
            is_available: true,
        }
    }

    pub fn unavailable() -> Self {
        Self::default()
    }

    /// Last non-whitespace character before the cursor, if any.
    pub fn last_non_space_char(&self) -> Option<char> {
        self.preceding_text
            .chars()
            .rev()
            .find(|c| !c.is_whitespace())
    }

    /// True when the cursor is at a natural sentence start:
    /// empty field, or right after `.` / `!` / `?`.
    pub fn is_at_sentence_start(&self) -> bool {
        match self.last_non_space_char() {
            None => true,
            Some(c) => matches!(c, '.' | '!' | '?'),
        }
    }

    /// True when the cursor is clearly mid-sentence: after `,` / `;` / `:`.
    pub fn is_mid_sentence(&self) -> bool {
        matches!(
            self.last_non_space_char(),
            Some(',') | Some(';') | Some(':')
        )
    }

    /// True when the preceding text ends with whitespace (or is empty).
    /// Used to decide whether a leading space is needed before the pasted word.
    pub fn has_trailing_whitespace(&self) -> bool {
        self.preceding_text.is_empty()
            || self
                .preceding_text
                .chars()
                .last()
                .map(|c| c.is_whitespace())
                .unwrap_or(true)
    }
}

// ── Capture ──────────────────────────────────────────────────────────────── //

/// Capture text before the cursor using the best available method.
///
/// ⚠️  Do NOT call for Code/terminal contexts (see module-level note).
pub fn capture(enigo: &mut Enigo, app_handle: &AppHandle) -> CursorContext {
    // Windows: try UIAutomation first — no keyboard events, no clipboard touch.
    #[cfg(target_os = "windows")]
    if let Some(text) = try_uia(MAX_CONTEXT_CHARS) {
        debug!("[SmartPaste] UIAutomation: {:?}", &text);
        return CursorContext::available(text);
    }

    // All platforms: clipboard trick fallback.
    match clipboard_trick(enigo, app_handle) {
        Some(ctx) => {
            debug!("[SmartPaste] clipboard trick: {:?}", &ctx.preceding_text);
            ctx
        }
        None => {
            debug!("[SmartPaste] context unavailable");
            CursorContext::unavailable()
        }
    }
}

// ── Windows UIAutomation ─────────────────────────────────────────────────── //

/// Try to read preceding text via IUIAutomationTextPattern2.
/// Returns `None` if the focused element doesn't support the TextPattern interface.
#[cfg(target_os = "windows")]
fn try_uia(max_chars: usize) -> Option<String> {
    use windows::core::Interface;
    use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER};
    use windows::Win32::UI::Accessibility::{
        CUIAutomation, IUIAutomation, IUIAutomationTextPattern2, TextPatternRangeEndpoint_Start,
        TextUnit_Character, UIA_TextPattern2Id,
    };

    unsafe {
        let automation: IUIAutomation =
            CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).ok()?;
        let element = automation.GetFocusedElement().ok()?;
        let raw = element.GetCurrentPattern(UIA_TextPattern2Id).ok()?;
        let pattern: IUIAutomationTextPattern2 = raw.cast().ok()?;
        let mut is_active = windows::core::BOOL(0);
        let caret_range = pattern.GetCaretRange(&mut is_active).ok()?;
        let range = caret_range.Clone().ok()?;
        range
            .MoveEndpointByUnit(
                TextPatternRangeEndpoint_Start,
                TextUnit_Character,
                -(max_chars as i32),
            )
            .ok()?;
        let bstr = range.GetText(max_chars as i32).ok()?;
        Some(bstr.to_string())
    }
}

// ── Clipboard trick ──────────────────────────────────────────────────────── //

fn clipboard_trick(enigo: &mut Enigo, app_handle: &AppHandle) -> Option<CursorContext> {
    let clipboard = app_handle.clipboard();

    // Save the user's current clipboard so we can restore it afterward.
    let saved = clipboard.read_text().unwrap_or_default();

    // Write a sentinel so we can tell whether the copy actually wrote anything.
    let sentinel = "__vcy__";
    let _ = clipboard.write_text(sentinel);

    // ── Shift + Home — select from cursor back to start of current line ── //
    #[cfg(target_os = "windows")]
    let home_key = Key::Other(0x24); // VK_HOME
    #[cfg(target_os = "macos")]
    let home_key = Key::Other(0x73); // kVK_Home
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let home_key = Key::Other(0xFF50); // XK_Home

    let _ = enigo.key(Key::Shift, Direction::Press);
    let _ = enigo.key(home_key, Direction::Click);
    let _ = enigo.key(Key::Shift, Direction::Release);

    // ── Ctrl+C / Cmd+C — copy the selection ─────────────────────────── //
    #[cfg(target_os = "windows")]
    let (copy_mod, copy_key) = (Key::Control, Key::Other(0x43)); // VK_C
    #[cfg(target_os = "macos")]
    let (copy_mod, copy_key) = (Key::Meta, Key::Other(0x08)); // kVK_ANSI_C
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let (copy_mod, copy_key) = (Key::Control, Key::Unicode('c'));

    let _ = enigo.key(copy_mod, Direction::Press);
    let _ = enigo.key(copy_key, Direction::Click);
    let _ = enigo.key(copy_mod, Direction::Release);

    // Wait for the clipboard write to complete.
    std::thread::sleep(Duration::from_millis(COPY_SETTLE_MS));

    // Read what was copied.
    let selected = clipboard.read_text().unwrap_or_default();

    // ── Right arrow — collapse selection, cursor returns to original pos ─ //
    // After Shift+Home the selection end = original cursor position.
    // Pressing Right collapses the selection and moves there. ✓
    #[cfg(target_os = "windows")]
    let right_key = Key::Other(0x27); // VK_RIGHT
    #[cfg(target_os = "macos")]
    let right_key = Key::Other(0x7C); // kVK_RightArrow
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let right_key = Key::Other(0xFF53); // XK_Right

    let _ = enigo.key(right_key, Direction::Click);

    // Restore the user's original clipboard.
    let _ = clipboard.write_text(&saved);

    if selected == sentinel {
        // Copy produced nothing → cursor was already at line start.
        // That IS meaningful: preceding text on this line is empty → capitalize.
        return Some(CursorContext::available(String::new()));
    }

    // Keep only the last MAX_CONTEXT_CHARS characters.
    let chars: Vec<char> = selected.chars().collect();
    let start = chars.len().saturating_sub(MAX_CONTEXT_CHARS);
    let text: String = chars[start..].iter().collect();
    Some(CursorContext::available(text))
}
