//! Tauri commands for the embedded llama-server.

use crate::llm::llama_server::{
    ensure_llama_server, is_binary_ready, is_model_ready, is_server_healthy, LlamaServerState,
    LlamaServerStatus, LLAMA_SERVER_PORT,
};
use tauri::{AppHandle, Manager};

/// Full setup: download binary + model (if needed) then start the server.
/// Emits `llm-setup-progress` events so the frontend can show a progress bar.
/// Idempotent — safe to call on every "Activer" click.
#[tauri::command]
#[specta::specta]
pub async fn setup_llama_server(app: AppHandle) -> Result<(), String> {
    ensure_llama_server(&app).await
}

/// Lightweight status check — no side effects.
#[tauri::command]
#[specta::specta]
pub async fn check_llama_server_status(app: AppHandle) -> Result<LlamaServerStatus, String> {
    Ok(LlamaServerStatus {
        binary_ready: is_binary_ready(&app),
        model_ready: is_model_ready(&app),
        server_running: is_server_healthy().await,
        port: LLAMA_SERVER_PORT,
    })
}

/// Stop the server (called when "Clean for LLM" is disabled or app exits).
#[tauri::command]
#[specta::specta]
pub async fn stop_llama_server(app: AppHandle) -> Result<(), String> {
    if let Some(state) = app.try_state::<LlamaServerState>() {
        state.shutdown();
    }
    Ok(())
}
