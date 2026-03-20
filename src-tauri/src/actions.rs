#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
use crate::apple_intelligence;
use crate::audio_feedback::{play_feedback_sound, play_feedback_sound_blocking, SoundType};
use crate::context_detector::{
    detect_current_app_context, ActiveAppContextState,
};
use crate::managers::audio::AudioRecordingManager;
use crate::managers::history::HistoryManager;
use crate::managers::model::{EngineType, ModelInfo, ModelManager};
use crate::managers::transcription::{
    TranscriptionManager, TranscriptionRequest,
};
use crate::runtime_observability::{
    emit_lifecycle_state, emit_pipeline_profile, emit_runtime_error, PipelineProfileEvent,
    PipelineStepTiming, RuntimeErrorStage, TranscriptionLifecycleState,
};
use crate::settings::{get_settings, AppSettings, APPLE_INTELLIGENCE_PROVIDER_ID};
use crate::shortcut;
use crate::tray::{change_tray_icon, TrayIconState};
use crate::utils::{
    self, show_processing_overlay, show_recording_overlay, show_transcribing_overlay,
};
use crate::voice_profile::{current_runtime_adjustment, VoiceProfileState};
use crate::TranscriptionCoordinator;
use ferrous_opencc::{config::BuiltinConfig, OpenCC};
use log::{debug, error, info, warn};
use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;

pub struct ActiveActionState(pub Mutex<Option<u8>>);

#[derive(Clone, serde::Serialize)]
struct PasteFailureEvent {
    reason: String,
    copied_to_clipboard: bool,
}

fn emit_paste_failed_event(app: &AppHandle, reason: impl Into<String>, copied_to_clipboard: bool) {
    let _ = app.emit(
        "paste-failed",
        PasteFailureEvent {
            reason: reason.into(),
            copied_to_clipboard,
        },
    );
}

