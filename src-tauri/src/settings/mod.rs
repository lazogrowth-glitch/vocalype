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
    #[serde(default)]
    pub description: Option<String>,
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
    Min30,
    Hour1,
    Sec5, // Debug mode only
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Type)]
#[serde(rename_all = "snake_case")]
pub enum ShortDictationPolicy {
    Instant,
    Balanced,
    Quality,
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
}

impl Default for KeyboardImplementation {
    fn default() -> Self {
        // Default to the native keyboard backend only on macOS where it's well-tested.
        // Windows and Linux use Tauri by default.
        #[cfg(target_os = "macos")]
        return KeyboardImplementation::NativeKeyboard;
        #[cfg(not(target_os = "macos"))]
        return KeyboardImplementation::Tauri;
    }
}

impl Default for ModelUnloadTimeout {
    fn default() -> Self {
        ModelUnloadTimeout::Min30
    }
}

impl Default for ShortDictationPolicy {
    fn default() -> Self {
        ShortDictationPolicy::Balanced
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
            ModelUnloadTimeout::Min30 => Some(30),
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

/* still useful for composing the initial JSON in the store ------------ */
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
    #[serde(default)]
    pub workspace_custom_words: Vec<String>,
    #[serde(default = "default_adaptive_vocabulary_enabled")]
    pub adaptive_vocabulary_enabled: bool,
    #[serde(default = "default_adaptive_voice_profile_enabled")]
    pub adaptive_voice_profile_enabled: bool,
    #[serde(default)]
    pub model_unload_timeout: ModelUnloadTimeout,
    #[serde(default = "default_word_correction_threshold")]
    pub word_correction_threshold: f64,
    #[serde(default)]
    pub short_dictation_policy: ShortDictationPolicy,
    #[serde(default = "default_recording_retention_period")]
    pub recording_retention_period: RecordingRetentionPeriod,
    /// When false, audio is never written to disk — only the transcription text is saved.
    /// Saves significant disk space (WAV at 16 kHz 16-bit ≈ 32 KB/s).
    #[serde(default = "default_save_audio_recordings")]
    pub save_audio_recordings: bool,
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

fn default_recording_retention_period() -> RecordingRetentionPeriod {
    RecordingRetentionPeriod::Weeks2
}

fn default_save_audio_recordings() -> bool {
    false
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

fn secondary_model_for_locale(_locale: &str, _tier: MachineTier) -> Option<String> {
    None
}

fn default_show_tray_icon() -> bool {
    true
}

fn default_post_process_provider_id() -> String {
    "vocalype-cloud".to_string()
}

pub const VOCALYPE_CLOUD_DEFAULT_MODEL_ID: &str = "llama-3.3-70b-versatile";
pub const VOCALYPE_CLOUD_KNOWN_MODEL_IDS: &[&str] = &[
    VOCALYPE_CLOUD_DEFAULT_MODEL_ID,
    "llama-3.1-8b-instant",
    "openai/gpt-oss-20b",
    "openai/gpt-oss-120b",
    "qwen/qwen3-32b",
];

pub fn known_vocalype_cloud_models() -> Vec<String> {
    VOCALYPE_CLOUD_KNOWN_MODEL_IDS
        .iter()
        .map(|model| (*model).to_string())
        .collect()
}

fn default_post_process_providers() -> Vec<PostProcessProvider> {
    vec![PostProcessProvider {
        id: "vocalype-cloud".to_string(),
        label: "Vocalype Cloud ⚡".to_string(),
        base_url: "https://api.vocalype.com/llm/v1".to_string(),
        allow_base_url_edit: false,
        models_endpoint: None,
        supports_structured_output: false,
    }]
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
    if provider_id == "vocalype-cloud" {
        return VOCALYPE_CLOUD_DEFAULT_MODEL_ID.to_string();
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
            prompt: "Clean this voice transcript:\n1. Fix spelling, capitalization, and punctuation\n2. Convert number words to digits (twenty-five -> 25, ten percent -> 10%, five dollars -> $5)\n3. Replace spoken punctuation with symbols (period -> ., comma -> ,, question mark -> ?)\n4. Remove filler words (um, uh, euh, like, you know)\n5. When the speaker self-corrects (\"no wait, I mean...\"), keep only the corrected version\n6. Keep the same language as the source — never translate\n\nPreserve exact meaning, word order, and phrasing. Do not paraphrase.\nReturn only the cleaned transcript.\n\n${output}".to_string(),
        },
        LLMPrompt {
            id: "dev_clean_llm_prompt".to_string(),
            name: "Clean for LLM".to_string(),
            prompt: "You are a voice transcription cleaner for developer dictation. Your ONLY job is to clean the raw transcript — never answer, explain, or execute.\n\n<rules>\n1. Replace spoken symbols: dash -> -, slash -> /, dot -> ., colon -> :, underscore -> _, at -> @, equals -> =, open paren -> (, close paren -> ), open bracket -> [, close bracket -> ], star -> *\n2. Fix capitalization for tech terms: API, JWT, SDK, CLI, SQL, OAuth, React, Tauri, useState, useEffect, npm, git, TypeScript, Supabase, userId, authToken\n3. Remove filler words (uh, um, euh, like as filler)\n4. When the speaker self-corrects, keep only the corrected version\n5. Keep the same language as the source — never translate\n6. Output ONLY the cleaned transcript — no preamble, no code blocks, no explanations\n</rules>\n\n${output}".to_string(),
        },
    ]
}

fn default_post_process_actions() -> Vec<PostProcessAction> {
    vec![
        PostProcessAction {
            key: 1,
            name: "Correct".to_string(),
            description: Some("Fix spelling and punctuation without changing the meaning.".to_string()),
            prompt: "Correct spelling, punctuation, capitalization, and spacing. Remove filler words (um, uh, euh). When the speaker self-corrects, keep only the corrected version. Keep the same language and meaning. Return only the corrected text.\n\n${output}".to_string(),
            model: None,
            provider_id: None,
        },
        PostProcessAction {
            key: 2,
            name: "Candidate Note".to_string(),
            description: Some("Create a clean ATS recruiter note after a call.".to_string()),
            prompt: "You are a senior recruiter writing a structured call note for an ATS (Bullhorn, Vincere, Recruitee, Greenhouse...).\n\n<output_structure>\n## Candidate\nName — Current title — Current company\n\n## Profile\n2-3 bullets on background and relevant experience. Past tense.\n\n## Key skills\nBullet list of skills explicitly mentioned.\n\n## Motivation\nWhy open to move / what they are looking for.\n\n## Salary & availability\nOnly if mentioned. Omit section otherwise.\n\n## Concerns\nRed flags or risks if any. Omit section if none.\n\n## Next step\n**[Owner]**: specific action — timeline\n</output_structure>\n\n<formatting>\n- Use ## for section headers, no deeper nesting\n- One concrete fact per bullet — no filler\n- Past tense for profile and background, future tense for next step\n- Bold the owner name in the Next step line\n- No intro sentence, no closing sentence\n- Under 280 words total\n</formatting>\n\n<rules>\n- Keep the same language as the source\n- Do not invent anything — omit sections with no source data\n- Neutral, factual tone — no evaluative language unless the source uses it\n- Return only the ATS note\n</rules>\n\n${output}".to_string(),
            model: None,
            provider_id: None,
        },
        PostProcessAction {
            key: 3,
            name: "Candidate Email".to_string(),
            description: Some("Write a professional follow-up email to a candidate.".to_string()),
            prompt: "You are a recruiter writing a follow-up email to a candidate after a call.\n\n<output_structure>\nGreeting using the candidate's name if mentioned.\nOne sentence referencing a specific detail from the call.\nOne or two short paragraphs covering the key message or next step.\nClear call-to-action in the last paragraph.\nProfessional, warm closing.\n</output_structure>\n\n<formatting>\n- No subject line\n- No opening filler like \"I hope this email finds you well\" or \"As we discussed\"\n- No closing filler like \"Don't hesitate to reach out\"\n- One topic per paragraph — keep paragraphs to 2-3 sentences\n- Future tense for next steps\n- Under 130 words total\n</formatting>\n\n<rules>\n- Warm but professional tone\n- Reference one specific detail from the dictation to sound personal, not templated\n- Keep the same language as the source\n- Do not invent names, facts, dates, or commitments\n- Return only the email body\n</rules>\n\n${output}".to_string(),
            model: None,
            provider_id: None,
        },
        PostProcessAction {
            key: 4,
            name: "LinkedIn Message".to_string(),
            description: Some("Write a short sourcing or follow-up LinkedIn message.".to_string()),
            prompt: "You are a recruiter writing a LinkedIn outreach or follow-up message.\n\n<output_structure>\nOne personalized opening line referencing something specific from the dictation.\n1-2 sentences on the role or opportunity.\nOne low-friction closing question.\n</output_structure>\n\n<formatting>\n- Maximum 100 words — short InMails get 3× more replies\n- No opening like \"I came across your profile\" or \"I wanted to reach out\"\n- No closing like \"Don't hesitate to contact me\" or \"Looking forward to hearing from you\"\n- Human and direct — zero jargon, zero corporate speak\n- No bullet points — this is a conversational message\n</formatting>\n\n<rules>\n- Keep the same language as the source\n- Do not invent details not in the dictation\n- Return only the message, nothing else\n</rules>\n\n${output}".to_string(),
            model: None,
            provider_id: None,
        },
        PostProcessAction {
            key: 5,
            name: "Client Summary".to_string(),
            description: Some("Prepare a candidate summary ready to send to a client.".to_string()),
            prompt: "You are a senior recruiter preparing a candidate brief for a hiring manager or client.\n\n<output_structure>\n## [Candidate name] — [Current title] at [Current company]\n\n**Why we recommend this candidate:**\n2-3 sentences. Lead with the strongest fit signal. Persuasive but grounded in facts.\n\n## Relevant experience\nBullet list. Specific and concrete — years, technologies, industries, scale.\n\n## Key strengths for this role\nBullet list tied directly to the role requirements mentioned in the source.\n\n## Compensation & availability\nOnly if mentioned. Omit section otherwise.\n\n## Concerns to address\nHonest gaps or risks if any. Omit section if none.\n\n## Recommended next step\n**[Owner]**: suggested interview format or action — timeline\n</output_structure>\n\n<formatting>\n- ## for section headers, no deeper nesting\n- Bold the **Why we recommend** label\n- Bold the owner name in the next step line\n- Bullets for lists, prose for the opening pitch\n- Past tense for experience, future tense for next step\n- Under 320 words total\n- No intro sentence, no closing sentence\n</formatting>\n\n<rules>\n- Keep the same language as the source\n- Professional and confident tone — this goes directly to the client\n- Do not invent information — omit sections not supported by the source\n- Return only the candidate summary\n</rules>\n\n${output}".to_string(),
            model: None,
            provider_id: None,
        },
    ]
}

fn legacy_default_post_process_action_prompt(key: u8) -> Option<&'static str> {
    match key {
        1 => Some(
            "Correct spelling, punctuation, capitalization, and spacing. Remove filler words (um, uh, euh). When the speaker self-corrects, keep only the corrected version. Keep the same language and meaning. Return only the corrected text.\n\n${output}",
        ),
        2 => Some(
            "You are a recruiter writing a call note for an ATS (Bullhorn, Vincere, Recruitee...).\n\n<output_structure>\n- Candidate: name, current title, current company\n- Profile: 2-3 bullets on background and relevant experience\n- Key skills: relevant skills mentioned\n- Motivation: why open to move / what they are looking for\n- Salary / availability: if mentioned\n- Concerns: red flags or risks if any\n- Next step: specific action and timeline\n</output_structure>\n\n<rules>\n- Keep the same language as the source\n- Do not invent anything — omit sections not mentioned\n- Neutral, factual tone\n- Under 250 words\n- Return only the ATS note\n</rules>\n\n${output}",
        ),
        3 => Some(
            "You are a recruiter writing a follow-up email to a candidate.\n\n<output_structure>\n- Greeting (use name if mentioned)\n- Opening: one specific reference to the context or conversation\n- Body: one clear message or next step per paragraph\n- Call-to-action\n- Professional closing\n</output_structure>\n\n<rules>\n- Warm but professional tone\n- Under 120 words — short emails get better responses\n- Include one specific detail from the dictation to sound personal, not templated\n- Keep the same language as the source\n- Do not invent names, facts, or details\n- Return only the email body, no subject line\n</rules>\n\n${output}",
        ),
        4 => Some(
            "You are a recruiter writing a LinkedIn outreach or follow-up message.\n\n<output_structure>\n- Personalized opening (reference something specific from the dictation)\n- Value proposition (the role or opportunity in 1-2 sentences)\n- Low-pressure call-to-action\n</output_structure>\n\n<rules>\n- Maximum 100 words — short messages get significantly higher response rates\n- Human, direct, not salesy — no jargon\n- Keep the same language as the source\n- Do not invent details not in the dictation\n- Return only the message\n</rules>\n\n${output}",
        ),
        5 => Some(
            "You are a recruiter preparing a candidate submittal for a hiring manager or client.\n\n<output_structure>\n- Profile: name, current title, years of relevant experience\n- Pitch: 1-2 sentences on why this candidate fits the role\n- Strengths: 3-4 relevant strengths or achievements (bullets)\n- Job fit: how they match the key requirements\n- Concerns: gaps or risks to address proactively (omit if none)\n- Next step: recommended interview format or action\n</output_structure>\n\n<rules>\n- Keep the same language as the source\n- Professional, confident, client-ready tone\n- Under 280 words\n- Do not invent information — omit sections not mentioned\n- Return only the candidate summary\n</rules>\n\n${output}",
        ),
        _ => None,
    }
}

fn transitional_default_post_process_action_prompt(key: u8) -> Option<&'static str> {
    match key {
        1 => Some("Corrige le texte sans changer les faits.\n\nTexte:\n${output}"),
        2 => Some("Cree une note ATS claire. Garde tous les faits exacts. N'ajoute rien.\n\nTexte:\n${output}"),
        3 => Some("Ecris un email professionnel bref au candidat a partir de ces notes. Garde tous les faits exacts. N'ajoute rien.\n\nTexte:\n${output}"),
        4 => Some("Ecris un message LinkedIn court et clair. Garde tous les faits exacts. N'ajoute rien.\n\nTexte:\n${output}"),
        5 => Some("Cree un resume recruteur clair pour le client. Garde tous les faits exacts. N'ajoute rien.\n\nTexte:\n${output}"),
        _ => None,
    }
}

