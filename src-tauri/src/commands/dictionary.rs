use crate::dictionary::{DictionaryEntry, DictionaryManager};
use std::sync::Arc;
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
    dictionary.add(from, to)
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
        let _ = dictionary.add(entry.from, entry.to);
    }

    Ok(())
}
