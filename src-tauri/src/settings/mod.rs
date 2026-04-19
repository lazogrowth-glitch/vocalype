use crate::model_ids::{canonical_model_id, PARAKEET_V3_MULTILINGUAL_ID};
use log::{debug, warn};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

pub mod adaptive;
pub mod audio;
pub mod logging;
pub mod persistence;
pub mod recording;
pub mod shortcuts;
pub mod ui;

pub(crate) use adaptive::*;
pub use audio::{apply_voice_snippets, SoundTheme, TypingTool, VoiceSnippet};
pub use logging::LogLevel;
pub(crate) use persistence::*;
pub use recording::{RecordingMode, RecordingRetentionPeriod};
pub use shortcuts::ShortcutBinding;
pub use ui::{
    AutoSubmitKey, ClipboardHandling, KeyboardImplementation, OverlayPosition, PasteMethod,
};

pub const APPLE_INTELLIGENCE_PROVIDER_ID: &str = "apple_intelligence";
pub const APPLE_INTELLIGENCE_DEFAULT_MODEL_ID: &str = "Apple Intelligence";
pub const CONFIGURED_SECRET_SENTINEL: &str = "__configured__";

#[derive(Serialize, Deserialize, Debug, Clone, Type)]
pub struct LLMPrompt {
    pub id: String,
    pub name: String,
    pub prompt: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, Type)]
pub struct PostProcessAction {
    pub key: u8,
    pub name: String,
    pub prompt: String,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub provider_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Type)]
pub struct SavedProcessingModel {
    pub id: String,
    pub provider_id: String,
    pub model_id: String,
    pub label: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, Type)]
pub struct PostProcessProvider {
    pub id: String,
    pub label: String,
    pub base_url: String,
    #[serde(default)]
    pub allow_base_url_edit: bool,
    #[serde(default)]
    pub models_endpoint: Option<String>,
    #[serde(default)]
    pub supports_structured_output: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Type)]
#[serde(rename_all = "snake_case")]
pub enum ModelUnloadTimeout {
    Never,
    Immediately,
    Min2,
    Min5,
    Min10,
    Min15,
    Hour1,
    Sec5, // Debug mode only
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Type)]
#[serde(rename_all = "snake_case")]
pub enum WhisperBackendPreference {
    Auto,
    Cpu,
    Gpu,
}

impl Default for WhisperBackendPreference {
    fn default() -> Self {
        WhisperBackendPreference::Auto
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Type)]
#[serde(rename_all = "snake_case")]
pub enum MachineTier {
    Low,
    Medium,
    High,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Type)]
#[serde(rename_all = "snake_case")]
pub enum PowerMode {
    Normal,
    Saver,
    Unknown,
}

impl Default for PowerMode {
    fn default() -> Self {
        Self::Unknown
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Type)]
#[serde(rename_all = "snake_case")]
pub enum CalibrationPhase {
    None,
    Quick,
    Full,
}

impl Default for CalibrationPhase {
    fn default() -> Self {
        Self::None
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Type)]
#[serde(rename_all = "snake_case")]
pub enum BenchPhase {
    None,
    QuickDone,
    FullDone,
}

impl Default for BenchPhase {
    fn default() -> Self {
        Self::None
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Type)]
#[serde(rename_all = "snake_case")]
pub enum AdaptiveCalibrationState {
    Idle,
    Queued,
    Running,
    Completed,
    Failed,
    FallbackApplied,
}

impl Default for AdaptiveCalibrationState {
    fn default() -> Self {
        Self::Idle
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Type, Default)]
pub struct MachineScoreDetails {
    #[serde(default)]
    pub ram_score: u8,
    #[serde(default)]
    pub cpu_threads_score: u8,
    #[serde(default)]
    pub cpu_family_score: u8,
    #[serde(default)]
    pub gpu_prebench_bonus: f32,
    #[serde(default)]
    pub npu_prebench_bonus: f32,
    #[serde(default)]
    pub low_power_penalty: f32,
    #[serde(default)]
    pub power_penalty: f32,
    #[serde(default)]
    pub thermal_penalty: f32,
    #[serde(default)]
    pub final_score: f32,
    #[serde(default)]
    pub tier_reason: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Type)]
#[serde(rename_all = "snake_case")]
pub enum GpuKind {
    None,
    Integrated,
    Dedicated,
    Unknown,
}

impl Default for GpuKind {
    fn default() -> Self {
        Self::Unknown
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Type)]
#[serde(rename_all = "snake_case")]
pub enum NpuKind {
    None,
    Qualcomm,
    Intel,
    Amd,
    Unknown,
}

impl Default for NpuKind {
    fn default() -> Self {
        Self::Unknown
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Type)]
pub struct UnsafeBackendRecord {
    pub backend: WhisperBackendPreference,
    pub unsafe_until_ms: u64,
    pub reason: String,
    pub failed_at_ms: u64,
}

#[derive(Serialize, Deserialize, Debug, Clone, Type)]
pub struct WhisperModelAdaptiveConfig {
    pub backend: WhisperBackendPreference,
    pub threads: u8,
    pub chunk_seconds: u8,
    pub overlap_ms: u16,
    #[serde(default)]
    pub active_backend: WhisperBackendPreference,
    #[serde(default)]
    pub active_threads: u8,
    #[serde(default)]
    pub active_chunk_seconds: u8,
    #[serde(default)]
    pub active_overlap_ms: u16,
    #[serde(default)]
    pub short_latency_ms: u64,
    #[serde(default)]
    pub medium_latency_ms: u64,
    #[serde(default)]
    pub long_latency_ms: u64,
    #[serde(default)]
    pub stability_score: f32,
    #[serde(default)]
    pub overall_score: f32,
    #[serde(default)]
    pub failure_count: u32,
    #[serde(default)]
    pub calibrated_phase: CalibrationPhase,
    #[serde(default)]
    pub unsafe_backends: Vec<UnsafeBackendRecord>,
    #[serde(default)]
    pub unsafe_until: Option<u64>,
    #[serde(default)]
    pub last_failure_reason: Option<String>,
    #[serde(default)]
    pub last_failure_at: Option<u64>,
    #[serde(default)]
    pub last_quick_bench_at: Option<u64>,
    #[serde(default)]
    pub last_full_bench_at: Option<u64>,
    #[serde(default)]
    pub backend_decision_reason: Option<String>,
    #[serde(default)]
    pub config_decision_reason: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Type)]
pub struct WhisperAdaptiveProfile {
    pub small: WhisperModelAdaptiveConfig,
    pub medium: WhisperModelAdaptiveConfig,
    pub turbo: WhisperModelAdaptiveConfig,
    pub large: WhisperModelAdaptiveConfig,
}

