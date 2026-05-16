mod engine_loader;
pub(crate) mod inference;

use crate::audio_toolkit::apply_custom_words;
use crate::context_detector::AppTranscriptionContext;
use crate::managers::audio::AudioRecordingManager;
use crate::managers::model::{EngineType, ModelManager};
use crate::runtime_observability::PipelineStepTiming;
use crate::settings::{get_settings, set_active_runtime_model, NpuKind};
use crate::transcription_confidence::{
    build_parakeet_confidence_payload, build_whisper_confidence_payload, ParakeetConfidenceInputs,
    TranscriptionConfidencePayload,
};
use crate::vocabulary_store::VocabularyStoreState;
use anyhow::Result;
use log::{debug, error, info, warn};
use parakeet_rs::{
    ExecutionConfig as ParakeetExecutionConfig, ExecutionProvider as ParakeetExecutionProvider,
    ParakeetEOU, ParakeetTDT, TimestampMode as ParakeetTimestampMode, Transcriber,
};
use parking_lot::{Condvar, Mutex, MutexGuard};
use serde::Serialize;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Emitter, Manager};

const MODEL_UNLOAD_IDLE_MS: u64 = 10_000;
const ACTIVE_SESSION_STALE_MS: u64 = 30_000;

#[cfg(target_os = "windows")]
fn parakeet_provider_label(provider: ParakeetExecutionProvider) -> &'static str {
    match provider {
        ParakeetExecutionProvider::Cpu => "cpu",
        ParakeetExecutionProvider::Qnn => "qnn",
        ParakeetExecutionProvider::DirectML => "directml",
        ParakeetExecutionProvider::OpenVINO => "openvino",
        ParakeetExecutionProvider::OpenVinoNpu => "openvino-npu",
        ParakeetExecutionProvider::OpenVinoGpu => "openvino-gpu",
    }
}

#[cfg(not(target_os = "windows"))]
fn parakeet_provider_label(provider: ParakeetExecutionProvider) -> &'static str {
    match provider {
        ParakeetExecutionProvider::Cpu => "cpu",
        #[allow(unreachable_patterns)]
        _ => "cpu",
    }
}

#[cfg(target_os = "windows")]
fn parakeet_v3_provider_candidates(app_handle: &AppHandle) -> Vec<ParakeetExecutionProvider> {
    let settings = get_settings(app_handle);
    let Some(profile) = settings.adaptive_machine_profile else {
        return vec![ParakeetExecutionProvider::Cpu];
    };

    // CPU is always tried first for fast, reliable loading.
    // NPU/GPU providers are appended as fallback candidates only — they can
    // take dozens of minutes to initialize/compile on first use.
    let mut providers = vec![ParakeetExecutionProvider::Cpu];

    match profile.npu_kind {
        NpuKind::Qualcomm => {
            providers.push(ParakeetExecutionProvider::Qnn);
        }
        NpuKind::Intel => {
            providers.push(ParakeetExecutionProvider::OpenVinoNpu);
            providers.push(ParakeetExecutionProvider::OpenVinoGpu);
            providers.push(ParakeetExecutionProvider::OpenVINO);
        }
        NpuKind::Amd => {
            providers.push(ParakeetExecutionProvider::OpenVinoGpu);
            providers.push(ParakeetExecutionProvider::DirectML);
        }
        NpuKind::Unknown | NpuKind::None => {}
    }

    providers.dedup();
    providers
}

#[cfg(not(target_os = "windows"))]
fn parakeet_v3_provider_candidates(_app_handle: &AppHandle) -> Vec<ParakeetExecutionProvider> {
    vec![ParakeetExecutionProvider::Cpu]
}

fn parakeet_v3_execution_config(provider: ParakeetExecutionProvider) -> ParakeetExecutionConfig {
    let intra_threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .min(8);

    ParakeetExecutionConfig::new()
        .with_execution_provider(provider)
        .with_intra_threads(intra_threads)
        .with_inter_threads(1)
}

