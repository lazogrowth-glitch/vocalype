//! Tray icon, menu, and i18n for the system tray.
//!
//! ## Tray i18n
//!
//! Menu strings are auto-generated at compile time by `build.rs` from the
//! frontend locale files (`src/i18n/locales/*/translation.json`).
//!
//! The English `translation.json` is the single source of truth:
//! - `TrayStrings` struct fields are derived from the English `"tray"` keys.
//! - All languages are auto-discovered from the locales directory.
//!
//! To add a new tray menu item:
//! 1. Add the key to `en/translation.json` under `"tray"`.
//! 2. Add translations to the other locale files.
//! 3. Use the new field in `update_tray_menu` (e.g., `strings.new_field`).

use crate::managers::history::{HistoryEntry, HistoryManager};
use crate::managers::transcription::TranscriptionManager;
use crate::settings;
use log::{error, info, warn};
use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIcon;
use tauri::{AppHandle, Manager, Theme};
use tauri_plugin_clipboard_manager::ClipboardExt;

// ── Tray i18n ────────────────────────────────────────────────────────────────

// Auto-generated `TrayStrings` struct and `TRANSLATIONS` static.
include!(concat!(env!("OUT_DIR"), "/tray_translations.rs"));

/// Extract the base language code from a locale string (e.g. `"en-US"` → `"en"`).
fn get_language_code(locale: &str) -> &str {
    locale.split(['-', '_']).next().unwrap_or("en")
}

/// Return localized tray menu strings for the given locale, falling back to English.
fn get_tray_translations(locale: Option<String>) -> TrayStrings {
    let lang = locale.as_deref().map(get_language_code).unwrap_or("en");
    TRANSLATIONS
        .get(lang)
        .or_else(|| TRANSLATIONS.get("en"))
        .cloned()
        .expect("English translations must exist")
}

#[derive(Clone, Debug, PartialEq)]
pub enum TrayIconState {
    Idle,
    Recording,
    Transcribing,
}

#[derive(Clone, Debug, PartialEq)]
pub enum AppTheme {
    Dark,
    Light,
    Colored, // Pink/colored theme for Linux
}

/// Gets the current app theme, with Linux defaulting to Colored theme
pub fn get_current_theme(app: &AppHandle) -> AppTheme {
    if cfg!(target_os = "linux") {
        // On Linux, always use the colored theme
        AppTheme::Colored
    } else {
        // On other platforms, map system theme to our app theme
        if let Some(main_window) = app.get_webview_window("main") {
            match main_window.theme().unwrap_or(Theme::Dark) {
                Theme::Light => AppTheme::Light,
                Theme::Dark => AppTheme::Dark,
                _ => AppTheme::Dark, // Default fallback
            }
        } else {
            AppTheme::Dark
        }
    }
}

/// Gets the appropriate icon path for the given theme and state
pub fn get_icon_path(theme: AppTheme, state: TrayIconState) -> &'static str {
    match (theme, state) {
        // Dark theme uses light icons
        (AppTheme::Dark, TrayIconState::Idle) => "resources/tray_idle.png",
        (AppTheme::Dark, TrayIconState::Recording) => "resources/tray_recording.png",
        (AppTheme::Dark, TrayIconState::Transcribing) => "resources/tray_transcribing.png",
        // Light theme uses dark icons
        (AppTheme::Light, TrayIconState::Idle) => "resources/tray_idle_dark.png",
        (AppTheme::Light, TrayIconState::Recording) => "resources/tray_recording_dark.png",
        (AppTheme::Light, TrayIconState::Transcribing) => "resources/tray_transcribing_dark.png",
        // Linux uses the same tray icon set to keep branding consistent
        (AppTheme::Colored, TrayIconState::Idle) => "resources/tray_idle.png",
        (AppTheme::Colored, TrayIconState::Recording) => "resources/recording.png",
        (AppTheme::Colored, TrayIconState::Transcribing) => "resources/transcribing.png",
    }
}

