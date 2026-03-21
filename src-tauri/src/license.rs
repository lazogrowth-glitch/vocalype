use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredLicenseBundle {
    pub state: String,
    pub issued_at: String,
    pub grant_token: String,
    pub grant_expires_at: String,
    pub offline_token: String,
    pub offline_expires_at: String,
    pub refresh_after_seconds: u64,
    pub device_id: String,
    pub plan: String,
    pub entitlements: Vec<String>,
    pub entitlement_status: String,
    pub model_unlock_key: String,
    pub build_binding_sha256: Option<String>,
    pub integrity_anomalies: Option<Vec<String>>,
    pub grace_until: Option<String>,
    pub last_refreshed_at: Option<String>,
    pub app_version: Option<String>,
    pub app_channel: Option<String>,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum LicenseState {
    OnlineValid,
    OfflineValid,
    Expired,
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct LicenseRuntimeState {
    pub state: LicenseState,
    pub reason: Option<String>,
    pub device_id: Option<String>,
    pub grant_expires_at: Option<String>,
    pub offline_expires_at: Option<String>,
    pub grace_until: Option<String>,
    pub entitlement_status: Option<String>,
    pub last_refreshed_at: Option<String>,
    pub integrity_anomalies: Vec<String>,
}

fn parse_utc(value: &str) -> Option<DateTime<Utc>> {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|dt| dt.with_timezone(&Utc))
}

fn load_license_bundle() -> Result<Option<StoredLicenseBundle>, String> {
    let raw = crate::secret_store::get_license_bundle()?;
    match raw {
        Some(value) if !value.trim().is_empty() => serde_json::from_str::<StoredLicenseBundle>(&value)
            .map(Some)
            .map_err(|err| format!("Failed to parse stored license bundle: {}", err)),
        _ => Ok(None),
    }
}

pub fn current_license_state(app: &AppHandle) -> Result<LicenseRuntimeState, String> {
    let Some(bundle) = load_license_bundle()? else {
        return Ok(LicenseRuntimeState {
            state: LicenseState::Expired,
            reason: Some("No stored license bundle".to_string()),
            device_id: None,
            grant_expires_at: None,
            offline_expires_at: None,
            grace_until: None,
            entitlement_status: None,
            last_refreshed_at: None,
            integrity_anomalies: Vec::new(),
        });
    };

    let expected_device_id = crate::commands::get_machine_device_id(app.clone())?;
    let integrity_snapshot = crate::integrity::collect_integrity_snapshot(app);
    let now = Utc::now();
    let grant_expires_at = parse_utc(&bundle.grant_expires_at);
    let offline_expires_at = parse_utc(&bundle.offline_expires_at);
    let grace_until = bundle.grace_until.as_deref().and_then(parse_utc);
    let has_premium = bundle.entitlements.iter().any(|item| item == "premium");
    let has_basic = bundle.entitlements.iter().any(|item| item == "basic");

    let base = LicenseRuntimeState {
        state: LicenseState::Expired,
        reason: None,
        device_id: Some(bundle.device_id.clone()),
        grant_expires_at: Some(bundle.grant_expires_at.clone()),
        offline_expires_at: Some(bundle.offline_expires_at.clone()),
        grace_until: bundle.grace_until.clone(),
        entitlement_status: Some(bundle.entitlement_status.clone()),
        last_refreshed_at: bundle.last_refreshed_at.clone(),
        integrity_anomalies: bundle.integrity_anomalies.clone().unwrap_or_default(),
    };

    if bundle.device_id.trim().to_lowercase() != expected_device_id.trim().to_lowercase() {
        return Ok(LicenseRuntimeState {
            reason: Some("Stored license bundle belongs to another device".to_string()),
            ..base
        });
    }

    // Basic-tier users skip integrity binding (no model unlock needed)
    if has_premium {
        if let Some(bound_hash) = bundle.build_binding_sha256.as_deref() {
            let current_hash = integrity_snapshot.binary_sha256.as_deref();
            if current_hash != Some(bound_hash) {
                return Ok(LicenseRuntimeState {
                    reason: Some("Binary integrity changed since premium license was issued".to_string()),
                    ..base
                });
            }
        }
    }

    if !has_premium && !has_basic {
        return Ok(LicenseRuntimeState {
            reason: Some("Stored license does not include a valid entitlement".to_string()),
            ..base
        });
    }

    // Grace period only applies to premium (basic never enters revocation)
    if has_premium {
        if let Some(grace_until) = grace_until {
            if grace_until <= now {
                return Ok(LicenseRuntimeState {
                    reason: Some("Premium grace period expired".to_string()),
                    ..base
                });
            }
        }
    }

    if let Some(grant_expires_at) = grant_expires_at {
        if grant_expires_at > now {
            return Ok(LicenseRuntimeState {
                state: LicenseState::OnlineValid,
                reason: None,
                ..base
            });
        }
    }

    if let Some(offline_expires_at) = offline_expires_at {
        if offline_expires_at > now {
            return Ok(LicenseRuntimeState {
                state: LicenseState::OfflineValid,
                reason: None,
                ..base
            });
        }
    }

    Ok(LicenseRuntimeState {
        reason: Some("Stored license expired".to_string()),
        ..base
    })
}

/// Returns the plan from the stored license bundle ("premium", "basic", or None).
pub fn current_plan(_app: &AppHandle) -> Option<String> {
    load_license_bundle().ok()?.map(|b| b.plan)
}

/// Allows any authenticated user with a valid license (premium or basic).
pub fn enforce_any_access(app: &AppHandle, action_name: &str) -> Result<(), String> {
    let state = current_license_state(app)?;
    match state.state {
        LicenseState::OnlineValid | LicenseState::OfflineValid => Ok(()),
        LicenseState::Expired => Err(format!(
            "Access required for {}. {}",
            action_name,
            state
                .reason
                .as_deref()
                .unwrap_or("Reconnect to validate your account.")
        )),
    }
}

pub fn enforce_premium_access(app: &AppHandle, action_name: &str) -> Result<(), String> {
    let state = current_license_state(app)?;
    match state.state {
        LicenseState::OnlineValid | LicenseState::OfflineValid => {
            // State is valid — now check the plan
            if current_plan(app).as_deref() != Some("premium") {
                return Err(format!(
                    "Premium subscription required for {}.",
                    action_name
                ));
            }
            Ok(())
        }
        LicenseState::Expired => Err(format!(
            "Premium access required for {}. {}",
            action_name,
            state
                .reason
                .as_deref()
                .unwrap_or("Reconnect to validate your subscription.")
        )),
    }
}

pub fn current_model_unlock_key(app: &AppHandle) -> Result<String, String> {
    let state = current_license_state(app)?;
    match state.state {
        LicenseState::OnlineValid | LicenseState::OfflineValid => {}
        LicenseState::Expired => {
            return Err(
                state
                    .reason
                    .unwrap_or_else(|| "No valid premium license".to_string()),
            )
        }
    }

    let Some(bundle) = load_license_bundle()? else {
        return Err("No stored license bundle".to_string());
    };

    if bundle.model_unlock_key.trim().is_empty() {
        return Err("Stored license bundle is missing model unlock key".to_string());
    }

    Ok(bundle.model_unlock_key)
}

#[tauri::command]
#[specta::specta]
pub fn get_license_runtime_state(app: AppHandle) -> Result<LicenseRuntimeState, String> {
    current_license_state(&app)
}