#[derive(Serialize, Deserialize, Debug, Clone, Type)]
pub struct AdaptiveMachineProfile {
    #[serde(default)]
    pub profile_schema_version: u16,
    #[serde(default)]
    pub app_version: String,
    #[serde(default)]
    pub backend_version: String,
    #[serde(default)]
    pub machine_score_details: MachineScoreDetails,
    pub machine_tier: MachineTier,
    pub cpu_brand: String,
    pub logical_cores: u8,
    pub total_memory_gb: u16,
    pub low_power_cpu: bool,
    #[serde(default)]
    pub gpu_detected: bool,
    #[serde(default)]
    pub gpu_kind: GpuKind,
    #[serde(default)]
    pub gpu_name: Option<String>,
    #[serde(default)]
    pub npu_detected: bool,
    #[serde(default)]
    pub npu_kind: NpuKind,
    #[serde(default)]
    pub npu_name: Option<String>,
    #[serde(default)]
    pub copilot_plus_detected: bool,
    #[serde(default)]
    pub on_battery: Option<bool>,
    #[serde(default)]
    pub power_mode: PowerMode,
    #[serde(default)]
    pub thermal_degraded: bool,
    #[serde(default)]
    pub runtime_power_snapshot_at: Option<u64>,
    pub recommended_model_id: String,
    pub secondary_model_id: Option<String>,
    #[serde(default)]
    pub active_runtime_model_id: Option<String>,
    #[serde(default)]
    pub recommended_backend: Option<WhisperBackendPreference>,
    #[serde(default)]
    pub active_backend: Option<WhisperBackendPreference>,
    #[serde(default)]
    pub calibrated_models: Vec<String>,
    #[serde(default)]
    pub bench_phase: BenchPhase,
    #[serde(default)]
    pub bench_completed_at: Option<u64>,
    #[serde(default)]
    pub last_quick_bench_at: Option<u64>,
    #[serde(default)]
    pub last_full_bench_at: Option<u64>,
    #[serde(default)]
    pub calibration_state: AdaptiveCalibrationState,
    #[serde(default)]
    pub calibration_reason: Option<String>,
    #[serde(default)]
    pub large_skip_reason: Option<String>,
    pub whisper: WhisperAdaptiveProfile,
}

impl Default for KeyboardImplementation {
    fn default() -> Self {
        // Default to the native shortcut capture backend only on macOS where it's well-tested.
        // Windows and Linux use Tauri by default.
        #[cfg(target_os = "macos")]
        return KeyboardImplementation::NativeShortcutCapture;
        #[cfg(not(target_os = "macos"))]
        return KeyboardImplementation::Tauri;
    }
}

impl Default for ModelUnloadTimeout {
    fn default() -> Self {
        ModelUnloadTimeout::Never
    }
}

impl Default for PasteMethod {
    fn default() -> Self {
        // Default to CtrlV for macOS and Windows, Direct for Linux
        #[cfg(target_os = "linux")]
        return PasteMethod::Direct;
        #[cfg(not(target_os = "linux"))]
        return PasteMethod::CtrlV;
    }
}

impl Default for ClipboardHandling {
    fn default() -> Self {
        ClipboardHandling::DontModify
    }
}

impl Default for AutoSubmitKey {
    fn default() -> Self {
        AutoSubmitKey::Enter
    }
}

impl ModelUnloadTimeout {
    pub fn to_minutes(self) -> Option<u64> {
        match self {
            ModelUnloadTimeout::Never => None,
            ModelUnloadTimeout::Immediately => Some(0), // Special case for immediate unloading
            ModelUnloadTimeout::Min2 => Some(2),
            ModelUnloadTimeout::Min5 => Some(5),
            ModelUnloadTimeout::Min10 => Some(10),
            ModelUnloadTimeout::Min15 => Some(15),
            ModelUnloadTimeout::Hour1 => Some(60),
            ModelUnloadTimeout::Sec5 => Some(0), // Special case for debug - handled separately
        }
    }

    pub fn to_seconds(self) -> Option<u64> {
        match self {
            ModelUnloadTimeout::Never => None,
            ModelUnloadTimeout::Immediately => Some(0), // Special case for immediate unloading
            ModelUnloadTimeout::Sec5 => Some(5),
            _ => self.to_minutes().map(|m| m * 60),
        }
    }
}

/// Increment this constant every time a migration step is added below.
/// Old installs see `settings_version = 0` (the serde default) and are migrated
/// forward automatically on the next launch.
pub const CURRENT_SETTINGS_VERSION: u32 = 1;

