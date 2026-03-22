pub mod app_context;
pub mod audio;
pub mod dictionary;
pub mod gemini;
pub mod history;
pub mod models;
pub mod snippets;
pub mod transcription;

use crate::adaptive_runtime::{
    get_calibration_states, recalibrate_whisper_model, CalibrationStatusSnapshot,
};
use crate::context_detector::{detect_current_app_context, AppTranscriptionContext};
use crate::runtime_observability::{collect_runtime_diagnostics, RuntimeDiagnostics};
use crate::settings::{get_settings, write_settings, AppSettings, CalibrationPhase, LogLevel};
use crate::startup_warmup::StartupWarmupStatus;
use crate::utils::cancel_current_operation;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

const MAX_IMPORTABLE_JSON_BYTES: u64 = 256 * 1024;

enum JsonPathAccess {
    Read,
    Write,
}

fn allowed_user_json_roots(app: &AppHandle) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    for candidate in [
        app.path().app_data_dir().ok(),
        app.path().app_config_dir().ok(),
        app.path().download_dir().ok(),
        app.path().document_dir().ok(),
        app.path().desktop_dir().ok(),
    ]
    .into_iter()
    .flatten()
    {
        if !roots.iter().any(|existing| existing == &candidate) {
            roots.push(candidate);
        }
    }
    roots
}

fn path_is_within_root(path: &Path, root: &Path) -> bool {
    path == root || path.starts_with(root)
}

fn validate_user_json_path(
    app: &AppHandle,
    path: &str,
    access: JsonPathAccess,
    purpose: &str,
) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(format!("Missing path for {}", purpose));
    }

    let candidate = PathBuf::from(trimmed);
    if !candidate.is_absolute() {
        return Err(format!("Path for {} must be absolute", purpose));
    }
    if candidate.extension().and_then(|ext| ext.to_str()) != Some("json") {
        return Err(format!("Path for {} must point to a .json file", purpose));
    }

    let allowed_roots = allowed_user_json_roots(app);
    if allowed_roots.is_empty() {
        return Err(format!("No writable roots are available for {}", purpose));
    }

    let resolved_path = match access {
        JsonPathAccess::Read => candidate.canonicalize().map_err(|err| {
            format!(
                "Failed to resolve path for {} '{}': {}",
                purpose,
                candidate.display(),
                err
            )
        })?,
        JsonPathAccess::Write => {
            let parent = candidate
                .parent()
                .ok_or_else(|| format!("Path for {} must include a parent directory", purpose))?;
            let resolved_parent = parent.canonicalize().map_err(|err| {
                format!(
                    "Failed to resolve parent directory for {} '{}': {}",
                    purpose,
                    parent.display(),
                    err
                )
            })?;
            resolved_parent.join(
                candidate
                    .file_name()
                    .ok_or_else(|| format!("Path for {} must include a file name", purpose))?,
            )
        }
    };

    let root_matches = allowed_roots.into_iter().any(|root| {
        let resolved_root = root.canonicalize().unwrap_or(root);
        path_is_within_root(&resolved_path, &resolved_root)
    });
    if !root_matches {
        return Err(format!(
            "Path for {} must stay inside app data, config, Downloads, Documents, or Desktop",
            purpose
        ));
    }

    if matches!(access, JsonPathAccess::Read) {
        let metadata = std::fs::metadata(&resolved_path).map_err(|err| {
            format!(
                "Failed to read metadata for {} '{}': {}",
                purpose,
                resolved_path.display(),
                err
            )
        })?;
        if !metadata.is_file() {
            return Err(format!("Path for {} must point to a file", purpose));
        }
        if metadata.len() > MAX_IMPORTABLE_JSON_BYTES {
            return Err(format!(
                "JSON file for {} exceeds the {} byte limit",
                purpose, MAX_IMPORTABLE_JSON_BYTES
            ));
        }
    }

    Ok(resolved_path)
}

