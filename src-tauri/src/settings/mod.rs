use log::{debug, warn};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashMap;
use std::ops::Deref;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use tauri_plugin_store::StoreExt;

pub mod audio;
pub mod logging;
pub mod recording;
pub mod shortcuts;
pub mod ui;

pub use audio::{apply_voice_snippets, SoundTheme, TypingTool, VoiceSnippet};
pub use logging::LogLevel;
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
    /// Canonical recording mode — supersedes the `push_to_talk` and
    /// `always_on_microphone` boolean pair. Populated from those booleans
    /// on first load via settings migration (T11). New code should read this
    /// field; old code continues to use the booleans until migration is done.
    #[serde(default)]
    pub recording_mode: RecordingMode,
    #[serde(default)]
    pub selected_microphone: Option<String>,
    #[serde(default)]
    pub clamshell_microphone: Option<String>,
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
    #[serde(default)]
    pub adaptive_vocabulary_enabled: bool,
    #[serde(default)]
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
    #[serde(default)]
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
    RecordingRetentionPeriod::PreserveLimit
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
    let base_language = locale.split('-').next().unwrap_or("en");
    if base_language == "en" {
        "parakeet-tdt-0.6b-v3-english".to_string()
    } else {
        "parakeet-tdt-0.6b-v3-multilingual".to_string()
    }
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

const ADAPTIVE_PROFILE_SCHEMA_VERSION: u16 = 4;
const THERMAL_DEGRADED_CELSIUS: f32 = 75.0;
const TURBO_POLICY_COOLDOWN_MS: u64 = 24 * 60 * 60 * 1000;
const ADAPTIVE_PROFILE_BENCH_STALE_MS: u64 = 30 * 24 * 60 * 60 * 1000;
const BACKEND_VERSION: &str = "whisper-adaptive-v2";

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[derive(Debug, Clone, Copy)]
struct RuntimePowerSnapshot {
    on_battery: Option<bool>,
    power_mode: PowerMode,
    thermal_degraded: bool,
    captured_at_ms: u64,
}

#[derive(Debug, Clone)]
struct GpuSnapshot {
    detected: bool,
    kind: GpuKind,
    name: Option<String>,
}

impl Default for GpuSnapshot {
    fn default() -> Self {
        Self {
            detected: false,
            kind: GpuKind::Unknown,
            name: None,
        }
    }
}

#[derive(Debug, Clone)]
struct NpuSnapshot {
    detected: bool,
    kind: NpuKind,
    name: Option<String>,
    copilot_plus: bool,
}

impl Default for NpuSnapshot {
    fn default() -> Self {
        Self {
            detected: false,
            kind: NpuKind::None,
            name: None,
            copilot_plus: false,
        }
    }
}

#[cfg(target_os = "windows")]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Win32VideoController {
    name: Option<String>,
    adapter_compatibility: Option<String>,
    pnp_device_id: Option<String>,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Win32PnPEntity {
    name: Option<String>,
    manufacturer: Option<String>,
    pnp_class: Option<String>,
    device_id: Option<String>,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct ThermalZoneInfo {
    current_temperature: Option<u32>,
    critical_trip_point: Option<u32>,
    passive_trip_point: Option<u32>,
}

fn gpu_kind_rank(kind: GpuKind) -> u8 {
    match kind {
        GpuKind::None => 0,
        GpuKind::Unknown => 1,
        GpuKind::Integrated => 2,
        GpuKind::Dedicated => 3,
    }
}

fn gpu_kind_label(kind: GpuKind) -> &'static str {
    match kind {
        GpuKind::None => "none",
        GpuKind::Integrated => "integrated",
        GpuKind::Dedicated => "dedicated",
        GpuKind::Unknown => "unknown",
    }
}

fn npu_kind_rank(kind: NpuKind) -> u8 {
    match kind {
        NpuKind::None => 0,
        NpuKind::Unknown => 1,
        NpuKind::Intel | NpuKind::Amd | NpuKind::Qualcomm => 2,
    }
}

fn npu_kind_label(kind: NpuKind) -> &'static str {
    match kind {
        NpuKind::None => "none",
        NpuKind::Qualcomm => "qualcomm",
        NpuKind::Intel => "intel",
        NpuKind::Amd => "amd",
        NpuKind::Unknown => "unknown",
    }
}

fn is_probable_copilot_plus_cpu(cpu_brand_upper: &str, npu_kind: NpuKind) -> bool {
    match npu_kind {
        NpuKind::Qualcomm => cpu_brand_upper.contains("SNAPDRAGON X"),
        NpuKind::Intel => {
            cpu_brand_upper.contains("CORE ULTRA")
                && ["226V", "228V", "236V", "238V", "258V", "268V", "288V"]
                    .iter()
                    .any(|needle| cpu_brand_upper.contains(needle))
        }
        NpuKind::Amd => cpu_brand_upper.contains("RYZEN AI"),
        NpuKind::None | NpuKind::Unknown => false,
    }
}