/* still handy for composing the initial JSON in the store ------------- */
#[derive(Serialize, Deserialize, Debug, Clone, Type)]
pub struct AppSettings {
    /// Schema version used to drive forward migrations.
    /// Never set this manually — it is managed by `migrate_settings`.
    #[serde(default)]
    pub settings_version: u32,
    pub bindings: HashMap<String, ShortcutBinding>,
    pub push_to_talk: bool,
    pub audio_feedback: bool,
    #[serde(default = "default_audio_feedback_volume")]
    pub audio_feedback_volume: f32,
    #[serde(default = "default_sound_theme")]
    pub sound_theme: SoundTheme,
    #[serde(default = "default_start_hidden")]
    pub start_hidden: bool,
    #[serde(default = "default_autostart_enabled")]
    pub autostart_enabled: bool,
    #[serde(default = "default_update_checks_enabled")]
    pub update_checks_enabled: bool,
    #[serde(default = "default_model")]
    pub selected_model: String,
    #[serde(default = "default_always_on_microphone")]
    pub always_on_microphone: bool,
    /// When true, Vocalype listens for the wake word "dictate" in the
    /// background and starts a hands-free recording session automatically.
    /// Requires the microphone stream to be open (AlwaysOn mode recommended).
    #[serde(default)]
    pub wake_word_enabled: bool,
    /// Sliding window of the last observed inter-word pause durations (ms).
    /// Accumulated across all recording modes to calibrate the adaptive
    /// silence threshold for wake-word auto-stop.
    #[serde(default)]
    pub speaking_rate_pauses: Vec<u64>,
    /// Canonical recording mode — supersedes the `push_to_talk` and
    /// `always_on_microphone` boolean pair. Populated from those booleans
    /// on first load via settings migration (T11). New code should read this
    /// field; old code continues to use the booleans until migration is done.
    #[serde(default)]
    pub recording_mode: RecordingMode,
    #[serde(default)]
    pub selected_microphone: Option<String>,
    #[serde(default)]
    pub selected_microphone_index: Option<String>,
    #[serde(default)]
    pub clamshell_microphone: Option<String>,
    #[serde(default)]
    pub clamshell_microphone_index: Option<String>,
    #[serde(default)]
    pub selected_output_device: Option<String>,
    #[serde(default = "default_translate_to_english")]
    pub translate_to_english: bool,
    #[serde(default = "default_selected_language")]
    pub selected_language: String,
    #[serde(default = "default_overlay_position")]
    pub overlay_position: OverlayPosition,
    #[serde(default = "default_debug_mode")]
    pub debug_mode: bool,
    #[serde(default = "default_log_level")]
    pub log_level: LogLevel,
    #[serde(default)]
    pub custom_words: Vec<String>,
    #[serde(default = "default_adaptive_vocabulary_enabled")]
    pub adaptive_vocabulary_enabled: bool,
    #[serde(default = "default_adaptive_voice_profile_enabled")]
    pub adaptive_voice_profile_enabled: bool,
    #[serde(default)]
    pub model_unload_timeout: ModelUnloadTimeout,
    #[serde(default = "default_word_correction_threshold")]
    pub word_correction_threshold: f64,
    #[serde(default = "default_history_limit")]
    pub history_limit: usize,
    #[serde(default = "default_recording_retention_period")]
    pub recording_retention_period: RecordingRetentionPeriod,
    #[serde(default)]
    pub paste_method: PasteMethod,
    #[serde(default)]
    pub clipboard_handling: ClipboardHandling,
    #[serde(default = "default_auto_submit")]
    pub auto_submit: bool,
    #[serde(default)]
    pub auto_submit_key: AutoSubmitKey,
    #[serde(default = "default_post_process_enabled")]
    pub post_process_enabled: bool,
    /// When true, LLM post-processing fires automatically whenever the
    /// session glossary signals a code context (≥ 3 extracted identifiers).
    #[serde(default)]
    pub llm_auto_mode: bool,
    #[serde(default = "default_post_process_provider_id")]
    pub post_process_provider_id: String,
    #[serde(default = "default_post_process_providers")]
    pub post_process_providers: Vec<PostProcessProvider>,
    #[serde(default = "default_post_process_api_keys")]
    pub post_process_api_keys: HashMap<String, String>,
    #[serde(default = "default_post_process_models")]
    pub post_process_models: HashMap<String, String>,
    #[serde(default = "default_post_process_prompts")]
    pub post_process_prompts: Vec<LLMPrompt>,
    #[serde(default)]
    pub post_process_selected_prompt_id: Option<String>,
    #[serde(default)]
    pub mute_while_recording: bool,
    #[serde(default)]
    pub append_trailing_space: bool,
    #[serde(default = "default_app_language")]
    pub app_language: String,
    #[serde(default)]
    pub experimental_enabled: bool,
    #[serde(default)]
    pub keyboard_implementation: KeyboardImplementation,
    #[serde(default = "default_show_tray_icon")]
    pub show_tray_icon: bool,
    #[serde(default = "default_paste_delay_ms")]
    pub paste_delay_ms: u64,
    #[serde(default = "default_typing_tool")]
    pub typing_tool: TypingTool,
    pub external_script_path: Option<String>,
    #[serde(default)]
    pub long_audio_model: Option<String>,
    #[serde(default = "default_long_audio_threshold_seconds")]
    pub long_audio_threshold_seconds: f32,
    #[serde(default)]
    pub gemini_api_key: Option<String>,
    #[serde(default = "default_gemini_model")]
    pub gemini_model: String,
    /// Groq API key for cloud STT (stored in keyring, never persisted to disk).
    #[serde(default)]
    pub groq_stt_api_key: Option<String>,
    /// Mistral API key for Voxtral cloud STT (stored in keyring, never persisted to disk).
    #[serde(default)]
    pub mistral_stt_api_key: Option<String>,
    /// Deepgram API key for cloud STT (stored in keyring, never persisted to disk).
    #[serde(default)]
    pub deepgram_api_key: Option<String>,
    #[serde(default = "default_post_process_actions")]
    pub post_process_actions: Vec<PostProcessAction>,
    #[serde(default)]
    pub saved_processing_models: Vec<SavedProcessingModel>,
    #[serde(default = "default_adaptive_profile_applied")]
    pub adaptive_profile_applied: bool,
    #[serde(default)]
    pub adaptive_machine_profile: Option<AdaptiveMachineProfile>,
    /// Whether the automatic app-context feature is enabled globally.
    #[serde(default = "default_app_context_enabled")]
    pub app_context_enabled: bool,
    /// Boost microphone gain for whisper / low-volume recording.
    #[serde(default)]
    pub whisper_mode: bool,
    /// Voice snippets: short trigger phrases → long expansions.
    #[serde(default)]
    pub voice_snippets: Vec<VoiceSnippet>,
    /// Automatically learn word corrections from clipboard changes after paste.
    #[serde(default)]
    pub auto_learn_dictionary: bool,
    /// Automatically pause media players (Spotify, etc.) during recording.
    #[serde(default)]
    pub auto_pause_media: bool,
    /// When true, dictation in code editors is sent to a local LLM (Ollama)
    /// and the result is pasted as formatted code instead of raw text.
    #[serde(default)]
    pub voice_to_code_enabled: bool,
    /// Model name to use for Voice-to-Code (e.g. "devstral", "ministral-3:8b").
    /// Applies to the "ollama" provider.
    #[serde(default)]
    pub voice_to_code_model: String,
    /// Set to true after the Voice-to-Code discovery prompt has been shown
    /// once, so it never appears again.
    #[serde(default)]
    pub voice_to_code_onboarding_done: bool,
}

fn default_model() -> String {
    "".to_string()
}

fn default_adaptive_profile_applied() -> bool {
    false
}

fn default_app_context_enabled() -> bool {
    true
}

fn default_always_on_microphone() -> bool {
    false
}

fn default_translate_to_english() -> bool {
    false
}

fn default_start_hidden() -> bool {
    false
}

fn default_autostart_enabled() -> bool {
    false
}

fn default_update_checks_enabled() -> bool {
    true
}

fn default_selected_language() -> String {
    preferred_transcription_language_from_locale(&default_app_language())
}

fn default_overlay_position() -> OverlayPosition {
    #[cfg(target_os = "linux")]
    return OverlayPosition::None;
    #[cfg(not(target_os = "linux"))]
    return OverlayPosition::Bottom;
}

fn default_debug_mode() -> bool {
    false
}

fn default_adaptive_vocabulary_enabled() -> bool {
    true
}

fn default_adaptive_voice_profile_enabled() -> bool {
    true
}

fn default_log_level() -> LogLevel {
    LogLevel::Info
}

fn default_word_correction_threshold() -> f64 {
    0.18
}

fn default_paste_delay_ms() -> u64 {
    60
}

fn default_auto_submit() -> bool {
    false
}

fn default_history_limit() -> usize {
    50
}

fn default_recording_retention_period() -> RecordingRetentionPeriod {
    // Default to 3 months for GDPR compliance — data should not be kept indefinitely.
    RecordingRetentionPeriod::Months3
}

fn default_audio_feedback_volume() -> f32 {
    1.0
}

fn default_sound_theme() -> SoundTheme {
    SoundTheme::Marimba
}

fn default_post_process_enabled() -> bool {
    false
}

fn default_app_language() -> String {
    tauri_plugin_os::locale()
        .map(|l| l.replace('_', "-"))
        .unwrap_or_else(|| "en".to_string())
}

fn preferred_transcription_language_from_locale(locale: &str) -> String {
    let base_language = locale.split('-').next().unwrap_or("en");

    match base_language {
        "fr" | "es" | "de" | "it" | "pt" | "ja" | "ko" | "zh" | "ru" | "uk" | "pl" | "tr"
        | "vi" | "ar" | "cs" => base_language.to_string(),
        _ => "auto".to_string(),
    }
}

