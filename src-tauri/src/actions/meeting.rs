use crate::managers::meetings::MeetingManager;
use crate::platform::process_monitor::detect_meeting_app;
use log::{debug, warn};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

/// The ID of the meeting that is currently being recorded.
/// `None` means no meeting is active — the next segment will create one.
static ACTIVE_MEETING_ID: Mutex<Option<i64>> = Mutex::new(None);

/// Append a transcription segment to the active meeting.
///
/// If no meeting is active, a new one is created automatically, using the
/// name of any running conferencing app (or "Meeting" as a fallback).
pub fn handle_meeting_segment(app: &AppHandle, _operation_id: u64, text: &str) {
    if text.trim().is_empty() {
        return;
    }

    let mm = match app.try_state::<Arc<MeetingManager>>() {
        Some(s) => s.inner().clone(),
        None => {
            warn!("meeting: MeetingManager not found in app state");
            return;
        }
    };

    let mut active_id = ACTIVE_MEETING_ID.lock().unwrap_or_else(|e| e.into_inner());

    // Create a meeting if none is active.
    let meeting_id = match *active_id {
        Some(id) => id,
        None => {
            let app_name = detect_meeting_app().unwrap_or_else(|| "Meeting".to_string());
            let title = format!("{} — {}", app_name, formatted_now());
            match mm.create_meeting(&title, &app_name) {
                Ok(m) => {
                    debug!("meeting: created meeting #{} ({})", m.id, app_name);
                    *active_id = Some(m.id);
                    let _ = app.emit("meeting-created", &m);
                    m.id
                }
                Err(e) => {
                    warn!("meeting: failed to create meeting: {}", e);
                    return;
                }
            }
        }
    };

    // Append a newline-separated segment.
    let segment = format!("{}\n", text.trim());
    let timestamp_ms = chrono::Utc::now().timestamp_millis();
    match mm.append_segment(meeting_id, &segment, timestamp_ms) {
        Ok(segment_entry) => {
            debug!("meeting: appended segment to meeting #{}", meeting_id);
            let _ = app.emit(
                "meeting-segment-added",
                serde_json::json!({
                    "id": meeting_id,
                    "text": segment,
                    "timestamp_ms": segment_entry.timestamp_ms,
                    "segment_id": segment_entry.id
                }),
            );
        }
        Err(e) => warn!("meeting: failed to append segment: {}", e),
    }
}

/// Clear the active meeting so the next segment starts a new one.
pub fn close_active_meeting() {
    let mut active_id = ACTIVE_MEETING_ID.lock().unwrap_or_else(|e| e.into_inner());
    *active_id = None;
}

pub fn set_active_meeting(id: Option<i64>) {
    let mut active_id = ACTIVE_MEETING_ID.lock().unwrap_or_else(|e| e.into_inner());
    *active_id = id;
}

fn formatted_now() -> String {
    let now = chrono::Local::now();
    now.format("%b %d, %H:%M").to_string()
}