struct PipelineProfiler {
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
    fn new(
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

    fn push_step(&mut self, step: impl Into<String>, duration: Duration, detail: Option<String>) {
        self.steps.push(PipelineStepTiming {
            step: step.into(),
            duration_ms: duration.as_millis() as u64,
            detail,
        });
    }

    fn push_step_since(
        &mut self,
        step: impl Into<String>,
        started_at: Instant,
        detail: Option<String>,
    ) {
        self.push_step(step, started_at.elapsed(), detail);
    }

    fn set_audio_duration_samples(&mut self, samples_len: usize) {
        self.audio_duration_ms = Some(((samples_len as f64 / 16_000.0) * 1000.0).round() as u64);
    }

    fn set_model(&mut self, model_id: Option<String>, model_name: Option<String>) {
        self.model_id = model_id;
        self.model_name = model_name;
    }

    fn set_transcription_chars(&mut self, transcription: &str) {
        self.transcription_chars = transcription.chars().count();
    }

    fn mark_completed(&mut self) {
        self.completed = true;
        self.error_code = None;
    }

    fn mark_error(&mut self, error_code: impl Into<String>) {
        self.completed = false;
        self.error_code = Some(error_code.into());
    }

    fn emit(&self, app: &AppHandle) {
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

// ── Streaming chunk constants ────────────────────────────────────────────────
const PARAKEET_V3_LEGACY_ID: &str = "parakeet-tdt-0.6b-v3";
const PARAKEET_V3_ENGLISH_ID: &str = "parakeet-tdt-0.6b-v3-english";
const PARAKEET_V3_MULTILINGUAL_ID: &str = "parakeet-tdt-0.6b-v3-multilingual";

/// Accumulate this many speech samples before sending a chunk for background transcription.
const DEFAULT_CHUNK_INTERVAL_SAMPLES: usize = 15 * 16_000; // 15 s at 16 kHz
/// Overlap kept at the START of each new chunk to avoid cutting words at boundaries.
const DEFAULT_CHUNK_OVERLAP_SAMPLES: usize = 8_000; // 0.5 s
/// Whisper Small benchmarks best with slightly larger chunks on weak PCs:
/// small enough to reduce key-up latency, large enough to avoid chunk storms.
const WHISPER_SMALL_CHUNK_INTERVAL_SAMPLES: usize = 12 * 16_000; // 12 s
const WHISPER_SMALL_CHUNK_OVERLAP_SAMPLES: usize = 8_000; // 0.5 s
/// Whisper Medium is still tuned for latency, but stays conservative enough
/// to avoid the short-chunk accuracy collapse seen on slow machines.
const WHISPER_MEDIUM_CHUNK_INTERVAL_SAMPLES: usize = 6 * 16_000; // 6 s
const WHISPER_MEDIUM_CHUNK_OVERLAP_SAMPLES: usize = 8_000; // 0.5 s
/// Whisper Turbo also stays healthier with larger chunks on low-end hardware.
/// This trims total chunk count and reduces the expensive tail assembly phase.
const WHISPER_TURBO_CHUNK_INTERVAL_SAMPLES: usize = 12 * 16_000; // 12 s
const WHISPER_TURBO_CHUNK_OVERLAP_SAMPLES: usize = 8_000; // 0.5 s
/// Whisper Large stays more quality-oriented, but should still avoid long
/// "all the work happens after key-up" behavior.
const WHISPER_LARGE_CHUNK_INTERVAL_SAMPLES: usize = 8 * 16_000; // 8 s
const WHISPER_LARGE_CHUNK_OVERLAP_SAMPLES: usize = 12_000; // 0.75 s
/// Shorter polling reduces how long a ready chunk waits before getting sent.
const CHUNK_SAMPLER_POLL_MS: u64 = 200;
/// Prevent Whisper from queueing many background chunks when the model is
/// slower than real time on the current machine.
const MAX_PENDING_BACKGROUND_CHUNKS: usize = 1;
/// English Parakeet profile tuned to reduce long-utterance truncation without
/// falling back to very small, repetition-prone chunks.
const PARAKEET_V3_EN_CHUNK_INTERVAL_SAMPLES: usize = 20 * 16_000; // 20 s at 16 kHz
const PARAKEET_V3_EN_CHUNK_OVERLAP_SAMPLES: usize = 16_000; // 1 s
/// French-first multilingual Parakeet profile tuned for lower EN drift.
const PARAKEET_V3_MULTI_CHUNK_INTERVAL_SAMPLES: usize = 5 * 16_000; // 5 s at 16 kHz
/// Small overlap limits boundary cuts while keeping tight chunks.
const PARAKEET_V3_MULTI_CHUNK_OVERLAP_SAMPLES: usize = 16_000; // 1 s

#[derive(Clone, Copy)]
struct ChunkingProfile {
    interval_samples: usize,
    overlap_samples: usize,
}

struct ChunkingSharedState {
    last_committed_idx: usize,
    next_chunk_idx: usize,
}

pub(crate) struct ChunkingHandle {
    sampler_handle: std::thread::JoinHandle<()>,
    worker_handle: std::thread::JoinHandle<()>,
    chunk_tx: std::sync::mpsc::Sender<Option<(Vec<f32>, usize)>>,
    shared_state: Arc<Mutex<ChunkingSharedState>>,
    results: Arc<Mutex<Vec<(usize, String)>>>,
    pending_chunks: Arc<AtomicUsize>,
    chunk_overlap_samples: usize,
}

pub struct ActiveChunkingHandle(pub Mutex<Option<ChunkingHandle>>);

fn is_parakeet_v3_model_id(model_id: &str) -> bool {
    matches!(
        model_id,
        PARAKEET_V3_LEGACY_ID | PARAKEET_V3_ENGLISH_ID | PARAKEET_V3_MULTILINGUAL_ID
    )
}

fn chunking_profile_for_model(
    app: &AppHandle,
    model_info: Option<&ModelInfo>,
    settings: &AppSettings,
) -> Option<ChunkingProfile> {
    match model_info {
        Some(info) if matches!(info.id.as_str(), "small" | "medium" | "turbo" | "large") => {
            if let Some(config) = settings.adaptive_whisper_config(&info.id) {
                let adjusted = current_runtime_adjustment(
                    app,
                    &info.id,
                    config.chunk_seconds,
                    config.overlap_ms,
                )
                .unwrap_or_else(|| crate::voice_profile::VoiceRuntimeAdjustment {
                    adjusted_chunk_seconds: config.chunk_seconds,
                    adjusted_overlap_ms: config.overlap_ms,
                    vad_hangover_frames_delta: 0,
                    reason: None,
                });
                return Some(ChunkingProfile {
                    interval_samples: usize::from(adjusted.adjusted_chunk_seconds) * 16_000,
                    overlap_samples: (usize::from(adjusted.adjusted_overlap_ms) * 16_000) / 1000,
                });
            }

            match info.id.as_str() {
                "small" => Some(ChunkingProfile {
                    interval_samples: WHISPER_SMALL_CHUNK_INTERVAL_SAMPLES,
                    overlap_samples: WHISPER_SMALL_CHUNK_OVERLAP_SAMPLES,
                }),
                "medium" => Some(ChunkingProfile {
                    interval_samples: WHISPER_MEDIUM_CHUNK_INTERVAL_SAMPLES,
                    overlap_samples: WHISPER_MEDIUM_CHUNK_OVERLAP_SAMPLES,
                }),
                "turbo" => Some(ChunkingProfile {
                    interval_samples: WHISPER_TURBO_CHUNK_INTERVAL_SAMPLES,
                    overlap_samples: WHISPER_TURBO_CHUNK_OVERLAP_SAMPLES,
                }),
                "large" => Some(ChunkingProfile {
                    interval_samples: WHISPER_LARGE_CHUNK_INTERVAL_SAMPLES,
                    overlap_samples: WHISPER_LARGE_CHUNK_OVERLAP_SAMPLES,
                }),
                _ => None,
            }
        }
        Some(info) if info.id == PARAKEET_V3_ENGLISH_ID => Some(ChunkingProfile {
            interval_samples: PARAKEET_V3_EN_CHUNK_INTERVAL_SAMPLES,
            overlap_samples: PARAKEET_V3_EN_CHUNK_OVERLAP_SAMPLES,
        }),
        Some(info)
            if matches!(
                info.id.as_str(),
                PARAKEET_V3_MULTILINGUAL_ID | PARAKEET_V3_LEGACY_ID
            ) =>
        {
            Some(ChunkingProfile {
                interval_samples: PARAKEET_V3_MULTI_CHUNK_INTERVAL_SAMPLES,
                overlap_samples: PARAKEET_V3_MULTI_CHUNK_OVERLAP_SAMPLES,
            })
        }
        Some(info)
            if matches!(
                info.engine_type,
                EngineType::Whisper | EngineType::MoonshineStreaming
            ) =>
        {
            Some(ChunkingProfile {
                interval_samples: DEFAULT_CHUNK_INTERVAL_SAMPLES,
                overlap_samples: DEFAULT_CHUNK_OVERLAP_SAMPLES,
            })
        }
        None => Some(ChunkingProfile {
            interval_samples: DEFAULT_CHUNK_INTERVAL_SAMPLES,
            overlap_samples: DEFAULT_CHUNK_OVERLAP_SAMPLES,
        }),
        _ => None,
    }
}

fn normalize_language_for_model_support(language: &str) -> &str {
    match language {
        "zh-Hans" | "zh-Hant" => "zh",
        other => other,
    }
}

fn model_supports_selected_language(model_info: &ModelInfo, settings: &AppSettings) -> bool {
    if settings.selected_language == "auto" {
        return true;
    }

    let normalized_language = normalize_language_for_model_support(&settings.selected_language);

    model_info
        .supported_languages
        .iter()
        .any(|language| language == &settings.selected_language || language == normalized_language)
}

fn find_best_model_fallback(
    model_manager: &ModelManager,
    settings: &AppSettings,
    require_translation: bool,
    excluded_model_id: &str,
) -> Option<ModelInfo> {
    let mut preferred_ids: Vec<String> = Vec::new();

    if let Some(long_model_id) = settings.long_audio_model.as_ref() {
        if !long_model_id.is_empty() {
            preferred_ids.push(long_model_id.clone());
        }
    }

    if require_translation {
        preferred_ids.extend(["large", "medium", "small"].into_iter().map(String::from));
    } else {
        preferred_ids.extend(
            ["turbo", "large", "medium", "small", "breeze-asr"]
                .into_iter()
                .map(String::from),
        );
    }

    for model_id in preferred_ids {
        if model_id == excluded_model_id {
            continue;
        }

        let Some(model_info) = model_manager.get_model_info(&model_id) else {
            continue;
        };

        if !model_info.is_downloaded {
            continue;
        }

        if require_translation && !model_info.supports_translation {
            continue;
        }

        if !model_supports_selected_language(&model_info, settings) {
            continue;
        }

        return Some(model_info);
    }

    model_manager
        .get_available_models()
        .into_iter()
        .filter(|model_info| model_info.id != excluded_model_id)
        .filter(|model_info| model_info.is_downloaded)
        .filter(|model_info| !require_translation || model_info.supports_translation)
        .filter(|model_info| model_supports_selected_language(model_info, settings))
        .max_by(|left, right| {
            left.accuracy_score
                .partial_cmp(&right.accuracy_score)
                .unwrap_or(std::cmp::Ordering::Equal)
        })
}

fn resolve_runtime_model_override(
    current_model_info: Option<&ModelInfo>,
    model_manager: &ModelManager,
    settings: &AppSettings,
) -> Option<(ModelInfo, String)> {
    let model_info = current_model_info?;

    if !is_parakeet_v3_model_id(&model_info.id) {
        return None;
    }

    if settings.translate_to_english && !model_info.supports_translation {
        let fallback = find_best_model_fallback(model_manager, settings, true, &model_info.id)?;
        return Some((
            fallback,
            "Parakeet V3 does not support translation-to-English in this runtime".to_string(),
        ));
    }

    if !model_supports_selected_language(model_info, settings) {
        let fallback = find_best_model_fallback(model_manager, settings, false, &model_info.id)?;
        return Some((
            fallback,
            format!(
                "Parakeet V3 does not support the selected language '{}'",
                settings.selected_language
            ),
        ));
    }

    None
}

/// Drop guard that notifies the [`TranscriptionCoordinator`] when the
/// transcription pipeline finishes — whether it completes normally or panics.
struct FinishGuard {
    app: AppHandle,
    binding_id: String,
}
impl Drop for FinishGuard {
    fn drop(&mut self) {
        if let Some(c) = self.app.try_state::<TranscriptionCoordinator>() {
            c.notify_processing_finished();
        }
        if let Some(state) = self.app.try_state::<ActiveAppContextState>() {
            if let Ok(mut snapshot) = state.0.lock() {
                snapshot.clear_active_context(&self.binding_id);
            }
        }
    }
}

// Shortcut Action Trait
pub trait ShortcutAction: Send + Sync {
    fn start(&self, app: &AppHandle, binding_id: &str, shortcut_str: &str);
    fn stop(&self, app: &AppHandle, binding_id: &str, shortcut_str: &str);
}

// Transcribe Action
struct TranscribeAction {
    post_process: bool,
}

/// Field name for structured output JSON schema
const TRANSCRIPTION_FIELD: &str = "transcription";

/// Remove words duplicated at the boundary between two adjacent chunk transcriptions.
/// Looks for up to 8 words of suffix/prefix overlap (case-insensitive).
fn deduplicate_boundary(prev: &str, next: &str) -> String {
    let prev_words: Vec<&str> = prev.split_whitespace().collect();
    let next_words: Vec<&str> = next.split_whitespace().collect();
    if prev_words.is_empty() || next_words.is_empty() {
        return next.to_string();
    }
    let max_overlap = 8.min(prev_words.len()).min(next_words.len());
    for n in (1..=max_overlap).rev() {
        let prev_suffix: Vec<String> = prev_words[prev_words.len() - n..]
            .iter()
            .map(|w| {
                w.to_lowercase()
                    .trim_matches(|c: char| !c.is_alphanumeric())
                    .to_string()
            })
            .collect();
        let next_prefix: Vec<String> = next_words[..n]
            .iter()
            .map(|w| {
                w.to_lowercase()
                    .trim_matches(|c: char| !c.is_alphanumeric())
                    .to_string()
            })
            .collect();
        if prev_suffix == next_prefix {
            return next_words[n..].join(" ");
        }
    }
    next.to_string()
}

fn language_code_to_name(code: &str) -> &'static str {
    match code {
        "fr" => "French",
        "en" => "English",
        "es" => "Spanish",
        "de" => "German",
        "it" => "Italian",
        "pt" => "Portuguese",
        "nl" => "Dutch",
        "ru" => "Russian",
        "ja" => "Japanese",
        "ko" => "Korean",
        "zh" | "zh-Hans" => "Chinese (Simplified)",
        "zh-Hant" => "Chinese (Traditional)",
        "ar" => "Arabic",
        "pl" => "Polish",
        "uk" => "Ukrainian",
        _ => "the language used by the speaker",
    }
}

/// Quick LLM pass to fix: boundary word repetitions, wrong-language words, punctuation.
/// Only runs if an LLM provider+model is configured.
async fn cleanup_assembled_transcription(settings: &AppSettings, text: &str) -> Option<String> {
    if text.trim().is_empty() {
        return None;
    }
    let provider = settings.active_post_process_provider().cloned()?;
    let model = settings
        .post_process_models
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();
    if model.trim().is_empty() {
        return None;
    }
    let api_key = settings
        .post_process_api_keys
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();

    let lang_name = if settings.selected_language == "auto" || settings.selected_language.is_empty()
    {
        "the language used by the speaker"
    } else {
        language_code_to_name(&settings.selected_language)
    };

    let system_prompt = format!(
        "You are a speech transcription cleaner. Fix ONLY these issues: \
        (1) Remove exact word or phrase repetitions caused by audio chunk boundaries \
        (e.g. \"bonjour bonjour\" → \"bonjour\"). \
        (2) If any words are in the wrong language, convert them to {}. \
        (3) Fix obvious punctuation errors. \
        Do NOT rephrase, summarize, add, or remove actual content. \
        Return ONLY the cleaned text, nothing else.",
        lang_name
    );

    debug!(
        "Running chunk cleanup pass (provider: {}, model: {})",
        provider.id, model
    );

    match crate::llm_client::send_chat_completion_with_schema(
        &provider,
        api_key,
        &model,
        text.to_string(),
        Some(system_prompt),
        None,
    )
    .await
    {
        Ok(Some(content)) if !content.trim().is_empty() => {
            let cleaned = strip_invisible_chars(&content);
            debug!(
                "Cleanup pass done. Input: {} chars → output: {} chars",
                text.len(),
                cleaned.len()
            );
            Some(cleaned)
        }
        _ => {
            debug!("Cleanup pass returned no result, keeping assembled text");
            None
        }
    }
}

/// Strip invisible Unicode characters that some LLMs may insert
fn strip_invisible_chars(s: &str) -> String {
    s.replace(['\u{200B}', '\u{200C}', '\u{200D}', '\u{FEFF}'], "")
}

/// Build a system prompt from the user's prompt template.
/// Removes `${output}` placeholder since the transcription is sent as the user message.
fn build_system_prompt(prompt_template: &str) -> String {
    prompt_template.replace("${output}", "").trim().to_string()
}

async fn post_process_transcription(settings: &AppSettings, transcription: &str) -> Option<String> {
    let provider = match settings.active_post_process_provider().cloned() {
        Some(provider) => provider,
        None => {
            debug!("Post-processing enabled but no provider is selected");
            return None;
        }
    };

    let model = settings
        .post_process_models
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();

    if model.trim().is_empty() {
        debug!(
            "Post-processing skipped because provider '{}' has no model configured",
            provider.id
        );
        return None;
    }

    let selected_prompt_id = match &settings.post_process_selected_prompt_id {
        Some(id) => id.clone(),
        None => {
            debug!("Post-processing skipped because no prompt is selected");
            return None;
        }
    };

    let prompt = match settings
        .post_process_prompts
        .iter()
        .find(|prompt| prompt.id == selected_prompt_id)
    {
        Some(prompt) => prompt.prompt.clone(),
        None => {
            debug!(
                "Post-processing skipped because prompt '{}' was not found",
                selected_prompt_id
            );
            return None;
        }
    };

    if prompt.trim().is_empty() {
        debug!("Post-processing skipped because the selected prompt is empty");
        return None;
    }

    debug!(
        "Starting LLM post-processing with provider '{}' (model: {})",
        provider.id, model
    );

    let api_key = settings
        .post_process_api_keys
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();

    if provider.supports_structured_output {
        debug!("Using structured outputs for provider '{}'", provider.id);

        let system_prompt = build_system_prompt(&prompt);
        let user_content = transcription.to_string();

        // Handle Apple Intelligence separately since it uses native Swift APIs
        if provider.id == APPLE_INTELLIGENCE_PROVIDER_ID {
            #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
            {
                if !apple_intelligence::check_apple_intelligence_availability() {
                    debug!(
                        "Apple Intelligence selected but not currently available on this device"
                    );
                    return None;
                }

                let token_limit = model.trim().parse::<i32>().unwrap_or(0);
                return match apple_intelligence::process_text_with_system_prompt(
                    &system_prompt,
                    &user_content,
                    token_limit,
                ) {
                    Ok(result) => {
                        if result.trim().is_empty() {
                            debug!("Apple Intelligence returned an empty response");
                            None
                        } else {
                            let result = strip_invisible_chars(&result);
                            debug!(
                                "Apple Intelligence post-processing succeeded. Output length: {} chars",
                                result.len()
                            );
                            Some(result)
                        }
                    }
                    Err(err) => {
                        error!("Apple Intelligence post-processing failed: {}", err);
                        None
                    }
                };
            }

            #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
            {
                debug!("Apple Intelligence provider selected on unsupported platform");
                return None;
            }
        }

        // Define JSON schema for transcription output
        let json_schema = serde_json::json!({
            "type": "object",
            "properties": {
                (TRANSCRIPTION_FIELD): {
                    "type": "string",
                    "description": "The cleaned and processed transcription text"
                }
            },
            "required": [TRANSCRIPTION_FIELD],
            "additionalProperties": false
        });

        match crate::llm_client::send_chat_completion_with_schema(
            &provider,
            api_key.clone(),
            &model,
            user_content,
            Some(system_prompt),
            Some(json_schema),
        )
        .await
        {
            Ok(Some(content)) => {
                // Parse the JSON response to extract the transcription field
                match serde_json::from_str::<serde_json::Value>(&content) {
                    Ok(json) => {
                        if let Some(transcription_value) =
                            json.get(TRANSCRIPTION_FIELD).and_then(|t| t.as_str())
                        {
                            let result = strip_invisible_chars(transcription_value);
                            debug!(
                                "Structured output post-processing succeeded for provider '{}'. Output length: {} chars",
                                provider.id,
                                result.len()
                            );
                            return Some(result);
                        } else {
                            error!("Structured output response missing 'transcription' field");
                            return Some(strip_invisible_chars(&content));
                        }
                    }
                    Err(e) => {
                        error!(
                            "Failed to parse structured output JSON: {}. Returning raw content.",
                            e
                        );
                        return Some(strip_invisible_chars(&content));
                    }
                }
            }
            Ok(None) => {
                error!("LLM API response has no content");
                return None;
            }
            Err(e) => {
                warn!(
                    "Structured output failed for provider '{}': {}. Falling back to legacy mode.",
                    provider.id, e
                );
                // Fall through to legacy mode below
            }
        }
    }

    // Legacy mode: Replace ${output} variable in the prompt with the actual text
    let processed_prompt = prompt.replace("${output}", transcription);
    debug!("Processed prompt length: {} chars", processed_prompt.len());

    match crate::llm_client::send_chat_completion(&provider, api_key, &model, processed_prompt)
        .await
    {
        Ok(Some(content)) => {
            let content = strip_invisible_chars(&content);
            debug!(
                "LLM post-processing succeeded for provider '{}'. Output length: {} chars",
                provider.id,
                content.len()
            );
            Some(content)
        }
        Ok(None) => {
            error!("LLM API response has no content");
            None
        }
        Err(e) => {
            error!(
                "LLM post-processing failed for provider '{}': {}. Falling back to original transcription.",
                provider.id,
                e
            );
            None
        }
    }
}

async fn process_action(
    settings: &AppSettings,
    transcription: &str,
    prompt: &str,
    action_model: Option<&str>,
    action_provider_id: Option<&str>,
) -> Option<String> {
    let provider = if let Some(pid) = action_provider_id.filter(|p| !p.is_empty()) {
        match settings.post_process_provider(pid).cloned() {
            Some(p) => p,
            None => {
                debug!(
                    "Action provider '{}' not found, falling back to active provider",
                    pid
                );
                settings.active_post_process_provider().cloned()?
            }
        }
    } else {
        match settings.active_post_process_provider().cloned() {
            Some(p) => p,
            None => {
                debug!("Action processing skipped: no provider configured");
                return None;
            }
        }
    };

    let model = action_model
        .filter(|m| !m.trim().is_empty())
        .map(|m| m.to_string())
        .or_else(|| settings.post_process_models.get(&provider.id).cloned())
        .unwrap_or_default();

    let full_prompt = if prompt.contains("${output}") {
        prompt.replace("${output}", transcription)
    } else {
        format!("{}\n\n{}", prompt, transcription)
    };

    debug!(
        "Starting action processing with provider '{}', model '{}', prompt length: {}",
        provider.id,
        model,
        full_prompt.len()
    );

    // Handle Apple Intelligence via native Swift APIs
    if provider.id == APPLE_INTELLIGENCE_PROVIDER_ID {
        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        {
            if !apple_intelligence::check_apple_intelligence_availability() {
                debug!("Apple Intelligence selected but not available for action processing");
                return None;
            }
            let token_limit = model.trim().parse::<i32>().unwrap_or(0);
            return match apple_intelligence::process_text_with_system_prompt(
                &full_prompt,
                transcription,
                token_limit,
            ) {
                Ok(result) if !result.trim().is_empty() => {
                    let result = strip_invisible_chars(&result);
                    debug!(
                        "Apple Intelligence action processing succeeded. Output length: {} chars",
                        result.len()
                    );
                    Some(result)
                }
                Ok(_) => {
                    debug!("Apple Intelligence action returned empty result");
                    None
                }
                Err(err) => {
                    error!("Apple Intelligence action processing failed: {}", err);
                    None
                }
            };
        }

        #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
        {
            debug!("Apple Intelligence provider selected on unsupported platform");
            return None;
        }
    }

    if model.trim().is_empty() {
        debug!(
            "Action processing skipped: no model configured for provider '{}'",
            provider.id
        );
        return None;
    }

    let api_key = settings
        .post_process_api_keys
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();

    let system_prompt = "You are a text processing assistant. Output ONLY the final processed text. Do not add any explanation, commentary, preamble, or formatting such as markdown code blocks. Just output the raw result text, nothing else.".to_string();

    match crate::llm_client::send_chat_completion_with_schema(
        &provider,
        api_key,
        &model,
        full_prompt,
        Some(system_prompt),
        None,
    )
    .await
    {
        Ok(Some(content)) if !content.is_empty() => {
            let result = strip_invisible_chars(&content);
            debug!(
                "Action processing succeeded for provider '{}'. Output length: {} chars",
                provider.id,
                result.len()
            );
            Some(result)
        }
        Ok(_) => {
            debug!("Action processing returned empty result");
            None
        }
        Err(e) => {
            error!(
                "Action processing failed for provider '{}': {}",
                provider.id, e
            );
            None
        }
    }
}

async fn maybe_convert_chinese_variant(
    settings: &AppSettings,
    transcription: &str,
) -> Option<String> {
    // Check if language is set to Simplified or Traditional Chinese
    let is_simplified = settings.selected_language == "zh-Hans";
    let is_traditional = settings.selected_language == "zh-Hant";

    if !is_simplified && !is_traditional {
        debug!("selected_language is not Simplified or Traditional Chinese; skipping translation");
        return None;
    }

    debug!(
        "Starting Chinese translation using OpenCC for language: {}",
        settings.selected_language
    );

    // Use OpenCC to convert based on selected language
    let config = if is_simplified {
        // Convert Traditional Chinese to Simplified Chinese
        BuiltinConfig::Tw2sp
    } else {
        // Convert Simplified Chinese to Traditional Chinese
        BuiltinConfig::S2twp
    };

    match OpenCC::from_config(config) {
        Ok(converter) => {
            let converted = converter.convert(transcription);
            debug!(
                "OpenCC translation completed. Input length: {}, Output length: {}",
                transcription.len(),
                converted.len()
            );
            Some(converted)
        }
        Err(e) => {
            error!("Failed to initialize OpenCC converter: {}. Falling back to original transcription.", e);
            None
        }
    }
}

impl ShortcutAction for TranscribeAction {
    fn start(&self, app: &AppHandle, binding_id: &str, _shortcut_str: &str) {
        let start_time = Instant::now();
        debug!("TranscribeAction::start called for binding: {}", binding_id);

        if let Err(err) = crate::license::enforce_any_access(app, "dictation") {
            warn!("Access gate denied transcription start: {}", err);
            let _ = app.emit("premium-access-denied", err.clone());
            return;
        }

        // Basic-tier quota check: 30 transcriptions per rolling 7-day window
        if crate::license::current_plan(app).as_deref() == Some("basic") {
            let since = (chrono::Utc::now() - chrono::Duration::days(7)).timestamp();
            let hm = app.state::<Arc<HistoryManager>>();
            match hm.count_recent_transcriptions(since) {
                Ok(count) if count >= 30 => {
                    warn!("Basic quota exceeded ({}/30), blocking transcription start", count);
                    let _ = app.emit(
                        "transcription-quota-exceeded",
                        serde_json::json!({ "count": count, "limit": 30 }),
                    );
                    return;
                }
                Err(e) => {
                    warn!("Failed to check transcription quota: {}", e);
                }
                _ => {}
            }
        }

        let captured_app_context = detect_current_app_context();

        // Load model in the background
        let tm = app.state::<Arc<TranscriptionManager>>();
        tm.initiate_model_load();

        let binding_id = binding_id.to_string();
        change_tray_icon(app, TrayIconState::Recording);
        show_recording_overlay(app);

        let rm = app.state::<Arc<AudioRecordingManager>>();

        // Get the microphone mode to determine audio feedback timing
        let settings = get_settings(app);
        let is_always_on = settings.always_on_microphone;
        debug!("Microphone mode - always_on: {}", is_always_on);

        let mut recording_started = false;
        if is_always_on {
            // Always-on mode: Play audio feedback immediately, then apply mute after sound finishes
            debug!("Always-on mode: Playing audio feedback immediately");
            let rm_clone = Arc::clone(&rm);
            let app_clone = app.clone();
            // The blocking helper exits immediately if audio feedback is disabled,
            // so we can always reuse this thread to ensure mute happens right after playback.
            std::thread::spawn(move || {
                play_feedback_sound_blocking(&app_clone, SoundType::Start);
                rm_clone.apply_mute();
            });

            recording_started = rm.try_start_recording(&binding_id);
            debug!("Recording started: {}", recording_started);
        } else {
            // On-demand mode: Start recording first, then play audio feedback, then apply mute
            // This allows the microphone to be activated before playing the sound
            debug!("On-demand mode: Starting recording first, then audio feedback");
            let recording_start_time = Instant::now();
            if rm.try_start_recording(&binding_id) {
                recording_started = true;
                debug!("Recording started in {:?}", recording_start_time.elapsed());
                // Small delay to ensure microphone stream is active
                let app_clone = app.clone();
                let rm_clone = Arc::clone(&rm);
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(100));
                    debug!("Handling delayed audio feedback/mute sequence");
                    // Helper handles disabled audio feedback by returning early, so we reuse it
                    // to keep mute sequencing consistent in every mode.
                    play_feedback_sound_blocking(&app_clone, SoundType::Start);
                    rm_clone.apply_mute();
                });
            } else {
                debug!("Failed to start recording");
            }
        }