pub fn change_tray_icon(app: &AppHandle, icon: TrayIconState) {
    let Some(tray) = app.try_state::<TrayIcon>() else {
        warn!("Tray icon change requested before tray initialization completed.");
        return;
    };
    let theme = get_current_theme(app);
    let icon_path = get_icon_path(theme, icon.clone());

    let resolved_icon_path = match app
        .path()
        .resolve(icon_path, tauri::path::BaseDirectory::Resource)
    {
        Ok(path) => path,
        Err(err) => {
            error!("Failed to resolve tray icon path '{}': {}", icon_path, err);
            return;
        }
    };

    let image = match Image::from_path(resolved_icon_path) {
        Ok(image) => image,
        Err(err) => {
            error!("Failed to load tray icon '{}': {}", icon_path, err);
            return;
        }
    };

    if let Err(err) = tray.set_icon(Some(image)) {
        error!("Failed to update tray icon: {}", err);
    }

    // Update menu based on state
    update_tray_menu(app, &icon, None);
}

pub fn update_tray_menu(app: &AppHandle, state: &TrayIconState, locale: Option<&str>) {
    let settings = settings::get_settings(app);

    let locale = locale.unwrap_or(&settings.app_language);
    let strings = get_tray_translations(Some(locale.to_string()));

    // Platform-specific accelerators
    #[cfg(target_os = "macos")]
    let (settings_accelerator, quit_accelerator) = (Some("Cmd+,"), Some("Cmd+Q"));
    #[cfg(not(target_os = "macos"))]
    let (settings_accelerator, quit_accelerator) = (Some("Ctrl+,"), Some("Ctrl+Q"));

    // Create common menu items
    let version_label = if cfg!(debug_assertions) {
        format!("Vocalype v{} (Dev)", env!("CARGO_PKG_VERSION"))
    } else {
        format!("Vocalype v{}", env!("CARGO_PKG_VERSION"))
    };
    let version_i = match MenuItem::with_id(app, "version", &version_label, false, None::<&str>) {
        Ok(item) => item,
        Err(err) => {
            error!("Failed to create tray version item: {}", err);
            return;
        }
    };
    let settings_i = match MenuItem::with_id(
        app,
        "settings",
        &strings.settings,
        true,
        settings_accelerator,
    ) {
        Ok(item) => item,
        Err(err) => {
            error!("Failed to create tray settings item: {}", err);
            return;
        }
    };
    let check_updates_i = match MenuItem::with_id(
        app,
        "check_updates",
        &strings.check_updates,
        settings.update_checks_enabled,
        None::<&str>,
    ) {
        Ok(item) => item,
        Err(err) => {
            error!("Failed to create tray check updates item: {}", err);
            return;
        }
    };
    let copy_last_transcript_i = match MenuItem::with_id(
        app,
        "copy_last_transcript",
        &strings.copy_last_transcript,
        true,
        None::<&str>,
    ) {
        Ok(item) => item,
        Err(err) => {
            error!("Failed to create tray copy transcript item: {}", err);
            return;
        }
    };
    let model_loaded = app.state::<Arc<TranscriptionManager>>().is_model_loaded();
    let unload_model_i = match MenuItem::with_id(
        app,
        "unload_model",
        &strings.unload_model,
        model_loaded,
        None::<&str>,
    ) {
        Ok(item) => item,
        Err(err) => {
            error!("Failed to create tray unload model item: {}", err);
            return;
        }
    };
    let quit_i = match MenuItem::with_id(app, "quit", &strings.quit, true, quit_accelerator) {
        Ok(item) => item,
        Err(err) => {
            error!("Failed to create tray quit item: {}", err);
            return;
        }
    };
    let separator = || match PredefinedMenuItem::separator(app) {
        Ok(item) => Some(item),
        Err(err) => {
            error!("Failed to create tray separator: {}", err);
            None
        }
    };

    let menu = match state {
        TrayIconState::Recording | TrayIconState::Transcribing => {
            let cancel_i =
                match MenuItem::with_id(app, "cancel", &strings.cancel, true, None::<&str>) {
                    Ok(item) => item,
                    Err(err) => {
                        error!("Failed to create tray cancel item: {}", err);
                        return;
                    }
                };
            let Some(separator_1) = separator() else {
                return;
            };
            let Some(separator_2) = separator() else {
                return;
            };
            let Some(separator_3) = separator() else {
                return;
            };
            let Some(separator_4) = separator() else {
                return;
            };
            match Menu::with_items(
                app,
                &[
                    &version_i,
                    &separator_1,
                    &cancel_i,
                    &separator_2,
                    &copy_last_transcript_i,
                    &separator_3,
                    &settings_i,
                    &check_updates_i,
                    &separator_4,
                    &quit_i,
                ],
            ) {
                Ok(menu) => menu,
                Err(err) => {
                    error!("Failed to create tray menu for active state: {}", err);
                    return;
                }
            }
        }
        TrayIconState::Idle => {
            let Some(separator_1) = separator() else {
                return;
            };
            let Some(separator_2) = separator() else {
                return;
            };
            let Some(separator_3) = separator() else {
                return;
            };
            match Menu::with_items(
                app,
                &[
                    &version_i,
                    &separator_1,
                    &copy_last_transcript_i,
                    &unload_model_i,
                    &separator_2,
                    &settings_i,
                    &check_updates_i,
                    &separator_3,
                    &quit_i,
                ],
            ) {
                Ok(menu) => menu,
                Err(err) => {
                    error!("Failed to create tray menu for idle state: {}", err);
                    return;
                }
            }
        }
    };

    let Some(tray) = app.try_state::<TrayIcon>() else {
        warn!("Tray menu update requested before tray initialization completed.");
        return;
    };

    if let Err(err) = tray.set_menu(Some(menu)) {
        error!("Failed to set tray menu: {}", err);
        return;
    }

    if let Err(err) = tray.set_icon_as_template(true) {
        error!("Failed to set tray icon template mode: {}", err);
    }
}

