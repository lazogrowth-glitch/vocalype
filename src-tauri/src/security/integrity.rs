use serde::Serialize;
use sha2::{Digest, Sha256};
use specta::Type;
use std::fs;
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize, Type)]
pub struct IntegritySnapshot {
    pub release_build: bool,
    pub binary_sha256: Option<String>,
    pub tamper_flags: Vec<String>,
    pub executable_path: Option<String>,
}

fn sha256_file(path: &std::path::Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|err| format!("Failed to read executable: {}", err))?;
    let digest = Sha256::digest(&bytes);
    Ok(digest.iter().map(|b| format!("{:02x}", b)).collect())
}

pub fn collect_integrity_snapshot(_app: &AppHandle) -> IntegritySnapshot {
    let mut tamper_flags = Vec::new();
    let release_build = !cfg!(debug_assertions);

    if !release_build {
        tamper_flags.push("debug_build".to_string());
    }

    let (binary_sha256, executable_path) = match std::env::current_exe() {
        Ok(exe_path) => {
            let hash = match sha256_file(&exe_path) {
                Ok(value) => Some(value),
                Err(_) => {
                    tamper_flags.push("binary_hash_unavailable".to_string());
                    None
                }
            };
            let exe_path_str = exe_path.to_string_lossy().to_string();
            let lowered = exe_path_str.to_lowercase();
            if lowered.contains("\\target\\debug\\") || lowered.contains("/target/debug/") {
                tamper_flags.push("debug_path".to_string());
            }
            (hash, Some(exe_path_str))
        }
        Err(_) => {
            tamper_flags.push("current_exe_unavailable".to_string());
            (None, None)
        }
    };

    IntegritySnapshot {
        release_build,
        binary_sha256,
        tamper_flags,
        executable_path,
    }
}

#[tauri::command]
#[specta::specta]
pub fn get_integrity_snapshot(app: AppHandle) -> IntegritySnapshot {
    collect_integrity_snapshot(&app)
}