        if recording_started {
            if let Some(state) = app.try_state::<ActiveAppContextState>() {
                if let Ok(mut snapshot) = state.0.lock() {
                    snapshot.set_active_context(&binding_id, captured_app_context.clone());
                }
            }
            shortcut::register_cancel_shortcut(app);
            shortcut::register_pause_shortcut(app);
            shortcut::register_action_shortcuts(app);

            let current_model_info = app.try_state::<Arc<ModelManager>>().and_then(|mm| {
                let settings = get_settings(app);
                let model_id = if settings.selected_model.is_empty() {
                    app.state::<Arc<TranscriptionManager>>().get_current_model()
                } else {
                    Some(settings.selected_model)
                }?;
                mm.get_model_info(&model_id)
            });
            let chunking_profile =
                chunking_profile_for_model(app, current_model_info.as_ref(), &settings);

            // ── Spawn background streaming transcription ──────────────────────────
            // The sampler wakes every 500 ms and sends a chunk once enough new
            // speech has accumulated according to the active model profile.
            // The worker processes chunks sequentially so the engine is never
            // called concurrently.  On stop(), only the last few seconds remain.
            if let Some(chunking_profile) = chunking_profile {
                let rm_s = Arc::clone(&*app.state::<Arc<AudioRecordingManager>>());
                let tm_s = Arc::clone(&*app.state::<Arc<TranscriptionManager>>());
                let chunk_context = captured_app_context.clone();

                let shared_state = Arc::new(Mutex::new(ChunkingSharedState {
                    last_committed_idx: 0,
                    next_chunk_idx: 0,
                }));
                let results: Arc<Mutex<Vec<(usize, String)>>> = Arc::new(Mutex::new(Vec::new()));
                let pending_chunks = Arc::new(AtomicUsize::new(0));

                let (chunk_tx, chunk_rx) = std::sync::mpsc::channel::<Option<(Vec<f32>, usize)>>();

                // Sampler thread: polls audio frequently and sends profile-sized chunks.
                let shared_s = Arc::clone(&shared_state);
                let tx_s = chunk_tx.clone();
                let pending_s = Arc::clone(&pending_chunks);
                let sampler_handle = std::thread::spawn(move || {
                    loop {
                        std::thread::sleep(std::time::Duration::from_millis(CHUNK_SAMPLER_POLL_MS));

                        let snapshot = match rm_s.snapshot_recording() {
                            Some(s) => s,
                            None => break, // recording stopped
                        };

                        let total = snapshot.len();
                        let (last_committed, next_idx) = {
                            let s = shared_s.lock().unwrap();
                            (s.last_committed_idx, s.next_chunk_idx)
                        };
                        let new_samples = total.saturating_sub(last_committed);

                        if new_samples >= chunking_profile.interval_samples {
                            let pending = pending_s.load(Ordering::Relaxed);
                            if pending >= MAX_PENDING_BACKGROUND_CHUNKS {
                                debug!(
                                    "Chunk sampler: pending backlog={} for interval {:.1}s, waiting before sending more",
                                    pending,
                                    chunking_profile.interval_samples as f32 / 16_000.0
                                );
                                continue;
                            }
                            // Include overlap at the start to avoid cutting words.
                            let overlap_start =
                                last_committed.saturating_sub(chunking_profile.overlap_samples);
                            let chunk = snapshot[overlap_start..].to_vec();
                            {
                                let mut s = shared_s.lock().unwrap();
                                s.last_committed_idx = total;
                                s.next_chunk_idx = next_idx + 1;
                            }
                            debug!(
                                "Chunk sampler: sending chunk {} ({:.1}s of audio, interval {:.1}s, overlap {:.1}s)",
                                next_idx,
                                chunk.len() as f32 / 16_000.0,
                                chunking_profile.interval_samples as f32 / 16_000.0,
                                chunking_profile.overlap_samples as f32 / 16_000.0
                            );
                            pending_s.fetch_add(1, Ordering::Relaxed);
                            if tx_s.send(Some((chunk, next_idx))).is_err() {
                                pending_s.fetch_sub(1, Ordering::Relaxed);
                                break;
                            }
                        }
                    }
                    debug!("Chunk sampler thread exited");
                });

                // Worker thread: transcribes chunks sequentially
                let results_w = Arc::clone(&results);
                let pending_w = Arc::clone(&pending_chunks);
                let worker_handle = std::thread::spawn(move || {
                    while let Ok(Some((samples, idx))) = chunk_rx.recv() {
                        debug!(
                            "Chunk worker: transcribing chunk {} ({:.1}s)",
                            idx,
                            samples.len() as f32 / 16_000.0
                        );
                        let text = match tm_s.transcribe_request(TranscriptionRequest {
                            audio: samples,
                            app_context: Some(chunk_context.clone()),
                        }) {
                            Ok(text) => text,
                            Err(err) => {
                                warn!("Chunk worker: failed to transcribe chunk {}: {}", idx, err);
                                String::new()
                            }
                        };
                        if !text.is_empty() {
                            debug!("Chunk {}: '{:.60}...'", idx, text);
                            results_w.lock().unwrap().push((idx, text));
                        }
                        pending_w.fetch_sub(1, Ordering::Relaxed);
                    }
                    debug!("Chunk worker thread exited");
                });

                if let Some(ch) = app.try_state::<ActiveChunkingHandle>() {
                    *ch.0.lock().unwrap() = Some(ChunkingHandle {
                        sampler_handle,
                        worker_handle,
                        chunk_tx,
                        shared_state,
                        results,
                        pending_chunks,
                        chunk_overlap_samples: chunking_profile.overlap_samples,
                    });
                }
            } else if let Some(info) = current_model_info {
                debug!(
                    "Skipping background chunking for model '{}' ({}) to preserve full-context transcription",
                    info.name,
                    info.id
                );
            }
        }

