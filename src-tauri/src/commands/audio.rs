use crate::audio_feedback;
use crate::audio_toolkit::audio::{list_input_devices, list_output_devices};
use crate::managers::audio::{AudioRecordingManager, MicrophoneMode};
use crate::settings::{get_settings, write_settings};
use log::{info, warn};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::sync::Arc;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Type)]
pub struct CustomSounds {
    start: bool,
    stop: bool,
}

fn custom_sound_exists(app: &AppHandle, sound_type: &str) -> bool {
    app.path()
        .resolve(
            format!("custom_{}.wav", sound_type),
            tauri::path::BaseDirectory::AppData,
        )
        .map_or(false, |path| path.exists())
}

#[tauri::command]
#[specta::specta]
pub fn check_custom_sounds(app: AppHandle) -> CustomSounds {
    CustomSounds {
        start: custom_sound_exists(&app, "start"),
        stop: custom_sound_exists(&app, "stop"),
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Type)]
pub struct AudioDevice {
    pub index: String,
    pub name: String,
    pub is_default: bool,
}

fn transcription_session_active(app: &AppHandle) -> bool {
    app.try_state::<crate::TranscriptionCoordinator>()
        .and_then(|coordinator| coordinator.active_operation_id())
        .is_some()
}

fn resolve_input_device_selector(device_selector: &str) -> Result<(String, String), String> {
    let devices =
        list_input_devices().map_err(|e| format!("Failed to list audio devices: {}", e))?;

    if let Some(device) = devices
        .iter()
        .find(|device| device.index == device_selector)
    {
        return Ok((device.name.clone(), device.index.clone()));
    }

    let matching_by_name: Vec<_> = devices
        .iter()
        .filter(|device| device.name == device_selector)
        .collect();

    match matching_by_name.len() {
        1 => Ok((
            matching_by_name[0].name.clone(),
            matching_by_name[0].index.clone(),
        )),
        0 => Err(format!(
            "Microphone selector '{}' did not match any available device",
            device_selector
        )),
        count => Err(format!(
            "Microphone selector '{}' is ambiguous ({} matching devices)",
            device_selector, count
        )),
    }
}