#[tauri::command]
#[specta::specta]
pub fn cancel_operation(app: AppHandle) {
    cancel_current_operation(&app);
}

#[tauri::command]
#[specta::specta]
pub fn toggle_pause(app: AppHandle) -> bool {
    let audio_manager =
        app.state::<std::sync::Arc<crate::managers::audio::AudioRecordingManager>>();
    if !audio_manager.is_recording() {
        return false;
    }
    let paused = audio_manager.toggle_pause();
    if let Some(coordinator) = app.try_state::<crate::TranscriptionCoordinator>() {
        if let Some(operation_id) = coordinator.active_operation_id() {
            let _ = coordinator.set_paused(&app, operation_id, paused);
        }
    }
    crate::overlay::emit_recording_paused(&app, paused);
    paused
}

#[tauri::command]
#[specta::specta]
pub fn get_app_dir_path(app: AppHandle) -> Result<String, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    Ok(app_data_dir.to_string_lossy().to_string())
}

#[tauri::command]
#[specta::specta]
pub fn get_app_settings(app: AppHandle) -> Result<AppSettings, String> {
    Ok(crate::settings::get_public_settings(&app))
}

#[tauri::command]
#[specta::specta]
pub fn get_default_settings() -> Result<AppSettings, String> {
    Ok(crate::settings::get_default_settings())
}

#[tauri::command]
#[specta::specta]
pub fn get_startup_warmup_status(app: AppHandle) -> Result<StartupWarmupStatus, String> {
    Ok(crate::startup_warmup::current_status(&app))
}

#[tauri::command]
#[specta::specta]
pub fn get_log_dir_path(app: AppHandle) -> Result<String, String> {
    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|e| format!("Failed to get log directory: {}", e))?;

    Ok(log_dir.to_string_lossy().to_string())
}

#[specta::specta]
#[tauri::command]
pub fn set_log_level(app: AppHandle, level: LogLevel) -> Result<(), String> {
    let tauri_log_level: tauri_plugin_log::LogLevel = level.into();
    let log_level: log::Level = tauri_log_level.into();
    // Update the file log level atomic so the filter picks up the new level
    crate::FILE_LOG_LEVEL.store(
        log_level.to_level_filter() as u8,
        std::sync::atomic::Ordering::Relaxed,
    );

    let mut settings = get_settings(&app);
    settings.log_level = level;
    write_settings(&app, settings);

    Ok(())
}

#[specta::specta]
#[tauri::command]
pub fn open_recordings_folder(app: AppHandle) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    let recordings_dir = app_data_dir.join("recordings");

    let path = recordings_dir.to_string_lossy().as_ref().to_string();
    app.opener()
        .open_path(path, None::<String>)
        .map_err(|e| format!("Failed to open recordings folder: {}", e))?;

    Ok(())
}

#[specta::specta]
#[tauri::command]
pub fn open_log_dir(app: AppHandle) -> Result<(), String> {
    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|e| format!("Failed to get log directory: {}", e))?;

    let path = log_dir.to_string_lossy().as_ref().to_string();
    app.opener()
        .open_path(path, None::<String>)
        .map_err(|e| format!("Failed to open log directory: {}", e))?;

    Ok(())
}

#[specta::specta]
#[tauri::command]
pub fn open_app_data_dir(app: AppHandle) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    let path = app_data_dir.to_string_lossy().as_ref().to_string();
    app.opener()
        .open_path(path, None::<String>)
        .map_err(|e| format!("Failed to open app data directory: {}", e))?;

    Ok(())
}

#[specta::specta]
#[tauri::command]
pub fn export_settings(app: AppHandle, path: String) -> Result<(), String> {
    let output_path =
        validate_user_json_path(&app, &path, JsonPathAccess::Write, "settings export")?;
    let mut settings = get_settings(&app);
    settings.gemini_api_key = None;
    settings.external_script_path = None;
    settings
        .post_process_api_keys
        .values_mut()
        .for_each(String::clear);
    let json = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;
    std::fs::write(&output_path, json).map_err(|e| format!("Failed to write file: {}", e))?;
    log::info!("Settings exported to {}", output_path.display());
    Ok(())
}

