use crate::managers::audio::AudioRecordingManager;
use crate::managers::transcription::TranscriptionManager;
use crate::runtime::chunking::ActiveChunkingHandle;
use crate::shortcut;
use crate::TranscriptionCoordinator;
use log::{info, warn};
use std::sync::Arc;
use tauri::{AppHandle, Manager};

// Re-export all utility modules for easy access
// pub use crate::audio_feedback::*;
pub use crate::clipboard::*;
pub use crate::overlay::*;
pub use crate::tray::*;

/// Centralized cancellation function that can be called from anywhere in the app.
/// Handles cancelling both recording and transcription operations and updates UI state.
pub fn cancel_current_operation(app: &AppHandle) {
    info!("[cancel] step 1: start");

    crate::shortcut::handler::reset_cancel_confirmation();
    info!("[cancel] step 2: reset_cancel_confirmation done");

    shortcut::unregister_cancel_shortcut(app);
    shortcut::unregister_pause_shortcut(app);
    shortcut::unregister_action_shortcuts(app);
    info!("[cancel] step 3: shortcuts unregistered");

    if let Some(coordinator) = app.try_state::<TranscriptionCoordinator>() {
        info!("[cancel] step 4a: notifying coordinator");
        let _ = coordinator.notify_cancel(app, "cancel-operation");
        info!("[cancel] step 4b: coordinator notified");
    } else {
        warn!("[cancel] step 4: no TranscriptionCoordinator in state");
    }

    info!("[cancel] step 5: cancelling audio recording...");
    let audio_manager = app.state::<Arc<AudioRecordingManager>>();
    audio_manager.cancel_recording();
    info!("[cancel] step 6: audio recording cancelled");

    if let Some(handle_state) = app.try_state::<ActiveChunkingHandle>() {
        info!("[cancel] step 7a: found ActiveChunkingHandle, locking...");
        match handle_state.0.lock() {
            Ok(mut guard) => {
                if guard.is_some() {
                    info!("[cancel] step 7b: setting cancel_flag and dropping handle");
                    if let Some(ref handle) = *guard {
                        handle
                            .cancel_flag
                            .store(true, std::sync::atomic::Ordering::Relaxed);
                    }
                    let _ = guard.take();
                    info!("[cancel] step 7c: handle dropped");
                } else {
                    info!("[cancel] step 7b: handle already None (no active chunking)");
                }
            }
            Err(e) => {
                warn!("[cancel] step 7b: mutex poisoned: {}", e);
            }
        }
    } else {
        info!("[cancel] step 7: no ActiveChunkingHandle in state");
    }

    info!("[cancel] step 8: updating tray + hiding overlay...");
    change_tray_icon(app, crate::tray::TrayIconState::Idle);
    hide_recording_overlay(app);
    info!("[cancel] step 9: tray + overlay done");

    info!("[cancel] step 10: maybe_unload_immediately...");
    let tm = app.state::<Arc<TranscriptionManager>>();
    tm.maybe_unload_immediately("cancellation");
    info!("[cancel] step 11: DONE");
}

/// Check if using the Wayland display server protocol
#[cfg(target_os = "linux")]
pub fn is_wayland() -> bool {
    std::env::var("WAYLAND_DISPLAY").is_ok()
        || std::env::var("XDG_SESSION_TYPE")
            .map(|v| v.to_lowercase() == "wayland")
            .unwrap_or(false)
}

/// Check if running on KDE Plasma desktop environment
#[cfg(target_os = "linux")]
pub fn is_kde_plasma() -> bool {
    std::env::var("XDG_CURRENT_DESKTOP")
        .map(|v| v.to_uppercase().contains("KDE"))
        .unwrap_or(false)
        || std::env::var("KDE_SESSION_VERSION").is_ok()
}

/// Check if running on KDE Plasma with Wayland
#[cfg(target_os = "linux")]
pub fn is_kde_wayland() -> bool {
    is_wayland() && is_kde_plasma()
}
