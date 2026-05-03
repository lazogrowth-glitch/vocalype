use crate::runtime_observability::{
    emit_pipeline_profile, PipelineProfileEvent, PipelineStepTiming,
};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

#[derive(Clone, serde::Serialize)]
struct PasteFailureEvent {
    reason: String,
    copied_to_clipboard: bool,
}

pub(super) fn emit_paste_failed_event(
    app: &AppHandle,
    reason: impl Into<String>,
    copied_to_clipboard: bool,
) {
    let _ = app.emit(
        "paste-failed",
        PasteFailureEvent {
            reason: reason.into(),
            copied_to_clipboard,
        },
    );
}

pub(super) struct PipelineProfiler {
    binding_id: String,
    path: String,
    started_at: Instant,
    model_id: Option<String>,
    model_name: Option<String>,
    audio_duration_ms: Option<u64>,
    transcription_chars: usize,
    completed: bool,
    error_code: Option<String>,
    steps: Vec<PipelineStepTiming>,
}

impl PipelineProfiler {
    pub(super) fn new(
        binding_id: impl Into<String>,
        path: impl Into<String>,
        model_id: Option<String>,
        model_name: Option<String>,
    ) -> Self {
        Self {
            binding_id: binding_id.into(),
            path: path.into(),
            started_at: Instant::now(),
            model_id,
            model_name,
            audio_duration_ms: None,
            transcription_chars: 0,
            completed: false,
            error_code: None,
            steps: Vec::new(),
        }
    }

    pub(super) fn push_step(
        &mut self,
        step: impl Into<String>,
        duration: Duration,
        detail: Option<String>,
    ) {
        let finished_at_ms = self.started_at.elapsed().as_millis() as u64;
        let duration_ms = duration.as_millis() as u64;
        let started_at_ms = finished_at_ms.saturating_sub(duration_ms);
        self.steps.push(PipelineStepTiming {
            step: step.into(),
            duration_ms,
            started_at_ms,
            finished_at_ms,
            detail,
        });
    }

    pub(super) fn push_step_since(
        &mut self,
        step: impl Into<String>,
        started_at: Instant,
        detail: Option<String>,
    ) {
        self.push_step(step, started_at.elapsed(), detail);
    }

    pub(super) fn push_recorded_step(&mut self, step: PipelineStepTiming) {
        self.steps.push(step);
    }

    pub(super) fn set_audio_duration_samples(&mut self, samples_len: usize) {
        self.audio_duration_ms = Some(((samples_len as f64 / 16_000.0) * 1000.0).round() as u64);
    }

    pub(super) fn set_model(&mut self, model_id: Option<String>, model_name: Option<String>) {
        self.model_id = model_id;
        self.model_name = model_name;
    }

    pub(super) fn set_transcription_chars(&mut self, transcription: &str) {
        self.transcription_chars = transcription.chars().count();
    }

    pub(super) fn mark_completed(&mut self) {
        self.completed = true;
        self.error_code = None;
    }

    pub(super) fn mark_error(&mut self, error_code: impl Into<String>) {
        self.completed = false;
        self.error_code = Some(error_code.into());
    }

    pub(super) fn emit(&self, app: &AppHandle) {
        emit_pipeline_profile(
            app,
            PipelineProfileEvent {
                binding_id: self.binding_id.clone(),
                created_at_ms: crate::runtime_observability::now_ms(),
                path: self.path.clone(),
                model_id: self.model_id.clone(),
                model_name: self.model_name.clone(),
                audio_duration_ms: self.audio_duration_ms,
                transcription_chars: self.transcription_chars,
                total_duration_ms: self.started_at.elapsed().as_millis() as u64,
                completed: self.completed,
                error_code: self.error_code.clone(),
                steps: self.steps.clone(),
            },
        );
    }
}