fn preferred_model_for_locale(locale: &str) -> String {
    let _ = locale;
    PARAKEET_V3_MULTILINGUAL_ID.to_string()
}

fn secondary_model_for_locale(locale: &str, tier: MachineTier) -> Option<String> {
    let base_language = locale.split('-').next().unwrap_or("en");
    if base_language == "en" {
        return Some("turbo".to_string());
    }

    match tier {
        MachineTier::High => Some("large".to_string()),
        MachineTier::Medium => Some("turbo".to_string()),
        MachineTier::Low => Some("small".to_string()),
    }
}

fn default_show_tray_icon() -> bool {
    true
}

fn default_post_process_provider_id() -> String {
    "openai".to_string()
}

fn default_post_process_providers() -> Vec<PostProcessProvider> {
    let mut providers = vec![
        PostProcessProvider {
            id: "openai".to_string(),
            label: "OpenAI".to_string(),
            base_url: "https://api.openai.com/v1".to_string(),
            allow_base_url_edit: false,
            models_endpoint: Some("/models".to_string()),
            supports_structured_output: true,
        },
        PostProcessProvider {
            id: "zai".to_string(),
            label: "Z.AI".to_string(),
            base_url: "https://api.z.ai/api/paas/v4".to_string(),
            allow_base_url_edit: false,
            models_endpoint: Some("/models".to_string()),
            supports_structured_output: true,
        },
        PostProcessProvider {
            id: "openrouter".to_string(),
            label: "OpenRouter".to_string(),
            base_url: "https://openrouter.ai/api/v1".to_string(),
            allow_base_url_edit: false,
            models_endpoint: Some("/models".to_string()),
            supports_structured_output: true,
        },
        PostProcessProvider {
            id: "anthropic".to_string(),
            label: "Anthropic".to_string(),
            base_url: "https://api.anthropic.com/v1".to_string(),
            allow_base_url_edit: false,
            models_endpoint: Some("/models".to_string()),
            supports_structured_output: false,
        },
        PostProcessProvider {
            id: "groq".to_string(),
            label: "Groq".to_string(),
            base_url: "https://api.groq.com/openai/v1".to_string(),
            allow_base_url_edit: false,
            models_endpoint: Some("/models".to_string()),
            supports_structured_output: false,
        },
        PostProcessProvider {
            id: "cerebras".to_string(),
            label: "Cerebras".to_string(),
            base_url: "https://api.cerebras.ai/v1".to_string(),
            allow_base_url_edit: false,
            models_endpoint: Some("/models".to_string()),
            supports_structured_output: true,
        },
    ];

    // Note: We always include Apple Intelligence on macOS ARM64 without checking availability
    // at startup. The availability check is deferred to when the user actually tries to use it
    // (in actions.rs). This prevents crashes on macOS 26.x beta where accessing
    // SystemLanguageModel.default during early app initialization causes SIGABRT.
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        providers.push(PostProcessProvider {
            id: APPLE_INTELLIGENCE_PROVIDER_ID.to_string(),
            label: "Apple Intelligence".to_string(),
            base_url: "apple-intelligence://local".to_string(),
            allow_base_url_edit: false,
            models_endpoint: None,
            supports_structured_output: true,
        });
    }

    providers.push(PostProcessProvider {
        id: "gemini".to_string(),
        label: "Gemini".to_string(),
        base_url: "https://generativelanguage.googleapis.com/v1beta".to_string(),
        allow_base_url_edit: false,
        models_endpoint: None,
        supports_structured_output: false,
    });

    providers.push(PostProcessProvider {
        id: "vocalype-llm".to_string(),
        label: "Vocalype LLM (local)".to_string(),
        base_url: crate::llm::llama_server::provider_base_url(),
        allow_base_url_edit: false,
        models_endpoint: None,
        supports_structured_output: false,
    });

    providers.push(PostProcessProvider {
        id: "ollama".to_string(),
        label: "Ollama (Local)".to_string(),
        base_url: "http://localhost:11434/v1".to_string(),
        allow_base_url_edit: false,
        models_endpoint: Some("/models".to_string()),
        supports_structured_output: false,
    });

    // Custom provider always comes last
    providers.push(PostProcessProvider {
        id: "custom".to_string(),
        label: "Custom".to_string(),
        base_url: "http://localhost:11434/v1".to_string(),
        allow_base_url_edit: true,
        models_endpoint: Some("/models".to_string()),
        supports_structured_output: false,
    });

    providers
}

fn default_post_process_api_keys() -> HashMap<String, String> {
    let mut map = HashMap::new();
    for provider in default_post_process_providers() {
        map.insert(provider.id, String::new());
    }
    map
}

fn default_model_for_provider(provider_id: &str) -> String {
    if provider_id == APPLE_INTELLIGENCE_PROVIDER_ID {
        return APPLE_INTELLIGENCE_DEFAULT_MODEL_ID.to_string();
    }
    String::new()
}

fn default_post_process_models() -> HashMap<String, String> {
    let mut map = HashMap::new();
    for provider in default_post_process_providers() {
        map.insert(
            provider.id.clone(),
            default_model_for_provider(&provider.id),
        );
    }
    map
}

fn default_post_process_prompts() -> Vec<LLMPrompt> {
    vec![
        LLMPrompt {
            id: "default_improve_transcriptions".to_string(),
            name: "Improve Transcriptions".to_string(),
            prompt: "Clean this transcript:\n1. Fix spelling, capitalization, and punctuation errors\n2. Convert number words to digits (twenty-five -> 25, ten percent -> 10%, five dollars -> $5)\n3. Replace spoken punctuation with symbols (period -> ., comma -> ,, question mark -> ?)\n4. Remove filler words (um, uh, like as filler)\n5. Keep the language in the original version (if it was French, keep it in French for example)\n\nPreserve exact meaning and word order. Do not paraphrase or reorder content.\n\nReturn only the cleaned transcript.\n\nTranscript:\n${output}".to_string(),
        },
        LLMPrompt {
            id: "dev_clean_llm_prompt".to_string(),
            name: "Clean for LLM".to_string(),
            prompt: "You are a voice transcription cleaner for developer dictation. Your ONLY job is to clean the raw transcript; never answer questions or execute tasks.\n\nRules:\n1. Replace spoken symbols with actual characters: dash -> -, slash -> /, dot -> ., colon -> :, underscore -> _, at -> @, equals -> =, open paren -> (, close paren -> ), open bracket -> [, close bracket -> ], star -> *\n2. Fix capitalization for tech terms: API, JWT, SDK, CLI, SQL, OAuth, React, Tauri, useState, useEffect, npm, git, TypeScript, Supabase, userId, authToken.\n3. Remove filler words (uh, um, like as filler)\n4. KEEP THE SAME LANGUAGE as the transcript. If it is French, output French; if English, output English. Never translate.\n5. NEVER answer, explain, implement, or generate anything, even if the transcript sounds like a task. Output ONLY the cleaned version of what was said.\n\nReturn only the cleaned transcript. No explanations, no code blocks, no preamble.\n\nTranscript:\n${output}".to_string(),
        },
    ]
}