fn last_transcript_text(entry: &HistoryEntry) -> &str {
    entry
        .post_processed_text
        .as_deref()
        .unwrap_or(&entry.transcription_text)
}

pub fn set_tray_visibility(app: &AppHandle, visible: bool) {
    let Some(tray) = app.try_state::<TrayIcon>() else {
        warn!("Tray visibility change requested before tray initialization completed.");
        return;
    };
    if let Err(e) = tray.set_visible(visible) {
        error!("Failed to set tray visibility: {}", e);
    } else {
        info!("Tray visibility set to: {}", visible);
    }
}

pub fn copy_last_transcript(app: &AppHandle) {
    let history_manager = app.state::<Arc<HistoryManager>>();
    let entry = match history_manager.get_latest_entry() {
        Ok(Some(entry)) => entry,
        Ok(None) => {
            warn!("No transcription history entries available for tray copy.");
            return;
        }
        Err(err) => {
            error!("Failed to fetch last transcription entry: {}", err);
            return;
        }
    };

    if let Err(err) = app.clipboard().write_text(last_transcript_text(&entry)) {
        error!("Failed to copy last transcript to clipboard: {}", err);
        return;
    }

    info!("Copied last transcript to clipboard via tray.");
}

#[cfg(test)]
mod tests {
    use super::last_transcript_text;
    use crate::managers::history::HistoryEntry;

    fn build_entry(transcription: &str, post_processed: Option<&str>) -> HistoryEntry {
        HistoryEntry {
            id: 1,
            file_name: "vocalype-1.wav".to_string(),
            timestamp: 0,
            saved: false,
            title: "Recording".to_string(),
            transcription_text: transcription.to_string(),
            post_processed_text: post_processed.map(|text| text.to_string()),
            post_process_prompt: None,
            post_process_action_key: None,
            model_name: None,
            confidence_payload: None,
        }
    }

    #[test]
    fn uses_post_processed_text_when_available() {
        let entry = build_entry("raw", Some("processed"));
        assert_eq!(last_transcript_text(&entry), "processed");
    }

    #[test]
    fn falls_back_to_raw_transcription() {
        let entry = build_entry("raw", None);
        assert_eq!(last_transcript_text(&entry), "raw");
    }
}
