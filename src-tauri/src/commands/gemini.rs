use tauri::AppHandle;

#[tauri::command]
#[specta::specta]
pub fn change_gemini_api_key_setting(app: AppHandle, api_key: String) -> Result<(), String> {
    crate::secrets::store_gemini_api_key(&api_key)?;
    let mut settings = crate::settings::get_settings(&app);
    settings.gemini_api_key = None;
    crate::settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_gemini_model_setting(app: AppHandle, model: String) -> Result<(), String> {
    let mut settings = crate::settings::get_settings(&app);
    settings.gemini_model = model;
    crate::settings::write_settings(&app, settings);
    Ok(())
}
