use keyring::Entry;
use log::warn;

const SERVICE_NAME: &str = "com.vocaltype.desktop";
const GEMINI_API_KEY_ACCOUNT: &str = "gemini_api_key";
const AUTH_TOKEN_ACCOUNT: &str = "auth_token";
const POST_PROCESS_API_KEY_PREFIX: &str = "post_process_api_key:";

fn entry(account: &str) -> Result<Entry, String> {
    Entry::new(SERVICE_NAME, account).map_err(|err| {
        format!(
            "Failed to initialize secure storage entry '{}': {}",
            account, err
        )
    })
}

fn account_for_post_process_provider(provider_id: &str) -> String {
    format!("{}{}", POST_PROCESS_API_KEY_PREFIX, provider_id)
}

fn store_secret(account: &str, value: &str) -> Result<(), String> {
    let credential = entry(account)?;

    if value.trim().is_empty() {
        match credential.delete_credential() {
            Ok(()) => Ok(()),
            Err(err) => {
                warn!(
                    "Failed to delete secure secret '{}' from OS credential store: {}",
                    account, err
                );
                Ok(())
            }
        }
    } else {
        credential
            .set_password(value)
            .map_err(|err| format!("Failed to store secure secret '{}': {}", account, err))
    }
}

fn load_secret(account: &str) -> Option<String> {
    let credential = match entry(account) {
        Ok(credential) => credential,
        Err(err) => {
            warn!("{}", err);
            return None;
        }
    };

    match credential.get_password() {
        Ok(value) if !value.trim().is_empty() => Some(value),
        Ok(_) => None,
        Err(_) => None,
    }
}

pub fn store_gemini_api_key(value: &str) -> Result<(), String> {
    store_secret(GEMINI_API_KEY_ACCOUNT, value)
}

pub fn load_gemini_api_key() -> Option<String> {
    load_secret(GEMINI_API_KEY_ACCOUNT)
}

pub fn store_auth_token(value: &str) -> Result<(), String> {
    store_secret(AUTH_TOKEN_ACCOUNT, value)
}

pub fn load_auth_token() -> Option<String> {
    load_secret(AUTH_TOKEN_ACCOUNT)
}

pub fn store_post_process_api_key(provider_id: &str, value: &str) -> Result<(), String> {
    store_secret(&account_for_post_process_provider(provider_id), value)
}

pub fn load_post_process_api_key(provider_id: &str) -> Option<String> {
    load_secret(&account_for_post_process_provider(provider_id))
}
