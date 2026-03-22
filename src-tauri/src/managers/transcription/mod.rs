mod engine_loader;
mod inference;

use crate::audio_toolkit::{apply_custom_words, filter_transcription_output};
use crate::context_detector::{AppContextCategory, AppTranscriptionContext};
use crate::managers::model::{EngineType, ModelManager};
use crate::model_ids::is_parakeet_v3_model_id;
use crate::prompt_builder::build_whisper_initial_prompt;
use crate::settings::{
    get_settings, record_whisper_backend_failure, set_active_runtime_model,
    set_active_whisper_backend, ModelUnloadTimeout, NpuKind, WhisperBackendPreference,
};
use crate::transcription_confidence::{
    build_whisper_confidence_payload, TranscriptionConfidencePayload,
};
use crate::vocabulary_store::VocabularyStoreState;
use crate::voice_profile::{current_voice_profile, VoiceProfile};
use anyhow::Result;
use log::{debug, error, info, warn};
use parakeet_rs::{
    ExecutionConfig as ParakeetExecutionConfig, ExecutionProvider as ParakeetExecutionProvider,
    ParakeetTDT, TimestampMode as ParakeetTimestampMode, Transcriber,
};
use parking_lot::{Condvar, Mutex, MutexGuard};
use serde::Serialize;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Emitter, Manager};
use transcribe_rs::{
    engines::{
        moonshine::{
            ModelVariant, MoonshineEngine, MoonshineModelParams, MoonshineStreamingEngine,
            StreamingModelParams,
        },
        parakeet::{
            ParakeetEngine as TranscribeParakeetEngine, ParakeetInferenceParams,
            ParakeetModelParams, TimestampGranularity,
        },
        sense_voice::{
            Language as SenseVoiceLanguage, SenseVoiceEngine, SenseVoiceInferenceParams,
            SenseVoiceModelParams,
        },
        whisper::{WhisperEngine, WhisperInferenceParams, WhisperModelParams},
    },
    TranscriptionEngine,
};

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

    let mut providers = Vec::new();

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

    providers.push(ParakeetExecutionProvider::Cpu);
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
}

#[derive(Debug)]
struct EngineTranscriptionResult {
    text: String,
    segments: Option<Vec<transcribe_rs::TranscriptionSegment>>,
}

enum LoadedEngine {
    Whisper(WhisperEngine),
    Parakeet(TranscribeParakeetEngine),
    ParakeetV3(ParakeetTDT),
    Moonshine(MoonshineEngine),
    MoonshineStreaming(MoonshineStreamingEngine),
    SenseVoice(SenseVoiceEngine),
    GeminiApi,
}

#[derive(Clone)]
pub struct TranscriptionManager {
    engine: Arc<Mutex<Option<LoadedEngine>>>,
    model_manager: Arc<ModelManager>,
    app_handle: AppHandle,
    current_model_id: Arc<Mutex<Option<String>>>,
    whisper_gpu_active: Arc<AtomicBool>,
    last_activity: Arc<AtomicU64>,
    shutdown_signal: Arc<AtomicBool>,
    watcher_handle: Arc<Mutex<Option<thread::JoinHandle<()>>>>,
    is_loading: Arc<Mutex<bool>>,
    loading_condvar: Arc<Condvar>,
}

impl TranscriptionManager {
    fn recommended_whisper_threads(&self, model_id: Option<&str>, whisper_gpu_active: bool) -> i32 {
        let settings = get_settings(&self.app_handle);
        if let Some(model_id) = model_id {
            if let Some(config) = settings.adaptive_whisper_config(model_id) {
                return i32::from(config.threads.max(1));
            }
        }

        let available = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4);
        let max_threads = if whisper_gpu_active {
            match model_id {
                Some("small") => 8,
                Some("medium") => 6,
                Some("turbo") => 8,
                Some("large") => 4,
                _ => 6,
            }
        } else {
            match model_id {
                Some("small") => 8,
                Some("medium") => 6,
                Some("turbo") => 6,
                Some("large") => 4,
                _ => 6,
            }
        };