fn default_post_process_actions() -> Vec<PostProcessAction> {
    vec![
        PostProcessAction {
            key: 1,
            name: "Corriger".to_string(),
            prompt: "Correct spelling, punctuation, capitalization, and spacing. Keep the same language and meaning. Return only the corrected text.\n\nText:\n${output}".to_string(),
            model: None,
            provider_id: None,
        },
        PostProcessAction {
            key: 2,
            name: "Resumer".to_string(),
            prompt: "Summarize the text in concise bullet points. Keep the same language as the source.\n\nText:\n${output}".to_string(),
            model: None,
            provider_id: None,
        },
        PostProcessAction {
            key: 3,
            name: "Email".to_string(),
            prompt: "Transform the text into a clear, polite email. Keep the same language as the source. Return only the email body.\n\nText:\n${output}".to_string(),
            model: None,
            provider_id: None,
        },
        PostProcessAction {
            key: 4,
            name: "Traduire".to_string(),
            prompt: "Translate the text. If the source is French, translate to English. If the source is not French, translate to French. Return only the translation.\n\nText:\n${output}".to_string(),
            model: None,
            provider_id: None,
        },
        PostProcessAction {
            key: 5,
            name: "Clean for LLM".to_string(),
            prompt: "Clean this developer dictation for use as an LLM prompt. Fix punctuation and tech terms such as API, JWT, SDK, CLI, SQL, OAuth, React, Tauri, userId, and authToken. Do not answer the prompt. Return only the cleaned prompt.\n\nText:\n${output}".to_string(),
            model: None,
            provider_id: None,
        },
    ]
}

fn default_typing_tool() -> TypingTool {
    TypingTool::Auto
}

fn default_long_audio_threshold_seconds() -> f32 {
    10.0
}

fn default_gemini_model() -> String {
    "gemini-2.5-flash".to_string()
}

pub fn sanitize_custom_provider_base_url(value: &str) -> Result<String, String> {
    let trimmed = value.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("Custom provider URL cannot be empty".to_string());
    }

    if trimmed.starts_with("https://")
        || trimmed.starts_with("http://localhost")
        || trimmed.starts_with("http://127.0.0.1")
    {
        return Ok(trimmed.to_string());
    }

    Err("Custom provider URLs must use https:// or point to localhost/127.0.0.1".to_string())
}

fn ensure_post_process_defaults(settings: &mut AppSettings) -> bool {
    let mut changed = false;
    let default_providers = default_post_process_providers();
    let existing_custom_provider = settings
        .post_process_providers
        .iter()
        .find(|provider| provider.id == "custom")
        .cloned();

    let rebuilt_providers: Vec<PostProcessProvider> = default_providers
        .iter()
        .cloned()
        .map(|provider| {
            if provider.id == "custom" {
                if let Some(existing) = existing_custom_provider.clone() {
                    if let Ok(base_url) = sanitize_custom_provider_base_url(&existing.base_url) {
                        PostProcessProvider {
                            base_url,
                            ..provider
                        }
                    } else {
                        provider
                    }
                } else {
                    provider
                }
            } else {
                provider
            }
        })
        .collect();

    if settings.post_process_providers != rebuilt_providers {
        settings.post_process_providers = rebuilt_providers;
        changed = true;
    }

    let allowed_provider_ids: Vec<String> = default_providers
        .iter()
        .map(|provider| provider.id.clone())
        .collect();

    let original_key_count = settings.post_process_api_keys.len();
    settings
        .post_process_api_keys
        .retain(|provider_id, _| allowed_provider_ids.iter().any(|id| id == provider_id));
    if settings.post_process_api_keys.len() != original_key_count {
        changed = true;
    }

    let original_model_count = settings.post_process_models.len();
    settings
        .post_process_models
        .retain(|provider_id, _| allowed_provider_ids.iter().any(|id| id == provider_id));
    if settings.post_process_models.len() != original_model_count {
        changed = true;
    }

    for provider in &default_providers {
        if !settings.post_process_api_keys.contains_key(&provider.id) {
            settings
                .post_process_api_keys
                .insert(provider.id.clone(), String::new());
            changed = true;
        }

        let default_model = default_model_for_provider(&provider.id);
        match settings.post_process_models.get_mut(&provider.id) {
            Some(existing) => {
                if existing.is_empty() && !default_model.is_empty() {
                    *existing = default_model.clone();
                    changed = true;
                }
            }
            None => {
                settings
                    .post_process_models
                    .insert(provider.id.clone(), default_model);
                changed = true;
            }
        }
    }

    if !allowed_provider_ids.contains(&settings.post_process_provider_id) {
        settings.post_process_provider_id = default_post_process_provider_id();
        changed = true;
    }

    if settings.post_process_actions.is_empty() {
        settings.post_process_actions = default_post_process_actions();
        changed = true;
    }

    changed
}

fn ensure_selected_language_default(settings: &mut AppSettings) -> bool {
    if settings.selected_language != "auto" || settings.translate_to_english {
        return false;
    }

    let preferred_language = preferred_transcription_language_from_locale(&settings.app_language);
    if preferred_language == "auto" {
        return false;
    }

    settings.selected_language = preferred_language;
    true
}

pub const SETTINGS_STORE_PATH: &str = "settings_store.json";

fn sanitize_persisted_secrets(settings: &mut AppSettings) {
    settings.gemini_api_key = None;
    for api_key in settings.post_process_api_keys.values_mut() {
        api_key.clear();
    }
}

fn is_redacted_secret_placeholder(value: &str) -> bool {
    value.trim() == CONFIGURED_SECRET_SENTINEL
}

fn migrate_plaintext_secrets_to_secure_store(settings: &mut AppSettings) -> bool {
    let mut changed = false;

    if let Some(api_key) = settings
        .gemini_api_key
        .clone()
        .filter(|value| !value.trim().is_empty() && !is_redacted_secret_placeholder(value))
    {
        match crate::secret_store::set_gemini_api_key(&api_key) {
            Ok(()) => {
                settings.gemini_api_key = None;
                changed = true;
            }
            Err(err) => warn!(
                "Failed to migrate Gemini API key to secure storage: {}",
                err
            ),
        }
    }

    for (provider_id, api_key) in settings.post_process_api_keys.clone() {
        if api_key.trim().is_empty() || is_redacted_secret_placeholder(&api_key) {
            continue;
        }

        match crate::secret_store::set_post_process_api_key(&provider_id, &api_key) {
            Ok(()) => {
                if let Some(stored_value) = settings.post_process_api_keys.get_mut(&provider_id) {
                    stored_value.clear();
                }
                changed = true;
            }
            Err(err) => warn!(
                "Failed to migrate secure API key for provider '{}' to OS credential storage: {}",
                provider_id, err
            ),
        }
    }

    changed
}

