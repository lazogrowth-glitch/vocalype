//! Platform abstraction layer.
//!
//! OS-level integration: keyboard simulation, clipboard, audio feedback,
//! overlay window management, and Unix signal handling.
//!
//! - `input`:          Keyboard/mouse simulation via Enigo.
//! - `clipboard`:      Clipboard read/write + external script paste validation.
//! - `overlay`:        Recording overlay window events.
//! - `audio_feedback`: Start/stop sounds and volume control.
//! - `signal_handle`:  Unix signal handlers (SIGUSR1/SIGUSR2 for toggle).
//! - `utils`:          Shared helpers (overlay show/hide, cancel, wayland detection).
//!
//! ## Keyboard library stack
//!
//! Three keyboard-related crates are in the dependency tree. Their roles are
//! distinct and **must not be conflated**:
//!
//! | Crate | Alias | Role | Where used |
//! |-------|-------|------|------------|
//! | `enigo` | — | **Output only** — injects text / simulates paste keystrokes (Ctrl+V, Shift+Insert, direct text) into the focused app after transcription. | `platform/input.rs` |
//! | `handy-keys` | `native-shortcut-capture-backend` | **Input — shortcut capture** — registers global hotkeys and listens for key events during shortcut-rebinding UI. Used when `keyboard_implementation = NativeShortcutCapture`. | `shortcut/native_shortcut_capture.rs` |
//! | `tauri-plugin-global-shortcut` | — | **Input — shortcut capture (Tauri)** — registers global hotkeys via Tauri's built-in plugin. Default implementation (`keyboard_implementation = Tauri`). | `shortcut/tauri_impl.rs` |
//!
//! ### rdev — dead direct dependency
//!
//! `rdev` (rustdesk-org fork) is listed as a direct dependency in `Cargo.toml`
//! but is **not imported anywhere** in the source tree (`use rdev` returns zero
//! hits). It appears in `Cargo.lock` both as a direct and as a transitive
//! dependency of `handy-keys`. Before removing it, verify that `handy-keys`
//! does not require a specific version of rdev that conflicts with its own
//! transitive resolution — then drop the direct entry from `Cargo.toml`.

pub mod audio_feedback;
pub mod clipboard;
pub mod input;
pub mod overlay;
pub mod utils;

#[cfg(unix)]
pub mod signal_handle;
