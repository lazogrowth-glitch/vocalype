//! Embedded llama-server management.
//!
//! Vocalype ships its own llama-server binary instead of depending on Ollama.
//! On first use, it downloads:
//!   1. The llama-server binary (~10 MB) from downloads.vocalype.com
//!   2. The qwen2.5-coder:0.5b GGUF model (~394 MB) from Hugging Face
//!
//! The server runs on localhost:8788 and exposes an OpenAI-compatible API
//! identical to Ollama, so `llm_client.rs` needs zero changes.
//!
//! ## Process lifecycle
//! - Started when "Clean for LLM" is enabled.
//! - Kept alive while the app is open (holds ~500 MB RAM).
//! - Killed cleanly on app exit via `LlamaServerState::shutdown()`.

use futures_util::StreamExt;
use log::{debug, info, warn};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex as AsyncMutex;

/// Global lock to prevent concurrent downloads (prefetch vs user-triggered).
static DOWNLOAD_LOCK: OnceLock<AsyncMutex<()>> = OnceLock::new();

fn download_lock() -> &'static AsyncMutex<()> {
    DOWNLOAD_LOCK.get_or_init(|| AsyncMutex::new(()))
}

// ── Constants ─────────────────────────────────────────────────────────────────

/// Port the embedded llama-server listens on (avoids Ollama's 11434).
pub const LLAMA_SERVER_PORT: u16 = 8788;

/// base_url injected into the "vocalype-llm" provider in settings.
pub fn provider_base_url() -> String {
    format!("http://127.0.0.1:{}/v1", LLAMA_SERVER_PORT)
}

/// Model identifier used in chat completion requests.
pub const MODEL_ID: &str = "qwen2.5-coder:0.5b";

/// GGUF filename stored on disk.
const MODEL_FILENAME: &str = "qwen2.5-coder-0.5b-q4_k_m.gguf";

/// Direct download URL for the quantised GGUF (public Hugging Face repo).
const MODEL_DOWNLOAD_URL: &str =
    "https://huggingface.co/bartowski/Qwen2.5-Coder-0.5B-Instruct-GGUF/resolve/main/Qwen2.5-Coder-0.5B-Instruct-Q4_K_M.gguf";

/// Expected model size in bytes (used for progress calculation if server
/// does not send Content-Length).
const MODEL_APPROX_BYTES: u64 = 394 * 1024 * 1024;

/// Pinned llama.cpp release tag. Bump to upgrade.
const LLAMA_CPP_RELEASE: &str = "b8849";

/// Official GitHub release archive for each platform.
/// All archives contain llama-server + all required libraries.
fn binary_download_url() -> &'static str {
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    return "https://github.com/ggml-org/llama.cpp/releases/download/b8849/llama-b8849-bin-win-cpu-x64.zip";

    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    return "https://github.com/ggml-org/llama.cpp/releases/download/b8849/llama-b8849-bin-macos-arm64.tar.gz";

    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    return "https://github.com/ggml-org/llama.cpp/releases/download/b8849/llama-b8849-bin-macos-x64.tar.gz";

    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    return "https://github.com/ggml-org/llama.cpp/releases/download/b8849/llama-b8849-bin-ubuntu-x64.tar.gz";

    #[cfg(not(any(
        all(target_os = "windows", target_arch = "x86_64"),
        all(target_os = "macos", target_arch = "aarch64"),
        all(target_os = "macos", target_arch = "x86_64"),
        all(target_os = "linux", target_arch = "x86_64"),
    )))]
    return "";
}

/// Binary filename on disk (platform-aware).
fn binary_filename() -> &'static str {
    if cfg!(target_os = "windows") {
        "llama-server.exe"
    } else {
        "llama-server"
    }
}