fn hydrate_secure_secrets(settings: &mut AppSettings) {
    let persisted_gemini_api_key = settings.gemini_api_key.take();
    settings.gemini_api_key = crate::secret_store::get_gemini_api_key()
        .ok()
        .flatten()
        .or_else(|| {
            persisted_gemini_api_key
                .filter(|value| !value.trim().is_empty() && !is_redacted_secret_placeholder(value))
        });

    let provider_ids: Vec<String> = settings
        .post_process_providers
        .iter()
        .map(|provider| provider.id.clone())
        .collect();

    for provider_id in provider_ids {
        let persisted_value = settings
            .post_process_api_keys
            .get(&provider_id)
            .cloned()
            .unwrap_or_default();
        let persisted_value = if is_redacted_secret_placeholder(&persisted_value) {
            String::new()
        } else {
            persisted_value
        };
        let secure_value = crate::secret_store::get_post_process_api_key(&provider_id)
            .ok()
            .flatten()
            .unwrap_or(persisted_value);
        settings
            .post_process_api_keys
            .insert(provider_id, secure_value);
    }
}

fn exportable_settings(mut settings: AppSettings) -> AppSettings {
    sanitize_persisted_secrets(&mut settings);
    settings
}

pub fn get_public_settings(app: &AppHandle) -> AppSettings {
    let mut settings = get_settings(app);
    let gemini_is_configured = settings
        .gemini_api_key
        .as_ref()
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);

    sanitize_persisted_secrets(&mut settings);
    if gemini_is_configured {
        settings.gemini_api_key = Some(CONFIGURED_SECRET_SENTINEL.to_string());
    }

    settings
}

fn prepare_settings_for_runtime(app: &AppHandle, settings: &mut AppSettings) -> bool {
    let secrets_changed = migrate_plaintext_secrets_to_secure_store(settings);
    let post_process_changed = ensure_post_process_defaults(settings);
    let language_changed = ensure_selected_language_default(settings);
    let adaptive_profile_changed = ensure_adaptive_profile(app, settings);
    let external_script_changed = sanitize_external_script_path(app, settings);
    let launch_output_changed = ensure_launch_output_defaults(settings);

    hydrate_secure_secrets(settings);

    secrets_changed
        || post_process_changed
        || language_changed
        || adaptive_profile_changed
        || external_script_changed
        || launch_output_changed
}

fn prepare_settings_for_fast_runtime(app: &AppHandle, settings: &mut AppSettings) -> bool {
    let secrets_changed = migrate_plaintext_secrets_to_secure_store(settings);
    let post_process_changed = ensure_post_process_defaults(settings);
    let language_changed = ensure_selected_language_default(settings);
    let external_script_changed = sanitize_external_script_path(app, settings);
    let launch_output_changed = ensure_launch_output_defaults(settings);

    hydrate_secure_secrets(settings);

    secrets_changed
        || post_process_changed
        || language_changed
        || external_script_changed
        || launch_output_changed
}

fn ensure_launch_output_defaults(settings: &mut AppSettings) -> bool {
    #[cfg(debug_assertions)]
    {
        let _ = settings;
        false
    }

    #[cfg(not(debug_assertions))]
    {
        let mut changed = false;
        let default_paste_method = PasteMethod::default();
        if settings.paste_method != default_paste_method {
            settings.paste_method = default_paste_method;
            changed = true;
        }
        if settings.typing_tool != TypingTool::Auto {
            settings.typing_tool = TypingTool::Auto;
            changed = true;
        }
        if settings.clipboard_handling != ClipboardHandling::DontModify {
            settings.clipboard_handling = ClipboardHandling::DontModify;
            changed = true;
        }
        if settings.paste_delay_ms != default_paste_delay_ms() {
            settings.paste_delay_ms = default_paste_delay_ms();
            changed = true;
        }
        if settings.external_script_path.take().is_some() {
            changed = true;
        }
        if settings.model_unload_timeout != ModelUnloadTimeout::Never {
            settings.model_unload_timeout = ModelUnloadTimeout::Never;
            changed = true;
        }
        if settings.long_audio_model.take().is_some() {
            changed = true;
        }
        if (settings.long_audio_threshold_seconds - default_long_audio_threshold_seconds()).abs()
            > f32::EPSILON
        {
            settings.long_audio_threshold_seconds = default_long_audio_threshold_seconds();
            changed = true;
        }
        changed
    }
}

pub fn external_scripts_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("Failed to resolve app data directory: {}", err))?
        .join("external-scripts");

    std::fs::create_dir_all(&directory).map_err(|err| {
        format!(
            "Failed to initialize the external scripts directory '{}': {}",
            directory.display(),
            err
        )
    })?;

    Ok(directory)
}

pub fn validate_external_script_path(app: &AppHandle, path: &str) -> Result<String, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("External script path is empty".to_string());
    }

    let allowed_root = external_scripts_dir(app)?;
    let candidate = PathBuf::from(trimmed);
    if !candidate.is_absolute() {
        return Err(format!(
            "External scripts must use an absolute path inside '{}'",
            allowed_root.display()
        ));
    }

    let canonical_root = allowed_root
        .canonicalize()
        .unwrap_or_else(|_| allowed_root.clone());
    let canonical_candidate = candidate.canonicalize().map_err(|err| {
        format!(
            "Failed to resolve external script path '{}': {}",
            candidate.display(),
            err
        )
    })?;

    if !canonical_candidate.is_file() {
        return Err(format!(
            "External script '{}' must point to a file",
            canonical_candidate.display()
        ));
    }

    if !path_is_within_root(&canonical_candidate, &canonical_root) {
        return Err(format!(
            "External scripts must live inside '{}'",
            canonical_root.display()
        ));
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        let permissions = canonical_candidate
            .metadata()
            .map_err(|err| {
                format!(
                    "Failed to read permissions for external script '{}': {}",
                    canonical_candidate.display(),
                    err
                )
            })?
            .permissions();

        if permissions.mode() & 0o111 == 0 {
            return Err(format!(
                "External script '{}' must be executable",
                canonical_candidate.display()
            ));
        }
    }

    Ok(canonical_candidate.to_string_lossy().to_string())
}

fn sanitize_external_script_path(app: &AppHandle, settings: &mut AppSettings) -> bool {
    let Some(path) = settings.external_script_path.clone() else {
        return false;
    };

    if path.trim().is_empty() {
        if settings.external_script_path.take().is_some() {
            return true;
        }
        return false;
    }

    match validate_external_script_path(app, &path) {
        Ok(validated_path) => {
            if settings.external_script_path.as_deref() != Some(validated_path.as_str()) {
                settings.external_script_path = Some(validated_path);
                return true;
            }
            false
        }
        Err(err) => {
            warn!(
                "Discarding invalid external script path '{}': {}",
                path, err
            );
            settings.external_script_path = None;
            true
        }
    }
}

