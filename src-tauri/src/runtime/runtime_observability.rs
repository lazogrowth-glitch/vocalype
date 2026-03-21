use crate::adaptive_runtime::{
    derive_machine_status, get_calibration_states, CalibrationStatusSnapshot, MachineStatusSnapshot,
};
use crate::context_detector::{
    detect_current_app_context, ActiveAppContextState, AppTranscriptionContext,
};
use crate::managers::audio::AudioRecordingManager;
use crate::managers::transcription::TranscriptionManager;
use crate::settings::{get_settings, AdaptiveMachineProfile};
use crate::voice_profile::{
    current_runtime_adjustment, current_voice_profile, VoiceProfile, VoiceRuntimeAdjustment,
};
use crate::TranscriptionCoordinator;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

const MAX_RUNTIME_ERRORS: usize = 100;
const MAX_PIPELINE_PROFILES: usize = 50;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum TranscriptionLifecycleState {
    Idle,
    PreparingMicrophone,
    Recording,
    Paused,
    Stopping,
    Transcribing,
    Processing,
    Pasting,
    Completed,
    Cancelled,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeErrorStage {
    Capture,
    Vad,
    Transcription,
    PostProcess,
    Paste,
    Shortcut,
    Model,
    System,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LifecycleStateEvent {
    pub state: TranscriptionLifecycleState,
    pub operation_id: Option<u64>,
    pub binding_id: Option<String>,
    pub detail: Option<String>,
    pub recoverable: bool,
    pub timestamp_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct RuntimeErrorEvent {
    pub code: String,
    pub stage: RuntimeErrorStage,
    pub message: String,
    pub recoverable: bool,
    pub operation_id: Option<u64>,
    pub device_name: Option<String>,
    pub model_id: Option<String>,
    pub timestamp_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct PipelineStepTiming {
    pub step: String,
    pub duration_ms: u64,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct PipelineProfileEvent {
    pub binding_id: String,
    pub created_at_ms: u64,
    pub path: String,
    pub model_id: Option<String>,
    pub model_name: Option<String>,
    pub audio_duration_ms: Option<u64>,
    pub transcription_chars: usize,
    pub total_duration_ms: u64,
    pub completed: bool,
    pub error_code: Option<String>,
    pub steps: Vec<PipelineStepTiming>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct RuntimeDiagnostics {
    pub captured_at_ms: u64,
    pub app_version: String,
    pub lifecycle_state: TranscriptionLifecycleState,
    pub last_lifecycle_event: LifecycleStateEvent,
    pub recent_errors: Vec<RuntimeErrorEvent>,
    pub selected_model: String,
    pub loaded_model_id: Option<String>,
    pub loaded_model_name: Option<String>,
    pub model_loaded: bool,
    pub paste_method: String,
    pub clipboard_handling: String,
    pub selected_language: String,
    pub selected_microphone: Option<String>,
    pub selected_output_device: Option<String>,
    pub is_recording: bool,
    pub is_paused: bool,
    pub operation_id: Option<u64>,
    pub active_stage: Option<TranscriptionLifecycleState>,
    pub last_audio_error: Option<String>,
    pub partial_result: bool,
    pub device_resolution: Option<String>,
    pub cancelled_at_stage: Option<TranscriptionLifecycleState>,
    pub current_app_context: Option<AppTranscriptionContext>,
    pub last_transcription_app_context: Option<AppTranscriptionContext>,
    pub adaptive_voice_profile_enabled: bool,
    pub adaptive_voice_profile: Option<VoiceProfile>,
    pub active_voice_runtime_adjustment: Option<VoiceRuntimeAdjustment>,
    pub machine_status: Option<MachineStatusSnapshot>,
    pub recent_pipeline_profiles: Vec<PipelineProfileEvent>,
    pub adaptive_machine_profile: Option<AdaptiveMachineProfile>,
    pub adaptive_calibration_state: Vec<CalibrationStatusSnapshot>,
}

pub struct RuntimeObservabilityState {
    lifecycle_state: Mutex<TranscriptionLifecycleState>,
    last_lifecycle_event: Mutex<LifecycleStateEvent>,
    recent_errors: Mutex<VecDeque<RuntimeErrorEvent>>,
    recent_pipeline_profiles: Mutex<VecDeque<PipelineProfileEvent>>,
}

impl RuntimeObservabilityState {
    pub fn new() -> Self {
        let now = now_ms();
        Self {
            lifecycle_state: Mutex::new(TranscriptionLifecycleState::Idle),
            last_lifecycle_event: Mutex::new(LifecycleStateEvent {
                state: TranscriptionLifecycleState::Idle,
                operation_id: None,
                binding_id: None,
                detail: Some("startup".to_string()),
                recoverable: true,
                timestamp_ms: now,
            }),
            recent_errors: Mutex::new(VecDeque::new()),
            recent_pipeline_profiles: Mutex::new(VecDeque::new()),
        }
    }

    fn set_lifecycle(&self, event: LifecycleStateEvent) {
        *self
            .lifecycle_state
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = event.state;
        *self
            .last_lifecycle_event
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = event;
    }

    fn push_error(&self, error: RuntimeErrorEvent) {
        let mut errors = self.recent_errors.lock().unwrap_or_else(|e| e.into_inner());
        errors.push_back(error);
        while errors.len() > MAX_RUNTIME_ERRORS {
            errors.pop_front();
        }
    }

    fn push_pipeline_profile(&self, profile: PipelineProfileEvent) {
        let mut profiles = self
            .recent_pipeline_profiles
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        profiles.push_back(profile);
        while profiles.len() > MAX_PIPELINE_PROFILES {
            profiles.pop_front();
        }
    }

    pub fn snapshot(
        &self,
    ) -> (
        TranscriptionLifecycleState,
        LifecycleStateEvent,
        Vec<RuntimeErrorEvent>,
        Vec<PipelineProfileEvent>,
    ) {
        (
            *self
                .lifecycle_state
                .lock()
                .unwrap_or_else(|e| e.into_inner()),
            self.last_lifecycle_event
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clone(),
            self.recent_errors
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .iter()
                .cloned()
                .collect(),
            self.recent_pipeline_profiles
                .lock()
                .unwrap()
                .iter()
                .cloned()
                .collect(),
        )
    }
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub fn emit_lifecycle_state(
    app: &AppHandle,
    state: TranscriptionLifecycleState,
    binding_id: Option<&str>,
    detail: Option<&str>,
) {
    emit_lifecycle_state_with_context(app, state, None, binding_id, detail, true);
}

pub fn emit_lifecycle_state_with_context(
    app: &AppHandle,
    state: TranscriptionLifecycleState,
    operation_id: Option<u64>,
    binding_id: Option<&str>,
    detail: Option<&str>,
    recoverable: bool,
) {
    let event = LifecycleStateEvent {
        state,
        operation_id,
        binding_id: binding_id.map(ToString::to_string),
        detail: detail.map(ToString::to_string),
        recoverable,
        timestamp_ms: now_ms(),
    };

    if let Some(obs) = app.try_state::<RuntimeObservabilityState>() {
        obs.set_lifecycle(event.clone());
    }

    let _ = app.emit("transcription-lifecycle", event);
}

pub fn emit_runtime_error(
    app: &AppHandle,
    code: impl Into<String>,
    stage: RuntimeErrorStage,
    message: impl Into<String>,
    recoverable: bool,
) {
    emit_runtime_error_with_context(app, code, stage, message, recoverable, None, None, None);
}

pub fn emit_runtime_error_with_context(
    app: &AppHandle,
    code: impl Into<String>,
    stage: RuntimeErrorStage,
    message: impl Into<String>,
    recoverable: bool,
    operation_id: Option<u64>,
    device_name: Option<String>,
    model_id: Option<String>,
) {
    let resolved_operation_id = operation_id.or_else(|| {
        app.try_state::<TranscriptionCoordinator>()
            .and_then(|coordinator| coordinator.active_operation_id())
    });
    let event = RuntimeErrorEvent {
        code: code.into(),
        stage,
        message: message.into(),
        recoverable,
        operation_id: resolved_operation_id,
        device_name,
        model_id,
        timestamp_ms: now_ms(),
    };

    if let Some(obs) = app.try_state::<RuntimeObservabilityState>() {
        obs.push_error(event.clone());
    }

    if resolved_operation_id.is_some() {
        emit_lifecycle_state_with_context(
            app,
            TranscriptionLifecycleState::Error,
            resolved_operation_id,
            None,
            Some(&event.code),
            recoverable,
        );
    }
    let _ = app.emit("runtime-error", event);
}

pub fn emit_pipeline_profile(app: &AppHandle, profile: PipelineProfileEvent) {
    if let Some(obs) = app.try_state::<RuntimeObservabilityState>() {
        obs.push_pipeline_profile(profile.clone());
    }

    log::info!(
        "Pipeline profile [{}] model={:?} total={}ms steps={}",
        profile.binding_id,
        profile.model_id,
        profile.total_duration_ms,
        profile
            .steps
            .iter()
            .map(|step| format!("{}={}ms", step.step, step.duration_ms))
            .collect::<Vec<_>>()
            .join(", ")
    );
    let _ = app.emit("pipeline-profile", profile);
}

pub fn collect_runtime_diagnostics(app: &AppHandle) -> RuntimeDiagnostics {
    let settings = get_settings(app);
    let tm = app.state::<std::sync::Arc<TranscriptionManager>>();
    let am = app.state::<std::sync::Arc<AudioRecordingManager>>();
    let active_context_state = app.try_state::<ActiveAppContextState>();
    let selected_model = settings.selected_model.clone();
    let selected_language = settings.selected_language.clone();
    let selected_microphone = settings.selected_microphone.clone();
    let selected_output_device = settings.selected_output_device.clone();
    let adaptive_voice_profile_enabled = settings.adaptive_voice_profile_enabled;
    let current_model_id = tm.get_current_model();
    let active_voice_runtime_adjustment = if adaptive_voice_profile_enabled {
        let model_id = current_model_id
            .clone()
            .unwrap_or_else(|| selected_model.clone());
        settings
            .adaptive_whisper_config(&model_id)
            .and_then(|config| {
                current_runtime_adjustment(app, &model_id, config.chunk_seconds, config.overlap_ms)
            })
    } else {
        None
    };
    let adaptive_voice_profile = if adaptive_voice_profile_enabled {
        current_voice_profile(app)
    } else {
        None
    };

    let (lifecycle_state, last_lifecycle_event, recent_errors, recent_pipeline_profiles) =
        if let Some(obs) = app.try_state::<RuntimeObservabilityState>() {
            obs.snapshot()
        } else {
            let fallback = LifecycleStateEvent {
                state: TranscriptionLifecycleState::Idle,
                operation_id: None,
                binding_id: None,
                detail: Some("observability-uninitialized".to_string()),
                recoverable: true,
                timestamp_ms: now_ms(),
            };
            (
                TranscriptionLifecycleState::Idle,
                fallback,
                Vec::new(),
                Vec::new(),
            )
        };

    let adaptive_calibration_state = get_calibration_states();
    let machine_status = derive_machine_status(
        settings.adaptive_machine_profile.as_ref(),
        &adaptive_calibration_state,
        tm.get_current_model().as_deref(),
    );
    let (operation_id, active_stage, cancelled_at_stage, partial_result) = app
        .try_state::<TranscriptionCoordinator>()
        .map(|coordinator| coordinator.diagnostics_snapshot())
        .unwrap_or((None, None, None, false));

    RuntimeDiagnostics {
        captured_at_ms: now_ms(),
        app_version: app.package_info().version.to_string(),
        lifecycle_state,
        last_lifecycle_event,
        recent_errors,
        selected_model,
        loaded_model_id: current_model_id,
        loaded_model_name: tm.get_current_model_name(),
        model_loaded: tm.is_model_loaded(),
        paste_method: format!("{:?}", settings.paste_method),
        clipboard_handling: format!("{:?}", settings.clipboard_handling),
        selected_language,
        selected_microphone,
        selected_output_device,
        is_recording: am.is_recording(),
        is_paused: am.is_paused(),
        operation_id,
        active_stage,
        last_audio_error: am.last_error_message(),
        partial_result,
        device_resolution: am.last_device_resolution(),
        cancelled_at_stage,
        current_app_context: Some(detect_current_app_context()),
        last_transcription_app_context: active_context_state
            .as_ref()
            .and_then(|state| state.0.lock().ok())
            .and_then(|snapshot| snapshot.last_transcription_context()),
        adaptive_voice_profile_enabled,
        adaptive_voice_profile,
        active_voice_runtime_adjustment,
        machine_status,
        recent_pipeline_profiles,
        adaptive_machine_profile: settings.adaptive_machine_profile,
        adaptive_calibration_state,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_error_buffer_is_bounded() {
        let state = RuntimeObservabilityState::new();
        for i in 0..(MAX_RUNTIME_ERRORS + 25) {
            state.push_error(RuntimeErrorEvent {
                code: format!("E{}", i),
                stage: RuntimeErrorStage::Unknown,
                message: "x".to_string(),
                recoverable: true,
                operation_id: None,
                device_name: None,
                model_id: None,
                timestamp_ms: i as u64,
            });
        }

        let (_, _, errors, _) = state.snapshot();
        assert_eq!(errors.len(), MAX_RUNTIME_ERRORS);
        assert_eq!(errors.first().unwrap().code, "E25");
        assert_eq!(
            errors.last().unwrap().code,
            format!("E{}", MAX_RUNTIME_ERRORS + 24)
        );
    }
}
