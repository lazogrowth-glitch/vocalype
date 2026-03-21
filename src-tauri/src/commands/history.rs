use crate::managers::history::{HistoryEntry, HistoryManager};
use crate::managers::transcription::TranscriptionManager;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::sync::Arc;
use tauri::{AppHandle, State};

#[tauri::command]
#[specta::specta]
pub async fn get_history_entries(
    _app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
) -> Result<Vec<HistoryEntry>, String> {
    history_manager
        .get_history_entries()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn get_history_entries_paginated(
    _app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
    limit: usize,
    offset: usize,
) -> Result<(Vec<HistoryEntry>, bool), String> {
    history_manager
        .get_history_entries_paginated(limit, offset)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn toggle_history_entry_saved(
    _app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
    id: i64,
) -> Result<(), String> {
    history_manager
        .toggle_saved_status(id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn get_audio_file_path(
    _app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
    file_name: String,
) -> Result<String, String> {
    let path = history_manager
        .get_audio_file_path(&file_name)
        .map_err(|e| e.to_string())?;
    path.to_str()
        .ok_or_else(|| "Invalid file path".to_string())
        .map(|s| s.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn delete_history_entry(
    _app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
    id: i64,
) -> Result<(), String> {
    history_manager
        .delete_entry(id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn update_history_limit(
    app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
    limit: usize,
) -> Result<(), String> {
    let mut settings = crate::settings::get_settings(&app);
    settings.history_limit = limit;
    crate::settings::write_settings(&app, settings);

    history_manager
        .cleanup_old_entries()
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn reprocess_history_entry(
    app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
    transcription_manager: State<'_, Arc<TranscriptionManager>>,
    id: i64,
    model_id: String,
) -> Result<String, String> {
    crate::license::enforce_premium_access(&app, "history reprocessing")?;

    let entry = history_manager
        .get_entry_by_id(id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "History entry not found".to_string())?;

    let audio_path = history_manager
        .get_audio_file_path(&entry.file_name)
        .map_err(|e| e.to_string())?;
    if !audio_path.exists() {
        return Err("Audio file not found".to_string());
    }

    let samples = crate::audio_toolkit::load_wav_file(&audio_path).map_err(|e| e.to_string())?;

    let previous_model = transcription_manager.get_current_model();

    transcription_manager
        .load_model(&model_id)
        .map_err(|e| e.to_string())?;

    let transcription_output = transcription_manager
        .transcribe_detailed_request(crate::managers::transcription::TranscriptionRequest {
            audio: samples,
            app_context: None,
        })
        .map_err(|e| e.to_string())?;
    let new_text = transcription_output.text;

    let model_name = transcription_manager.get_current_model_name();
    history_manager
        .update_transcription_text(
            id,
            &new_text,
            transcription_output.confidence_payload.as_ref(),
            model_name.as_deref(),
        )
        .map_err(|e| e.to_string())?;

    if let Some(prev_id) = previous_model {
        if prev_id != model_id {
            let _ = transcription_manager.load_model(&prev_id);
        }
    }

    Ok(new_text)
}

// ── History Stats ─────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone, Type)]
pub struct HistoryStats {
    pub total_entries: i64,
    pub total_words: i64,
    pub entries_today: i64,
    pub entries_this_week: i64,
    pub most_used_model: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub async fn get_history_stats(
    _app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
) -> Result<HistoryStats, String> {
    history_manager.get_stats().await.map_err(|e| e.to_string())
}

// ── Export History ────────────────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub async fn export_history_entries(
    _app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
    format: String,
) -> Result<String, String> {
    let entries = history_manager
        .get_history_entries()
        .await
        .map_err(|e| e.to_string())?;

    match format.as_str() {
        "json" => serde_json::to_string_pretty(&entries).map_err(|e| e.to_string()),
        "csv" => {
            let mut out = String::from("id,timestamp,model,transcription,post_processed\n");
            for e in &entries {
                let ts = chrono::DateTime::from_timestamp(e.timestamp, 0)
                    .map(|d| d.format("%Y-%m-%d %H:%M:%S").to_string())
                    .unwrap_or_default();
                let text = e.transcription_text.replace('"', "\"\"");
                let post = e
                    .post_processed_text
                    .as_deref()
                    .unwrap_or("")
                    .replace('"', "\"\"");
                let model = e.model_name.as_deref().unwrap_or("").replace('"', "\"\"");
                out.push_str(&format!(
                    "{},\"{}\",\"{}\",\"{}\",\"{}\"\n",
                    e.id, ts, model, text, post
                ));
            }
            Ok(out)
        }
        "md" => {
            let mut out = String::from("# VocalType — Historique des transcriptions\n\n");
            for e in &entries {
                let ts = chrono::DateTime::from_timestamp(e.timestamp, 0)
                    .map(|d| d.format("%Y-%m-%d %H:%M:%S").to_string())
                    .unwrap_or_default();
                out.push_str(&format!("## {}", ts));
                if let Some(m) = &e.model_name {
                    out.push_str(&format!(" · *{}*", m));
                }
                out.push('\n');
                if let Some(pp) = &e.post_processed_text {
                    out.push_str(&format!("{}\n\n", pp));
                    out.push_str(&format!("*Original :* {}\n\n", e.transcription_text));
                } else {
                    out.push_str(&format!("{}\n\n", e.transcription_text));
                }
                out.push_str("---\n\n");
            }
            Ok(out)
        }
        _ => {
            // Plain text (default)
            let mut out = String::new();
            for e in &entries {
                let ts = chrono::DateTime::from_timestamp(e.timestamp, 0)
                    .map(|d| d.format("%Y-%m-%d %H:%M:%S").to_string())
                    .unwrap_or_default();
                let text = e
                    .post_processed_text
                    .as_deref()
                    .unwrap_or(&e.transcription_text);
                out.push_str(&format!("[{}] {}\n", ts, text));
            }
            Ok(out)
        }
    }
}

// ── Transcribe Audio File ─────────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub async fn transcribe_audio_file(
    app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
    transcription_manager: State<'_, Arc<TranscriptionManager>>,
    path: String,
) -> Result<String, String> {
    crate::license::enforce_premium_access(&app, "transcribe_file")?;

    let audio_path = std::path::PathBuf::from(&path);
    if !audio_path.exists() {
        return Err(format!("Fichier introuvable : {}", path));
    }

    let samples = crate::audio_toolkit::load_wav_file(&audio_path).map_err(|e| e.to_string())?;

    let tm = Arc::clone(&*transcription_manager);
    let output = tokio::task::spawn_blocking(move || {
        tm.transcribe_detailed_request(crate::managers::transcription::TranscriptionRequest {
            audio: samples,
            app_context: None,
        })
    })
    .await
    .map_err(|e| format!("Tâche annulée : {}", e))?
    .map_err(|e| e.to_string())?;

    let text = output.text.trim().to_string();
    if text.is_empty() {
        return Err("Aucune transcription produite".to_string());
    }

    // Save to history so the user can see it
    let file_name = audio_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file")
        .to_string();

    let _ = history_manager
        .save_file_transcription(&file_name, &text, output.confidence_payload.as_ref())
        .await;

    Ok(text)
}

#[tauri::command]
#[specta::specta]
pub async fn clear_all_history(
    _app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
) -> Result<(), String> {
    history_manager
        .clear_all_history()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn update_recording_retention_period(
    app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
    period: String,
) -> Result<(), String> {
    use crate::settings::RecordingRetentionPeriod;

    let retention_period = match period.as_str() {
        // "never" is no longer offered — treat legacy values as preserve_limit
        "never" => RecordingRetentionPeriod::PreserveLimit,
        "preserve_limit" => RecordingRetentionPeriod::PreserveLimit,
        "days3" => RecordingRetentionPeriod::Days3,
        "weeks2" => RecordingRetentionPeriod::Weeks2,
        "months3" => RecordingRetentionPeriod::Months3,
        _ => return Err(format!("Invalid retention period: {}", period)),
    };

    let mut settings = crate::settings::get_settings(&app);
    settings.recording_retention_period = retention_period;
    crate::settings::write_settings(&app, settings);

    history_manager
        .cleanup_old_entries()
        .map_err(|e| e.to_string())?;

    Ok(())
}
