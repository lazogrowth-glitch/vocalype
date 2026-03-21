use crate::adaptive_runtime::maybe_schedule_whisper_calibration;
use crate::managers::audio::AudioRecordingManager;
use crate::managers::model::{EngineType, ModelInfo, ModelManager};
use crate::managers::transcription::TranscriptionManager;
use crate::settings::{get_settings, write_settings};
use log::warn;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};

fn transcription_session_active(app: &AppHandle) -> bool {
    app.try_state::<crate::TranscriptionCoordinator>()
        .and_then(|coordinator| coordinator.active_operation_id())
        .is_some()
}

#[tauri::command]
#[specta::specta]
pub async fn get_available_models(
    model_manager: State<'_, Arc<ModelManager>>,
) -> Result<Vec<ModelInfo>, String> {
    Ok(model_manager.get_available_models())
}

#[tauri::command]
#[specta::specta]
pub async fn get_model_info(
    model_manager: State<'_, Arc<ModelManager>>,
    model_id: String,
) -> Result<Option<ModelInfo>, String> {
    Ok(model_manager.get_model_info(&model_id))
}

#[tauri::command]
#[specta::specta]
pub async fn download_model(
    app_handle: AppHandle,
    model_manager: State<'_, Arc<ModelManager>>,
    model_id: String,
) -> Result<(), String> {
    crate::license::enforce_premium_access(&app_handle, "model download")?;

    model_manager
        .download_model(&model_id)
        .await
        .map_err(|e| e.to_string())?;

    maybe_schedule_whisper_calibration(&app_handle, model_manager.inner().clone(), &model_id);

    if get_settings(&app_handle).selected_model == model_id {
        crate::startup_warmup::ensure_startup_warmup(&app_handle, "model-downloaded");
    }

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn delete_model(
    app_handle: AppHandle,
    model_manager: State<'_, Arc<ModelManager>>,
    transcription_manager: State<'_, Arc<TranscriptionManager>>,
    model_id: String,
) -> Result<(), String> {
    let target_model = model_manager
        .get_model_info(&model_id)
        .ok_or_else(|| format!("Model not found: {}", model_id))?;

    // If deleting the active model (or another profile sharing the same
    // underlying files), unload it and clear the setting.
    let settings = get_settings(&app_handle);
    let active_uses_same_files = if settings.selected_model.is_empty() {
        false
    } else {
        model_manager
            .get_model_info(&settings.selected_model)
            .map(|active_model| active_model.filename == target_model.filename)
            .unwrap_or(false)
    };

    if settings.selected_model == model_id || active_uses_same_files {
        transcription_manager
            .unload_model()
            .map_err(|e| format!("Failed to unload model: {}", e))?;

        let mut settings = get_settings(&app_handle);
        settings.selected_model = String::new();
        write_settings(&app_handle, settings);
    }

    model_manager
        .delete_model(&model_id)
        .map_err(|e| e.to_string())?;

    if settings.selected_model == model_id || active_uses_same_files {
        crate::startup_warmup::ensure_startup_warmup(&app_handle, "model-deleted");
    }

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn set_active_model(
    app_handle: AppHandle,
    model_manager: State<'_, Arc<ModelManager>>,
    transcription_manager: State<'_, Arc<TranscriptionManager>>,
    audio_manager: State<'_, Arc<AudioRecordingManager>>,
    model_id: String,
) -> Result<(), String> {
    crate::license::enforce_premium_access(&app_handle, "model activation")?;

    // Check if model exists and is available
    let model_info = model_manager
        .get_model_info(&model_id)
        .ok_or_else(|| format!("Model not found: {}", model_id))?;

    if !model_info.is_downloaded {
        return Err(format!("Model not downloaded: {}", model_id));
    }

    if transcription_session_active(&app_handle) {
        let mut settings = get_settings(&app_handle);
        settings.selected_model = model_id.clone();
        write_settings(&app_handle, settings);
        crate::startup_warmup::ensure_startup_warmup(&app_handle, "active-model-deferred");
        return Ok(());
    }

    // Load the model in the transcription manager
    transcription_manager
        .load_model(&model_id)
        .map_err(|e| e.to_string())?;

    // Update settings
    let mut settings = get_settings(&app_handle);
    settings.selected_model = model_id.clone();
    write_settings(&app_handle, settings);

    // If microphone stream is currently open (always-on mode), restart it so
    // recorder/VAD profile follows the newly selected model immediately.
    if let Err(e) = audio_manager.update_selected_device() {
        warn!(
            "Failed to refresh microphone stream after model change to '{}': {}",
            model_id, e
        );
    }

    crate::startup_warmup::ensure_startup_warmup(&app_handle, "active-model-changed");

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn get_current_model(app_handle: AppHandle) -> Result<String, String> {
    let settings = get_settings(&app_handle);
    Ok(settings.selected_model)
}

#[tauri::command]
#[specta::specta]
pub async fn get_transcription_model_status(
    transcription_manager: State<'_, Arc<TranscriptionManager>>,
) -> Result<Option<String>, String> {
    Ok(transcription_manager.get_current_model())
}

#[tauri::command]
#[specta::specta]
pub async fn is_model_loading(
    transcription_manager: State<'_, Arc<TranscriptionManager>>,
) -> Result<bool, String> {
    Ok(transcription_manager.is_loading_model())
}

#[tauri::command]
#[specta::specta]
pub async fn has_any_models_available(
    model_manager: State<'_, Arc<ModelManager>>,
) -> Result<bool, String> {
    let models = model_manager.get_available_models();
    Ok(models
        .iter()
        .any(|m| m.is_downloaded && !matches!(m.engine_type, EngineType::GeminiApi)))
}

#[tauri::command]
#[specta::specta]
pub async fn has_any_models_or_downloads(
    model_manager: State<'_, Arc<ModelManager>>,
) -> Result<bool, String> {
    let models = model_manager.get_available_models();
    Ok(models.iter().any(|m| {
        !matches!(m.engine_type, EngineType::GeminiApi) && (m.is_downloaded || m.is_downloading)
    }))
}

#[tauri::command]
#[specta::specta]
pub async fn cancel_download(
    model_manager: State<'_, Arc<ModelManager>>,
    model_id: String,
) -> Result<(), String> {
    model_manager
        .cancel_download(&model_id)
        .map_err(|e| e.to_string())
}