#[cfg(target_os = "windows")]
fn classify_windows_gpu(controller: &Win32VideoController) -> GpuKind {
    let text = format!(
        "{} {} {}",
        controller.name.as_deref().unwrap_or_default(),
        controller
            .adapter_compatibility
            .as_deref()
            .unwrap_or_default(),
        controller.pnp_device_id.as_deref().unwrap_or_default()
    )
    .to_uppercase();

    if text.trim().is_empty() || text.contains("MICROSOFT BASIC") {
        return GpuKind::Unknown;
    }

    let dedicated_markers = [
        "NVIDIA",
        "GEFORCE",
        "RTX",
        "GTX",
        "QUADRO",
        "TESLA",
        "TITAN",
        "RADEON RX",
        "RADEON PRO",
        " AMD RX",
        " AMD PRO",
        "INTEL ARC",
    ];
    if dedicated_markers.iter().any(|needle| text.contains(needle)) {
        return GpuKind::Dedicated;
    }

    let integrated_markers = [
        "INTEL",
        "UHD",
        "IRIS",
        "HD GRAPHICS",
        "RADEON GRAPHICS",
        "VEGA 8",
        "VEGA 7",
        "680M",
        "780M",
    ];
    if integrated_markers
        .iter()
        .any(|needle| text.contains(needle))
    {
        return GpuKind::Integrated;
    }

    GpuKind::Unknown
}

#[cfg(target_os = "windows")]
fn classify_windows_npu(entity: &Win32PnPEntity) -> Option<NpuKind> {
    let text = format!(
        "{} {} {} {}",
        entity.name.as_deref().unwrap_or_default(),
        entity.manufacturer.as_deref().unwrap_or_default(),
        entity.pnp_class.as_deref().unwrap_or_default(),
        entity.device_id.as_deref().unwrap_or_default()
    )
    .to_uppercase();

    let has_npu_markers = [
        "NPU",
        "AI BOOST",
        "HEXAGON",
        "RYZEN AI",
        "AMD IPU",
        "IPU DEVICE",
        "NEURAL PROCESSING",
    ]
    .iter()
    .any(|needle| text.contains(needle));

    if !has_npu_markers {
        return None;
    }

    if text.contains("QUALCOMM") || text.contains("HEXAGON") {
        return Some(NpuKind::Qualcomm);
    }

    if text.contains("INTEL") || text.contains("AI BOOST") {
        return Some(NpuKind::Intel);
    }

    if text.contains("AMD") || text.contains("RYZEN AI") || text.contains("AMD IPU") {
        return Some(NpuKind::Amd);
    }

    Some(NpuKind::Unknown)
}

#[cfg(target_os = "windows")]
fn open_wmi_com_library() -> Option<wmi::COMLibrary> {
    use wmi::COMLibrary;

    match COMLibrary::without_security() {
        Ok(value) => Some(value),
        Err(err) => {
            debug!(
                "Falling back to assumed COM initialization for WMI access: {}",
                err
            );
            Some(unsafe { COMLibrary::assume_initialized() })
        }
    }
}

