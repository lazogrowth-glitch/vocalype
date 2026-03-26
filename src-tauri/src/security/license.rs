use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
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

fn hash_backend_device_id(device_id: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(device_id.trim().to_lowercase().as_bytes());
    hasher.update(b"vocalype-salt");
    format!("{:x}", hasher.finalize())
}

fn load_license_bundle() -> Result<Option<StoredLicenseBundle>, String> {
    let raw = crate::secret_store::get_license_bundle()?;
    match raw {
        Some(value) if !value.trim().is_empty() => {
            serde_json::from_str::<StoredLicenseBundle>(&value)
                .map(Some)
                .map_err(|err| format!("Failed to parse stored license bundle: {}", err))
        }
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
    let expected_backend_device_id = hash_backend_device_id(&expected_device_id);
    let _integrity_snapshot = crate::integrity::collect_integrity_snapshot(app);
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

    let stored_device_id = bundle.device_id.trim().to_lowercase();
    let expected_local_device_id = expected_device_id.trim().to_lowercase();
    if stored_device_id != expected_local_device_id
        && stored_device_id != expected_backend_device_id
    {
        return Ok(LicenseRuntimeState {
            reason: Some("Stored license bundle belongs to another device".to_string()),
            ..base
        });
    }

    // Binary integrity binding check intentionally disabled:
    // build_binding_sha256 changes on every rebuild and would block users after updates.

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
            // State is valid - now check the plan
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
            return Err(state
                .reason
                .unwrap_or_else(|| "No valid premium license".to_string()))
        }
    }

    // Derive a stable key from the machine device ID so models stay valid
    // across login/logout cycles. The backend's model_unlock_key changes with
    // each issued bundle, which would invalidate all downloaded models.
    let device_id = crate::commands::get_machine_device_id(app.clone())?;
    let digest = Sha256::digest(format!("vocalype-model-key:{}", device_id).as_bytes());
    Ok(format!("{:x}", digest))
}

#[tauri::command]
#[specta::specta]
pub fn get_license_runtime_state(app: AppHandle) -> Result<LicenseRuntimeState, String> {
    current_license_state(&app)
}

#[cfg(test)]
mod tests {
    use super::hash_backend_device_id;

    #[test]
    fn hashes_device_id_like_frontend_auth_client() {
        assert_eq!(
            hash_backend_device_id("abc123"),
            "82d9f197f420ced8b0f9241c0795b720a546039a39cdd4da1a4d54daa6d42029"
        );
    }
}