#[specta::specta]
#[tauri::command]
pub fn import_settings(app: AppHandle, path: String) -> Result<(), String> {
    let input_path = validate_user_json_path(&app, &path, JsonPathAccess::Read, "settings import")?;
    let json =
        std::fs::read_to_string(&input_path).map_err(|e| format!("Failed to read file: {}", e))?;
    let mut settings: AppSettings =
        serde_json::from_str(&json).map_err(|e| format!("Invalid settings file: {}", e))?;
    settings.gemini_api_key = None;
    settings.external_script_path = None;
    settings
        .post_process_api_keys
        .values_mut()
        .for_each(String::clear);
    write_settings(&app, settings);
    let normalized_settings = get_settings(&app);
    write_settings(&app, normalized_settings);
    log::info!("Settings imported from {}", input_path.display());
    Ok(())
}

fn hex_encode_lower(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

fn machine_identifier_seed() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        let output = Command::new("reg")
            .args([
                "query",
                r"HKLM\SOFTWARE\Microsoft\Cryptography",
                "/v",
                "MachineGuid",
            ])
            .output()
            .map_err(|err| format!("Failed to query Windows machine identifier: {}", err))?;

        if !output.status.success() {
            return Err("Windows machine identifier query failed".to_string());
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            if line.contains("MachineGuid") {
                let value = line
                    .split_whitespace()
                    .last()
                    .unwrap_or_default()
                    .trim()
                    .to_string();
                if !value.is_empty() {
                    return Ok(value);
                }
            }
        }

        return Err("Windows machine identifier was empty".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        let output = Command::new("ioreg")
            .args(["-rd1", "-c", "IOPlatformExpertDevice"])
            .output()
            .map_err(|err| format!("Failed to query macOS machine identifier: {}", err))?;

        if !output.status.success() {
            return Err("macOS machine identifier query failed".to_string());
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            if let Some((_, raw_value)) = line.split_once("IOPlatformUUID") {
                let value = raw_value
                    .trim()
                    .trim_start_matches('=')
                    .trim()
                    .trim_matches('"')
                    .to_string();
                if !value.is_empty() {
                    return Ok(value);
                }
            }
        }

        return Err("macOS machine identifier was empty".to_string());
    }

    #[cfg(target_os = "linux")]
    {
        for path in ["/etc/machine-id", "/var/lib/dbus/machine-id"] {
            if let Ok(value) = std::fs::read_to_string(path) {
                let trimmed = value.trim();
                if !trimmed.is_empty() {
                    return Ok(trimmed.to_string());
                }
            }
        }

        return Err("Linux machine identifier was empty".to_string());
    }

    #[allow(unreachable_code)]
    Err("Unsupported platform for machine identifier".to_string())
}

#[specta::specta]
#[tauri::command]
pub fn get_machine_device_id(app: AppHandle) -> Result<String, String> {
    let seed = machine_identifier_seed()?;
    let app_id = app.config().identifier.trim().to_string();

    let mut hasher = Sha256::new();
    hasher.update("vocaltype-device-id:v1:");
    hasher.update(app_id.as_bytes());
    hasher.update(b":");
    hasher.update(seed.trim().as_bytes());
    let digest = hasher.finalize();

    Ok(hex_encode_lower(&digest))
}

#[specta::specta]
#[tauri::command]
pub fn load_secure_auth_token() -> Result<Option<String>, String> {
    crate::secret_store::get_auth_token()
}

#[specta::specta]
#[tauri::command]
pub fn store_secure_auth_token(token: String) -> Result<(), String> {
    crate::secret_store::set_auth_token(&token)
}

