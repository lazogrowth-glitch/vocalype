use crate::managers::transcription::TranscriptionManager;
use crate::runtime_observability::TranscriptionLifecycleState;
use crate::settings::{get_settings, write_settings, ModelUnloadTimeout};
use crate::signal_handle;
use serde::Serialize;
use specta::Type;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};

#[derive(Serialize, Type)]
pub struct ModelLoadStatus {
    is_loaded: bool,
    current_model: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub fn set_model_unload_timeout(app: AppHandle, timeout: ModelUnloadTimeout) {
    let mut settings = get_settings(&app);
    settings.model_unload_timeout = timeout;
    write_settings(&app, settings);
}

#[tauri::command]
#[specta::specta]
pub fn get_model_load_status(
    transcription_manager: State<Arc<TranscriptionManager>>,
) -> Result<ModelLoadStatus, String> {
    Ok(ModelLoadStatus {
        is_loaded: transcription_manager.is_model_loaded(),
        current_model: transcription_manager.get_current_model(),
    })
}

#[tauri::command]
#[specta::specta]
pub fn unload_model_manually(
    transcription_manager: State<Arc<TranscriptionManager>>,
) -> Result<(), String> {
    transcription_manager
        .unload_model()
        .map_err(|e| format!("Failed to unload model: {}", e))
}

#[tauri::command]
#[specta::specta]
pub fn trigger_transcription_binding(app: AppHandle, binding_id: String) -> Result<(), String> {
    let trimmed = binding_id.trim();
    if trimmed.is_empty() {
        return Err("Missing binding id".to_string());
    }

    signal_handle::send_transcription_input(&app, trimmed, "UI");
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn toggle_transcription_binding(app: AppHandle, binding_id: String) -> Result<String, String> {
    let trimmed = binding_id.trim();
    if trimmed.is_empty() {
        return Err("Missing binding id".to_string());
    }

    let coordinator = app
        .try_state::<crate::TranscriptionCoordinator>()
        .ok_or_else(|| "Transcription coordinator not initialized".to_string())?;

    let lifecycle = coordinator.lifecycle_state();
    let active_binding = coordinator.active_binding_id();
    let is_active_binding = active_binding.as_deref() == Some(trimmed);
    let can_start = matches!(
        lifecycle,
        TranscriptionLifecycleState::Idle
            | TranscriptionLifecycleState::Completed
            | TranscriptionLifecycleState::Cancelled
            | TranscriptionLifecycleState::Error
    );

    if is_active_binding && !can_start {
        crate::actions::transcribe::stop_transcription_action(&app, trimmed, false);
        return Ok("stopping".to_string());
    }

    if can_start {
        crate::actions::transcribe::start_transcription_action(&app, trimmed);
        return Ok("starting".to_string());
    }

    Err(format!("Pipeline busy in state {:?}", lifecycle))
}
