use super::*;
use std::ops::Deref;
use tauri_plugin_store::StoreExt;

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

pub(crate) fn strip_secrets_for_persistence(mut settings: AppSettings) -> AppSettings {
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
