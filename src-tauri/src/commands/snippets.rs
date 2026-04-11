use crate::settings::{get_settings, write_settings, VoiceSnippet};
use rand::Rng;
use tauri::AppHandle;

fn new_snippet_id() -> String {
    let mut rng = rand::thread_rng();
    format!("snip_{:016x}", rng.gen::<u64>())
}

#[tauri::command]
#[specta::specta]
pub fn get_voice_snippets(app: AppHandle) -> Vec<VoiceSnippet> {
    get_settings(&app).voice_snippets
}

#[tauri::command]
#[specta::specta]
pub fn add_voice_snippet(
    app: AppHandle,
    trigger: String,
    expansion: String,
) -> Result<VoiceSnippet, String> {
    let trigger = trigger.trim().to_string();
    let expansion = expansion.trim().to_string();

    if trigger.is_empty() {
        return Err("Trigger cannot be empty".to_string());
    }
    if expansion.is_empty() {
        return Err("Expansion cannot be empty".to_string());
    }

    let mut settings = get_settings(&app);

    // Duplicate trigger check
    if settings
        .voice_snippets
        .iter()
        .any(|s| s.trigger.trim().to_lowercase() == trigger.to_lowercase())
    {
        return Err(format!(
            "A snippet with trigger '{}' already exists",
            trigger
        ));
    }

    let snippet = VoiceSnippet {
        id: new_snippet_id(),
        trigger,
        expansion,
    };

    settings.voice_snippets.push(snippet.clone());
    write_settings(&app, settings);

    Ok(snippet)
}

#[tauri::command]
#[specta::specta]
pub fn remove_voice_snippet(app: AppHandle, id: String) -> Result<(), String> {
    let mut settings = get_settings(&app);
    let before = settings.voice_snippets.len();
    settings.voice_snippets.retain(|s| s.id != id);
    if settings.voice_snippets.len() == before {
        return Err(format!("Snippet not found: {}", id));
    }
    write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn update_voice_snippet(
    app: AppHandle,
    id: String,
    trigger: String,
    expansion: String,
) -> Result<(), String> {
    let trigger = trigger.trim().to_string();
    let expansion = expansion.trim().to_string();

    if trigger.is_empty() {
        return Err("Trigger cannot be empty".to_string());
    }
    if expansion.is_empty() {
        return Err("Expansion cannot be empty".to_string());
    }

    let mut settings = get_settings(&app);

    // Duplicate trigger check (excluding current snippet)
    if settings
        .voice_snippets
        .iter()
        .any(|s| s.id != id && s.trigger.trim().to_lowercase() == trigger.to_lowercase())
    {
        return Err(format!(
            "A snippet with trigger '{}' already exists",
            trigger
        ));
    }

    let snippet = settings
        .voice_snippets
        .iter_mut()
        .find(|s| s.id == id)
        .ok_or_else(|| format!("Snippet not found: {}", id))?;

    snippet.trigger = trigger;
    snippet.expansion = expansion;
    write_settings(&app, settings);

    Ok(())
}