        debug!(
            "TranscribeAction::start completed in {:?}",
            start_time.elapsed()
        );
    }

    fn stop(&self, app: &AppHandle, binding_id: &str, _shortcut_str: &str) {
        crate::shortcut::handler::reset_cancel_confirmation();
        shortcut::unregister_cancel_shortcut(app);
        shortcut::unregister_pause_shortcut(app);
        shortcut::unregister_action_shortcuts(app);

        let stop_time = Instant::now();
        debug!("TranscribeAction::stop called for binding: {}", binding_id);

        let ah = app.clone();
        let rm = Arc::clone(&app.state::<Arc<AudioRecordingManager>>());
        let tm = Arc::clone(&app.state::<Arc<TranscriptionManager>>());
        let hm = Arc::clone(&app.state::<Arc<HistoryManager>>());
        let is_basic_plan = crate::license::current_plan(app).as_deref() == Some("basic");

        change_tray_icon(app, TrayIconState::Transcribing);
        show_transcribing_overlay(app);

        // Unmute before playing audio feedback so the stop sound is audible
        rm.remove_mute();

        // Play audio feedback for recording stop
        play_feedback_sound(app, SoundType::Stop);

        let binding_id = binding_id.to_string(); // Clone binding_id for the async task
        let post_process = self.post_process;
        let active_app_context = if let Some(state) = app.try_state::<ActiveAppContextState>() {
            if let Ok(snapshot) = state.0.lock() {
                snapshot.active_context_for_binding(&binding_id)
            } else {
                None
            }
        } else {
            None
        };

        // Read and clear the selected action before spawning the async task
        let selected_action_key =
            app.try_state::<ActiveActionState>()
                .and_then(|s| match s.0.lock() {
                    Ok(mut guard) => guard.take(),
                    Err(poisoned) => {
                        error!("ActiveActionState mutex poisoned, recovering");
                        poisoned.into_inner().take()
                    }
                });

        // Take the chunking handle (if any) before entering the async block
        let chunking_handle = app
            .try_state::<ActiveChunkingHandle>()
            .and_then(|s| s.0.lock().ok().map(|mut g| g.take()))
            .flatten();

        tauri::async_runtime::spawn(async move {
            let _guard = FinishGuard {
                app: ah.clone(),
                binding_id: binding_id.clone(),
            };
            let binding_id = binding_id.clone();
            let profiler = Arc::new(Mutex::new(PipelineProfiler::new(
                binding_id.clone(),
                if chunking_handle.is_some() {
                    "chunked"
                } else {
                    "single-shot"
                },
                tm.get_current_model(),
                tm.get_current_model_name(),
            )));
            debug!(
                "Starting async transcription task for binding: {}, action: {:?}",
                binding_id, selected_action_key
            );

            // ── Obtain samples + initial transcription ───────────────────────────
            // Two paths:
            //   A) Chunked  – background worker already has most of the text;
            //      we just need to flush the final partial chunk, assemble, and
            //      optionally run a quick cleanup pass.
            //   B) Single-shot – classic "transcribe everything at once" path used
            //      when background chunking is not active for the selected model.

            let stop_recording_time = Instant::now();

            struct TranscriptionResult {
                samples: Vec<f32>,
                transcription: String,
                confidence_payload:
                    Option<crate::transcription_confidence::TranscriptionConfidencePayload>,
                #[allow(dead_code)]
                chunk_count: usize,
            }

            let result: Option<TranscriptionResult> = if let Some(ch) = chunking_handle {
                // ── Path A: chunked streaming ────────────────────────────────────
                let all_samples = match rm.stop_recording(&binding_id) {
                    Some(s) => s,
                    None => {
                        let reason = format!(
                            "No samples returned when stopping recording for binding '{}' (chunked path)",
                            binding_id
                        );
                        warn!("{}", reason);
                        emit_runtime_error(
                            &ah,
                            "CAPTURE_NO_SAMPLES",
                            RuntimeErrorStage::Capture,
                            reason,
                            true,
                        );
                        if let Ok(mut p) = profiler.lock() {
                            p.mark_error("CAPTURE_NO_SAMPLES");
                            p.push_step_since(
                                "stop_recording",
                                stop_recording_time,
                                Some("chunked-path".to_string()),
                            );
                            p.emit(&ah);
                        }
                        utils::hide_recording_overlay(&ah);
                        change_tray_icon(&ah, TrayIconState::Idle);
                        return;
                    }
                };
                if let Ok(mut p) = profiler.lock() {
                    p.set_audio_duration_samples(all_samples.len());
                    p.push_step_since(
                        "stop_recording",
                        stop_recording_time,
                        Some("chunked-path".to_string()),
                    );
                }
                debug!(
                    "Recording stopped in {:?}, {} samples total",
                    stop_recording_time.elapsed(),
                    all_samples.len()
                );

                // Run the blocking work (join sampler, flush final chunk, join
                // worker, assemble results) on a dedicated blocking thread so we
                // don't stall the async executor.
                let chunk_finalize_started = Instant::now();
                let (assembled, chunk_count, all_samples) =
                    tokio::task::spawn_blocking(move || {
                        // Wait for sampler to notice that recording has stopped
                        // (snapshot_recording() now returns None → sampler exits).
                        let _ = ch.sampler_handle.join();

                        // Determine what samples the sampler hasn't sent yet
                        let (last_committed, next_idx) = {
                            let s = ch.shared_state.lock().unwrap();
                            (s.last_committed_idx, s.next_chunk_idx)
                        };

                        // Send the remaining audio (with overlap) as the final chunk
                        let overlap_start = last_committed.saturating_sub(ch.chunk_overlap_samples);
                        let remaining = all_samples[overlap_start..].to_vec();
                        let sent_final = !remaining.is_empty();
                        if sent_final {
                            ch.pending_chunks.fetch_add(1, Ordering::Relaxed);
                            if ch.chunk_tx.send(Some((remaining, next_idx))).is_err() {
                                ch.pending_chunks.fetch_sub(1, Ordering::Relaxed);
                            }
                        }
                        // Signal the worker to shut down
                        let _ = ch.chunk_tx.send(None);

                        // Wait for all chunks to finish transcribing
                        let _ = ch.worker_handle.join();

                        // Assemble in order with boundary deduplication
                        let mut results = ch.results.lock().unwrap();
                        results.sort_by_key(|r| r.0);

                        let chunk_count = results.len();
                        let assembled = if results.is_empty() {
                            String::new()
                        } else if results.len() == 1 {
                            results[0].1.clone()
                        } else {
                            let mut parts = vec![results[0].1.clone()];
                            for i in 1..results.len() {
                                let d = deduplicate_boundary(&results[i - 1].1, &results[i].1);
                                if !d.is_empty() {
                                    parts.push(d);
                                }
                            }
                            parts.join(" ")
                        };

                        (assembled, chunk_count, all_samples)
                    })
                    .await
                    .unwrap_or_else(|_| (String::new(), 0, Vec::new()));
                if let Ok(mut p) = profiler.lock() {
                    p.push_step_since(
                        "chunk_finalize_and_assemble",
                        chunk_finalize_started,
                        Some(format!("chunks={}", chunk_count)),
                    );
                }

                debug!(
                    "Chunked assembly done: {} chunks → '{}' (first 80 chars)",
                    chunk_count,
                    &assembled.chars().take(80).collect::<String>()
                );

                // Optional cleanup pass: fix language + boundary artifacts
                let chunk_cleanup_started = Instant::now();
                let transcription = if chunk_count >= 2 && !assembled.is_empty() {
                    let settings_for_cleanup = get_settings(&ah);
                    cleanup_assembled_transcription(&settings_for_cleanup, &assembled)
                        .await
                        .unwrap_or(assembled)
                } else {
                    assembled
                };
                if let Ok(mut p) = profiler.lock() {
                    p.push_step_since(
                        "chunk_cleanup",
                        chunk_cleanup_started,
                        Some(format!(
                            "applied={}",
                            chunk_count >= 2 && !transcription.is_empty()
                        )),
                    );
                }

                Some(TranscriptionResult {
                    samples: all_samples,
                    transcription,
                    confidence_payload: None,
                    chunk_count,
                })
            } else {
                // ── Path B: single-shot (short recording) ────────────────────────
                let samples = match rm.stop_recording(&binding_id) {
                    Some(s) => s,
                    None => {
                        let reason = format!(
                            "No samples returned when stopping recording for binding '{}'",
                            binding_id
                        );
                        warn!("{}", reason);
                        emit_runtime_error(
                            &ah,
                            "CAPTURE_NO_SAMPLES",
                            RuntimeErrorStage::Capture,
                            reason,
                            true,
                        );
                        if let Ok(mut p) = profiler.lock() {
                            p.mark_error("CAPTURE_NO_SAMPLES");
                            p.push_step_since(
                                "stop_recording",
                                stop_recording_time,
                                Some("single-shot-path".to_string()),
                            );
                            p.emit(&ah);
                        }
                        utils::hide_recording_overlay(&ah);
                        change_tray_icon(&ah, TrayIconState::Idle);
                        return;
                    }
                };
                if let Ok(mut p) = profiler.lock() {
                    p.set_audio_duration_samples(samples.len());
                    p.push_step_since(
                        "stop_recording",
                        stop_recording_time,
                        Some("single-shot-path".to_string()),
                    );
                }
                debug!(
                    "Recording stopped in {:?}, {} samples",
                    stop_recording_time.elapsed(),
                    samples.len()
                );

                let duration_seconds = samples.len() as f32 / 16_000.0;
                let settings_for_model = get_settings(&ah);
                let original_model = tm.get_current_model();
                let mut switched_model = false;
                let model_manager = ah.state::<Arc<ModelManager>>();
                let selected_model_info = original_model
                    .as_deref()
                    .and_then(|model_id| model_manager.get_model_info(model_id));

                if let Some((fallback_model, reason)) = resolve_runtime_model_override(
                    selected_model_info.as_ref(),
                    &model_manager,
                    &settings_for_model,
                ) {
                    if original_model.as_deref() != Some(fallback_model.id.as_str()) {
                        let model_switch_started = Instant::now();
                        info!(
                            "{}. Temporarily switching from Parakeet V3 to '{}' ({})",
                            reason, fallback_model.name, fallback_model.id
                        );
                        if let Err(err) = tm.load_model(&fallback_model.id) {
                            warn!(
                                "Failed to load fallback model '{}' after Parakeet V3 compatibility check: {}",
                                fallback_model.id,
                                err
                            );
                        } else {
                            switched_model = true;
                            if let Ok(mut p) = profiler.lock() {
                                p.set_model(
                                    Some(fallback_model.id.clone()),
                                    Some(fallback_model.name.clone()),
                                );
                                p.push_step_since(
                                    "model_switch_runtime_override",
                                    model_switch_started,
                                    Some(reason),
                                );
                            }
                        }
                    }
                } else if let Some(info) = selected_model_info.as_ref() {
                    if is_parakeet_v3_model_id(&info.id) {
                        if settings_for_model.selected_language != "auto"
                            && !model_supports_selected_language(info, &settings_for_model)
                        {
                            warn!(
                                "Parakeet V3 is being used with unsupported language '{}', and no downloaded fallback model was available.",
                                settings_for_model.selected_language
                            );
                        }
                    }
                }

                if let Some(ref long_model_id) = settings_for_model.long_audio_model {
                    if duration_seconds > settings_for_model.long_audio_threshold_seconds
                        && original_model.as_deref() != Some(long_model_id.as_str())
                    {
                        let long_model_switch_started = Instant::now();
                        debug!(
                            "Audio {:.1}s > threshold {:.1}s, switching to long model: {}",
                            duration_seconds,
                            settings_for_model.long_audio_threshold_seconds,
                            long_model_id
                        );
                        if let Err(e) = tm.load_model(long_model_id) {
                            warn!("Failed to load long audio model: {}", e);
                        } else {
                            switched_model = true;
                            if let Ok(mut p) = profiler.lock() {
                                p.set_model(
                                    Some(long_model_id.clone()),
                                    tm.get_current_model_name(),
                                );
                                p.push_step_since(
                                    "model_switch_long_audio",
                                    long_model_switch_started,
                                    Some(format!(
                                        "{:.1}s>{:.1}s",
                                        duration_seconds,
                                        settings_for_model.long_audio_threshold_seconds
                                    )),
                                );
                            }
                        }
                    }
                }

                let transcription_time = Instant::now();
                let samples_clone_fb = samples.clone();
                let transcription_output = match tm.transcribe_detailed_request(TranscriptionRequest {
                    audio: samples.clone(),
                    app_context: active_app_context.clone(),
                }) {
                    Ok(mut output) => {
                        if let Ok(mut p) = profiler.lock() {
                            p.push_step_since(
                                "transcribe_primary",
                                transcription_time,
                                Some(format!(
                                    "chars={}, duration_s={:.2}",
                                    output.text.chars().count(),
                                    duration_seconds
                                )),
                            );
                        }
                        debug!(
                            "Transcription in {:?}: '{}'",
                            transcription_time.elapsed(),
                            output.text
                        );
                        // Fallback retry with accurate model on empty result
                        if output.text.is_empty() && duration_seconds > 1.0 && !switched_model {
                            if let Some(ref long_model_id) = settings_for_model.long_audio_model {
                                if original_model.as_deref() != Some(long_model_id.as_str()) {
                                    let retry_started = Instant::now();
                                    info!(
                                        "Empty result for {:.1}s audio, retrying with long model",
                                        duration_seconds
                                    );
                                    if tm.load_model(long_model_id).is_ok() {
                                        if let Ok(retry) =
                                            tm.transcribe_detailed_request(TranscriptionRequest {
                                                audio: samples_clone_fb,
                                                app_context: active_app_context.clone(),
                                            })
                                        {
                                            if !retry.text.is_empty() {
                                                output = retry;
                                            }
                                        }
                                        if let Ok(mut p) = profiler.lock() {
                                            p.set_model(
                                                Some(long_model_id.clone()),
                                                tm.get_current_model_name(),
                                            );
                                            p.push_step_since(
                                                "transcribe_retry_long_model",
                                                retry_started,
                                                Some(format!(
                                                    "chars={}",
                                                    output.text.chars().count()
                                                )),
                                            );
                                        }
                                    }
                                }
                            }
                        }
                        output
                    }
                    Err(err) => {
                        let reason = format!("Transcription error: {}", err);
                        error!("{}", reason);
                        emit_runtime_error(
                            &ah,
                            "TRANSCRIPTION_FAILED",
                            RuntimeErrorStage::Transcription,
                            reason,
                            true,
                        );
                        if let Ok(mut p) = profiler.lock() {
                            p.mark_error("TRANSCRIPTION_FAILED");
                            p.push_step_since(
                                "transcribe_primary",
                                transcription_time,
                                Some("error".to_string()),
                            );
                            p.emit(&ah);
                        }
                        utils::hide_recording_overlay(&ah);
                        change_tray_icon(&ah, TrayIconState::Idle);
                        // Restore model if needed
                        if switched_model {
                            if let Some(ref orig_id) = original_model {
                                let _ = tm.load_model(orig_id);
                            }
                        }
                        return;
                    }
                };

                if switched_model {
                    if let Some(ref orig_id) = original_model {
                        let restore_started = Instant::now();
                        if let Err(e) = tm.load_model(orig_id) {
                            warn!("Failed to restore original model: {}", e);
                        } else if let Ok(mut p) = profiler.lock() {
                            p.push_step_since(
                                "restore_original_model",
                                restore_started,
                                Some(orig_id.clone()),
                            );
                            p.set_model(original_model.clone(), tm.get_current_model_name());
                        }
                    }
                }

                Some(TranscriptionResult {
                    samples,
                    transcription: transcription_output.text,
                    confidence_payload: transcription_output.confidence_payload,
                    chunk_count: 1,
                })
            };

            // ── Shared post-processing, paste and history ────────────────────────
            if let Some(TranscriptionResult {
                samples,
                transcription,
                confidence_payload,
                ..
            }) = result
            {
                if let Some(context) = active_app_context.clone() {
                    if let Some(state) = ah.try_state::<ActiveAppContextState>() {
                        if let Ok(mut snapshot) = state.0.lock() {
                            snapshot.set_last_transcription_context(context);
                        }
                    }
                }
                let duration_seconds = samples.len() as f32 / 16_000.0;
                let samples_clone = samples.clone();

                let mut post_processed_text: Option<String> = None;
                let mut post_process_prompt: Option<String> = None;

                if !transcription.is_empty() {
                    let settings = get_settings(&ah);
                    let mut final_text = transcription.clone();

                    // Chinese variant conversion
                    let chinese_convert_started = Instant::now();
                    if let Some(converted) =
                        maybe_convert_chinese_variant(&settings, &transcription).await
                    {
                        final_text = converted;
                    }
                    if let Ok(mut p) = profiler.lock() {
                        p.push_step_since(
                            "post_convert_chinese_variant",
                            chinese_convert_started,
                            Some(format!("changed={}", final_text != transcription)),
                        );
                    }

                    let selected_action = selected_action_key.and_then(|key| {
                        settings
                            .post_process_actions
                            .iter()
                            .find(|a| a.key == key)
                            .cloned()
                    });

                    if selected_action.is_some() || post_process {
                        show_processing_overlay(&ah);
                        if let Some(coordinator) = ah.try_state::<TranscriptionCoordinator>() {
                            coordinator.notify_enter_processing();
                        }
                    }

                    let post_process_started = Instant::now();
                    let processed = if let Some(ref action) = selected_action {
                        process_action(
                            &settings,
                            &final_text,
                            &action.prompt,
                            action.model.as_deref(),
                            action.provider_id.as_deref(),
                        )
                        .await
                    } else if post_process {
                        post_process_transcription(&settings, &final_text).await
                    } else {
                        None
                    };
                    if let Ok(mut p) = profiler.lock() {
                        p.push_step_since(
                            "post_process",
                            post_process_started,
                            Some(format!("applied={}", processed.is_some())),
                        );
                    }

                    if let Some(processed_text) = processed {
                        post_processed_text = Some(processed_text.clone());
                        final_text = processed_text;

                        if let Some(action) = selected_action {
                            post_process_prompt = Some(action.prompt);
                        } else if let Some(prompt_id) = &settings.post_process_selected_prompt_id {
                            if let Some(prompt) = settings
                                .post_process_prompts
                                .iter()
                                .find(|p| &p.id == prompt_id)
                            {
                                post_process_prompt = Some(prompt.prompt.clone());
                            }
                        }
                    } else if final_text != transcription {
                        post_processed_text = Some(final_text.clone());
                    }

                    if settings.adaptive_voice_profile_enabled {
                        let voice_profile_started = Instant::now();
                        if let Some(state) = ah.try_state::<VoiceProfileState>() {
                            if let Ok(mut profile) = state.0.lock() {
                                profile.update_from_session(
                                    &samples,
                                    &final_text,
                                    &settings.custom_words,
                                );
                                profile.save(&ah);
                            }
                        }
                        if let Ok(mut p) = profiler.lock() {
                            p.push_step_since(
                                "voice_profile_update",
                                voice_profile_started,
                                Some(format!(
                                    "enabled=true chars={}",
                                    final_text.chars().count()
                                )),
                            );
                        }
                    }

                    let ah_clone = ah.clone();
                    let fallback_text = final_text.clone();
                    let main_thread_fallback_text = fallback_text.clone();
                    let paste_time = Instant::now();
                    if let Ok(mut p) = profiler.lock() {
                        p.set_transcription_chars(&final_text);
                    }
                    emit_lifecycle_state(
                        &ah,
                        TranscriptionLifecycleState::Pasting,
                        None,
                        Some("paste-dispatch"),
                    );
                    let profiler_for_paste = Arc::clone(&profiler);
                    ah.run_on_main_thread(move || {
                        if let Ok(mut p) = profiler_for_paste.lock() {
                            p.push_step_since("paste_dispatch_wait", paste_time, None);
                        }
                        let text_for_fallback = fallback_text.clone();
                        let paste_exec_started = Instant::now();

                        // Basic-tier: clipboard-only, no native injection
                        if is_basic_plan {
                            match ah_clone.clipboard().write_text(&final_text) {
                                Ok(()) => {
                                    debug!("Basic tier: copied transcription to clipboard");
                                    let _ = ah_clone.emit("basic-copied-to-clipboard", ());
                                    if let Ok(mut p) = profiler_for_paste.lock() {
                                        p.push_step_since(
                                            "paste_execute",
                                            paste_exec_started,
                                            Some("basic_clipboard".to_string()),
                                        );
                                        p.mark_completed();
                                        p.emit(&ah_clone);
                                    }
                                }
                                Err(e) => {
                                    error!("Basic tier clipboard write failed: {}", e);
                                    emit_paste_failed_event(&ah_clone, e.to_string(), false);
                                }
                            }
                        } else {
                        match utils::paste(final_text, ah_clone.clone()) {
                            Ok(()) => {
                                debug!("Text pasted in {:?}", paste_time.elapsed());
                                if let Ok(mut p) = profiler_for_paste.lock() {
                                    p.push_step_since(
                                        "paste_execute",
                                        paste_exec_started,
                                        Some("ok".to_string()),
                                    );
                                    p.mark_completed();
                                    p.emit(&ah_clone);
                                }
                            }
                            Err(e) => {
                                let reason = format!("Failed to paste transcription: {}", e);
                                error!("{}", reason);
                                let copied_to_clipboard =
                                    match ah_clone.clipboard().write_text(&text_for_fallback) {
                                        Ok(()) => {
                                            info!(
                                                "Paste failed, copied transcription to clipboard as fallback"
                                            );
                                            true
                                        }
                                        Err(copy_err) => {
                                            error!(
                                                "Fallback clipboard write failed after paste error: {}",
                                                copy_err
                                            );
                                            false
                                        }
                                    };
                                emit_runtime_error(
                                    &ah_clone,
                                    "PASTE_FAILED",
                                    RuntimeErrorStage::Paste,
                                    reason.clone(),
                                    true,
                                );
                                emit_paste_failed_event(
                                    &ah_clone,
                                    reason,
                                    copied_to_clipboard,
                                );
                                if let Ok(mut p) = profiler_for_paste.lock() {
                                    p.push_step_since(
                                        "paste_execute",
                                        paste_exec_started,
                                        Some(format!(
                                            "fallback_clipboard={}",
                                            copied_to_clipboard
                                        )),
                                    );
                                    p.mark_error("PASTE_FAILED");
                                    p.emit(&ah_clone);
                                }
                            }
                        }
                        } // end else (premium paste)
                        utils::hide_recording_overlay(&ah_clone);
                        change_tray_icon(&ah_clone, TrayIconState::Idle);
                    })
                    .unwrap_or_else(|e| {
                        let reason = format!("Failed to run paste on main thread: {:?}", e);
                        error!("{}", reason);
                        let copied_to_clipboard =
                            match ah.clipboard().write_text(&main_thread_fallback_text) {
                                Ok(()) => {
                                    info!(
                                        "Main-thread paste dispatch failed, copied transcription to clipboard as fallback"
                                    );
                                    true
                                }
                                Err(copy_err) => {
                                    error!(
                                        "Fallback clipboard write failed after main-thread dispatch error: {}",
                                        copy_err
                                    );
                                    false
                                }
                            };
                        emit_runtime_error(
                            &ah,
                            "PASTE_MAIN_THREAD_DISPATCH_FAILED",
                            RuntimeErrorStage::Paste,
                            reason.clone(),
                            true,
                        );
                        emit_paste_failed_event(&ah, reason, copied_to_clipboard);
                        if let Ok(mut p) = profiler.lock() {
                            p.push_step_since(
                                "paste_dispatch_wait",
                                paste_time,
                                Some("dispatch-failed".to_string()),
                            );
                            p.mark_error("PASTE_MAIN_THREAD_DISPATCH_FAILED");
                            p.emit(&ah);
                        }
                        utils::hide_recording_overlay(&ah);
                        change_tray_icon(&ah, TrayIconState::Idle);
                    });
                } else {
                    warn!("Empty transcription result; skipping automatic paste");
                    emit_runtime_error(
                        &ah,
                        "TRANSCRIPTION_EMPTY",
                        RuntimeErrorStage::Transcription,
                        "Transcription produced empty output; paste skipped",
                        true,
                    );
                    if let Ok(mut p) = profiler.lock() {
                        p.set_transcription_chars("");
                        p.mark_error("TRANSCRIPTION_EMPTY");
                        p.emit(&ah);
                    }
                    utils::hide_recording_overlay(&ah);
                    change_tray_icon(&ah, TrayIconState::Idle);
                }

                if !transcription.is_empty() || duration_seconds > 1.0 {
                    let hm_clone = Arc::clone(&hm);
                    let transcription_for_history = transcription.clone();
                    let model_name_for_history = tm.get_current_model_name();
                    let action_key_for_history = if post_processed_text.is_some() {
                        selected_action_key
                    } else {
                        None
                    };
                    if let Ok(mut p) = profiler.lock() {
                        p.push_step(
                            "history_enqueue",
                            Duration::from_millis(0),
                            Some(format!(
                                "chars={}, post_processed={}",
                                transcription_for_history.chars().count(),
                                post_processed_text.is_some()
                            )),
                        );
                    }
                    tauri::async_runtime::spawn(async move {
                        if let Err(e) = hm_clone
                            .save_transcription(
                                samples_clone,
                                transcription_for_history,
                                confidence_payload,
                                post_processed_text,
                                post_process_prompt,
                                action_key_for_history,
                                model_name_for_history,
                            )
                            .await
                        {
                            error!("Failed to save transcription to history: {}", e);
                        }
                    });
                }
            }
        });

        debug!(
            "TranscribeAction::stop completed in {:?}",
            stop_time.elapsed()
        );
    }
}