        available.min(max_threads).max(1) as i32
    }

    fn whisper_model_params(&self, model_id: &str) -> WhisperModelParams {
        let settings = get_settings(&self.app_handle);
        let backend_preference = settings
            .adaptive_whisper_config(model_id)
            .map(|config| config.backend)
            .unwrap_or(WhisperBackendPreference::Auto);

        WhisperModelParams {
            use_gpu: !matches!(backend_preference, WhisperBackendPreference::Cpu),
            // Flash Attention: ~30-50% faster on GPU (Metal/Vulkan).
            // Incompatible with DTW word-level timestamps (we don't use those).
            flash_attn: matches!(backend_preference, WhisperBackendPreference::Gpu)
                || matches!(backend_preference, WhisperBackendPreference::Auto),
        }
    }

    fn filter_transcription_output_for_context(
        text: String,
        model_id: Option<&str>,
        app_context: Option<&AppTranscriptionContext>,
    ) -> String {
        if matches!(
            app_context.map(|context| context.category),
            Some(AppContextCategory::Code)
        ) {
            return text;
        }

        match model_id {
            Some(id) if is_parakeet_v3_model_id(id) => text,
            _ => filter_transcription_output(&text),
        }
    }

    pub fn new(app_handle: &AppHandle, model_manager: Arc<ModelManager>) -> Result<Self> {
        let manager = Self {
            engine: Arc::new(Mutex::new(None)),
            model_manager,
            app_handle: app_handle.clone(),
            current_model_id: Arc::new(Mutex::new(None)),
            whisper_gpu_active: Arc::new(AtomicBool::new(false)),
            last_activity: Arc::new(AtomicU64::new(
                SystemTime::now()
                    .duration_since(SystemTime::UNIX_EPOCH)
                    .expect("System clock is before Unix epoch")
                    .as_millis() as u64,
            )),
            shutdown_signal: Arc::new(AtomicBool::new(false)),
            watcher_handle: Arc::new(Mutex::new(None)),
            is_loading: Arc::new(Mutex::new(false)),
            loading_condvar: Arc::new(Condvar::new()),
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
                    let timeout_seconds = settings.model_unload_timeout.to_seconds();

                    if let Some(limit_seconds) = timeout_seconds {
                        // Skip polling-based unloading for immediate timeout since it's handled directly in transcribe()
                        if settings.model_unload_timeout == ModelUnloadTimeout::Immediately {
                            continue;
                        }

                        let last = manager_cloned.last_activity.load(Ordering::Relaxed);
                        let now_ms = SystemTime::now()
                            .duration_since(SystemTime::UNIX_EPOCH)
                            .expect("System clock is before Unix epoch")
                            .as_millis() as u64;

                        if now_ms.saturating_sub(last) > limit_seconds * 1000 {
                            // idle -> unload
                            if manager_cloned.is_model_loaded() {
                                let unload_start = std::time::Instant::now();
                                debug!("Starting to unload model due to inactivity");

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
                                    debug!(
                                        "Model unloaded due to inactivity (took {}ms)",
                                        unload_duration.as_millis()
                                    );
                                }
                            }
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

    pub fn ensure_model_loaded(&self, model_id: &str) -> Result<()> {
        {
            let mut is_loading = self.is_loading.lock();
            while *is_loading {
                self.loading_condvar.wait(&mut is_loading);
            }

            if self.get_current_model().as_deref() == Some(model_id) && self.is_model_loaded() {
                return Ok(());
            }

            *is_loading = true;
        }

        let result = self.load_model(model_id);

        let mut is_loading = self.is_loading.lock();
        *is_loading = false;
        self.loading_condvar.notify_all();

        result
    }

    pub fn unload_model(&self) -> Result<()> {
        let unload_start = std::time::Instant::now();
        debug!("Starting to unload model");
        let previous_model_id = self.get_current_model();

        {
            let mut engine = self.lock_engine();
            if let Some(ref mut loaded_engine) = *engine {
                match loaded_engine {
                    LoadedEngine::Whisper(ref mut e) => e.unload_model(),
                    LoadedEngine::Parakeet(ref mut e) => e.unload_model(),
                    LoadedEngine::ParakeetV3(_) => {}
                    LoadedEngine::Moonshine(ref mut e) => e.unload_model(),
                    LoadedEngine::MoonshineStreaming(ref mut e) => e.unload_model(),
                    LoadedEngine::SenseVoice(ref mut e) => e.unload_model(),
                    LoadedEngine::GeminiApi => {}
                }
            }
            *engine = None; // Drop the engine to free memory
        }
        self.whisper_gpu_active.store(false, Ordering::Relaxed);
        {
            let mut current_model = self.current_model_id.lock();
            *current_model = None;
        }
        if let Some(model_id) = previous_model_id.as_deref() {
            if let Err(err) = self.model_manager.clear_runtime_cache_for_model(model_id) {
                warn!(
                    "Failed to clear runtime cache for model '{}': {}",
                    model_id, err
                );
            }
        }
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
        debug!(
            "Model unloaded manually (took {}ms)",
            unload_duration.as_millis()
        );
        Ok(())
    }

    /// Unloads the model immediately if the setting is enabled and the model is loaded
    pub fn maybe_unload_immediately(&self, context: &str) {
        let settings = get_settings(&self.app_handle);
        if settings.model_unload_timeout == ModelUnloadTimeout::Immediately
            && self.is_model_loaded()
        {
            info!("Immediately unloading model after {}", context);
            if let Err(e) = self.unload_model() {
                warn!("Failed to immediately unload model: {}", e);
            }
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
            if let Err(e) = self_clone.load_model(&model_id) {
                error!("Failed to load model: {}", e);
            }
            let mut is_loading = self_clone.is_loading.lock();
            *is_loading = false;
            self_clone.loading_condvar.notify_all();
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

    pub fn transcribe_request(&self, request: TranscriptionRequest) -> Result<String> {
        self.transcribe_detailed_request(request)
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