fn path_is_within_root(path: &Path, root: &Path) -> bool {
    path == root || path.starts_with(root)
}

pub fn get_default_settings() -> AppSettings {
    #[cfg(target_os = "windows")]
    let default_shortcut = "ctrl+space";
    #[cfg(target_os = "macos")]
    let default_shortcut = "option+space";
    #[cfg(target_os = "linux")]
    let default_shortcut = "ctrl+space";
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    let default_shortcut = "alt+space";

    let mut bindings = HashMap::new();
    bindings.insert(
        "transcribe".to_string(),
        ShortcutBinding {
            id: "transcribe".to_string(),
            name: "Transcribe".to_string(),
            description: "Converts your speech into text.".to_string(),
            default_binding: default_shortcut.to_string(),
            current_binding: default_shortcut.to_string(),
        },
    );
    #[cfg(target_os = "windows")]
    let default_post_process_shortcut = "ctrl+shift+space";
    #[cfg(target_os = "macos")]
    let default_post_process_shortcut = "option+shift+space";
    #[cfg(target_os = "linux")]
    let default_post_process_shortcut = "ctrl+shift+space";
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    let default_post_process_shortcut = "alt+shift+space";

    bindings.insert(
        "transcribe_with_post_process".to_string(),
        ShortcutBinding {
            id: "transcribe_with_post_process".to_string(),
            name: "Transcribe with Post-Processing".to_string(),
            description: "Converts your speech into text and applies AI post-processing."
                .to_string(),
            default_binding: default_post_process_shortcut.to_string(),
            current_binding: default_post_process_shortcut.to_string(),
        },
    );
    bindings.insert(
        "cancel".to_string(),
        ShortcutBinding {
            id: "cancel".to_string(),
            name: "Cancel".to_string(),
            description: "Cancels the current recording.".to_string(),
            default_binding: "escape".to_string(),
            current_binding: "escape".to_string(),
        },
    );
    bindings.insert(
        "pause".to_string(),
        ShortcutBinding {
            id: "pause".to_string(),
            name: "Pause / Resume".to_string(),
            description: "Pauses or resumes the current recording.".to_string(),
            default_binding: "f6".to_string(),
            current_binding: "f6".to_string(),
        },
    );
    bindings.insert(
        "show_history".to_string(),
        ShortcutBinding {
            id: "show_history".to_string(),
            name: "Show History".to_string(),
            description: "Opens the app window and navigates to the History tab.".to_string(),
            default_binding: "".to_string(),
            current_binding: "".to_string(),
        },
    );
    bindings.insert(
        "copy_latest_history".to_string(),
        ShortcutBinding {
            id: "copy_latest_history".to_string(),
            name: "Copy Latest History".to_string(),
            description: "Copies the latest transcription entry to your clipboard.".to_string(),
            default_binding: "".to_string(),
            current_binding: "".to_string(),
        },
    );
    bindings.insert(
        "command_mode".to_string(),
        ShortcutBinding {
            id: "command_mode".to_string(),
            name: "Command Mode".to_string(),
            description: "Selects text, records a voice command, and replaces the selection with the AI-processed result.".to_string(),
            default_binding: "ctrl+alt+c".to_string(),
            current_binding: "ctrl+alt+c".to_string(),
        },
    );
    bindings.insert(
        "whisper_mode".to_string(),
        ShortcutBinding {
            id: "whisper_mode".to_string(),
            name: "Whisper Mode".to_string(),
            description: "Toggle microphone gain boost for low-volume or whispered dictation."
                .to_string(),
            default_binding: "ctrl+alt+w".to_string(),
            current_binding: "ctrl+alt+w".to_string(),
        },
    );
    bindings.insert(
        "agent_key".to_string(),
        ShortcutBinding {
            id: "agent_key".to_string(),
            name: "Agent Key".to_string(),
            description: "Transcribes your speech and routes it to the AI agent.".to_string(),
            default_binding: "".to_string(),
            current_binding: "".to_string(),
        },
    );
    bindings.insert(
        "meeting_key".to_string(),
        ShortcutBinding {
            id: "meeting_key".to_string(),
            name: "Meeting Key".to_string(),
            description: "Transcribes your speech optimized for meeting notes.".to_string(),
            default_binding: "".to_string(),
            current_binding: "".to_string(),
        },
    );
    bindings.insert(
        "note_key".to_string(),
        ShortcutBinding {
            id: "note_key".to_string(),
            name: "Note Key".to_string(),
            description: "Transcribes your speech directly into an active note.".to_string(),
            default_binding: "".to_string(),
            current_binding: "".to_string(),
        },
    );

    AppSettings {
        settings_version: CURRENT_SETTINGS_VERSION,
        bindings,
        push_to_talk: true,
        audio_feedback: false,
        audio_feedback_volume: default_audio_feedback_volume(),
        sound_theme: default_sound_theme(),
        start_hidden: default_start_hidden(),
        autostart_enabled: default_autostart_enabled(),
        update_checks_enabled: default_update_checks_enabled(),
        selected_model: "".to_string(),
        always_on_microphone: false,
        wake_word_enabled: false,
        recording_mode: RecordingMode::default(),
        selected_microphone: None,
        selected_microphone_index: None,
        clamshell_microphone: None,
        clamshell_microphone_index: None,
        selected_output_device: None,
        translate_to_english: false,
        selected_language: default_selected_language(),
        overlay_position: default_overlay_position(),
        debug_mode: false,
        log_level: default_log_level(),
        custom_words: Vec::new(),
        adaptive_vocabulary_enabled: true,
        adaptive_voice_profile_enabled: true,
        model_unload_timeout: ModelUnloadTimeout::Never,
        word_correction_threshold: default_word_correction_threshold(),
        history_limit: default_history_limit(),
        recording_retention_period: default_recording_retention_period(),
        paste_method: PasteMethod::default(),
        clipboard_handling: ClipboardHandling::default(),
        auto_submit: default_auto_submit(),
        auto_submit_key: AutoSubmitKey::default(),
        post_process_enabled: default_post_process_enabled(),
        llm_auto_mode: false,
        post_process_provider_id: default_post_process_provider_id(),
        post_process_providers: default_post_process_providers(),
        post_process_api_keys: default_post_process_api_keys(),
        post_process_models: default_post_process_models(),
        post_process_prompts: default_post_process_prompts(),
        post_process_selected_prompt_id: None,
        mute_while_recording: false,
        append_trailing_space: false,
        app_language: default_app_language(),
        experimental_enabled: false,
        keyboard_implementation: KeyboardImplementation::default(),
        show_tray_icon: default_show_tray_icon(),
        paste_delay_ms: default_paste_delay_ms(),
        typing_tool: default_typing_tool(),
        external_script_path: None,
        long_audio_model: None,
        long_audio_threshold_seconds: default_long_audio_threshold_seconds(),
        gemini_api_key: None,
        gemini_model: default_gemini_model(),
        post_process_actions: default_post_process_actions(),
        saved_processing_models: Vec::new(),
        adaptive_profile_applied: default_adaptive_profile_applied(),
        adaptive_machine_profile: None,
        app_context_enabled: default_app_context_enabled(),
        whisper_mode: false,
        voice_snippets: Vec::new(),
        auto_learn_dictionary: true,
        auto_pause_media: false,
        groq_stt_api_key: None,
        mistral_stt_api_key: None,
        deepgram_api_key: None,
        speaking_rate_pauses: Vec::new(),
        voice_to_code_enabled: false,
        voice_to_code_model: String::new(),
        voice_to_code_onboarding_done: false,
    }
}

