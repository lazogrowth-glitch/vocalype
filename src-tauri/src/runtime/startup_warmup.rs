use crate::managers::audio::AudioRecordingManager;
use crate::managers::model::{ModelInfo, ModelManager};
use crate::managers::transcription::TranscriptionManager;
use crate::settings::get_settings;
use log::debug;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum StartupWarmupPhase {
    Idle,
    Preparing,
    Ready,
    Failed,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum StartupWarmupReason {
    NoModelSelected,
    ModelNotDownloaded,
    PreparingMicrophone,
    PreparingModel,
    Ready,
    MicrophoneError,
    ModelError,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct StartupWarmupStatus {
    pub phase: StartupWarmupPhase,
    pub reason: StartupWarmupReason,
    pub can_record: bool,
    pub microphone_checked: bool,
    pub microphone_ready: bool,
    pub model_ready: bool,
    pub blocking_reason: Option<String>,
    pub message: String,
    pub detail: Option<String>,
    pub updated_at_ms: u64,
}

pub struct StartupWarmupState {
    status: Mutex<StartupWarmupStatus>,
    requested_generation: AtomicU64,
}

impl StartupWarmupState {
    pub fn new(status: StartupWarmupStatus) -> Self {
        Self {
            status: Mutex::new(status),
            requested_generation: AtomicU64::new(0),
        }
    }
}

#[derive(Debug, Clone)]
struct WarmupSnapshot {
    selected_model: String,
    always_on_microphone: bool,
    selected_microphone: Option<String>,
    clamshell_microphone: Option<String>,
}

impl WarmupSnapshot {
    fn capture(app: &AppHandle) -> Self {
        let settings = get_settings(app);
        Self {
            selected_model: settings.selected_model.clone(),
            always_on_microphone: settings.always_on_microphone,
            selected_microphone: settings.selected_microphone.clone(),
            clamshell_microphone: settings.clamshell_microphone.clone(),
        }
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn emit_status(app: &AppHandle, status: &StartupWarmupStatus) {
    let _ = app.emit("startup-warmup-changed", status.clone());
}

fn no_model_status(snapshot: &WarmupSnapshot) -> StartupWarmupStatus {
    StartupWarmupStatus {
        phase: StartupWarmupPhase::Idle,
        reason: StartupWarmupReason::NoModelSelected,
        can_record: false,
        microphone_checked: snapshot.always_on_microphone,
        microphone_ready: !snapshot.always_on_microphone,
        model_ready: false,
        blocking_reason: Some("NO_MODEL_SELECTED".to_string()),
        message: "Select a model to enable dictation.".to_string(),
        detail: None,
        updated_at_ms: 0,
    }
}

fn missing_model_status(snapshot: &WarmupSnapshot, model_id: &str) -> StartupWarmupStatus {
    StartupWarmupStatus {
        phase: StartupWarmupPhase::Failed,
        reason: StartupWarmupReason::ModelError,
        can_record: false,
        microphone_checked: snapshot.always_on_microphone,
        microphone_ready: !snapshot.always_on_microphone,
        model_ready: false,
        blocking_reason: Some("MODEL_NOT_FOUND".to_string()),
        message: "Failed to prepare dictation.".to_string(),
        detail: Some(format!("Model not found: {}", model_id)),
        updated_at_ms: 0,
    }
}

fn not_downloaded_status(snapshot: &WarmupSnapshot, model_name: &str) -> StartupWarmupStatus {
    StartupWarmupStatus {
        phase: StartupWarmupPhase::Idle,
        reason: StartupWarmupReason::ModelNotDownloaded,
        can_record: false,
        microphone_checked: snapshot.always_on_microphone,
        microphone_ready: !snapshot.always_on_microphone,
        model_ready: false,
        blocking_reason: Some("MODEL_NOT_DOWNLOADED".to_string()),
        message: "Download your model to enable dictation.".to_string(),
        detail: Some(format!("Model '{}' is not downloaded.", model_name)),
        updated_at_ms: 0,
    }
}

fn preparing_microphone_status(model_name: &str, model_ready: bool) -> StartupWarmupStatus {
    StartupWarmupStatus {
        phase: StartupWarmupPhase::Preparing,
        reason: StartupWarmupReason::PreparingMicrophone,
        can_record: false,
        microphone_checked: true,
        microphone_ready: false,
        model_ready,
        blocking_reason: Some("PREPARING_MICROPHONE".to_string()),
        message: "Preparing microphone...".to_string(),
        detail: Some(format!("Initializing microphone for {}", model_name)),
        updated_at_ms: 0,
    }
}

fn preparing_model_status(model_name: &str, microphone_ready: bool) -> StartupWarmupStatus {
    StartupWarmupStatus {
        phase: StartupWarmupPhase::Preparing,
        reason: StartupWarmupReason::PreparingModel,
        can_record: false,
        microphone_checked: true,
        microphone_ready,
        model_ready: false,
        blocking_reason: Some("PREPARING_MODEL".to_string()),
        message: "Loading speech engine...".to_string(),
        detail: Some(format!("Loading {}", model_name)),
        updated_at_ms: 0,
    }
}

fn ready_status(model_name: &str, microphone_ready: bool) -> StartupWarmupStatus {
    StartupWarmupStatus {
        phase: StartupWarmupPhase::Ready,
        reason: StartupWarmupReason::Ready,
        can_record: true,
        microphone_checked: true,
        microphone_ready,
        model_ready: true,
        blocking_reason: None,
        message: "Dictation ready.".to_string(),
        detail: Some(format!("{} is loaded.", model_name)),
        updated_at_ms: 0,
    }
}

fn on_demand_ready_status(model_name: &str, microphone_ready: bool) -> StartupWarmupStatus {
    StartupWarmupStatus {
        phase: StartupWarmupPhase::Ready,
        reason: StartupWarmupReason::Ready,
        can_record: true,
        microphone_checked: true,
        microphone_ready,
        model_ready: false,
        blocking_reason: None,
        message: "Dictation ready.".to_string(),
        detail: Some(format!("{} will load on first use.", model_name)),
        updated_at_ms: 0,
    }
}

fn microphone_error_status(detail: String) -> StartupWarmupStatus {
    StartupWarmupStatus {
        phase: StartupWarmupPhase::Failed,
        reason: StartupWarmupReason::MicrophoneError,
        can_record: false,
        microphone_checked: true,
        microphone_ready: false,
        model_ready: false,
        blocking_reason: Some("MICROPHONE_ERROR".to_string()),
        message: "Failed to initialize microphone.".to_string(),
        detail: Some(detail),
        updated_at_ms: 0,
    }
}

fn set_status_if_current(app: &AppHandle, generation: u64, mut next: StartupWarmupStatus) -> bool {
    let state = app.state::<StartupWarmupState>();
    if state.requested_generation.load(Ordering::SeqCst) != generation {
        return false;
    }

    next.updated_at_ms = now_ms();
    let mut guard = state
        .status
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    if state.requested_generation.load(Ordering::SeqCst) != generation {
        return false;
    }

    *guard = next.clone();
    drop(guard);
    emit_status(app, &next);
    true
}

fn resolve_model_info(
    app: &AppHandle,
    snapshot: &WarmupSnapshot,
) -> Result<ModelInfo, StartupWarmupStatus> {
    if snapshot.selected_model.trim().is_empty() {
        return Err(no_model_status(snapshot));
    }

    let Some(model_info) = app
        .try_state::<Arc<ModelManager>>()
        .and_then(|manager| manager.get_model_info(&snapshot.selected_model))
    else {
        return Err(missing_model_status(snapshot, &snapshot.selected_model));
    };

    if !model_info.is_downloaded {
        return Err(not_downloaded_status(snapshot, &model_info.name));
    }

    Ok(model_info)
}

fn immediate_status(app: &AppHandle, snapshot: &WarmupSnapshot) -> StartupWarmupStatus {
    let model_info = match resolve_model_info(app, snapshot) {
        Ok(model_info) => model_info,
        Err(status) => return status,
    };

    let (microphone_checked, microphone_ready, microphone_error) =
        match app.try_state::<Arc<AudioRecordingManager>>() {
            Some(manager) if snapshot.always_on_microphone => (
                true,
                manager.is_microphone_stream_open(),
                (!manager.is_microphone_stream_open())
                    .then(|| "Microphone stream is not open".to_string()),
            ),
            Some(manager) => match manager.preflight_microphone() {
                Ok(()) => (true, true, None),
                Err(err) => (true, false, Some(err.to_string())),
            },
            None => (false, false, Some("Audio manager unavailable".to_string())),
        };

    let model_ready = app
        .try_state::<Arc<TranscriptionManager>>()
        .map(|manager| {
            manager.get_current_model().as_deref() == Some(snapshot.selected_model.as_str())
                && manager.is_model_loaded()
        })
        .unwrap_or(false);

    if model_ready && microphone_ready {
        ready_status(&model_info.name, microphone_ready)
    } else if !snapshot.always_on_microphone && microphone_ready {
        // In on-demand mode, keeping the model cold is intentional. Showing a
        // perpetual "Loading speech engine..." banner here is misleading and
        // makes the app feel broken even though dictation can start normally.
        on_demand_ready_status(&model_info.name, microphone_ready)
    } else if snapshot.always_on_microphone && !microphone_ready {
        preparing_microphone_status(&model_info.name, model_ready)
    } else if !microphone_ready && microphone_checked {
        microphone_error_status(
            microphone_error.unwrap_or_else(|| "Microphone preflight failed".to_string()),
        )
    } else {
        preparing_model_status(&model_info.name, microphone_ready)
    }
}

pub fn initial_status(app: &AppHandle) -> StartupWarmupStatus {
    let snapshot = WarmupSnapshot::capture(app);
    immediate_status(app, &snapshot)
}

pub fn current_status(app: &AppHandle) -> StartupWarmupStatus {
    app.state::<StartupWarmupState>()
        .status
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
}

pub fn refresh_startup_warmup_status(app: &AppHandle, trigger: &'static str) {
    let state = app.state::<StartupWarmupState>();
    let generation = state.requested_generation.fetch_add(1, Ordering::SeqCst) + 1;
    let snapshot = WarmupSnapshot::capture(app);

    debug!(
        "Warmup status refresh by {} (generation {}, model='{}', always_on={}, selected_microphone={:?}, clamshell_microphone={:?})",
        trigger,
        generation,
        snapshot.selected_model,
        snapshot.always_on_microphone,
        snapshot.selected_microphone,
        snapshot.clamshell_microphone
    );

    let status = immediate_status(app, &snapshot);
    let _ = set_status_if_current(app, generation, status);
}

pub fn ensure_startup_warmup(app: &AppHandle, trigger: &'static str) {
    debug!(
        "Warmup request by {} reduced to a status refresh because dictation runtime is now fully on-demand",
        trigger
    );
    refresh_startup_warmup_status(app, trigger);
}
