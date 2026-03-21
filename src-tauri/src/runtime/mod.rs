//! Application runtime core.
//!
//! Everything that manages the lifecycle of a recording session and the
//! hardware/model adaptation layer:
//!
//! - `adaptive_runtime`:          Machine profiling, model recommendations, Whisper calibration.
//! - `transcription_coordinator`: Serializes record/transcribe/paste to avoid race conditions.
//! - `startup_warmup`:            Pre-loads models at launch for fast first transcription.
//! - `runtime_observability`:     Diagnostics collection and lifecycle event emission.
//! - `vocabulary_store`:          Custom vocabulary prioritization.
//! - `voice_profile`:             Per-user voice adaptation (VAD thresholds, gain).
//! - `context_detector`:          Detects the active app (code editor, chat, terminal…).
//! - `command_mode`:              Hotkey sequence → action mapping.
//! - `chunking`:                  Audio chunking strategy per model.
//! - `model_ids`:                 Canonical model ID helpers.
//! - `transcription_confidence`:  Confidence score payload from transcription engines.
//! - `apple_intelligence`:        Apple Intelligence integration (macOS aarch64 only).

pub mod adaptive_runtime;
pub mod chunking;
pub mod command_mode;
pub mod context_detector;
pub mod model_ids;
pub mod runtime_observability;
pub mod startup_warmup;
pub mod transcription_confidence;
pub mod transcription_coordinator;
pub mod vocabulary_store;
pub mod voice_profile;

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
pub mod apple_intelligence;
