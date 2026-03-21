use crate::managers::audio::AudioRecordingManager;
use crate::managers::model::{ModelInfo, ModelManager};
use crate::managers::transcription::TranscriptionManager;
use crate::settings::get_settings;
use log::debug;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
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
    pub microphone_ready: bool,
    pub model_ready: bool,
    pub message: String,
    pub detail: Option<String>,
    pub updated_at_ms: u64,
}

pub struct StartupWarmupState {
    status: Mutex<StartupWarmupStatus>,
    requested_generation: AtomicU64,
    running: AtomicBool,
}

impl StartupWarmupState {
    pub fn new(status: StartupWarmupStatus) -> Self {
        Self {
            status: Mutex::new(status),
            requested_generation: AtomicU64::new(0),
            running: AtomicBool::new(false),
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
        microphone_ready: !snapshot.always_on_microphone,
        model_ready: false,
        message: "Choisissez un modele pour activer la dictee.".to_string(),
        detail: None,
        updated_at_ms: 0,
    }
}

fn missing_model_status(snapshot: &WarmupSnapshot, model_id: &str) -> StartupWarmupStatus {
    StartupWarmupStatus {
        phase: StartupWarmupPhase::Failed,
        reason: StartupWarmupReason::ModelError,
        can_record: false,
        microphone_ready: !snapshot.always_on_microphone,
        model_ready: false,
        message: "Impossible de preparer la dictee.".to_string(),
        detail: Some(format!("Modele introuvable: {}", model_id)),
        updated_at_ms: 0,
    }
}

fn not_downloaded_status(snapshot: &WarmupSnapshot, model_name: &str) -> StartupWarmupStatus {
    StartupWarmupStatus {
        phase: StartupWarmupPhase::Idle,
        reason: StartupWarmupReason::ModelNotDownloaded,
        can_record: false,
        microphone_ready: !snapshot.always_on_microphone,
        model_ready: false,
        message: "Telechargez votre modele pour activer la dictee.".to_string(),
        detail: Some(format!("Le modele '{}' n'est pas telecharge.", model_name)),
        updated_at_ms: 0,
    }
}

fn preparing_microphone_status(model_name: &str, model_ready: bool) -> StartupWarmupStatus {
    StartupWarmupStatus {
        phase: StartupWarmupPhase::Preparing,
        reason: StartupWarmupReason::PreparingMicrophone,
        can_record: false,
        microphone_ready: false,
        model_ready,
        message: "Preparation du micro...".to_string(),
        detail: Some(format!("Initialisation du microphone pour {}", model_name)),
        updated_at_ms: 0,
    }
}

fn preparing_model_status(model_name: &str, microphone_ready: bool) -> StartupWarmupStatus {
    StartupWarmupStatus {
        phase: StartupWarmupPhase::Preparing,
        reason: StartupWarmupReason::PreparingModel,
        can_record: false,
        microphone_ready,
        model_ready: false,
        message: "Preparation du moteur vocal...".to_string(),
        detail: Some(format!("Chargement de {}", model_name)),
        updated_at_ms: 0,
    }
}

fn ready_status(model_name: &str, microphone_ready: bool) -> StartupWarmupStatus {
    StartupWarmupStatus {
        phase: StartupWarmupPhase::Ready,
        reason: StartupWarmupReason::Ready,
        can_record: true,
        microphone_ready,
        model_ready: true,
        message: "Dictee prete".to_string(),
        detail: Some(format!("{} est charge.", model_name)),
        updated_at_ms: 0,
    }
}

fn microphone_error_status(detail: String) -> StartupWarmupStatus {
    StartupWarmupStatus {
        phase: StartupWarmupPhase::Failed,
        reason: StartupWarmupReason::MicrophoneError,
        can_record: false,
        microphone_ready: false,
        model_ready: false,
        message: "Impossible d'initialiser le microphone.".to_string(),
        detail: Some(detail),
        updated_at_ms: 0,
    }
}

fn model_error_status(model_name: &str, detail: String, microphone_ready: bool) -> StartupWarmupStatus {
    StartupWarmupStatus {
        phase: StartupWarmupPhase::Failed,
        reason: StartupWarmupReason::ModelError,
        can_record: false,
        microphone_ready,
        model_ready: false,
        message: "Le moteur vocal n'a pas pu etre charge.".to_string(),
        detail: Some(format!("{} {}", model_name, detail)),
        updated_at_ms: 0,
    }
}

fn current_generation(app: &AppHandle) -> u64 {
    let state = app.state::<StartupWarmupState>();
    state.requested_generation.load(Ordering::SeqCst)
}

fn is_generation_current(app: &AppHandle, generation: u64) -> bool {
    current_generation(app) == generation
}

fn set_status_if_current(
    app: &AppHandle,
    generation: u64,
    mut next: StartupWarmupStatus,
) -> bool {
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

fn resolve_model_info(app: &AppHandle, snapshot: &WarmupSnapshot) -> Result<ModelInfo, StartupWarmupStatus> {
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

    let microphone_ready = if snapshot.always_on_microphone {
        app.try_state::<Arc<AudioRecordingManager>>()
            .map(|manager| manager.is_microphone_stream_open())
            .unwrap_or(false)
    } else {
        true
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
    } else if snapshot.always_on_microphone && !microphone_ready {
        preparing_microphone_status(&model_info.name, model_ready)
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

pub fn can_start_recording(app: &AppHandle) -> bool {
    current_status(app).can_record
}

pub fn block_message(app: &AppHandle) -> String {
    let status = current_status(app);
    status
        .detail
        .filter(|detail| !detail.trim().is_empty())
        .unwrap_or(status.message)
}

fn run_generation(app: &AppHandle, generation: u64) {
    let snapshot = WarmupSnapshot::capture(app);
    let model_info = match resolve_model_info(app, &snapshot) {
        Ok(model_info) => model_info,
        Err(status) => {
            let _ = set_status_if_current(app, generation, status);
            return;
        }
    };

    let audio_manager = app.state::<Arc<AudioRecordingManager>>();
    let transcription_manager = app.state::<Arc<TranscriptionManager>>();

    let mut microphone_ready = if snapshot.always_on_microphone {
        audio_manager.is_microphone_stream_open()
    } else {
        true
    };
    let mut model_ready = transcription_manager.get_current_model().as_deref()
        == Some(snapshot.selected_model.as_str())
        && transcription_manager.is_model_loaded();

    if microphone_ready && model_ready {
        let _ = set_status_if_current(app, generation, ready_status(&model_info.name, true));
        return;
    }

    if snapshot.always_on_microphone && !microphone_ready {
        if !set_status_if_current(
            app,
            generation,
            preparing_microphone_status(&model_info.name, model_ready),
        ) {
            return;
        }

        match audio_manager.start_microphone_stream() {
            Ok(()) => {
                microphone_ready = true;
            }
            Err(err) => {
                let _ =
                    set_status_if_current(app, generation, microphone_error_status(err.to_string()));
                return;
            }
        }
    }

    if !model_ready {
        if !set_status_if_current(
            app,
            generation,
            preparing_model_status(&model_info.name, microphone_ready),
        ) {
            return;
        }

        if !is_generation_current(app, generation) {
            return;
        }

        match transcription_manager.ensure_model_loaded(&snapshot.selected_model) {
            Ok(()) => {
                model_ready = transcription_manager.get_current_model().as_deref()
                    == Some(snapshot.selected_model.as_str())
                    && transcription_manager.is_model_loaded();
            }
            Err(err) => {
                let _ = set_status_if_current(
                    app,
                    generation,
                    model_error_status(&model_info.name, err.to_string(), microphone_ready),
                );
                return;
            }
        }
    }

    if !is_generation_current(app, generation) {
        return;
    }

    if microphone_ready && model_ready {
        let _ = set_status_if_current(
            app,
            generation,
            ready_status(&model_info.name, microphone_ready),
        );
    } else {
        let _ = set_status_if_current(
            app,
            generation,
            model_error_status(
                &model_info.name,
                "n'est pas pret.".to_string(),
                microphone_ready,
            ),
        );
    }
}

fn spawn_runner(app: &AppHandle) {
    let app_handle = app.clone();
    thread::spawn(move || {
        loop {
            let generation = current_generation(&app_handle);
            debug!("Running startup warmup generation {}", generation);
            run_generation(&app_handle, generation);

            let state = app_handle.state::<StartupWarmupState>();
            let latest_generation = state.requested_generation.load(Ordering::SeqCst);
            if latest_generation != generation {
                continue;
            }

            state.running.store(false, Ordering::SeqCst);

            if state.requested_generation.load(Ordering::SeqCst) == generation {
                break;
            }

            if state
                .running
                .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                .is_err()
            {
                break;
            }
        }
    });
}

pub fn ensure_startup_warmup(app: &AppHandle, trigger: &'static str) {
    let state = app.state::<StartupWarmupState>();
    let generation = state.requested_generation.fetch_add(1, Ordering::SeqCst) + 1;
    let snapshot = WarmupSnapshot::capture(app);

    debug!(
        "Warmup requested by {} (generation {}, model='{}', always_on={}, selected_microphone={:?}, clamshell_microphone={:?})",
        trigger,
        generation,
        snapshot.selected_model,
        snapshot.always_on_microphone,
        snapshot.selected_microphone,
        snapshot.clamshell_microphone
    );

    let status = immediate_status(app, &snapshot);
    let _ = set_status_if_current(app, generation, status.clone());

    if matches!(status.phase, StartupWarmupPhase::Idle | StartupWarmupPhase::Ready) {
        return;
    }

    if !state.running.swap(true, Ordering::SeqCst) {
        spawn_runner(app);
    }
}
