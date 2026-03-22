use tauri::AppHandle;

#[tauri::command]
#[specta::specta]
pub fn dismiss_agent_overlay(app: AppHandle) {
    crate::platform::agent_overlay::hide_agent_overlay(&app);
}