#[cfg(target_os = "windows")]
fn detect_gpu_snapshot() -> GpuSnapshot {
    use std::sync::mpsc;
    use std::time::Duration;

    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(detect_gpu_snapshot_inner());
    });

    match rx.recv_timeout(Duration::from_secs(5)) {
        Ok(snapshot) => snapshot,
        Err(_) => {
            warn!("WMI GPU detection timed out, using Unknown fallback");
            GpuSnapshot {
                detected: true,
                kind: GpuKind::Unknown,
                name: None,
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn detect_gpu_snapshot_inner() -> GpuSnapshot {
    use wmi::WMIConnection;

    let Some(com) = open_wmi_com_library() else {
        return GpuSnapshot {
            detected: true,
            kind: GpuKind::Unknown,
            name: None,
        };
    };

    let connection = match WMIConnection::new(com.into()) {
        Ok(value) => value,
        Err(err) => {
            warn!("Failed to connect to WMI for GPU detection: {}", err);
            return GpuSnapshot {
                detected: true,
                kind: GpuKind::Unknown,
                name: None,
            };
        }
    };

    let controllers: Vec<Win32VideoController> = match connection
        .raw_query("SELECT Name, AdapterCompatibility, PNPDeviceID FROM Win32_VideoController")
    {
        Ok(value) => value,
        Err(err) => {
            warn!("Failed to query Win32_VideoController: {}", err);
            return GpuSnapshot {
                detected: true,
                kind: GpuKind::Unknown,
                name: None,
            };
        }
    };

    let mut best_kind = GpuKind::None;
    let mut best_name = None;
    for controller in controllers {
        let kind = classify_windows_gpu(&controller);
        if matches!(kind, GpuKind::Unknown | GpuKind::None) {
            continue;
        }
        if gpu_kind_rank(kind) > gpu_kind_rank(best_kind) {
            best_name = controller.name.clone();
            best_kind = kind;
        }
    }

    if matches!(best_kind, GpuKind::None) {
        GpuSnapshot {
            detected: false,
            kind: GpuKind::None,
            name: None,
        }
    } else {
        GpuSnapshot {
            detected: true,
            kind: best_kind,
            name: best_name,
        }
    }
}

#[cfg(target_os = "windows")]
fn detect_npu_snapshot(cpu_brand_upper: &str) -> NpuSnapshot {
    use std::sync::mpsc;
    use std::time::Duration;

    let cpu_brand_upper = cpu_brand_upper.to_owned();
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(detect_npu_snapshot_inner(&cpu_brand_upper));
    });

    match rx.recv_timeout(Duration::from_secs(5)) {
        Ok(snapshot) => snapshot,
        Err(_) => {
            warn!("WMI NPU detection timed out, using default fallback");
            NpuSnapshot::default()
        }
    }
}

#[cfg(target_os = "windows")]
fn detect_npu_snapshot_inner(cpu_brand_upper: &str) -> NpuSnapshot {
    use wmi::WMIConnection;

    let Some(com) = open_wmi_com_library() else {
        return NpuSnapshot::default();
    };

    let connection = match WMIConnection::new(com.into()) {
        Ok(value) => value,
        Err(err) => {
            warn!("Failed to connect to WMI for NPU detection: {}", err);
            return NpuSnapshot::default();
        }
    };

    let entities: Vec<Win32PnPEntity> = match connection
        .raw_query("SELECT Name, Manufacturer, PNPClass, DeviceID FROM Win32_PnPEntity WHERE PNPClass = 'System' OR PNPClass = 'Processor' OR Name LIKE '%NPU%' OR Name LIKE '%AI%' OR Name LIKE '%Neural%' OR Name LIKE '%Hexagon%' OR Name LIKE '%Ryzen AI%'")
    {
        Ok(value) => value,
        Err(err) => {
            warn!("Failed to query Win32_PnPEntity for NPU detection: {}", err);
            return NpuSnapshot::default();
        }
    };

    let mut best_kind = NpuKind::None;
    let mut best_name = None;
    for entity in entities {
        let Some(kind) = classify_windows_npu(&entity) else {
            continue;
        };
        if npu_kind_rank(kind) > npu_kind_rank(best_kind) {
            best_kind = kind;
            best_name = entity.name.clone();
        }
    }

    if matches!(best_kind, NpuKind::None) {
        return NpuSnapshot::default();
    }

    NpuSnapshot {
        detected: true,
        kind: best_kind,
        name: best_name,
        copilot_plus: is_probable_copilot_plus_cpu(cpu_brand_upper, best_kind),
    }
}

#[cfg(not(target_os = "windows"))]
fn detect_npu_snapshot(_cpu_brand_upper: &str) -> NpuSnapshot {
    NpuSnapshot::default()
}

#[cfg(not(target_os = "windows"))]
fn detect_gpu_snapshot() -> GpuSnapshot {
    GpuSnapshot {
        detected: cfg!(any(target_os = "macos", target_os = "linux")),
        kind: GpuKind::Unknown,
        name: None,
    }
}

#[cfg(target_os = "windows")]
fn detect_thermal_degraded() -> bool {
    use wmi::WMIConnection;

    let Some(com) = open_wmi_com_library() else {
        return false;
    };

    let connection = match WMIConnection::with_namespace_path("ROOT\\WMI", com.into()) {
        Ok(value) => value,
        Err(err) => {
            warn!("Failed to connect to WMI thermal namespace: {}", err);
            return false;
        }
    };

    let zones: Vec<ThermalZoneInfo> = match connection.raw_query(
        "SELECT CurrentTemperature, CriticalTripPoint, PassiveTripPoint FROM MSAcpi_ThermalZoneTemperature",
    ) {
        Ok(value) => value,
        Err(err) => {
            debug!("Thermal WMI query unavailable: {}", err);
            return false;
        }
    };

    zones.into_iter().any(|zone| {
        let current_celsius = zone
            .current_temperature
            .map(|value| (value as f32 / 10.0) - 273.15)
            .filter(|value| value.is_finite() && *value > 0.0);
        let passive_celsius = zone
            .passive_trip_point
            .map(|value| (value as f32 / 10.0) - 273.15)
            .filter(|value| value.is_finite() && *value > 0.0);
        let critical_celsius = zone
            .critical_trip_point
            .map(|value| (value as f32 / 10.0) - 273.15)
            .filter(|value| value.is_finite() && *value > 0.0);

        let Some(current_celsius) = current_celsius else {
            return false;
        };

        current_celsius >= THERMAL_DEGRADED_CELSIUS
            || passive_celsius
                .map(|passive| current_celsius >= passive - 2.0)
                .unwrap_or(false)
            || critical_celsius
                .map(|critical| current_celsius >= critical - 10.0)
                .unwrap_or(false)
    })
}

#[cfg(not(target_os = "windows"))]
fn detect_thermal_degraded() -> bool {
    false
}

#[cfg(target_os = "windows")]
fn detect_runtime_power_snapshot() -> RuntimePowerSnapshot {
    use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};

    let mut status = SYSTEM_POWER_STATUS::default();
    let captured_at_ms = now_ms();
    let result = unsafe { GetSystemPowerStatus(&mut status) };
    if result.is_ok() {
        let on_battery = match status.ACLineStatus {
            0 => Some(true),
            1 => Some(false),
            _ => None,
        };
        let power_mode = if status.SystemStatusFlag == 1 {
            PowerMode::Saver
        } else {
            PowerMode::Normal
        };
        RuntimePowerSnapshot {
            on_battery,
            power_mode,
            thermal_degraded: detect_thermal_degraded(),
            captured_at_ms,
        }
    } else {
        RuntimePowerSnapshot {
            on_battery: None,
            power_mode: PowerMode::Unknown,
            thermal_degraded: detect_thermal_degraded(),
            captured_at_ms,
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn detect_runtime_power_snapshot() -> RuntimePowerSnapshot {
    RuntimePowerSnapshot {
        on_battery: None,
        power_mode: PowerMode::Unknown,
        thermal_degraded: false,
        captured_at_ms: now_ms(),
    }
}

fn ram_score(total_memory_gb: u16) -> u8 {
    match total_memory_gb {
        0..=8 => 0,
        9..=15 => 1,
        16..=23 => 2,
        _ => 3,
    }
}

fn cpu_threads_score(logical_cores: u8) -> u8 {
    match logical_cores {
        0..=8 => 0,
        9..=12 => 1,
        13..=16 => 2,
        _ => 3,
    }
}

fn cpu_family_score(cpu_brand_upper: &str, low_power_cpu: bool) -> u8 {
    if low_power_cpu
        || ["CELERON", "PENTIUM", "N100", "N200", "ATHLON", "SILVER"]
            .iter()
            .any(|needle| cpu_brand_upper.contains(needle))
    {
        0
    } else if ["HX", "HS", "H ", "DESKTOP", "RYZEN 9", "CORE I9", "XEON"]
        .iter()
        .any(|needle| cpu_brand_upper.contains(needle))
    {
        2
    } else {
        1
    }
}

fn whisper_config(
    backend: WhisperBackendPreference,
    threads: u8,
    chunk_seconds: u8,
    overlap_ms: u16,
) -> WhisperModelAdaptiveConfig {
    WhisperModelAdaptiveConfig {
        backend,
        threads,
        chunk_seconds,
        overlap_ms,
        active_backend: backend,
        active_threads: threads,
        active_chunk_seconds: chunk_seconds,
        active_overlap_ms: overlap_ms,
        short_latency_ms: 0,
        medium_latency_ms: 0,
        long_latency_ms: 0,
        stability_score: 1.0,
        overall_score: 0.0,
        failure_count: 0,
        calibrated_phase: CalibrationPhase::None,
        unsafe_backends: Vec::new(),
        unsafe_until: None,
        last_failure_reason: None,
        last_failure_at: None,
        last_quick_bench_at: None,
        last_full_bench_at: None,
        backend_decision_reason: None,
        config_decision_reason: None,
    }
}

fn current_app_version(app: &AppHandle) -> String {
    app.package_info().version.to_string()
}

fn tier_from_score(score: f32) -> MachineTier {
    if score <= 2.0 {
        MachineTier::Low
    } else if score <= 5.0 {
        MachineTier::Medium
    } else {
        MachineTier::High
    }
}

fn detect_adaptive_machine_profile(app: &AppHandle, app_language: &str) -> AdaptiveMachineProfile {
    let mut system = sysinfo::System::new_all();
    system.refresh_cpu_all();
    system.refresh_memory();

    let power_snapshot = detect_runtime_power_snapshot();
    let gpu_snapshot = detect_gpu_snapshot();
    let cpu_brand = system
        .cpus()
        .first()
        .map(|cpu| cpu.brand().trim().to_string())
        .filter(|brand| !brand.is_empty())
        .unwrap_or_else(|| "Unknown CPU".to_string());
    let logical_cores = std::thread::available_parallelism()
        .map(|value| value.get())
        .unwrap_or(4)
        .min(u8::MAX as usize) as u8;
    let total_memory_gb = (system.total_memory() / 1024 / 1024 / 1024)
        .max(1)
        .min(u16::MAX as u64) as u16;

    let cpu_brand_upper = cpu_brand.to_uppercase();
    let low_power_cpu = [
        " CELERON", " PENTIUM", " N100", " N200", " N305", " U", " Y",
    ]
    .iter()
    .any(|needle| cpu_brand_upper.contains(needle));
    let gpu_detected = gpu_snapshot.detected;
    let npu_snapshot = detect_npu_snapshot(&cpu_brand_upper);
    let machine_score_details = {
        let ram_score = ram_score(total_memory_gb);
        let cpu_threads_score = cpu_threads_score(logical_cores);
        let cpu_family_score = cpu_family_score(&cpu_brand_upper, low_power_cpu);
        let gpu_prebench_bonus = match gpu_snapshot.kind {
            GpuKind::Dedicated => 0.10,
            GpuKind::Integrated => 0.05,
            _ => 0.0,
        };
        let npu_prebench_bonus = if npu_snapshot.copilot_plus {
            0.10
        } else if npu_snapshot.detected {
            0.05
        } else {
            0.0
        };
        let low_power_penalty = if low_power_cpu { -1.0 } else { 0.0 };
        let power_penalty = if power_snapshot.on_battery == Some(true) {
            -0.5
        } else if matches!(power_snapshot.power_mode, PowerMode::Saver) {
            -0.5
        } else {
            0.0
        };
        let thermal_penalty = if power_snapshot.thermal_degraded {
            -1.0
        } else {
            0.0
        };
        let final_score = ram_score as f32
            + cpu_threads_score as f32
            + cpu_family_score as f32
            + gpu_prebench_bonus
            + npu_prebench_bonus
            + low_power_penalty
            + power_penalty
            + thermal_penalty;
        MachineScoreDetails {
            ram_score,
            cpu_threads_score,
            cpu_family_score,
            gpu_prebench_bonus,
            npu_prebench_bonus,
            low_power_penalty,
            power_penalty,
            thermal_penalty,
            final_score,
            tier_reason: format!(
                "ram={} cpu_threads={} cpu_family={} gpu_kind={} gpu_bonus={:.2} npu_kind={} npu_bonus={:.2} copilot_plus={} low_power={:.2} power={:.2} thermal={:.2}",
                ram_score,
                cpu_threads_score,
                cpu_family_score,
                gpu_kind_label(gpu_snapshot.kind),
                gpu_prebench_bonus,
                npu_kind_label(npu_snapshot.kind),
                npu_prebench_bonus,
                npu_snapshot.copilot_plus,
                low_power_penalty,
                power_penalty,
                thermal_penalty
            ),
        }
    };
    let machine_tier = tier_from_score(machine_score_details.final_score);

    let whisper = match machine_tier {
        MachineTier::Low => WhisperAdaptiveProfile {
            small: whisper_config(
                if low_power_cpu && total_memory_gb <= 8 {
                    WhisperBackendPreference::Cpu
                } else {
                    WhisperBackendPreference::Auto
                },
                6,
                12,
                500,
            ),
            medium: whisper_config(WhisperBackendPreference::Auto, 6, 10, 500),
            turbo: whisper_config(WhisperBackendPreference::Auto, 6, 12, 500),
            large: whisper_config(WhisperBackendPreference::Gpu, 4, 12, 750),
        },
        MachineTier::Medium => WhisperAdaptiveProfile {
            small: whisper_config(WhisperBackendPreference::Auto, 8, 10, 500),
            medium: whisper_config(WhisperBackendPreference::Auto, 6, 8, 500),
            turbo: whisper_config(WhisperBackendPreference::Auto, 8, 10, 500),
            large: whisper_config(WhisperBackendPreference::Gpu, 4, 10, 750),
        },
        MachineTier::High => WhisperAdaptiveProfile {
            small: whisper_config(WhisperBackendPreference::Auto, 8, 8, 500),
            medium: whisper_config(WhisperBackendPreference::Auto, 8, 8, 500),
            turbo: whisper_config(WhisperBackendPreference::Gpu, 8, 8, 500),
            large: whisper_config(WhisperBackendPreference::Gpu, 6, 10, 750),
        },
    };

    AdaptiveMachineProfile {
        profile_schema_version: ADAPTIVE_PROFILE_SCHEMA_VERSION,
        app_version: current_app_version(app),
        backend_version: BACKEND_VERSION.to_string(),
        machine_score_details,
        machine_tier,
        cpu_brand,
        logical_cores,
        total_memory_gb,
        low_power_cpu,
        gpu_detected,
        gpu_kind: gpu_snapshot.kind,
        gpu_name: gpu_snapshot.name,
        npu_detected: npu_snapshot.detected,
        npu_kind: npu_snapshot.kind,
        npu_name: npu_snapshot.name,
        copilot_plus_detected: npu_snapshot.copilot_plus,
        on_battery: power_snapshot.on_battery,
        power_mode: power_snapshot.power_mode,
        thermal_degraded: power_snapshot.thermal_degraded,
        runtime_power_snapshot_at: Some(power_snapshot.captured_at_ms),
        recommended_model_id: preferred_model_for_locale(app_language),
        secondary_model_id: secondary_model_for_locale(app_language, machine_tier),
        active_runtime_model_id: None,
        recommended_backend: None,
        active_backend: None,
        calibrated_models: Vec::new(),
        bench_phase: BenchPhase::None,
        bench_completed_at: None,
        last_quick_bench_at: None,
        last_full_bench_at: None,
        calibration_state: AdaptiveCalibrationState::Idle,
        calibration_reason: None,
        large_skip_reason: None,
        whisper,
    }
}

fn profile_is_stale(profile: &AdaptiveMachineProfile, app: &AppHandle) -> bool {
    if profile.profile_schema_version < ADAPTIVE_PROFILE_SCHEMA_VERSION {
        return true;
    }

    if profile.app_version != current_app_version(app) || profile.backend_version != BACKEND_VERSION
    {
        return true;
    }

    profile
        .bench_completed_at
        .map(|timestamp| now_ms().saturating_sub(timestamp) > ADAPTIVE_PROFILE_BENCH_STALE_MS)
        .unwrap_or(false)
}

fn merge_whisper_profile(
    mut base: AdaptiveMachineProfile,
    existing: AdaptiveMachineProfile,
) -> AdaptiveMachineProfile {
    base.whisper = existing.whisper;
    base.calibrated_models = existing.calibrated_models;
    base.bench_phase = existing.bench_phase;
    base.bench_completed_at = existing.bench_completed_at;
    base.last_quick_bench_at = existing.last_quick_bench_at;
    base.last_full_bench_at = existing.last_full_bench_at;
    base.calibration_state = existing.calibration_state;
    base.calibration_reason = existing.calibration_reason;
    base.large_skip_reason = existing.large_skip_reason;
    base.active_runtime_model_id = existing.active_runtime_model_id;
    base.recommended_backend = existing.recommended_backend;
    base.active_backend = existing.active_backend;
    base
}

fn normalize_adaptive_profile(profile: &mut AdaptiveMachineProfile) {
    let turbo = &mut profile.whisper.turbo;
    for entry in &mut turbo.unsafe_backends {
        let capped_until = entry.failed_at_ms.saturating_add(TURBO_POLICY_COOLDOWN_MS);
        if entry.unsafe_until_ms > capped_until {
            entry.unsafe_until_ms = capped_until;
        }
    }
    turbo.unsafe_until = turbo
        .unsafe_backends
        .iter()
        .map(|entry| entry.unsafe_until_ms)
        .max();
}

fn profile_needs_turbo_cooldown_normalization(profile: &AdaptiveMachineProfile) -> bool {
    profile.whisper.turbo.unsafe_backends.iter().any(|entry| {
        entry.unsafe_until_ms > entry.failed_at_ms.saturating_add(TURBO_POLICY_COOLDOWN_MS)
    })
}

fn ensure_adaptive_profile(app: &AppHandle, settings: &mut AppSettings) -> bool {
    let mut changed = false;
    let needs_new_profile = !settings.adaptive_profile_applied
        || settings.adaptive_machine_profile.is_none()
        || settings
            .adaptive_machine_profile
            .as_ref()
            .map(|profile| profile_is_stale(profile, app))
            .unwrap_or(true);

    if needs_new_profile {
        // Full hardware detection (WMI GPU/NPU/thermal) — only when profile is missing or stale.
        let mut detected = detect_adaptive_machine_profile(app, &settings.app_language);
        if let Some(existing) = settings.adaptive_machine_profile.clone() {
            detected = merge_whisper_profile(detected, existing);
        }
        normalize_adaptive_profile(&mut detected);
        settings.adaptive_machine_profile = Some(detected);
        settings.adaptive_profile_applied = true;
        changed = true;
    } else if let Some(existing) = settings.adaptive_machine_profile.as_mut() {
        // Profile is fresh — apply only cheap metadata updates, no WMI re-detection.
        let current_selected_model = settings.selected_model.clone();
        let new_recommended = preferred_model_for_locale(&settings.app_language);
        let new_secondary =
            secondary_model_for_locale(&settings.app_language, existing.machine_tier);
        let has_diff = existing.profile_schema_version != ADAPTIVE_PROFILE_SCHEMA_VERSION
            || existing.app_version != current_app_version(app)
            || existing.backend_version != BACKEND_VERSION
            || existing.recommended_model_id != new_recommended
            || existing.secondary_model_id != new_secondary
            || profile_needs_turbo_cooldown_normalization(existing)
            || (!current_selected_model.is_empty()
                && existing.active_runtime_model_id.as_deref()
                    != Some(current_selected_model.as_str()));

        if has_diff {
            existing.profile_schema_version = ADAPTIVE_PROFILE_SCHEMA_VERSION;
            existing.app_version = current_app_version(app);
            existing.backend_version = BACKEND_VERSION.to_string();
            existing.recommended_model_id = new_recommended;
            existing.secondary_model_id = new_secondary;
            if !current_selected_model.is_empty() {
                existing.active_runtime_model_id = Some(current_selected_model);
            }
            normalize_adaptive_profile(existing);
            changed = true;
        }
    }

    changed
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
    vec![LLMPrompt {
        id: "default_improve_transcriptions".to_string(),
        name: "Improve Transcriptions".to_string(),
        prompt: "Clean this transcript:\n1. Fix spelling, capitalization, and punctuation errors\n2. Convert number words to digits (twenty-five → 25, ten percent → 10%, five dollars → $5)\n3. Replace spoken punctuation with symbols (period → ., comma → ,, question mark → ?)\n4. Remove filler words (um, uh, like as filler)\n5. Keep the language in the original version (if it was french, keep it in french for example)\n\nPreserve exact meaning and word order. Do not paraphrase or reorder content.\n\nReturn only the cleaned transcript.\n\nTranscript:\n${output}".to_string(),
    }]
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

    hydrate_secure_secrets(settings);

    secrets_changed
        || post_process_changed
        || language_changed
        || adaptive_profile_changed
        || external_script_changed
}

fn prepare_settings_for_fast_runtime(app: &AppHandle, settings: &mut AppSettings) -> bool {
    let secrets_changed = migrate_plaintext_secrets_to_secure_store(settings);
    let post_process_changed = ensure_post_process_defaults(settings);
    let language_changed = ensure_selected_language_default(settings);
    let external_script_changed = sanitize_external_script_path(app, settings);

    hydrate_secure_secrets(settings);

    secrets_changed || post_process_changed || language_changed || external_script_changed
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

    AppSettings {
        bindings,
        push_to_talk: false,
        audio_feedback: false,
        audio_feedback_volume: default_audio_feedback_volume(),
        sound_theme: default_sound_theme(),
        start_hidden: default_start_hidden(),
        autostart_enabled: default_autostart_enabled(),
        update_checks_enabled: default_update_checks_enabled(),
        selected_model: "".to_string(),
        always_on_microphone: false,
        selected_microphone: None,
        clamshell_microphone: None,
        selected_output_device: None,
        translate_to_english: false,
        selected_language: default_selected_language(),
        overlay_position: default_overlay_position(),
        debug_mode: false,
        log_level: default_log_level(),
        custom_words: Vec::new(),
        adaptive_vocabulary_enabled: false,
        adaptive_voice_profile_enabled: false,
        model_unload_timeout: ModelUnloadTimeout::Never,
        word_correction_threshold: default_word_correction_threshold(),
        history_limit: default_history_limit(),
        recording_retention_period: default_recording_retention_period(),
        paste_method: PasteMethod::default(),
        clipboard_handling: ClipboardHandling::default(),
        auto_submit: default_auto_submit(),
        auto_submit_key: AutoSubmitKey::default(),
        post_process_enabled: default_post_process_enabled(),
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
        post_process_actions: Vec::new(),
        saved_processing_models: Vec::new(),
        adaptive_profile_applied: default_adaptive_profile_applied(),
        adaptive_machine_profile: None,
        app_context_enabled: default_app_context_enabled(),
        whisper_mode: false,
        voice_snippets: Vec::new(),
    }
}

impl AppSettings {
    /// Returns the canonical recording mode, resolving the legacy boolean pair
    /// when `recording_mode` is still at its default value (not yet migrated).
    ///
    /// Use this in new code instead of reading `push_to_talk` / `always_on_microphone` directly.
    pub fn effective_recording_mode(&self) -> RecordingMode {
        if self.recording_mode != RecordingMode::Toggle {
            // Already set explicitly — trust it.
            return self.recording_mode;
        }
        // Derive from legacy booleans for settings that haven't been migrated yet.
        RecordingMode::from_legacy(self.push_to_talk, self.always_on_microphone)
    }

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

fn persist_store(store: &impl Deref<Target = tauri_plugin_store::Store<tauri::Wry>>) {
    if let Err(err) = store.save() {
        warn!("Failed to save settings store: {}", err);
    }
}

fn migrate_secret_to_secure_store(
    secure_value: Option<String>,
    legacy_value: Option<&str>,
    set_secret: impl Fn(&str) -> Result<(), String>,
) -> Option<String> {
    if let Some(value) = secure_value {
        return Some(value);
    }

    let legacy_value = legacy_value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);

    if let Some(value) = legacy_value.as_deref() {
        if let Err(err) = set_secret(value) {
            warn!("Failed to migrate legacy secret into secure store: {}", err);
        }
    }

    legacy_value
}

fn hydrate_settings_secrets(app: &AppHandle, settings: &mut AppSettings) {
    settings.gemini_api_key = migrate_secret_to_secure_store(
        crate::secret_store::get_gemini_api_key()
            .map_err(|err| {
                warn!("Failed to load Gemini API key from secure store: {}", err);
                err
            })
            .ok()
            .flatten(),
        settings.gemini_api_key.as_deref(),
        crate::secret_store::set_gemini_api_key,
    );

    let provider_ids: Vec<String> = settings
        .post_process_providers
        .iter()
        .map(|provider| provider.id.clone())
        .collect();

    for provider_id in provider_ids {
        let legacy_value = settings.post_process_api_keys.get(&provider_id).cloned();
        let hydrated_value = migrate_secret_to_secure_store(
            crate::secret_store::get_post_process_api_key(&provider_id)
                .map_err(|err| {
                    warn!(
                        "Failed to load secure post-process API key for provider '{}': {}",
                        provider_id, err
                    );
                    err
                })
                .ok()
                .flatten(),
            legacy_value.as_deref(),
            |value| crate::secret_store::set_post_process_api_key(&provider_id, value),
        )
        .unwrap_or_default();

        settings
            .post_process_api_keys
            .insert(provider_id, hydrated_value);
    }

    let _ = app;
}

fn strip_secrets_for_persistence(mut settings: AppSettings) -> AppSettings {
    settings.gemini_api_key = None;
    for value in settings.post_process_api_keys.values_mut() {
        value.clear();
    }
    settings
}

fn persist_settings_payload(
    store: &impl Deref<Target = tauri_plugin_store::Store<tauri::Wry>>,
    settings: &AppSettings,
) {
    match serde_json::to_value(strip_secrets_for_persistence(settings.clone())) {
        Ok(value) => {
            store.set("settings", value);
            persist_store(store);
        }
        Err(e) => {
            log::error!("Failed to serialize settings for persistence: {e}");
        }
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

    // Add future migrations here:
    // if settings.settings_version < 2 { ... settings.settings_version = 2; }
}

pub fn load_or_create_app_settings(app: &AppHandle) -> AppSettings {
    // Initialize store
    let store = app
        .store(SETTINGS_STORE_PATH)
        .expect("Failed to initialize store");

    let mut settings = if let Some(settings_value) = store.get("settings") {
        // Parse the entire settings object
        match serde_json::from_value::<AppSettings>(settings_value) {
            Ok(mut settings) => {
                let default_settings = get_default_settings();
                let mut updated = false;

                // Merge default bindings into existing settings
                for (key, value) in default_settings.bindings {
                    if !settings.bindings.contains_key(&key) {
                        debug!("Adding missing binding: {}", key);
                        settings.bindings.insert(key, value);
                        updated = true;
                    }
                }

                if updated {
                    debug!("Settings updated with new bindings");
                    persist_settings_payload(&store, &settings);
                }

                settings
            }
            Err(e) => {
                warn!("Failed to parse settings: {}", e);
                // Fall back to default settings if parsing fails
                let default_settings = get_default_settings();
                persist_settings_payload(&store, &default_settings);
                default_settings
            }
        }
    } else {
        let default_settings = get_default_settings();
        persist_settings_payload(&store, &default_settings);
        default_settings
    };

    // Run any pending schema migrations before runtime preparation.
    let pre_migration_version = settings.settings_version;
    migrate_settings(&mut settings);
    if settings.settings_version != pre_migration_version {
        persist_settings_payload(&store, &settings);
    }

    if prepare_settings_for_runtime(app, &mut settings) {
        match serde_json::to_value(exportable_settings(settings.clone())) {
            Ok(value) => {
                store.set("settings", value);
                persist_store(&store);
            }
            Err(e) => {
                log::error!("Failed to serialize settings: {e}");
            }
        }
    }

    settings
}

pub fn get_settings(app: &AppHandle) -> AppSettings {
    let store = app
        .store(SETTINGS_STORE_PATH)
        .expect("Failed to initialize store");

    let mut settings = if let Some(settings_value) = store.get("settings") {
        serde_json::from_value::<AppSettings>(settings_value).unwrap_or_else(|_| {
            let default_settings = get_default_settings();
            persist_settings_payload(&store, &default_settings);
            default_settings
        })
    } else {
        let default_settings = get_default_settings();
        persist_settings_payload(&store, &default_settings);
        default_settings
    };

    if prepare_settings_for_runtime(app, &mut settings) {
        match serde_json::to_value(exportable_settings(settings.clone())) {
            Ok(value) => {
                store.set("settings", value);
                persist_store(&store);
            }
            Err(e) => {
                log::error!("Failed to serialize settings: {e}");
            }
        }
    }

    settings
}

/// Fast variant: reads settings without running WMI hardware detection.
/// Use at startup so the app window appears instantly.
/// Always follow this with `refresh_adaptive_profile_if_needed()` in a background thread.
pub fn get_settings_fast(app: &AppHandle) -> AppSettings {
    let store = app
        .store(SETTINGS_STORE_PATH)
        .expect("Failed to initialize store");

    let mut settings = if let Some(settings_value) = store.get("settings") {
        serde_json::from_value::<AppSettings>(settings_value).unwrap_or_else(|_| {
            let default_settings = get_default_settings();
            persist_settings_payload(&store, &default_settings);
            default_settings
        })
    } else {
        let default_settings = get_default_settings();
        persist_settings_payload(&store, &default_settings);
        default_settings
    };

    if prepare_settings_for_fast_runtime(app, &mut settings) {
        match serde_json::to_value(exportable_settings(settings.clone())) {
            Ok(value) => {
                store.set("settings", value);
                persist_store(&store);
            }
            Err(e) => {
                log::error!("Failed to serialize settings: {e}");
            }
        }
    }

    settings
}

/// Runs adaptive hardware profile detection (WMI GPU/NPU queries) and persists
/// the result. Safe to call from a background thread after startup.
pub fn refresh_adaptive_profile_if_needed(app: &AppHandle) {
    let store = app
        .store(SETTINGS_STORE_PATH)
        .expect("Failed to initialize store");

    let mut settings = if let Some(settings_value) = store.get("settings") {
        serde_json::from_value::<AppSettings>(settings_value)
            .unwrap_or_else(|_| get_default_settings())
    } else {
        get_default_settings()
    };

    let changed = ensure_adaptive_profile(app, &mut settings);
    hydrate_settings_secrets(app, &mut settings);
    if changed {
        match serde_json::to_value(exportable_settings(settings)) {
            Ok(value) => {
                store.set("settings", value);
                persist_store(&store);
                log::info!("Adaptive machine profile refreshed in background");
            }
            Err(e) => {
                log::error!("Failed to serialize settings: {e}");
            }
        }
    }
}

pub fn write_settings(app: &AppHandle, settings: AppSettings) {
    let store = app
        .store(SETTINGS_STORE_PATH)
        .expect("Failed to initialize store");

    match serde_json::to_value(exportable_settings(settings)) {
        Ok(value) => {
            store.set("settings", value);
            persist_store(&store);
        }
        Err(e) => {
            log::error!("Failed to serialize settings for write: {e}");
        }
    }
}

fn whisper_config_mut<'a>(
    profile: &'a mut AdaptiveMachineProfile,
    model_id: &str,
) -> Option<&'a mut WhisperModelAdaptiveConfig> {
    match model_id {
        "small" => Some(&mut profile.whisper.small),
        "medium" => Some(&mut profile.whisper.medium),
        "turbo" => Some(&mut profile.whisper.turbo),
        "large" => Some(&mut profile.whisper.large),
        _ => None,
    }
}

pub fn set_active_runtime_model(app: &AppHandle, model_id: Option<String>) {
    let mut settings = get_settings(app);
    if let Some(profile) = settings.adaptive_machine_profile.as_mut() {
        profile.active_runtime_model_id = model_id;
        write_settings(app, settings);
    }
}

pub fn set_active_whisper_backend(
    app: &AppHandle,
    model_id: &str,
    active_backend: WhisperBackendPreference,
    reason: Option<String>,
) {
    let mut settings = get_settings(app);
    if let Some(profile) = settings.adaptive_machine_profile.as_mut() {
        let recommended_backend = if let Some(config) = whisper_config_mut(profile, model_id) {
            let recommended_backend = config.backend;
            config.active_backend = active_backend;
            config.backend_decision_reason = reason.clone();
            Some(recommended_backend)
        } else {
            None
        };
        if let Some(recommended_backend) = recommended_backend {
            profile.active_backend = Some(active_backend);
            profile.recommended_backend = Some(recommended_backend);
            profile.calibration_reason = reason;
            write_settings(app, settings);
        }
    }
}

pub fn record_whisper_backend_failure(
    app: &AppHandle,
    model_id: &str,
    backend: WhisperBackendPreference,
    reason: impl Into<String>,
    cooldown_ms: u64,
) {
    let mut settings = get_settings(app);
    if let Some(profile) = settings.adaptive_machine_profile.as_mut() {
        if let Some(config) = whisper_config_mut(profile, model_id) {
            let failed_at_ms = now_ms();
            let unsafe_until_ms = failed_at_ms.saturating_add(cooldown_ms);
            let reason = reason.into();
            config.failure_count = config.failure_count.saturating_add(1);
            config.last_failure_reason = Some(reason.clone());
            config.last_failure_at = Some(failed_at_ms);
            config.unsafe_until = Some(unsafe_until_ms);
            config
                .unsafe_backends
                .retain(|entry| entry.backend != backend);
            config.unsafe_backends.push(UnsafeBackendRecord {
                backend,
                unsafe_until_ms,
                reason: reason.clone(),
                failed_at_ms,
            });
            profile.calibration_state = AdaptiveCalibrationState::FallbackApplied;
            profile.calibration_reason = Some(reason);
            write_settings(app, settings);
        }
    }
}

pub fn get_bindings(app: &AppHandle) -> HashMap<String, ShortcutBinding> {
    let settings = get_settings(app);

    settings.bindings
}

pub fn get_stored_binding(app: &AppHandle, id: &str) -> ShortcutBinding {
    let bindings = get_bindings(app);

    if let Some(binding) = bindings.get(id) {
        return binding.clone();
    }

    if let Some(binding) = get_default_settings().bindings.get(id) {
        return binding.clone();
    }

    ShortcutBinding {
        id: id.to_string(),
        name: id.to_string(),
        description: String::new(),
        default_binding: String::new(),
        current_binding: String::new(),
    }
}

pub fn get_history_limit(app: &AppHandle) -> usize {
    let settings = get_settings(app);
    settings.history_limit
}

pub fn get_recording_retention_period(app: &AppHandle) -> RecordingRetentionPeriod {
    let settings = get_settings(app);
    settings.recording_retention_period
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
