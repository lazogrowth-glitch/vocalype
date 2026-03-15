use crate::audio_toolkit::{apply_custom_words, filter_transcription_output};
use crate::context_detector::{AppContextCategory, AppTranscriptionContext};
use crate::managers::model::{EngineType, ModelManager};
use crate::prompt_builder::build_whisper_initial_prompt;
use crate::settings::{
    get_settings, record_whisper_backend_failure, set_active_runtime_model,
    set_active_whisper_backend, ModelUnloadTimeout, NpuKind, WhisperBackendPreference,
};
use crate::vocabulary_store::VocabularyStoreState;
use crate::voice_profile::{current_voice_profile, VoiceProfile};
use anyhow::Result;
use log::{debug, error, info, warn};
use parakeet_rs::{
    ExecutionConfig as ParakeetExecutionConfig, ExecutionProvider as ParakeetExecutionProvider,
    ParakeetTDT, TimestampMode as ParakeetTimestampMode, Transcriber,
};
use serde::Serialize;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
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

const PARAKEET_V3_LEGACY_ID: &str = "parakeet-tdt-0.6b-v3";
const PARAKEET_V3_ENGLISH_ID: &str = "parakeet-tdt-0.6b-v3-english";
const PARAKEET_V3_MULTILINGUAL_ID: &str = "parakeet-tdt-0.6b-v3-multilingual";