// Cancel Action
struct CancelAction;

impl ShortcutAction for CancelAction {
    fn start(&self, app: &AppHandle, _binding_id: &str, _shortcut_str: &str) {
        utils::cancel_current_operation(app);
    }

    fn stop(&self, _app: &AppHandle, _binding_id: &str, _shortcut_str: &str) {
        // Nothing to do on stop for cancel
    }
}

// Test Action
struct TestAction;

impl ShortcutAction for TestAction {
    fn start(&self, app: &AppHandle, binding_id: &str, shortcut_str: &str) {
        log::info!(
            "Shortcut ID '{}': Started - {} (App: {})", // Changed "Pressed" to "Started" for consistency
            binding_id,
            shortcut_str,
            app.package_info().name
        );
    }

    fn stop(&self, app: &AppHandle, binding_id: &str, shortcut_str: &str) {
        log::info!(
            "Shortcut ID '{}': Stopped - {} (App: {})", // Changed "Released" to "Stopped" for consistency
            binding_id,
            shortcut_str,
            app.package_info().name
        );
    }
}

// Static Action Map
pub static ACTION_MAP: Lazy<HashMap<String, Arc<dyn ShortcutAction>>> = Lazy::new(|| {
    let mut map = HashMap::new();
    map.insert(
        "transcribe".to_string(),
        Arc::new(TranscribeAction {
            post_process: false,
        }) as Arc<dyn ShortcutAction>,
    );
    map.insert(
        "transcribe_with_post_process".to_string(),
        Arc::new(TranscribeAction { post_process: true }) as Arc<dyn ShortcutAction>,
    );
    map.insert(
        "cancel".to_string(),
        Arc::new(CancelAction) as Arc<dyn ShortcutAction>,
    );
    map.insert(
        "test".to_string(),
        Arc::new(TestAction) as Arc<dyn ShortcutAction>,
    );
    map
});