#[derive(Clone, Debug, Serialize)]
pub struct ModelStateEvent {
    pub event_type: String,
    pub model_id: Option<String>,
    pub model_name: Option<String>,
    pub error: Option<String>,
}

#[derive(Clone, Debug)]
pub struct TranscriptionRequest {
    pub audio: Vec<f32>,
    pub app_context: Option<AppTranscriptionContext>,
}

#[derive(Clone, Debug)]
pub struct TranscriptionOutput {
    pub text: String,
    pub confidence_payload: Option<TranscriptionConfidencePayload>,
    pub timings: Vec<PipelineStepTiming>,
    /// Word-level timed segments from the model (Parakeet V3 only).
    /// Each segment carries a `start` / `end` in seconds relative to the
    /// audio buffer that was passed to the engine.  Used by the chunking
    /// worker to trim the overlap prefix without relying on fragile text dedup.
    pub segments: Option<Vec<transcribe_rs::TranscriptionSegment>>,
}

struct EngineTranscriptionResult {
    text: String,
    segments: Option<Vec<transcribe_rs::TranscriptionSegment>>,
}

#[derive(Debug)]
enum ParakeetStatefulStatus {
    Disabled,
    MissingModelFiles,
    LoadFailed(String),
    Ready { model_path: std::path::PathBuf },
}

struct ParakeetStatefulRuntime {
    engine: ParakeetEOU,
    last_operation_id: Option<u64>,
}

impl ParakeetStatefulRuntime {
    fn new(engine: ParakeetEOU) -> Self {
        Self {
            engine,
            last_operation_id: None,
        }
    }

    fn prepare_session(&mut self, operation_id: Option<u64>) {
        if self.last_operation_id != operation_id {
            self.engine.reset_streaming_state();
            self.last_operation_id = operation_id;
        }
    }
}

struct ParakeetV3Runtime {
    tdt: ParakeetTDT,
    stateful: Option<ParakeetStatefulRuntime>,
    stateful_status: ParakeetStatefulStatus,
}

impl ParakeetV3Runtime {
    fn new(
        tdt: ParakeetTDT,
        stateful: Option<ParakeetStatefulRuntime>,
        stateful_status: ParakeetStatefulStatus,
    ) -> Self {
        Self {
            tdt,
            stateful,
            stateful_status,
        }
    }
}

enum LoadedEngine {
    ParakeetV3(ParakeetV3Runtime),
}

#[derive(Clone)]
pub struct TranscriptionManager {
    engine: Arc<Mutex<Option<LoadedEngine>>>,
    model_manager: Arc<ModelManager>,
    app_handle: AppHandle,
    current_model_id: Arc<Mutex<Option<String>>>,
    last_activity: Arc<AtomicU64>,
    unload_generation: Arc<AtomicU64>,
    shutdown_signal: Arc<AtomicBool>,
    watcher_handle: Arc<Mutex<Option<thread::JoinHandle<()>>>>,
    is_loading: Arc<Mutex<bool>>,
    loading_condvar: Arc<Condvar>,
    /// True while a transcription call is actively running inference.
    /// Concurrent chunks wait on `inferring_condvar` instead of failing with
    /// "Model is not loaded" — which happens when one chunk holds the engine
    /// via `take()` (temporarily setting the mutex to None) while another
    /// chunk checks it simultaneously.
    is_inferring: Arc<Mutex<bool>>,
    inferring_condvar: Arc<Condvar>,
    /// Number of consecutive engine panics since the last successful inference.
    /// Reset to 0 on every successful transcription.
    consecutive_panics: Arc<AtomicU64>,
    /// Timestamp (ms since epoch) before which new inference calls must wait.
    /// Set after each panic using exponential backoff (2^n seconds, max 60 s).
    panic_backoff_until_ms: Arc<AtomicU64>,
}

