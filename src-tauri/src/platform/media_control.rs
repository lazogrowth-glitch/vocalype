//! Auto-pause media during recording.
//!
//! When `auto_pause_media` is enabled in settings, media players are paused
//! when recording starts and resumed when recording ends.
//!
//! ## Platform implementations
//! - **macOS**: AppleScript to pause/resume Spotify and Apple Music.
//! - **Windows**: Virtual media key (VK_MEDIA_PLAY_PAUSE) via PowerShell.
//! - **Linux**: `playerctl` to pause/resume all MPRIS-compatible players.
//!
//! The module tracks which apps were actually playing at pause time so we only
//! resume those that we interrupted — apps that were already stopped are left alone.

use log::debug;
use std::process::Command;
use std::sync::Mutex;

/// Apps that were paused by this module and should be resumed on stop.
static PAUSED_APPS: Mutex<Vec<PausedApp>> = Mutex::new(Vec::new());

#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Eq)]
enum PausedApp {
    Spotify,
    AppleMusic,
    Playerctl,      // Linux: generic MPRIS
    SystemMediaKey, // Windows: toggle-based, no tracking
}

/// Pause all playing media players. Call this when recording starts.
pub fn pause_media() {
    let mut paused = PAUSED_APPS.lock().unwrap_or_else(|e| e.into_inner());
    paused.clear();

    #[cfg(target_os = "macos")]
    {
        if pause_spotify_macos() {
            paused.push(PausedApp::Spotify);
        }
        if pause_apple_music_macos() {
            paused.push(PausedApp::AppleMusic);
        }
    }

    #[cfg(target_os = "windows")]
    {
        // Windows uses a media toggle key — no precise tracking of which app was playing.
        if send_media_key_windows() {
            paused.push(PausedApp::SystemMediaKey);
        }
    }

    #[cfg(target_os = "linux")]
    {
        if pause_playerctl_linux() {
            paused.push(PausedApp::Playerctl);
        }
    }

    debug!("media_control: paused {:?}", *paused);
}

/// Resume media players that were paused by `pause_media`. Call this when recording ends.
pub fn resume_media() {
    let mut paused = PAUSED_APPS.lock().unwrap_or_else(|e| e.into_inner());
    if paused.is_empty() {
        return;
    }

    debug!("media_control: resuming {:?}", *paused);

    for app in paused.drain(..) {
        match app {
            #[cfg(target_os = "macos")]
            PausedApp::Spotify => {
                resume_spotify_macos();
            }
            #[cfg(target_os = "macos")]
            PausedApp::AppleMusic => {
                resume_apple_music_macos();
            }
            #[cfg(target_os = "windows")]
            PausedApp::SystemMediaKey => {
                let _ = send_media_key_windows();
            }
            #[cfg(target_os = "linux")]
            PausedApp::Playerctl => {
                resume_playerctl_linux();
            }
            // Silence unused variant warnings on other platforms.
            #[allow(unreachable_patterns)]
            _ => {}
        }
    }
}

// ── macOS ────────────────────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
fn pause_spotify_macos() -> bool {
    let result = Command::new("osascript")
        .args([
            "-e",
            r#"tell application "Spotify"
                if it is running then
                    if player state is playing then
                        pause
                        return "yes"
                    end if
                end if
                return "no"
            end tell"#,
        ])
        .output();
    matches!(result, Ok(o) if String::from_utf8_lossy(&o.stdout).trim() == "yes")
}

#[cfg(target_os = "macos")]
fn resume_spotify_macos() {
    let _ = Command::new("osascript")
        .args([
            "-e",
            r#"tell application "Spotify"
                if it is running then play
            end tell"#,
        ])
        .output();
}

#[cfg(target_os = "macos")]
fn pause_apple_music_macos() -> bool {
    let result = Command::new("osascript")
        .args([
            "-e",
            r#"tell application "Music"
                if it is running then
                    if player state is playing then
                        pause
                        return "yes"
                    end if
                end if
                return "no"
            end tell"#,
        ])
        .output();
    matches!(result, Ok(o) if String::from_utf8_lossy(&o.stdout).trim() == "yes")
}

#[cfg(target_os = "macos")]
fn resume_apple_music_macos() {
    let _ = Command::new("osascript")
        .args([
            "-e",
            r#"tell application "Music"
                if it is running then play
            end tell"#,
        ])
        .output();
}

// ── Windows ──────────────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
fn send_media_key_windows() -> bool {
    // VK_MEDIA_PLAY_PAUSE = 0xB3
    let result = Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            r#"
$wsh = New-Object -ComObject WScript.Shell
$wsh.SendKeys([char]0xB3)
"#,
        ])
        .output();
    result.is_ok()
}

// ── Linux ────────────────────────────────────────────────────────────────────

#[cfg(target_os = "linux")]
fn pause_playerctl_linux() -> bool {
    // Check if something is playing first
    let status = Command::new("playerctl").args(["status"]).output();

    let playing = status
        .as_ref()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim() == "Playing")
        .unwrap_or(false);

    if playing {
        let _ = Command::new("playerctl").args(["pause"]).output();
    }
    playing
}

#[cfg(target_os = "linux")]
fn resume_playerctl_linux() {
    let _ = Command::new("playerctl").args(["play"]).output();
}
