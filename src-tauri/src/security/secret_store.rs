use keyring::Entry;
use tauri::AppHandle;

const SERVICE_NAME: &str = "com.vocalype.desktop";

const AUTH_TOKEN_ACCOUNT: &str = "auth.token";
const AUTH_SESSION_ACCOUNT: &str = "auth.session";
const LICENSE_BUNDLE_ACCOUNT: &str = "license.bundle";
const GEMINI_API_KEY_ACCOUNT: &str = "settings.gemini_api_key";
const POST_PROCESS_PREFIX: &str = "settings.post_process_api_key.";

fn entry(account: &str) -> Result<Entry, String> {
    Entry::new(SERVICE_NAME, account)
        .map_err(|err| format!("Failed to access secure store: {}", err))
}

fn get_secret_value(account: &str) -> Result<Option<String>, String> {
    let entry = entry(account)?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(format!(
            "Failed to read secure value '{}': {}",
            account, err
        )),
    }
}

fn set_secret_value(account: &str, value: &str) -> Result<(), String> {
    let entry = entry(account)?;
    entry
        .set_password(value)
        .map_err(|err| format!("Failed to write secure value '{}': {}", account, err))
}

fn delete_secret_value(account: &str) -> Result<(), String> {
    let entry = entry(account)?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(format!(
            "Failed to delete secure value '{}': {}",
            account, err
        )),
    }
}

pub fn get_auth_token() -> Result<Option<String>, String> {
    get_secret_value(AUTH_TOKEN_ACCOUNT)
}

pub fn set_auth_token(token: &str) -> Result<(), String> {
    set_secret_value(AUTH_TOKEN_ACCOUNT, token)
}

pub fn clear_auth_token() -> Result<(), String> {
    delete_secret_value(AUTH_TOKEN_ACCOUNT)
}

pub fn get_auth_session() -> Result<Option<String>, String> {
    get_secret_value(AUTH_SESSION_ACCOUNT)
}

pub fn set_auth_session(session_json: &str) -> Result<(), String> {
    set_secret_value(AUTH_SESSION_ACCOUNT, session_json)
}

pub fn clear_auth_session() -> Result<(), String> {
    delete_secret_value(AUTH_SESSION_ACCOUNT)
}

pub fn get_license_bundle() -> Result<Option<String>, String> {
    get_secret_value(LICENSE_BUNDLE_ACCOUNT)
}

pub fn set_license_bundle(bundle_json: &str) -> Result<(), String> {
    set_secret_value(LICENSE_BUNDLE_ACCOUNT, bundle_json)
}

pub fn clear_license_bundle() -> Result<(), String> {
    delete_secret_value(LICENSE_BUNDLE_ACCOUNT)
}

pub fn get_gemini_api_key() -> Result<Option<String>, String> {
    get_secret_value(GEMINI_API_KEY_ACCOUNT)
}

pub fn set_gemini_api_key(value: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        clear_gemini_api_key()
    } else {
        set_secret_value(GEMINI_API_KEY_ACCOUNT, value)
    }
}

pub fn clear_gemini_api_key() -> Result<(), String> {
    delete_secret_value(GEMINI_API_KEY_ACCOUNT)
}

pub fn post_process_api_key_account(provider_id: &str) -> String {
    format!("{}{}", POST_PROCESS_PREFIX, provider_id)
}

pub fn get_post_process_api_key(provider_id: &str) -> Result<Option<String>, String> {
    get_secret_value(&post_process_api_key_account(provider_id))
}

pub fn set_post_process_api_key(provider_id: &str, value: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        clear_post_process_api_key(provider_id)
    } else {
        set_secret_value(&post_process_api_key_account(provider_id), value)
    }
}

pub fn clear_post_process_api_key(provider_id: &str) -> Result<(), String> {
    delete_secret_value(&post_process_api_key_account(provider_id))
}

#[tauri::command]
#[specta::specta]
pub fn get_secure_auth_token(_app: AppHandle) -> Result<Option<String>, String> {
    get_auth_token()
}

#[tauri::command]
#[specta::specta]
pub fn set_secure_auth_token(_app: AppHandle, token: String) -> Result<(), String> {
    if token.trim().is_empty() {
        clear_auth_token()
    } else {
        set_auth_token(&token)
    }
}

#[tauri::command]
#[specta::specta]
pub fn clear_secure_auth_token(_app: AppHandle) -> Result<(), String> {
    clear_auth_token()
}

#[tauri::command]
#[specta::specta]
pub fn get_secure_auth_session(_app: AppHandle) -> Result<Option<String>, String> {
    get_auth_session()
}

#[tauri::command]
#[specta::specta]
pub fn set_secure_auth_session(_app: AppHandle, session_json: String) -> Result<(), String> {
    if session_json.trim().is_empty() {
        clear_auth_session()
    } else {
        set_auth_session(&session_json)
    }
}

#[tauri::command]
#[specta::specta]
pub fn clear_secure_auth_session(_app: AppHandle) -> Result<(), String> {
    clear_auth_session()
}

#[tauri::command]
#[specta::specta]
pub fn get_secure_license_bundle(_app: AppHandle) -> Result<Option<String>, String> {
    get_license_bundle()
}

#[tauri::command]
#[specta::specta]
pub fn set_secure_license_bundle(_app: AppHandle, bundle_json: String) -> Result<(), String> {
    if bundle_json.trim().is_empty() {
        clear_license_bundle()
    } else {
        set_license_bundle(&bundle_json)
    }
}

#[tauri::command]
#[specta::specta]
pub fn clear_secure_license_bundle(_app: AppHandle) -> Result<(), String> {
    clear_license_bundle()
}