impl TranscriptionManager {
    fn now_ms() -> u64 {
        SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("System clock is before Unix epoch")
            .as_millis() as u64
    }

    fn touch_activity(&self) {
        self.last_activity.store(Self::now_ms(), Ordering::Relaxed);
        self.unload_generation.fetch_add(1, Ordering::Relaxed);
    }

    fn schedule_idle_unload(&self, context: &str) {
        let generation = self.unload_generation.load(Ordering::Relaxed);
        let manager = self.clone();
        let context = context.to_string();
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(MODEL_UNLOAD_IDLE_MS));

            if manager.unload_generation.load(Ordering::Relaxed) != generation {
                debug!(
                    "[model-unload] timed unload cancelled context={} generation={} current_generation={}",
                    context,
                    generation,
                    manager.unload_generation.load(Ordering::Relaxed)
                );
                return;
            }

            if manager.is_transcription_session_active() {
                info!(
                    "[model-unload] timed unload skipped after {} because a transcription session is still active",
                    context
                );
                return;
            }

            if !manager.is_model_loaded() {
                debug!(
                    "[model-unload] timed unload found model already unloaded after {}",
                    context
                );
                return;
            }

            info!(
                "[model-unload] timed unload firing after {} (generation={})",
                context, generation
            );
            if let Err(err) = manager.unload_model() {
                warn!(
                    "[model-unload] timed unload failed after {}: {}",
                    context, err
                );
            }
        });
    }

    fn coordinator_session_snapshot(
        &self,
    ) -> Option<crate::runtime::transcription_coordinator::ActiveSessionSnapshot> {
        self.app_handle
            .try_state::<crate::TranscriptionCoordinator>()
            .map(|coordinator| coordinator.active_session_snapshot())
    }

    fn is_transcription_session_active(&self) -> bool {
        let coordinator_snapshot = self.coordinator_session_snapshot();
        let operation_active = coordinator_snapshot
            .as_ref()
            .and_then(|snapshot| snapshot.operation_id)
            .is_some();
        let lifecycle_state = coordinator_snapshot.map(|snapshot| snapshot.lifecycle_state);

        if !operation_active {
            let recording_active = self
                .app_handle
                .try_state::<Arc<AudioRecordingManager>>()
                .map(|audio_manager| audio_manager.is_recording())
                .unwrap_or(false);
            if recording_active {
                warn!(
                    "[model-unload] coordinator reported no active session but microphone is still recording; treating session as active as a safety fallback"
                );
                return true;
            }
            debug!(
                "[model-unload] session-active=false recording_active={} operation_active={} lifecycle_state={:?}",
                recording_active,
                operation_active,
                lifecycle_state
            );
            return false;
        }

        let age_ms = Self::now_ms().saturating_sub(self.last_activity.load(Ordering::Relaxed));
        if age_ms > ACTIVE_SESSION_STALE_MS {
            let recording_active = self
                .app_handle
                .try_state::<Arc<AudioRecordingManager>>()
                .map(|audio_manager| audio_manager.is_recording())
                .unwrap_or(false);
            warn!(
                "[model-unload] ignoring stale transcription session marker recording_active={} operation_active={} lifecycle_state={:?} idle_ms={}",
                recording_active,
                operation_active,
                lifecycle_state,
                age_ms
            );
            return false;
        }

        let recording_active = self
            .app_handle
            .try_state::<Arc<AudioRecordingManager>>()
            .map(|audio_manager| audio_manager.is_recording())
            .unwrap_or(false);
        debug!(
            "[model-unload] session-active=true recording_active={} operation_active={} lifecycle_state={:?} idle_ms={}",
            recording_active,
            operation_active,
            lifecycle_state,
            age_ms
        );
        true
    }

    fn filter_transcription_output_for_context(
        text: String,
        _model_id: Option<&str>,
        _app_context: Option<&AppTranscriptionContext>,
    ) -> String {
        text
    }

    pub fn new(app_handle: &AppHandle, model_manager: Arc<ModelManager>) -> Result<Self> {
        let manager = Self {
            engine: Arc::new(Mutex::new(None)),
            model_manager,
            app_handle: app_handle.clone(),
            current_model_id: Arc::new(Mutex::new(None)),
            last_activity: Arc::new(AtomicU64::new(
                SystemTime::now()
                    .duration_since(SystemTime::UNIX_EPOCH)
                    .expect("System clock is before Unix epoch")
                    .as_millis() as u64,
            )),
            unload_generation: Arc::new(AtomicU64::new(0)),
            shutdown_signal: Arc::new(AtomicBool::new(false)),
            watcher_handle: Arc::new(Mutex::new(None)),
            is_loading: Arc::new(Mutex::new(false)),
            loading_condvar: Arc::new(Condvar::new()),
            is_inferring: Arc::new(Mutex::new(false)),
            inferring_condvar: Arc::new(Condvar::new()),
            consecutive_panics: Arc::new(AtomicU64::new(0)),
            panic_backoff_until_ms: Arc::new(AtomicU64::new(0)),
        };

        // Start the idle watcher
        {
            let app_handle_cloned = app_handle.clone();
            let manager_cloned = manager.clone();
            let shutdown_signal = manager.shutdown_signal.clone();
            let handle = thread::spawn(move || {
                while !shutdown_signal.load(Ordering::Relaxed) {
                    thread::sleep(Duration::from_secs(10)); // Check every 10 seconds

                    // Check shutdown signal again after sleep
                    if shutdown_signal.load(Ordering::Relaxed) {
                        break;
                    }

                    let settings = get_settings(&app_handle_cloned);
                    let last = manager_cloned.last_activity.load(Ordering::Relaxed);
                    let now_ms = Self::now_ms();
                    // Respect the user-configured unload timeout; fall back to the
                    // compile-time constant only when the setting resolves to zero seconds.
                    let idle_limit_ms = settings
                        .model_unload_timeout
                        .to_seconds()
                        .map(|s| s * 1_000)
                        .unwrap_or(MODEL_UNLOAD_IDLE_MS);
                    let idle_ms = now_ms.saturating_sub(last);

                    // ModelUnloadTimeout::Never → to_seconds() returns None →
                    // we used MODEL_UNLOAD_IDLE_MS above, which is not "never".
                    // Handle Never explicitly: skip this tick entirely.
                    if settings.model_unload_timeout == crate::settings::ModelUnloadTimeout::Never {
                        debug!("[model-unload] watcher skipped: unload timeout=Never");
                        continue;
                    }

                    debug!(
                        "[model-unload] watcher tick loaded={} loading={} hidden_mode={} idle_ms={} idle_limit_ms={} setting={:?}",
                        manager_cloned.is_model_loaded(),
                        manager_cloned.is_loading_model(),
                        manager_cloned.should_force_background_lean_unload(),
                        idle_ms,
                        idle_limit_ms,
                        settings.model_unload_timeout
                    );

                    if idle_ms > idle_limit_ms {
                        if manager_cloned.is_transcription_session_active() {
                            debug!(
                                "[model-unload] watcher skipped unload because a transcription session is still active"
                            );
                            continue;
                        }

                        if manager_cloned.is_model_loaded() {
                            let unload_start = std::time::Instant::now();
                            info!(
                                "[model-unload] watcher unloading model due to inactivity idle_ms={} idle_limit_ms={}",
                                idle_ms,
                                idle_limit_ms
                            );

                            if let Ok(()) = manager_cloned.unload_model() {
                                let _ = app_handle_cloned.emit(
                                    "model-state-changed",
                                    ModelStateEvent {
                                        event_type: "unloaded".to_string(),
                                        model_id: None,
                                        model_name: None,
                                        error: None,
                                    },
                                );
                                let unload_duration = unload_start.elapsed();
                                info!(
                                    "[model-unload] watcher unloaded model due to inactivity (took {}ms)",
                                    unload_duration.as_millis()
                                );
                            }
                        } else {
                            debug!(
                                "[model-unload] watcher wanted to unload but model was already not loaded"
                            );
                        }
                    }
                }
                debug!("Idle watcher thread shutting down gracefully");
            });
            *manager.watcher_handle.lock() = Some(handle);
        }

        Ok(manager)
    }

    /// Lock the engine mutex.
    fn lock_engine(&self) -> MutexGuard<'_, Option<LoadedEngine>> {
        self.engine.lock()
    }

    pub fn is_model_loaded(&self) -> bool {
        let engine = self.lock_engine();
        engine.is_some()
    }

    pub fn is_loading_model(&self) -> bool {
        *self.is_loading.lock()
    }

    pub fn unload_model(&self) -> Result<()> {
        let unload_start = std::time::Instant::now();
        let previous_model_id = self.get_current_model();
        info!(
            "[model-unload] unload_model start previous_model_id={:?} hidden_mode={} loading={}",
            previous_model_id,
            self.should_force_background_lean_unload(),
            self.is_loading_model()
        );

        {
            let mut engine = self.lock_engine();
            *engine = None; // Drop the engine to free memory
        }
        {
            let mut current_model = self.current_model_id.lock();
            *current_model = None;
        }
        // Runtime cache is kept on disk so the next load doesn't need to
        // decrypt + extract again. Cache is only cleared when a model is deleted.
        set_active_runtime_model(&self.app_handle, None);

        // Emit unloaded event
        let _ = self.app_handle.emit(
            "model-state-changed",
            ModelStateEvent {
                event_type: "unloaded".to_string(),
                model_id: None,
                model_name: None,
                error: None,
            },
        );

        let unload_duration = unload_start.elapsed();
        info!(
            "[model-unload] unload_model complete previous_model_id={:?} took_ms={}",
            previous_model_id,
            unload_duration.as_millis()
        );
        Ok(())
    }

    fn should_force_background_lean_unload(&self) -> bool {
        let Some(main_window) = self.app_handle.get_webview_window("main") else {
            return true;
        };

        match main_window.is_visible() {
            Ok(is_visible) => !is_visible,
            Err(err) => {
                debug!(
                    "Falling back to aggressive unload because main window visibility could not be read: {}",
                    err
                );
                true
            }
        }
    }

    /// Release the "inference in progress" slot so waiting chunks can proceed.
    /// Must be called on every exit path after `is_inferring` was set to true
    /// in `transcribe_detailed_request`.
    pub(super) fn release_inferring_slot(&self) {
        let mut is_inferring = self.is_inferring.lock();
        *is_inferring = false;
        self.inferring_condvar.notify_all();
    }

    /// Unloads the model immediately if the setting is enabled and the model is loaded
    pub fn maybe_unload_immediately(&self, context: &str) {
        let settings = get_settings(&self.app_handle);
        let should_force_hidden_unload = self.should_force_background_lean_unload();
        let should_unload_now = self.is_model_loaded();

        let coordinator_snapshot = self.coordinator_session_snapshot();
        let lifecycle_state = coordinator_snapshot.map(|snapshot| snapshot.lifecycle_state);
        let active_operation_id = coordinator_snapshot.and_then(|snapshot| snapshot.operation_id);
        let recording_active = self
            .app_handle
            .try_state::<Arc<AudioRecordingManager>>()
            .map(|audio_manager| audio_manager.is_recording())
            .unwrap_or(false);
        let idle_ms = Self::now_ms().saturating_sub(self.last_activity.load(Ordering::Relaxed));

        info!(
            "[model-unload] maybe_unload_immediately context={} loaded={} should_unload_now={} hidden_mode={} setting={:?} recording_active={} active_operation_id={:?} lifecycle_state={:?} idle_ms={}",
            context,
            self.is_model_loaded(),
            should_unload_now,
            should_force_hidden_unload,
            settings.model_unload_timeout,
            recording_active,
            active_operation_id,
            lifecycle_state,
            idle_ms
        );

        if should_unload_now {
            if self.is_transcription_session_active() {
                info!(
                    "[model-unload] deferring unload after {} because a transcription session is still active",
                    context
                );
                return;
            }

            self.touch_activity();
            info!(
                "[model-unload] keeping model warm for {}ms after {} before timed unload",
                MODEL_UNLOAD_IDLE_MS, context
            );
            self.schedule_idle_unload(context);
        } else {
            debug!(
                "[model-unload] maybe_unload_immediately skipped context={} loaded={} hidden_mode={} setting={:?}",
                context,
                self.is_model_loaded(),
                should_force_hidden_unload,
                settings.model_unload_timeout
            );
        }
    }

    pub fn initiate_model_load_for(&self, model_id: String) {
        let mut is_loading = self.is_loading.lock();
        if *is_loading {
            return;
        }

        if self.get_current_model().as_deref() == Some(model_id.as_str()) && self.is_model_loaded()
        {
            return;
        }

        *is_loading = true;
        let self_clone = self.clone();
        thread::spawn(move || {
            info!(
                "[model-load] background load thread start model_id={} hidden_mode={}",
                model_id,
                self_clone.should_force_background_lean_unload()
            );
            if let Err(e) = self_clone.load_model(&model_id) {
                error!("Failed to load model: {}", e);
            } else {
                self_clone.touch_activity();
                let coordinator_snapshot = self_clone.coordinator_session_snapshot();
                let operation_active = coordinator_snapshot
                    .as_ref()
                    .and_then(|snapshot| snapshot.operation_id)
                    .is_some();
                let lifecycle_state = coordinator_snapshot.map(|snapshot| snapshot.lifecycle_state);
                let should_keep_loaded = operation_active;

                info!(
                    "[model-load] background load completed model_id={} operation_active={} lifecycle_state={:?} should_keep_loaded={}",
                    model_id,
                    operation_active,
                    lifecycle_state,
                    should_keep_loaded
                );

                if !should_keep_loaded {
                    self_clone.maybe_unload_immediately(
                        "background load completed without active recording",
                    );
                }
            }
            let mut is_loading = self_clone.is_loading.lock();
            *is_loading = false;
            self_clone.loading_condvar.notify_all();
            info!(
                "[model-load] background load thread end model_id={}",
                model_id
            );
        });
    }

    /// Kicks off the model loading in a background thread if it's not already loaded
    pub fn initiate_model_load(&self) {
        let settings = get_settings(&self.app_handle);
        self.initiate_model_load_for(settings.selected_model.clone());
    }

    pub fn get_current_model(&self) -> Option<String> {
        self.current_model_id.lock().clone()
    }

    pub fn get_current_model_name(&self) -> Option<String> {
        let model_id = self.get_current_model()?;
        self.model_manager
            .get_model_info(&model_id)
            .map(|info| info.name)
    }

    #[allow(dead_code)]
    pub fn transcribe(&self, audio: Vec<f32>) -> Result<String> {
        self.transcribe_detailed_request(TranscriptionRequest {
            audio,
            app_context: None,
        })
        .map(|result| result.text)
    }
}

impl Drop for TranscriptionManager {
    fn drop(&mut self) {
        debug!("Shutting down TranscriptionManager");

        // Signal the watcher thread to shutdown
        self.shutdown_signal.store(true, Ordering::Relaxed);

        // Wait for the thread to finish gracefully
        if let Some(handle) = self.watcher_handle.lock().take() {
            if let Err(e) = handle.join() {
                warn!("Failed to join idle watcher thread: {:?}", e);
            } else {
                debug!("Idle watcher thread joined successfully");
            }
        }
    }
}