/// Download the llama-server binary from the official llama.cpp GitHub release.
/// Extracts the archive (zip on Windows, tar.gz on Mac/Linux) into the binary directory.
async fn download_binary(app: &AppHandle, url: &str, dest: &PathBuf) -> Result<(), String> {
    let dir = dest.parent().ok_or("Cannot resolve binary directory")?;
    std::fs::create_dir_all(dir).map_err(|e| format!("Failed to create directory: {}", e))?;

    let tmp = dir.join("llama-server-download.tmp");
    download_with_progress(app, url, &tmp, "binary", 30 * 1024 * 1024).await?;

    #[cfg(target_os = "windows")]
    {
        let file = std::fs::File::open(&tmp).map_err(|e| format!("Failed to open zip: {}", e))?;
        let mut archive =
            zip::ZipArchive::new(file).map_err(|e| format!("Failed to read zip: {}", e))?;
        for i in 0..archive.len() {
            let mut entry = archive
                .by_index(i)
                .map_err(|e| format!("Zip entry error: {}", e))?;
            let name = entry.name().to_owned();
            if entry.is_dir() || (!name.ends_with(".exe") && !name.ends_with(".dll")) {
                continue;
            }
            let out_path = dir.join(std::path::Path::new(&name).file_name().unwrap_or_default());
            let mut out = std::fs::File::create(&out_path)
                .map_err(|e| format!("Failed to write {}: {}", name, e))?;
            std::io::copy(&mut entry, &mut out)
                .map_err(|e| format!("Failed to extract {}: {}", name, e))?;
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        use flate2::read::GzDecoder;
        let file =
            std::fs::File::open(&tmp).map_err(|e| format!("Failed to open tar.gz: {}", e))?;
        let mut archive = tar::Archive::new(GzDecoder::new(file));
        for entry in archive.entries().map_err(|e| format!("Tar error: {}", e))? {
            let mut entry = entry.map_err(|e| format!("Tar entry error: {}", e))?;
            let path = entry
                .path()
                .map_err(|e| format!("Tar path error: {}", e))?
                .into_owned();
            let filename = match path.file_name() {
                Some(n) => n.to_string_lossy().into_owned(),
                None => continue,
            };
            if filename != "llama-server" {
                continue;
            }
            entry
                .unpack(dest)
                .map_err(|e| format!("Failed to extract llama-server: {}", e))?;
            // Mark executable.
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(dest)
                .map_err(|e| format!("Stat failed: {}", e))?
                .permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(dest, perms).map_err(|e| format!("chmod failed: {}", e))?;
            break;
        }
    }

    let _ = std::fs::remove_file(&tmp);
    info!("[llama-server] binary extracted to {:?}", dir);
    Ok(())
}

// ── Paths ─────────────────────────────────────────────────────────────────────

/// Root directory where we store binary + model.
pub fn llm_data_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|d| d.join("vocalype-llm"))
}

pub fn binary_path(app: &AppHandle) -> Option<PathBuf> {
    llm_data_dir(app).map(|d| d.join(binary_filename()))
}

pub fn model_path(app: &AppHandle) -> Option<PathBuf> {
    llm_data_dir(app).map(|d| d.join("models").join(MODEL_FILENAME))
}

pub fn is_binary_ready(app: &AppHandle) -> bool {
    binary_path(app).map(|p| p.exists()).unwrap_or(false)
}

pub fn is_model_ready(app: &AppHandle) -> bool {
    model_path(app).map(|p| p.exists()).unwrap_or(false)
}

// ── State ─────────────────────────────────────────────────────────────────────

/// Tauri managed state: holds the running server process (if any).
pub struct LlamaServerState(pub Mutex<Option<Child>>);

impl LlamaServerState {
    pub fn new() -> Self {
        Self(Mutex::new(None))
    }

    /// Kill the server process if it's running.
    pub fn shutdown(&self) {
        if let Ok(mut guard) = self.0.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
                info!("[llama-server] server stopped");
            }
        }
    }
}

// ── Health check ──────────────────────────────────────────────────────────────

