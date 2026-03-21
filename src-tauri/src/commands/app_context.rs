use crate::context_detector::{
    ActiveAppContextState, AppContextCategory, AppContextOverride, RecentAppEntry,
};
use crate::settings::{get_settings, write_settings};
use tauri::{AppHandle, State};

/// Return the list of apps detected during the last N dictation sessions.
#[tauri::command]
#[specta::specta]
pub fn get_recent_apps(state: State<'_, ActiveAppContextState>) -> Vec<RecentAppEntry> {
    state.0.lock().map(|s| s.recent_apps()).unwrap_or_default()
}

/// Return all user-defined app-category overrides.
#[tauri::command]
#[specta::specta]
pub fn list_app_context_overrides(
    state: State<'_, ActiveAppContextState>,
) -> Vec<AppContextOverride> {
    state
        .0
        .lock()
        .map(|s| s.list_overrides())
        .unwrap_or_default()
}

/// Force a specific category for a given process name.
/// `process_name` is the `.exe` filename (e.g. `"notion.exe"`).
#[tauri::command]
#[specta::specta]
pub fn set_app_context_override(
    state: State<'_, ActiveAppContextState>,
    process_name: String,
    category: AppContextCategory,
) -> Result<(), String> {
    state
        .0
        .lock()
        .map(|mut s| s.set_override(&process_name, category))
        .map_err(|_| "Failed to acquire context state lock".to_string())
}

/// Remove a previously set category override for a process.
#[tauri::command]
#[specta::specta]
pub fn remove_app_context_override(
    state: State<'_, ActiveAppContextState>,
    process_name: String,
) -> Result<(), String> {
    state
        .0
        .lock()
        .map(|mut s| s.remove_override(&process_name))
        .map_err(|_| "Failed to acquire context state lock".to_string())
}

/// Enable or disable the automatic app-context feature globally.
#[tauri::command]
#[specta::specta]
pub fn set_app_context_enabled(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = get_settings(&app);
    settings.app_context_enabled = enabled;
    write_settings(&app, settings);
    Ok(())
}
