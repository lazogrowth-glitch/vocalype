use tauri::AppHandle;

#[tauri::command]
#[specta::specta]
pub fn set_groq_stt_api_key(app: AppHandle, api_key: String) -> Result<(), String> {
    crate::secret_store::set_groq_stt_api_key(&api_key)?;
    let mut settings = crate::settings::get_settings(&app);
    settings.groq_stt_api_key = None;
    crate::settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn set_mistral_stt_api_key(app: AppHandle, api_key: String) -> Result<(), String> {
    crate::secret_store::set_mistral_stt_api_key(&api_key)?;
    let mut settings = crate::settings::get_settings(&app);
    settings.mistral_stt_api_key = None;
    crate::settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn set_deepgram_api_key(app: AppHandle, api_key: String) -> Result<(), String> {
    crate::secret_store::set_deepgram_api_key(&api_key)?;
    let mut settings = crate::settings::get_settings(&app);
    settings.deepgram_api_key = None;
    crate::settings::write_settings(&app, settings);
    Ok(())
}
