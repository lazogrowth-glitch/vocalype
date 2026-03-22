//! Centralised error type for Vocalype.
//!
//! ## Usage
//!
//! Internal Rust code uses `AppResult<T>`:
//! ```rust
//! use vocalype_app_lib::error::{AppError, AppResult};
//!
//! fn load_model(id: &str) -> AppResult<()> {
//!     if id.is_empty() {
//!         return Err(AppError::Config("model id must not be empty".into()));
//!     }
//!     Ok(())
//! }
//! ```
//!
//! Tauri commands still return `Result<T, String>` because the JSON bridge
//! can only carry a string error. Use `.map_err(|e| e.to_string())` or the
//! `into_tauri_err` helper at the call site:
//! ```rust
//! fn some_internal_fn() -> Result<(), &'static str> {
//!     Ok(())
//! }
//!
//! #[tauri::command]
//! fn my_command() -> Result<(), String> {
//!     some_internal_fn().map_err(|e| e.to_string())
//! }
//! ```
//!
//! ## Log level conventions
//!
//! | Level   | When to use |
//! |---------|-------------|
//! | `error!` | Unrecoverable failures visible to the user (recording failed, model missing). |
//! | `warn!`  | Recoverable issues worth tracking (retry succeeded, config key missing → default). |
//! | `info!`  | Milestone transitions (model loaded, transcription started/finished). |
//! | `debug!` | Intermediate data helpful when debugging locally (chunk size, vad score). |
//! | `trace!` | Hot-path detail that would flood logs (audio sample counts, loop iterations). |

use thiserror::Error;

/// Top-level domain error for the Vocalype backend.
#[derive(Error, Debug)]
pub enum AppError {
    /// An audio device could not be opened or enumerated.
    #[error("Audio error: {0}")]
    Audio(String),

    /// A transcription model failed to load or run inference.
    #[error("Model error: {0}")]
    Model(String),

    /// App settings could not be read or written.
    #[error("Settings error: {0}")]
    Settings(String),

    /// OS clipboard, input injection, or keyring operation failed.
    #[error("Platform error: {0}")]
    Platform(String),

    /// Invalid argument supplied to an internal function or Tauri command.
    #[error("Config error: {0}")]
    Config(String),

    /// Network / HTTP call failed (auth, LLM, license).
    #[error("Network error: {0}")]
    Network(String),

    /// Any other error (catches `anyhow` and third-party errors).
    #[error("{0}")]
    Other(#[from] anyhow::Error),
}

/// Convenience alias for internal functions.
pub type AppResult<T> = Result<T, AppError>;

impl From<AppError> for String {
    fn from(e: AppError) -> Self {
        e.to_string()
    }
}