/// Performs a lightweight GET /health check against the running server.
pub async fn is_server_healthy() -> bool {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    let client = CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_millis(500))
            .build()
            .expect("reqwest client")
    });
    client
        .get(format!("http://127.0.0.1:{}/health", LLAMA_SERVER_PORT))
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

// ── Download helpers ──────────────────────────────────────────────────────────

/// Download a file with streaming progress, emitting `llm-setup-progress` events.
/// `step` is used as-is in the event payload (e.g. "binary", "model").
async fn download_with_progress(
    app: &AppHandle,
    url: &str,
    dest: &PathBuf,
    step: &str,
    approx_total: u64,
) -> Result<(), String> {
    // Ensure parent directory exists.
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Download failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("HTTP {} downloading {}", response.status(), url));
    }

    let total = response.content_length().unwrap_or(approx_total).max(1);
    let mut downloaded: u64 = 0;
    let mut last_pct: u8 = 0;

    // Write to a temp path, rename on success (atomic).
    let tmp = dest.with_extension("tmp");
    let mut file =
        std::fs::File::create(&tmp).map_err(|e| format!("Failed to create temp file: {}", e))?;

    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Stream error: {}", e))?;
        std::io::Write::write_all(&mut file, &chunk).map_err(|e| format!("Write error: {}", e))?;
        downloaded += chunk.len() as u64;

        let pct = ((downloaded * 100) / total).min(99) as u8;
        if pct != last_pct {
            last_pct = pct;
            let _ = app.emit(
                "llm-setup-progress",
                serde_json::json!({
                    "step": step,
                    "pct": pct,
                    "label": format!("{} {} MB / {} MB",
                        if step == "model" { "Modèle" } else { "Moteur" },
                        downloaded / 1_048_576,
                        total / 1_048_576)
                }),
            );
        }
    }

    // Rename temp → final.
    std::fs::rename(&tmp, dest).map_err(|e| format!("Rename failed: {}", e))?;

    // On Unix, mark the binary executable.
    #[cfg(unix)]
    if step == "binary" {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(dest)
            .map_err(|e| format!("Stat failed: {}", e))?
            .permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(dest, perms).map_err(|e| format!("chmod failed: {}", e))?;
    }

    Ok(())
}

// ── Background prefetch ───────────────────────────────────────────────────────

/// Silently downloads the binary + model in the background on first launch.
/// Does NOT start the server — that happens only when the user activates the feature.
pub fn spawn_prefetch(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if is_binary_ready(&app) && is_model_ready(&app) {
            return;
        }
        if let Err(e) = prefetch_llm_assets(&app).await {
            log::warn!("[llama-server] background prefetch failed: {}", e);
        }
    });
}

async fn prefetch_llm_assets(app: &AppHandle) -> Result<(), String> {
    let _guard = download_lock().lock().await;
    if !is_binary_ready(app) {
        let url = binary_download_url();
        if url.is_empty() {
            return Ok(());
        }
        let dest = binary_path(app).ok_or("Cannot resolve binary path")?;
        info!("[llama-server] prefetch: downloading binary");
        download_binary(app, url, &dest).await?;
        info!("[llama-server] prefetch: binary ready");
    }
    if !is_model_ready(app) {
        let dest = model_path(app).ok_or("Cannot resolve model path")?;
        info!("[llama-server] prefetch: downloading model (~394 MB)");
        download_with_progress(app, MODEL_DOWNLOAD_URL, &dest, "model", MODEL_APPROX_BYTES).await?;
        info!("[llama-server] prefetch: model ready");
    }
    Ok(())
}

// ── Main setup entry point ────────────────────────────────────────────────────

