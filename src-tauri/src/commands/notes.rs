use crate::managers::notes::{NoteEntry, NoteManager};
use std::sync::Arc;
use tauri::State;

#[tauri::command]
#[specta::specta]
pub fn get_notes(note_manager: State<Arc<NoteManager>>) -> Result<Vec<NoteEntry>, String> {
    note_manager.get_notes().map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn create_note(
    title: String,
    content: String,
    note_manager: State<Arc<NoteManager>>,
) -> Result<NoteEntry, String> {
    note_manager
        .create_note(&title, &content)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn update_note(
    id: i64,
    title: String,
    content: String,
    note_manager: State<Arc<NoteManager>>,
) -> Result<(), String> {
    note_manager
        .update_note(id, &title, &content)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn delete_note(id: i64, note_manager: State<Arc<NoteManager>>) -> Result<(), String> {
    note_manager.delete_note(id).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn search_notes(
    query: String,
    note_manager: State<Arc<NoteManager>>,
) -> Result<Vec<NoteEntry>, String> {
    note_manager.search_notes(&query).map_err(|e| e.to_string())
}
