use crate::managers::notes::NoteManager;
use log::{debug, warn};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

/// The note currently receiving dictated segments.
static ACTIVE_NOTE_ID: Mutex<Option<i64>> = Mutex::new(None);

/// Append a transcription segment to the active note, creating one on demand.
pub fn handle_note_segment(app: &AppHandle, _operation_id: u64, text: &str) {
    if text.trim().is_empty() {
        return;
    }

    let note_manager = match app.try_state::<Arc<NoteManager>>() {
        Some(state) => state.inner().clone(),
        None => {
            warn!("note: NoteManager not found in app state");
            return;
        }
    };

    let mut active_id = ACTIVE_NOTE_ID.lock().unwrap_or_else(|e| e.into_inner());

    let note_id = match *active_id {
        Some(id) => id,
        None => {
            let title = format!("Note - {}", formatted_now());
            match note_manager.create_note(&title, "") {
                Ok(note) => {
                    debug!("note: created note #{}", note.id);
                    *active_id = Some(note.id);
                    let _ = app.emit("note-created", &note);
                    note.id
                }
                Err(err) => {
                    warn!("note: failed to create note: {}", err);
                    return;
                }
            }
        }
    };

    let segment = format!("{}\n", text.trim());
    match note_manager.append_segment(note_id, &segment) {
        Ok(()) => {
            debug!("note: appended segment to note #{}", note_id);
            let _ = app.emit(
                "note-segment-added",
                serde_json::json!({ "id": note_id, "text": segment }),
            );
        }
        Err(err) => warn!("note: failed to append segment: {}", err),
    }
}

pub fn close_active_note() {
    let mut active_id = ACTIVE_NOTE_ID.lock().unwrap_or_else(|e| e.into_inner());
    *active_id = None;
}

pub fn set_active_note(id: Option<i64>) {
    let mut active_id = ACTIVE_NOTE_ID.lock().unwrap_or_else(|e| e.into_inner());
    *active_id = id;
}

fn formatted_now() -> String {
    let now = chrono::Local::now();
    now.format("%b %d, %H:%M").to_string()
}