/// Full setup: download binary + model if needed, start server.
/// Emits `llm-setup-progress` events throughout.
/// Idempotent — safe to call multiple times.
pub async fn ensure_llama_server(app: &AppHandle) -> Result<(), String> {
    // ── 1 & 2. Binary + Model (serialised with prefetch via global lock) ───────
    {
        let _guard = download_lock().lock().await;
        if !is_binary_ready(app) {
            let url = binary_download_url();
            if url.is_empty() {
                return Err("Unsupported platform for embedded LLM".into());
            }
            let dest = binary_path(app).ok_or("Cannot resolve binary path")?;
            info!("[llama-server] downloading binary from {}", url);
            let _ = app.emit(
                "llm-setup-progress",
                serde_json::json!({ "step": "binary", "pct": 0, "label": "Téléchargement du moteur LLM…" }),
            );
            download_binary(app, url, &dest).await?;
            info!("[llama-server] binary ready at {:?}", dest);
        }
        if !is_model_ready(app) {
            let dest = model_path(app).ok_or("Cannot resolve model path")?;
            info!(
                "[llama-server] downloading model from {}",
                MODEL_DOWNLOAD_URL
            );
            let _ = app.emit(
                "llm-setup-progress",
                serde_json::json!({ "step": "model", "pct": 0, "label": "Téléchargement du modèle (~394 MB)…" }),
            );
            download_with_progress(app, MODEL_DOWNLOAD_URL, &dest, "model", MODEL_APPROX_BYTES)
                .await?;
            info!("[llama-server] model ready at {:?}", dest);
        }
    }

    // ── 3. Start server if not already running ────────────────────────────────
    if is_server_healthy().await {
        debug!("[llama-server] already healthy, skipping start");
        let _ = app.emit(
            "llm-setup-progress",
            serde_json::json!({ "step": "done", "pct": 100, "label": "Moteur LLM prêt" }),
        );
        return Ok(());
    }

    let _ = app.emit(
        "llm-setup-progress",
        serde_json::json!({ "step": "starting", "pct": 99, "label": "Démarrage du moteur…" }),
    );

    let bin = binary_path(app).ok_or("Cannot resolve binary path")?;
    let model = model_path(app).ok_or("Cannot resolve model path")?;

    let child = Command::new(&bin)
        .args([
            "--host",
            "127.0.0.1",
            "--port",
            &LLAMA_SERVER_PORT.to_string(),
            "--model",
            model.to_str().unwrap_or_default(),
            "--ctx-size",
            "2048",
            "--threads",
            "4",
            "--n-predict",
            "512",
            "-ngl",
            "0",         // CPU only; GPU layers can be added later
            "--no-mmap", // more reliable across OS
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to start llama-server: {}", e))?;

    // Store process handle.
    if let Some(state) = app.try_state::<LlamaServerState>() {
        if let Ok(mut guard) = state.0.lock() {
            *guard = Some(child);
        }
    }

    // Poll until healthy — no hard timeout, loading time varies by machine.
    let mut i = 0u64;
    loop {
        tokio::time::sleep(Duration::from_millis(500)).await;
        if is_server_healthy().await {
            info!("[llama-server] healthy after {}ms", (i + 1) * 500);
            let _ = app.emit(
                "llm-setup-progress",
                serde_json::json!({ "step": "done", "pct": 100, "label": "Moteur LLM prêt ✓" }),
            );
            return Ok(());
        }
        // Check if the process already exited (crash at startup).
        if let Some(state) = app.try_state::<LlamaServerState>() {
            if let Ok(mut guard) = state.0.lock() {
                if let Some(child) = guard.as_mut() {
                    match child.try_wait() {
                        Ok(Some(status)) => {
                            warn!("[llama-server] process exited with {}", status);
                            *guard = None;
                            return Err(format!("llama-server crashed at startup ({})", status));
                        }
                        Ok(None) => {} // still running
                        Err(e) => warn!("[llama-server] try_wait error: {}", e),
                    }
                }
            }
        }
        i += 1;
    }
}

// ── Status type (for frontend) ────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Type)]
pub struct LlamaServerStatus {
    pub binary_ready: bool,
    pub model_ready: bool,
    pub server_running: bool,
    pub port: u16,
}