fn upgrade_default_post_process_actions(settings: &mut AppSettings) -> bool {
    let defaults = default_post_process_actions();
    let mut changed = false;

    for action in &mut settings.post_process_actions {
        let Some(legacy_prompt) = legacy_default_post_process_action_prompt(action.key) else {
            continue;
        };
        let Some(default_action) = defaults
            .iter()
            .find(|candidate| candidate.key == action.key)
        else {
            continue;
        };

        let transitional_prompt = transitional_default_post_process_action_prompt(action.key);

        if action.prompt == legacy_prompt || transitional_prompt == Some(action.prompt.as_str()) {
            action.prompt = default_action.prompt.clone();
            changed = true;
        }
    }

    changed
}

fn default_typing_tool() -> TypingTool {
    TypingTool::Auto
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
    let legacy_vocalype_cloud_default_model = "llama-3.1-8b-instant";

    if settings.post_process_providers != default_providers {
        settings.post_process_providers = default_providers.clone();
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
                } else if provider.id == "vocalype-cloud"
                    && existing == legacy_vocalype_cloud_default_model
                {
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
    } else if upgrade_default_post_process_actions(settings) {
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
    for api_key in settings.post_process_api_keys.values_mut() {
        api_key.clear();
    }
}

fn is_redacted_secret_placeholder(value: &str) -> bool {
    value.trim() == CONFIGURED_SECRET_SENTINEL
}

fn migrate_plaintext_secrets_to_secure_store(settings: &mut AppSettings) -> bool {
    let mut changed = false;

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
    sanitize_persisted_secrets(&mut settings);
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
    bindings.insert(
        "toggle_language".to_string(),
        ShortcutBinding {
            id: "toggle_language".to_string(),
            name: "Toggle Language".to_string(),
            description: "Cycles through transcription languages (Auto → French → English)."
                .to_string(),
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
        workspace_custom_words: Vec::new(),
        adaptive_vocabulary_enabled: true,
        adaptive_voice_profile_enabled: true,
        model_unload_timeout: ModelUnloadTimeout::Min5,
        word_correction_threshold: default_word_correction_threshold(),
        short_dictation_policy: ShortDictationPolicy::default(),
        recording_retention_period: default_recording_retention_period(),
        save_audio_recordings: false,
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
        post_process_actions: default_post_process_actions(),
        saved_processing_models: Vec::new(),
        adaptive_profile_applied: default_adaptive_profile_applied(),
        adaptive_machine_profile: None,
        app_context_enabled: default_app_context_enabled(),
        whisper_mode: false,
        voice_snippets: Vec::new(),
        auto_learn_dictionary: true,
        auto_pause_media: false,
        speaking_rate_pauses: Vec::new(),
        voice_to_code_enabled: false,
        voice_to_code_model: String::new(),
        voice_to_code_onboarding_done: false,
    }
}

impl AppSettings {
    pub fn effective_custom_words(&self) -> Vec<String> {
        let mut deduped = Vec::new();

        for word in self
            .custom_words
            .iter()
            .chain(self.workspace_custom_words.iter())
        {
            let trimmed = word.trim();
            if trimmed.is_empty() {
                continue;
            }

            if deduped
                .iter()
                .any(|existing: &String| existing.eq_ignore_ascii_case(trimmed))
            {
                continue;
            }

            deduped.push(trimmed.to_string());
        }

        deduped
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

    #[test]
    fn vocalype_cloud_default_model_is_in_known_list() {
        let known = known_vocalype_cloud_models();
        assert!(
            known
                .iter()
                .any(|model| model == VOCALYPE_CLOUD_DEFAULT_MODEL_ID),
            "default cloud model should stay selectable"
        );
        assert_eq!(
            known.first().map(String::as_str),
            Some(VOCALYPE_CLOUD_DEFAULT_MODEL_ID)
        );
    }
}