#[tauri::command]
#[specta::specta]
pub fn update_microphone_mode(app: AppHandle, always_on: bool) -> Result<(), String> {
    info!(
        "[MODE] update_microphone_mode called: always_on={}",
        always_on
    );
    let rm = app.state::<Arc<AudioRecordingManager>>();
    let new_mode = if always_on {
        MicrophoneMode::AlwaysOn
    } else {
        MicrophoneMode::OnDemand
    };

    let session_active = transcription_session_active(&app);
    info!(
        "[MODE] session_active={} stream_open={}",
        session_active,
        rm.is_microphone_stream_open()
    );

    if !session_active {
        info!("[MODE] calling update_mode...");
        rm.update_mode(new_mode.clone()).map_err(|e| {
            info!("[MODE] update_mode FAILED: {}", e);
            format!("Failed to update microphone mode: {}", e)
        })?;
        info!("[MODE] update_mode OK");
    }

    info!("[MODE] writing settings...");
    let mut settings = get_settings(&app);
    settings.always_on_microphone = always_on;
    write_settings(&app, settings);
    info!("[MODE] settings written, triggering warmup...");

    crate::startup_warmup::ensure_startup_warmup(&app, "microphone-mode-changed");
    info!("[MODE] update_microphone_mode done");
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn get_microphone_mode(app: AppHandle) -> Result<bool, String> {
    let settings = get_settings(&app);
    Ok(settings.always_on_microphone)
}

#[tauri::command]
#[specta::specta]
pub fn get_available_microphones() -> Result<Vec<AudioDevice>, String> {
    let devices =
        list_input_devices().map_err(|e| format!("Failed to list audio devices: {}", e))?;

    let mut result = vec![AudioDevice {
        index: "default".to_string(),
        name: "Default".to_string(),
        is_default: true,
    }];

    result.extend(devices.into_iter().map(|d| AudioDevice {
        index: d.index,
        name: d.name,
        is_default: false, // The explicit default is handled separately
    }));

    Ok(result)
}

#[tauri::command]
#[specta::specta]
pub fn set_selected_microphone(app: AppHandle, device_name: String) -> Result<(), String> {
    let (selected_microphone, selected_microphone_index) = if device_name == "default" {
        (None, None)
    } else {
        let (resolved_name, resolved_index) = resolve_input_device_selector(&device_name)?;
        (Some(resolved_name), Some(resolved_index))
    };

    let session_active = transcription_session_active(&app);
    let rm = app.state::<Arc<AudioRecordingManager>>();
    if !session_active {
        let previous_settings = get_settings(&app);
        let mut next_settings = previous_settings.clone();
        next_settings.selected_microphone = selected_microphone.clone();
        next_settings.selected_microphone_index = selected_microphone_index.clone();
        write_settings(&app, next_settings);
        if let Err(err) = rm.update_selected_device() {
            write_settings(&app, previous_settings);
            return Err(format!("Failed to update selected device: {}", err));
        }
    } else {
        let mut settings = get_settings(&app);
        settings.selected_microphone = selected_microphone.clone();
        settings.selected_microphone_index = selected_microphone_index.clone();
        write_settings(&app, settings);
    }

    crate::startup_warmup::ensure_startup_warmup(&app, "selected-microphone-changed");

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn get_selected_microphone(app: AppHandle) -> Result<String, String> {
    let settings = get_settings(&app);
    if let Some(index) = settings.selected_microphone_index {
        return Ok(index);
    }
    if let Some(name) = settings.selected_microphone {
        if let Ok((_, index)) = resolve_input_device_selector(&name) {
            return Ok(index);
        }
    }
    Ok("default".to_string())
}

#[tauri::command]
#[specta::specta]
pub fn get_available_output_devices() -> Result<Vec<AudioDevice>, String> {
    let devices =
        list_output_devices().map_err(|e| format!("Failed to list output devices: {}", e))?;

    let mut result = vec![AudioDevice {
        index: "default".to_string(),
        name: "Default".to_string(),
        is_default: true,
    }];

    result.extend(devices.into_iter().map(|d| AudioDevice {
        index: d.index,
        name: d.name,
        is_default: false, // The explicit default is handled separately
    }));

    Ok(result)
}

#[tauri::command]
#[specta::specta]
pub fn set_selected_output_device(app: AppHandle, device_name: String) -> Result<(), String> {
    let resolved = if device_name == "default" {
        None
    } else {
        let devices =
            list_output_devices().map_err(|e| format!("Failed to list output devices: {}", e))?;
        if !devices
            .iter()
            .any(|d| d.index == device_name || d.name == device_name)
        {
            return Err(format!("Output device '{}' not found", device_name));
        }
        Some(device_name)
    };
    let mut settings = get_settings(&app);
    settings.selected_output_device = resolved;
    write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn get_selected_output_device(app: AppHandle) -> Result<String, String> {
    let settings = get_settings(&app);
    Ok(settings
        .selected_output_device
        .unwrap_or_else(|| "default".to_string()))
}

#[tauri::command]
#[specta::specta]
pub async fn play_test_sound(app: AppHandle, sound_type: String) {
    let sound = match sound_type.as_str() {
        "start" => audio_feedback::SoundType::Start,
        "stop" => audio_feedback::SoundType::Stop,
        _ => {
            warn!("Unknown sound type: {}", sound_type);
            return;
        }
    };
    audio_feedback::play_test_sound(&app, sound);
}

#[tauri::command]
#[specta::specta]
pub fn set_clamshell_microphone(app: AppHandle, device_name: String) -> Result<(), String> {
    let rm = app.state::<Arc<AudioRecordingManager>>();
    let (clamshell_microphone, clamshell_microphone_index) = if device_name == "default" {
        (None, None)
    } else {
        let (resolved_name, resolved_index) = resolve_input_device_selector(&device_name)?;
        (Some(resolved_name), Some(resolved_index))
    };
    let session_active = transcription_session_active(&app);

    if !session_active {
        let previous_settings = get_settings(&app);
        let mut next_settings = previous_settings.clone();
        next_settings.clamshell_microphone = clamshell_microphone.clone();
        next_settings.clamshell_microphone_index = clamshell_microphone_index.clone();
        write_settings(&app, next_settings);
        if let Err(err) = rm.update_selected_device() {
            write_settings(&app, previous_settings);
            return Err(format!("Failed to update clamshell microphone: {}", err));
        }
    } else {
        let mut settings = get_settings(&app);
        settings.clamshell_microphone = clamshell_microphone.clone();
        settings.clamshell_microphone_index = clamshell_microphone_index.clone();
        write_settings(&app, settings);
    }

    crate::startup_warmup::ensure_startup_warmup(&app, "clamshell-microphone-changed");

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn get_clamshell_microphone(app: AppHandle) -> Result<String, String> {
    let settings = get_settings(&app);
    if let Some(index) = settings.clamshell_microphone_index {
        return Ok(index);
    }
    if let Some(name) = settings.clamshell_microphone {
        if let Ok((_, index)) = resolve_input_device_selector(&name) {
            return Ok(index);
        }
    }
    Ok("default".to_string())
}

#[tauri::command]
#[specta::specta]
pub fn is_recording(app: AppHandle) -> bool {
    let audio_manager = app.state::<Arc<AudioRecordingManager>>();
    audio_manager.is_recording()
}