/// Check if Apple Intelligence is available on this device.
/// Called by the frontend when the user selects Apple Intelligence provider.
#[specta::specta]
#[tauri::command]
pub fn check_apple_intelligence_available() -> bool {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        crate::apple_intelligence::check_apple_intelligence_availability()
    }
    #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
    {
        false
    }
}

/// Try to initialize Enigo (keyboard/mouse simulation).
/// On macOS, this will return an error if accessibility permissions are not granted.
#[specta::specta]
#[tauri::command]
pub fn initialize_enigo(app: AppHandle) -> Result<(), String> {
    use crate::input::EnigoState;

    // Check if already initialized
    if app.try_state::<EnigoState>().is_some() {
        log::debug!("Enigo already initialized");
        return Ok(());
    }

    // Try to initialize
    match EnigoState::new() {
        Ok(enigo_state) => {
            app.manage(enigo_state);
            log::info!("Enigo initialized successfully after permission grant");
            Ok(())
        }
        Err(e) => {
            if cfg!(target_os = "macos") {
                log::warn!(
                    "Failed to initialize Enigo: {} (accessibility permissions may not be granted)",
                    e
                );
            } else {
                log::warn!("Failed to initialize Enigo: {}", e);
            }
            Err(format!("Failed to initialize input system: {}", e))
        }
    }
}

/// Marker state to track if shortcuts have been initialized.
pub struct ShortcutsInitialized;

/// Initialize keyboard shortcuts.
/// On macOS, this should be called after accessibility permissions are granted.
/// This is idempotent - calling it multiple times is safe.
#[specta::specta]
#[tauri::command]
pub fn initialize_shortcuts(app: AppHandle) -> Result<(), String> {
    // Check if already initialized
    if app.try_state::<ShortcutsInitialized>().is_some() {
        log::debug!("Shortcuts already initialized");
        return Ok(());
    }

    // Initialize shortcuts
    crate::shortcut::init_shortcuts(&app);

    // Mark as initialized
    app.manage(ShortcutsInitialized);

    log::info!("Shortcuts initialized successfully");
    Ok(())
}

#[specta::specta]
#[tauri::command]
pub fn get_runtime_diagnostics(app: AppHandle) -> Result<RuntimeDiagnostics, String> {
    Ok(collect_runtime_diagnostics(&app))
}

#[specta::specta]
#[tauri::command]
pub fn export_runtime_diagnostics(app: AppHandle, path: String) -> Result<(), String> {
    let output_path =
        validate_user_json_path(&app, &path, JsonPathAccess::Write, "diagnostics export")?;
    let diagnostics = collect_runtime_diagnostics(&app);
    let json = serde_json::to_string_pretty(&diagnostics)
        .map_err(|e| format!("Failed to serialize runtime diagnostics: {}", e))?;
    std::fs::write(&output_path, json)
        .map_err(|e| format!("Failed to write diagnostics file: {}", e))?;
    log::info!("Runtime diagnostics exported to {}", output_path.display());
    Ok(())
}

#[specta::specta]
#[tauri::command]
pub fn get_current_app_context() -> Result<AppTranscriptionContext, String> {
    Ok(detect_current_app_context())
}

#[specta::specta]
#[tauri::command]
pub fn get_adaptive_runtime_profile(
    app: AppHandle,
) -> Result<Option<crate::settings::AdaptiveMachineProfile>, String> {
    Ok(get_settings(&app).adaptive_machine_profile)
}

#[specta::specta]
#[tauri::command]
pub fn get_adaptive_calibration_state() -> Result<Vec<CalibrationStatusSnapshot>, String> {
    Ok(get_calibration_states())
}

#[specta::specta]
#[tauri::command]
pub fn recalibrate_whisper_model_command(
    app: AppHandle,
    model_id: String,
    phase: Option<CalibrationPhase>,
) -> Result<(), String> {
    let model_manager = app.state::<std::sync::Arc<crate::managers::model::ModelManager>>();
    recalibrate_whisper_model(&app, model_manager.inner().clone(), &model_id, phase);
    Ok(())
}