impl AppSettings {
    pub fn active_post_process_provider(&self) -> Option<&PostProcessProvider> {
        self.post_process_providers
            .iter()
            .find(|provider| provider.id == self.post_process_provider_id)
    }

    pub fn post_process_provider(&self, provider_id: &str) -> Option<&PostProcessProvider> {
        self.post_process_providers
            .iter()
            .find(|provider| provider.id == provider_id)
    }

    pub fn post_process_provider_mut(
        &mut self,
        provider_id: &str,
    ) -> Option<&mut PostProcessProvider> {
        self.post_process_providers
            .iter_mut()
            .find(|provider| provider.id == provider_id)
    }

    pub fn adaptive_whisper_config(&self, model_id: &str) -> Option<WhisperModelAdaptiveConfig> {
        let profile = self.adaptive_machine_profile.as_ref()?;
        let mut config = match model_id {
            "small" => profile.whisper.small.clone(),
            "medium" => profile.whisper.medium.clone(),
            "turbo" => profile.whisper.turbo.clone(),
            "large" => profile.whisper.large.clone(),
            _ => return None,
        };

        config.backend = if !matches!(config.active_backend, WhisperBackendPreference::Auto)
            || matches!(config.backend, WhisperBackendPreference::Auto)
        {
            config.active_backend
        } else {
            config.backend
        };
        if config.active_threads > 0 {
            config.threads = config.active_threads;
        }
        if config.active_chunk_seconds > 0 {
            config.chunk_seconds = config.active_chunk_seconds;
        }
        if config.active_overlap_ms > 0 {
            config.overlap_ms = config.active_overlap_ms;
        }

        let constrained = profile.on_battery == Some(true)
            || matches!(profile.power_mode, PowerMode::Saver)
            || profile.thermal_degraded;
        if constrained {
            match model_id {
                "turbo" => {
                    config.threads = config.threads.min(6);
                    config.chunk_seconds = config.chunk_seconds.max(12);
                }
                "large" => {
                    config.threads = config.threads.min(4);
                    config.chunk_seconds = config.chunk_seconds.max(12);
                }
                _ => {}
            }
        }

        Some(config)
    }
}

// ── Settings migrations ───────────────────────────────────────────────────────

impl AppSettings {
    /// Canonical recording mode, resolved from the legacy boolean pair when
    /// `settings_version < 1` (i.e. before migration T11 has run).
    pub fn effective_recording_mode(&self) -> RecordingMode {
        if self.settings_version < 1 {
            RecordingMode::from_legacy(self.push_to_talk, self.always_on_microphone)
        } else {
            self.recording_mode
        }
    }
}

/// Apply all pending forward migrations to `settings` and bump `settings_version`.
///
/// Migrations are idempotent: each step only runs when
/// `settings.settings_version < N` for the relevant version N.
pub fn migrate_settings(settings: &mut AppSettings) {
    // ── v0 → v1: RecordingMode canonical field ──────────────────────────────
    // The old store had `push_to_talk: bool` and `always_on_microphone: bool`.
    // Derive `recording_mode` from those booleans so existing user preferences
    // are preserved, then mark the migration done.
    if settings.settings_version < 1 {
        settings.recording_mode =
            RecordingMode::from_legacy(settings.push_to_talk, settings.always_on_microphone);
        settings.settings_version = 1;
        debug!(
            "Settings migrated v0→v1: recording_mode = {:?}",
            settings.recording_mode
        );
    }

    let canonical_selected = canonical_model_id(&settings.selected_model).to_string();
    if settings.selected_model != canonical_selected {
        settings.selected_model = canonical_selected;
    }

    if let Some(long_audio_model) = settings.long_audio_model.clone() {
        let canonical_long_audio = canonical_model_id(&long_audio_model).to_string();
        if long_audio_model != canonical_long_audio {
            settings.long_audio_model = Some(canonical_long_audio);
        }
    }

    if let Some(profile) = settings.adaptive_machine_profile.as_mut() {
        let canonical_recommended = canonical_model_id(&profile.recommended_model_id).to_string();
        if profile.recommended_model_id != canonical_recommended {
            profile.recommended_model_id = canonical_recommended;
        }

        if let Some(secondary_model_id) = profile.secondary_model_id.clone() {
            let canonical_secondary = canonical_model_id(&secondary_model_id).to_string();
            if secondary_model_id != canonical_secondary {
                profile.secondary_model_id = Some(canonical_secondary);
            }
        }

        if let Some(active_runtime_model_id) = profile.active_runtime_model_id.clone() {
            let canonical_active = canonical_model_id(&active_runtime_model_id).to_string();
            if active_runtime_model_id != canonical_active {
                profile.active_runtime_model_id = Some(canonical_active);
            }
        }
    }

    // Add future migrations here:
    // if settings.settings_version < 2 { ... settings.settings_version = 2; }
}

impl Default for AppSettings {
    fn default() -> Self {
        get_default_settings()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_settings_disable_auto_submit() {
        let settings = get_default_settings();
        assert!(!settings.auto_submit);
        assert_eq!(settings.auto_submit_key, AutoSubmitKey::Enter);
    }

    #[test]
    fn default_settings_use_push_to_talk_for_launch_flow() {
        let settings = get_default_settings();
        assert!(settings.push_to_talk);
        assert_eq!(settings.recording_mode, RecordingMode::PushToTalk);
    }

    #[test]
    fn default_settings_serialize_to_json() {
        let settings = get_default_settings();
        let result = serde_json::to_value(exportable_settings(settings));
        assert!(result.is_ok(), "Default settings must be JSON-serializable");
    }

    #[test]
    fn default_settings_strip_secrets_serialize_to_json() {
        let settings = get_default_settings();
        let result = serde_json::to_value(strip_secrets_for_persistence(settings));
        assert!(
            result.is_ok(),
            "Settings stripped of secrets must be JSON-serializable"
        );
    }

    #[test]
    fn settings_roundtrip() {
        let original = get_default_settings();
        let serialized = serde_json::to_value(exportable_settings(original.clone()))
            .expect("Serialization must succeed");
        let deserialized: AppSettings =
            serde_json::from_value(serialized).expect("Deserialization must succeed");
        assert_eq!(original.push_to_talk, deserialized.push_to_talk);
        assert_eq!(original.selected_model, deserialized.selected_model);
        assert_eq!(original.auto_submit, deserialized.auto_submit);
    }
}
