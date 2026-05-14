use crate::dictionary::{DictionaryEntry, DictionaryManager};
use crate::settings::{get_settings, write_settings};
use std::sync::Arc;
use tauri::AppHandle;
use tauri::State;

#[tauri::command]
#[specta::specta]
pub fn get_dictionary(
    dictionary: State<'_, Arc<DictionaryManager>>,
) -> Result<Vec<DictionaryEntry>, String> {
    Ok(dictionary.entries())
}

#[tauri::command]
#[specta::specta]
pub fn add_dictionary_entry(
    dictionary: State<'_, Arc<DictionaryManager>>,
    from: String,
    to: String,
) -> Result<(), String> {
    dictionary.add_manual(from, to)
}

#[tauri::command]
#[specta::specta]
pub fn remove_dictionary_entry(
    dictionary: State<'_, Arc<DictionaryManager>>,
    from: String,
) -> Result<(), String> {
    dictionary.remove(&from)
}

#[tauri::command]
#[specta::specta]
pub fn update_dictionary_entry(
    dictionary: State<'_, Arc<DictionaryManager>>,
    from: String,
    to: String,
) -> Result<(), String> {
    dictionary.update(&from, to)
}

#[tauri::command]
#[specta::specta]
pub fn clear_dictionary(dictionary: State<'_, Arc<DictionaryManager>>) -> Result<(), String> {
    dictionary.clear()
}

#[tauri::command]
#[specta::specta]
pub fn export_dictionary(dictionary: State<'_, Arc<DictionaryManager>>) -> Result<String, String> {
    let entries = dictionary.entries();
    serde_json::to_string_pretty(&entries).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn import_dictionary(
    dictionary: State<'_, Arc<DictionaryManager>>,
    json: String,
    replace: bool,
) -> Result<(), String> {
    use crate::dictionary::DictionaryEntry;

    let entries: Vec<DictionaryEntry> =
        serde_json::from_str(&json).map_err(|e| format!("JSON invalide : {}", e))?;

    if replace {
        dictionary.clear()?;
    }

    for entry in entries {
        // Skip if already present (when merging)
        let _ = dictionary.add_manual(entry.from, entry.to);
    }

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn sync_workspace_custom_words(app: AppHandle, words: Vec<String>) -> Result<(), String> {
    let mut deduped = Vec::new();

    for word in words {
        let trimmed = word.trim();
        if trimmed.is_empty() {
            continue;
        }

        if deduped
            .iter()
            .any(|existing: &String| existing.eq_ignore_ascii_case(trimmed))
        {
            continue;
        }

        deduped.push(trimmed.to_string());
    }

    let mut settings = get_settings(&app);
    settings.workspace_custom_words = deduped;
    write_settings(&app, settings);
    Ok(())
}