fn is_parakeet_v3_model(model_id: &str) -> bool {
    matches!(
        model_id,
        PARAKEET_V3_LEGACY_ID | PARAKEET_V3_ENGLISH_ID | PARAKEET_V3_MULTILINGUAL_ID
    )
}

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
            providers.push(ParakeetExecutionProvider::OpenVINO);
        }
        NpuKind::Amd | NpuKind::Unknown | NpuKind::None => {}
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
            Some(id) if is_parakeet_v3_model(id) => text,
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
                    .unwrap()
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
                            .unwrap()
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
            *manager.watcher_handle.lock().unwrap() = Some(handle);
        }

        Ok(manager)
    }

    /// Lock the engine mutex, recovering from poison if a previous transcription panicked.
    fn lock_engine(&self) -> MutexGuard<'_, Option<LoadedEngine>> {
        self.engine.lock().unwrap_or_else(|poisoned| {
            warn!("Engine mutex was poisoned by a previous panic, recovering");
            poisoned.into_inner()
        })
    }

    pub fn is_model_loaded(&self) -> bool {
        let engine = self.lock_engine();
        engine.is_some()
    }

    pub fn unload_model(&self) -> Result<()> {
        let unload_start = std::time::Instant::now();
        debug!("Starting to unload model");

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
            let mut current_model = self.current_model_id.lock().unwrap();
            *current_model = None;
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

    pub fn load_model(&self, model_id: &str) -> Result<()> {
        let load_start = std::time::Instant::now();
        debug!("Starting to load model: {}", model_id);

        if self.get_current_model().as_deref() == Some(model_id) && self.is_model_loaded() {
            debug!("Model {} is already loaded, skipping reload", model_id);
            return Ok(());
        }

        if self.is_model_loaded() {
            self.unload_model()?;
        }

        // Emit loading started event
        let _ = self.app_handle.emit(
            "model-state-changed",
            ModelStateEvent {
                event_type: "loading_started".to_string(),
                model_id: Some(model_id.to_string()),
                model_name: None,
                error: None,
            },
        );

        let model_info = self
            .model_manager
            .get_model_info(model_id)
            .ok_or_else(|| anyhow::anyhow!("Model not found: {}", model_id))?;

        if !model_info.is_downloaded {
            let error_msg = "Model not downloaded";
            let _ = self.app_handle.emit(
                "model-state-changed",
                ModelStateEvent {
                    event_type: "loading_failed".to_string(),
                    model_id: Some(model_id.to_string()),
                    model_name: Some(model_info.name.clone()),
                    error: Some(error_msg.to_string()),
                },
            );
            return Err(anyhow::anyhow!(error_msg));
        }

        let model_path = if matches!(model_info.engine_type, EngineType::GeminiApi) {
            std::path::PathBuf::new()
        } else {
            self.model_manager.get_model_path(model_id)?
        };

        // Create appropriate engine based on model type
        let loaded_engine = match model_info.engine_type {
            EngineType::Whisper => {
                let mut engine = WhisperEngine::new();
                let model_params = self.whisper_model_params(model_id);
                let use_gpu = model_params.use_gpu;
                let preferred_backend = if use_gpu {
                    #[cfg(target_os = "windows")]
                    {
                        "Vulkan"
                    }
                    #[cfg(target_os = "macos")]
                    {
                        "Metal"
                    }
                    #[cfg(target_os = "linux")]
                    {
                        "Vulkan"
                    }
                    #[cfg(not(any(
                        target_os = "windows",
                        target_os = "macos",
                        target_os = "linux"
                    )))]
                    {
                        "CPU"
                    }
                } else {
                    "CPU"
                };
                info!(
                    "Loading Whisper model '{}' — preferred backend: {} (use_gpu={})",
                    model_id, preferred_backend, model_params.use_gpu
                );
                let load_result = engine.load_model_with_params(&model_path, model_params);
                match load_result {
                    Ok(()) => {
                        self.whisper_gpu_active.store(use_gpu, Ordering::Relaxed);
                        set_active_whisper_backend(
                            &self.app_handle,
                            model_id,
                            if use_gpu {
                                WhisperBackendPreference::Gpu
                            } else {
                                WhisperBackendPreference::Cpu
                            },
                            Some(format!("loaded on preferred {} backend", preferred_backend)),
                        );
                    }
                    Err(ref e) if use_gpu => {
                        warn!(
                            "Preferred Whisper backend ({}) init failed for '{}': {}. Retrying with CPU fallback.",
                            preferred_backend, model_id, e
                        );
                        let cpu_params = WhisperModelParams {
                            use_gpu: false,
                            flash_attn: false,
                        };
                        engine
                            .load_model_with_params(&model_path, cpu_params)
                            .map_err(|e2| {
                                let error_msg =
                                    format!("Failed to load whisper model {}: {}", model_id, e2);
                                let _ = self.app_handle.emit(
                                    "model-state-changed",
                                    ModelStateEvent {
                                        event_type: "loading_failed".to_string(),
                                        model_id: Some(model_id.to_string()),
                                        model_name: Some(model_info.name.clone()),
                                        error: Some(error_msg.clone()),
                                    },
                                );
                                anyhow::anyhow!(error_msg)
                            })?;
                        let _ = self
                            .app_handle
                            .emit("whisper-gpu-unavailable", model_id.to_string());
                        self.whisper_gpu_active.store(false, Ordering::Relaxed);
                        record_whisper_backend_failure(
                            &self.app_handle,
                            model_id,
                            WhisperBackendPreference::Gpu,
                            format!("gpu backend init failed: {}", e),
                            7 * 24 * 60 * 60 * 1000,
                        );
                        set_active_whisper_backend(
                            &self.app_handle,
                            model_id,
                            WhisperBackendPreference::Cpu,
                            Some("gpu backend failed; cpu fallback applied".to_string()),
                        );
                        warn!(
                            "Whisper '{}' loaded on CPU — transcription will be slow. Consider switching to Parakeet V3.",
                            model_id
                        );
                    }
                    Err(e) => {
                        let error_msg = format!("Failed to load whisper model {}: {}", model_id, e);
                        let _ = self.app_handle.emit(
                            "model-state-changed",
                            ModelStateEvent {
                                event_type: "loading_failed".to_string(),
                                model_id: Some(model_id.to_string()),
                                model_name: Some(model_info.name.clone()),
                                error: Some(error_msg.clone()),
                            },
                        );
                        return Err(anyhow::anyhow!(error_msg));
                    }
                }
                LoadedEngine::Whisper(engine)
            }
            EngineType::Parakeet => {
                if is_parakeet_v3_model(model_id) {
                    let provider_candidates = parakeet_v3_provider_candidates(&self.app_handle);
                    let mut last_error = None;
                    let mut loaded_engine = None;

                    for provider in provider_candidates {
                        let provider_label = parakeet_provider_label(provider);
                        info!(
                            "Attempting to load Parakeet V3 '{}' with provider {}",
                            model_id, provider_label
                        );

                        match ParakeetTDT::from_pretrained(
                            &model_path,
                            Some(parakeet_v3_execution_config(provider)),
                        ) {
                            Ok(engine) => {
                                info!(
                                    "Loaded Parakeet V3 '{}' with provider {}",
                                    model_id, provider_label
                                );
                                loaded_engine = Some(engine);
                                break;
                            }
                            Err(err) => {
                                warn!(
                                    "Parakeet V3 provider {} failed for '{}': {}",
                                    provider_label, model_id, err
                                );
                                last_error =
                                    Some(format!("provider {} failed: {}", provider_label, err));
                            }
                        }
                    }

                    let engine = loaded_engine.ok_or_else(|| {
                        let error_msg = format!(
                            "Failed to load Parakeet V3 model {}: {}",
                            model_id,
                            last_error.unwrap_or_else(|| "no provider succeeded".to_string())
                        );
                        let _ = self.app_handle.emit(
                            "model-state-changed",
                            ModelStateEvent {
                                event_type: "loading_failed".to_string(),
                                model_id: Some(model_id.to_string()),
                                model_name: Some(model_info.name.clone()),
                                error: Some(error_msg.clone()),
                            },
                        );
                        anyhow::anyhow!(error_msg)
                    })?;
                    LoadedEngine::ParakeetV3(engine)
                } else {
                    let mut engine = TranscribeParakeetEngine::new();
                    engine
                        .load_model_with_params(&model_path, ParakeetModelParams::int8())
                        .map_err(|e| {
                            let error_msg =
                                format!("Failed to load parakeet model {}: {}", model_id, e);
                            let _ = self.app_handle.emit(
                                "model-state-changed",
                                ModelStateEvent {
                                    event_type: "loading_failed".to_string(),
                                    model_id: Some(model_id.to_string()),
                                    model_name: Some(model_info.name.clone()),
                                    error: Some(error_msg.clone()),
                                },
                            );
                            anyhow::anyhow!(error_msg)
                        })?;
                    LoadedEngine::Parakeet(engine)
                }
            }
            EngineType::Moonshine => {
                let mut engine = MoonshineEngine::new();
                engine
                    .load_model_with_params(
                        &model_path,
                        MoonshineModelParams::variant(ModelVariant::Base),
                    )
                    .map_err(|e| {
                        let error_msg =
                            format!("Failed to load moonshine model {}: {}", model_id, e);
                        let _ = self.app_handle.emit(
                            "model-state-changed",
                            ModelStateEvent {
                                event_type: "loading_failed".to_string(),
                                model_id: Some(model_id.to_string()),
                                model_name: Some(model_info.name.clone()),
                                error: Some(error_msg.clone()),
                            },
                        );
                        anyhow::anyhow!(error_msg)
                    })?;
                LoadedEngine::Moonshine(engine)
            }
            EngineType::MoonshineStreaming => {
                let mut engine = MoonshineStreamingEngine::new();
                engine
                    .load_model_with_params(&model_path, StreamingModelParams::default())
                    .map_err(|e| {
                        let error_msg = format!(
                            "Failed to load moonshine streaming model {}: {}",
                            model_id, e
                        );
                        let _ = self.app_handle.emit(
                            "model-state-changed",
                            ModelStateEvent {
                                event_type: "loading_failed".to_string(),
                                model_id: Some(model_id.to_string()),
                                model_name: Some(model_info.name.clone()),
                                error: Some(error_msg.clone()),
                            },
                        );
                        anyhow::anyhow!(error_msg)
                    })?;
                LoadedEngine::MoonshineStreaming(engine)
            }
            EngineType::SenseVoice => {
                let mut engine = SenseVoiceEngine::new();
                engine
                    .load_model_with_params(&model_path, SenseVoiceModelParams::int8())
                    .map_err(|e| {
                        let error_msg =
                            format!("Failed to load SenseVoice model {}: {}", model_id, e);
                        let _ = self.app_handle.emit(
                            "model-state-changed",
                            ModelStateEvent {
                                event_type: "loading_failed".to_string(),
                                model_id: Some(model_id.to_string()),
                                model_name: Some(model_info.name.clone()),
                                error: Some(error_msg.clone()),
                            },
                        );
                        anyhow::anyhow!(error_msg)
                    })?;
                LoadedEngine::SenseVoice(engine)
            }
            EngineType::GeminiApi => {
                let settings = get_settings(&self.app_handle);
                if settings.gemini_api_key.is_none()
                    || settings
                        .gemini_api_key
                        .as_ref()
                        .map_or(true, |k| k.is_empty())
                {
                    let error_msg = "Gemini API key not configured";
                    let _ = self.app_handle.emit(
                        "model-state-changed",
                        ModelStateEvent {
                            event_type: "loading_failed".to_string(),
                            model_id: Some(model_id.to_string()),
                            model_name: Some(model_info.name.clone()),
                            error: Some(error_msg.to_string()),
                        },
                    );
                    return Err(anyhow::anyhow!(error_msg));
                }
                LoadedEngine::GeminiApi
            }
        };

        // Update the current engine and model ID
        {
            let mut engine = self.lock_engine();
            *engine = Some(loaded_engine);
        }
        {
            let mut current_model = self.current_model_id.lock().unwrap();
            *current_model = Some(model_id.to_string());
        }
        set_active_runtime_model(&self.app_handle, Some(model_id.to_string()));

        // Emit loading completed event
        let _ = self.app_handle.emit(
            "model-state-changed",
            ModelStateEvent {
                event_type: "loading_completed".to_string(),
                model_id: Some(model_id.to_string()),
                model_name: Some(model_info.name.clone()),
                error: None,
            },
        );

        let load_duration = load_start.elapsed();
        debug!(
            "Successfully loaded transcription model: {} (took {}ms)",
            model_id,
            load_duration.as_millis()
        );
        Ok(())
    }

    /// Kicks off the model loading in a background thread if it's not already loaded
    pub fn initiate_model_load(&self) {
        let mut is_loading = self.is_loading.lock().unwrap();
        if *is_loading || self.is_model_loaded() {
            return;
        }

        *is_loading = true;
        let self_clone = self.clone();
        thread::spawn(move || {
            let settings = get_settings(&self_clone.app_handle);
            if let Err(e) = self_clone.load_model(&settings.selected_model) {
                error!("Failed to load model: {}", e);
            }
            let mut is_loading = self_clone.is_loading.lock().unwrap();
            *is_loading = false;
            self_clone.loading_condvar.notify_all();
        });
    }

    pub fn get_current_model(&self) -> Option<String> {
        let current_model = self.current_model_id.lock().unwrap();
        current_model.clone()
    }

    pub fn get_current_model_name(&self) -> Option<String> {
        let model_id = self.get_current_model()?;
        self.model_manager
            .get_model_info(&model_id)
            .map(|info| info.name)
    }

    pub fn transcribe(&self, audio: Vec<f32>) -> Result<String> {
        self.transcribe_request(TranscriptionRequest {
            audio,
            app_context: None,
        })
    }

    pub fn transcribe_request(&self, request: TranscriptionRequest) -> Result<String> {
        // Update last activity timestamp
        self.last_activity.store(
            SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64,
            Ordering::Relaxed,
        );

        let st = std::time::Instant::now();
        let TranscriptionRequest { audio, app_context } = request;

        debug!("Audio vector length: {}", audio.len());

        if audio.is_empty() {
            debug!("Empty audio vector");
            self.maybe_unload_immediately("empty audio");
            return Ok(String::new());
        }

        // Check if model is loaded, if not try to load it
        {
            // If the model is loading, wait for it to complete.
            let mut is_loading = self.is_loading.lock().unwrap();
            while *is_loading {
                is_loading = self.loading_condvar.wait(is_loading).unwrap();
            }

            let engine_guard = self.lock_engine();
            if engine_guard.is_none() {
                return Err(anyhow::anyhow!("Model is not loaded for transcription."));
            }
        }

        // Get current settings for configuration
        let settings = get_settings(&self.app_handle);
        let active_model_id = self.get_current_model();
        let voice_profile = if settings.adaptive_voice_profile_enabled {
            current_voice_profile(&self.app_handle)
        } else {
            None
        };
        let voice_terms: Vec<String> = voice_profile
            .as_ref()
            .map(|profile: &VoiceProfile| profile.preferred_terms.clone())
            .unwrap_or_default();
        let initial_prompt = if settings.adaptive_vocabulary_enabled
            || (settings.adaptive_voice_profile_enabled && !voice_terms.is_empty())
        {
            if let Some(state) = self.app_handle.try_state::<VocabularyStoreState>() {
                if let Ok(store) = state.0.lock() {
                    build_whisper_initial_prompt(
                        &settings,
                        app_context.as_ref(),
                        &store,
                        &voice_terms,
                    )
                } else {
                    None
                }
            } else {
                build_whisper_initial_prompt(
                    &settings,
                    app_context.as_ref(),
                    &crate::vocabulary_store::VocabularyStore::default(),
                    &voice_terms,
                )
            }
        } else {
            None
        };

        // Handle Gemini API separately (requires async HTTP call)
        {
            let engine_guard = self.lock_engine();
            if let Some(LoadedEngine::GeminiApi) = engine_guard.as_ref() {
                drop(engine_guard);
                let api_key = settings
                    .gemini_api_key
                    .as_ref()
                    .ok_or_else(|| anyhow::anyhow!("Gemini API key not configured"))?
                    .clone();
                let gemini_model = settings.gemini_model.clone();

                // Use block_in_place to safely run async code from a tokio worker thread.
                // Handle::block_on() panics if called directly from an async context,
                // so block_in_place tells tokio to move its work off this thread first.
                let result = tokio::task::block_in_place(|| {
                    tokio::runtime::Handle::current().block_on(
                        crate::gemini_client::transcribe_audio(&api_key, &gemini_model, &audio),
                    )
                })?;

                let corrected = if !settings.custom_words.is_empty() {
                    apply_custom_words(
                        &result,
                        &settings.custom_words,
                        settings.word_correction_threshold,
                    )
                } else {
                    result
                };
                let final_result = Self::filter_transcription_output_for_context(
                    corrected,
                    active_model_id.as_deref(),
                    app_context.as_ref(),
                );

                let et = std::time::Instant::now();
                info!(
                    "Gemini transcription completed in {}ms",
                    (et - st).as_millis()
                );

                self.maybe_unload_immediately("gemini transcription");
                return Ok(final_result);
            }
        }

        // Perform transcription with the appropriate engine.
        // We use catch_unwind to prevent engine panics from poisoning the mutex,
        // which would make the app hang indefinitely on subsequent operations.
        let result = {
            let mut engine_guard = self.lock_engine();

            // Take the engine out so we own it during transcription.
            // If the engine panics, we simply don't put it back (effectively unloading it)
            // instead of poisoning the mutex.
            let mut engine = match engine_guard.take() {
                Some(e) => e,
                None => {
                    return Err(anyhow::anyhow!(
                        "Model failed to load after auto-load attempt. Please check your model settings."
                    ));
                }
            };

            // Release the lock before transcribing — no mutex held during the engine call
            drop(engine_guard);

            let transcribe_result = catch_unwind(AssertUnwindSafe(|| -> Result<String> {
                match &mut engine {
                    LoadedEngine::Whisper(whisper_engine) => {
                        let whisper_language = if settings.selected_language == "auto" {
                            None
                        } else {
                            let normalized = if settings.selected_language == "zh-Hans"
                                || settings.selected_language == "zh-Hant"
                            {
                                "zh".to_string()
                            } else {
                                settings.selected_language.clone()
                            };
                            Some(normalized)
                        };

                        let current_model_id = self.get_current_model();
                        let whisper_gpu_active =
                            self.whisper_gpu_active.load(Ordering::Relaxed);
                        let n_threads = self.recommended_whisper_threads(
                            current_model_id.as_deref(),
                            whisper_gpu_active,
                        );

                        let params = WhisperInferenceParams {
                            language: whisper_language,
                            translate: settings.translate_to_english,
                            initial_prompt: initial_prompt.clone(),
                            greedy_best_of: Some(1),
                            n_threads: Some(n_threads),
                            debug_mode: false,
                            // Each dictation chunk is independent. Reusing decoder text
                            // context across calls can both slow decoding and smear text
                            // from earlier chunks into later ones.
                            no_context: true,
                            // Skip timestamp computation — we only need raw text.
                            // This alone saves ~10-20% of inference time.
                            no_timestamps: true,
                            // Treat the full clip as one segment — avoids per-segment
                            // overhead. Safe for push-to-talk dictation clips.
                            single_segment: true,
                            // Disable whisper.cpp's multi-temperature retry ladder for
                            // latency-sensitive dictation. Without this, a bad short clip
                            // can trigger several full re-decodes and explode latency.
                            temperature: Some(0.0),
                            temperature_inc: Some(0.0),
                            entropy_thold: Some(9_999.0),
                            logprob_thold: Some(-9_999.0),
                            ..Default::default()
                        };
                        debug!(
                            "Whisper inference params: model={:?}, gpu_active={}, threads={}",
                            current_model_id, whisper_gpu_active, n_threads
                        );

                        whisper_engine
                            .transcribe_samples(audio, Some(params))
                            .map(|result| result.text)
                            .map_err(|e| anyhow::anyhow!("Whisper transcription failed: {}", e))
                    }
                    LoadedEngine::Parakeet(parakeet_engine) => {
                        let params = ParakeetInferenceParams {
                            timestamp_granularity: TimestampGranularity::Segment,
                            ..Default::default()
                        };
                        parakeet_engine
                            .transcribe_samples(audio, Some(params))
                            .map(|result| result.text)
                            .map_err(|e| anyhow::anyhow!("Parakeet transcription failed: {}", e))
                    }
                    LoadedEngine::ParakeetV3(parakeet_engine) => parakeet_engine
                        .transcribe_samples(
                            audio.clone(),
                            16_000,
                            1,
                            Some(ParakeetTimestampMode::Sentences),
                        )
                        .or_else(|sentence_err| {
                            debug!(
                                "Parakeet V3 sentence-mode decode failed, retrying with word mode: {}",
                                sentence_err
                            );
                            parakeet_engine.transcribe_samples(
                                audio,
                                16_000,
                                1,
                                Some(ParakeetTimestampMode::Words),
                            )
                        })
                        .map(|result| result.text)
                        .map_err(|e| anyhow::anyhow!("Parakeet V3 transcription failed: {}", e)),
                    LoadedEngine::Moonshine(moonshine_engine) => moonshine_engine
                        .transcribe_samples(audio, None)
                        .map(|result| result.text)
                        .map_err(|e| anyhow::anyhow!("Moonshine transcription failed: {}", e)),
                    LoadedEngine::MoonshineStreaming(streaming_engine) => streaming_engine
                        .transcribe_samples(audio, None)
                        .map(|result| result.text)
                        .map_err(|e| {
                            anyhow::anyhow!("Moonshine streaming transcription failed: {}", e)
                        }),
                    LoadedEngine::SenseVoice(sense_voice_engine) => {
                        let language = match settings.selected_language.as_str() {
                            "zh" | "zh-Hans" | "zh-Hant" => SenseVoiceLanguage::Chinese,
                            "en" => SenseVoiceLanguage::English,
                            "ja" => SenseVoiceLanguage::Japanese,
                            "ko" => SenseVoiceLanguage::Korean,
                            "yue" => SenseVoiceLanguage::Cantonese,
                            _ => SenseVoiceLanguage::Auto,
                        };
                        let params = SenseVoiceInferenceParams {
                            language,
                            use_itn: true,
                        };
                        sense_voice_engine
                            .transcribe_samples(audio, Some(params))
                            .map(|result| result.text)
                            .map_err(|e| anyhow::anyhow!("SenseVoice transcription failed: {}", e))
                    }
                    LoadedEngine::GeminiApi => {
                        unreachable!("GeminiApi handled before catch_unwind")
                    }
                }
            }));

            match transcribe_result {
                Ok(inner_result) => {
                    // Success or normal error — put the engine back
                    let mut engine_guard = self.lock_engine();
                    *engine_guard = Some(engine);
                    inner_result?
                }
                Err(panic_payload) => {
                    // Engine panicked — do NOT put it back (it's in an unknown state).
                    // The engine is dropped here, effectively unloading it.
                    let panic_msg = if let Some(s) = panic_payload.downcast_ref::<&str>() {
                        s.to_string()
                    } else if let Some(s) = panic_payload.downcast_ref::<String>() {
                        s.clone()
                    } else {
                        "unknown panic".to_string()
                    };
                    error!(
                        "Transcription engine panicked: {}. Model has been unloaded.",
                        panic_msg
                    );

                    // Clear the model ID so it will be reloaded on next attempt
                    {
                        let mut current_model = self
                            .current_model_id
                            .lock()
                            .unwrap_or_else(|e| e.into_inner());
                        *current_model = None;
                    }

                    let _ = self.app_handle.emit(
                        "model-state-changed",
                        ModelStateEvent {
                            event_type: "unloaded".to_string(),
                            model_id: None,
                            model_name: None,
                            error: Some(format!("Engine panicked: {}", panic_msg)),
                        },
                    );

                    return Err(anyhow::anyhow!(
                        "Transcription engine panicked: {}. The model has been unloaded and will reload on next attempt.",
                        panic_msg
                    ));
                }
            }
        };

        // Apply word correction if custom words are configured
        let corrected_result = if !settings.custom_words.is_empty() {
            apply_custom_words(
                &result,
                &settings.custom_words,
                settings.word_correction_threshold,
            )
        } else {
            result
        };

        let filtered_result = Self::filter_transcription_output_for_context(
            corrected_result,
            active_model_id.as_deref(),
            app_context.as_ref(),
        );

        let et = std::time::Instant::now();
        let translation_note = if settings.translate_to_english {
            " (translated)"
        } else {
            ""
        };
        info!(
            "Transcription completed in {}ms{}",
            (et - st).as_millis(),
            translation_note
        );

        let final_result = filtered_result;

        if final_result.is_empty() {
            info!("Transcription result is empty");
        } else {
            info!(
                "Transcription result [{}]: {}",
                app_context
                    .as_ref()
                    .map(|context| format!("{:?}", context.category))
                    .unwrap_or_else(|| "Unknown".to_string()),
                final_result
            );
        }

        self.maybe_unload_immediately("transcription");

        Ok(final_result)
    }
}

impl Drop for TranscriptionManager {
    fn drop(&mut self) {
        debug!("Shutting down TranscriptionManager");

        // Signal the watcher thread to shutdown
        self.shutdown_signal.store(true, Ordering::Relaxed);

        // Wait for the thread to finish gracefully
        if let Some(handle) = self.watcher_handle.lock().unwrap().take() {
            if let Err(e) = handle.join() {
                warn!("Failed to join idle watcher thread: {:?}", e);
            } else {
                debug!("Idle watcher thread joined successfully");
            }
        }
    }
}
