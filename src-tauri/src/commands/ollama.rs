use log::debug;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::PathBuf;
use std::process::Stdio;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Serialize, Type)]
pub struct OllamaModelInfo {
    pub name: String,
    pub size_gb: f32,
}

#[derive(Debug, Serialize, Type)]
pub struct OllamaStatus {
    pub available: bool,
    pub models: Vec<OllamaModelInfo>,
}

#[derive(Deserialize)]
struct OllamaTagsResponse {
    models: Vec<OllamaModelRaw>,
}

#[derive(Deserialize)]
struct OllamaModelRaw {
    name: String,
    size: Option<u64>,
}

fn find_ollama_exe() -> PathBuf {
    // Windows: check common install location if not in PATH
    #[cfg(target_os = "windows")]
    {
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            let candidate = PathBuf::from(local)
                .join("Programs")
                .join("Ollama")
                .join("ollama.exe");
            if candidate.exists() {
                return candidate;
            }
        }
    }
    PathBuf::from("ollama")
}

#[specta::specta]
#[tauri::command]
pub async fn check_ollama_status() -> Result<OllamaStatus, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    debug!("Checking Ollama availability at http://localhost:11434/api/tags");

    match client.get("http://localhost:11434/api/tags").send().await {
        Ok(response) if response.status().is_success() => {
            match response.json::<OllamaTagsResponse>().await {
                Ok(tags) => {
                    let models: Vec<OllamaModelInfo> = tags
                        .models
                        .into_iter()
                        .map(|m| OllamaModelInfo {
                            name: m.name,
                            size_gb: m.size.unwrap_or(0) as f32 / 1_073_741_824.0,
                        })
                        .collect();
                    debug!("Ollama available, {} models found", models.len());
                    Ok(OllamaStatus {
                        available: true,
                        models,
                    })
                }
                Err(e) => {
                    debug!("Ollama responded but JSON parse failed: {}", e);
                    Ok(OllamaStatus {
                        available: true,
                        models: Vec::new(),
                    })
                }
            }
        }
        Ok(response) => {
            debug!("Ollama responded with status {}", response.status());
            Ok(OllamaStatus {
                available: false,
                models: Vec::new(),
            })
        }
        Err(e) => {
            debug!("Ollama not reachable: {}", e);
            Ok(OllamaStatus {
                available: false,
                models: Vec::new(),
            })
        }
    }
}

/// Spawn `ollama serve` detached. Searches common install paths on Windows
/// in case ollama is not in PATH.
#[specta::specta]
#[tauri::command]
pub async fn start_ollama_serve() -> Result<(), String> {
    let exe = find_ollama_exe();
    debug!("Attempting to start ollama serve via {:?}", exe);
    std::process::Command::new(&exe)
        .arg("serve")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Ollama not found (tried {:?}): {}", exe, e))?;
    Ok(())
}

/// Pull an Ollama model, emitting `ollama-pull-progress` events so the
/// frontend can show a live progress bar.
/// Emits `ollama-pull-done` when complete or `ollama-pull-error` on failure.
#[specta::specta]
#[tauri::command]
pub async fn pull_ollama_model(app: AppHandle, model: String) -> Result<(), String> {
    use std::io::{BufRead, BufReader};

    let exe = find_ollama_exe();
    debug!("Pulling Ollama model {} via {:?}", model, exe);
    let _ = app.emit("ollama-pull-progress", serde_json::json!({ "pct": 0, "label": format!("Démarrage du téléchargement de {}…", model) }));

    let mut child = std::process::Command::new(&exe)
        .args(["pull", &model])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Ollama not found (tried {:?}): {}", exe, e))?;

    if let Some(stdout) = child.stdout.take() {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            debug!("ollama pull: {}", line);
            // Parse "pulling manifest", "pulling <hash> XX%" lines
            let pct = parse_pull_pct(&line);
            let _ = app.emit(
                "ollama-pull-progress",
                serde_json::json!({ "pct": pct, "label": line }),
            );
        }
    }

    let status = child
        .wait()
        .map_err(|e| format!("Failed to wait for ollama pull: {}", e))?;

    if status.success() {
        debug!("ollama pull {} completed", model);
        let _ = app.emit("ollama-pull-done", &model);
        Ok(())
    } else {
        let msg = format!("ollama pull {} failed (exit {:?})", model, status.code());
        let _ = app.emit("ollama-pull-error", &msg);
        Err(msg)
    }
}

/// Pre-load a model into Ollama's memory so the first real request is instant.
/// Sends a tiny dummy chat completion with `keep_alive: -1` so the model
/// stays loaded indefinitely after warmup.
/// Fire-and-forget from the frontend — errors are silently ignored.
#[specta::specta]
#[tauri::command]
pub async fn warmup_ollama_model(model: String) -> Result<(), String> {
    debug!("[ollama] warming up model: {}", model);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("client build failed: {e}"))?;

    let body = serde_json::json!({
        "model": model,
        "messages": [{ "role": "user", "content": "hi" }],
        "max_tokens": 1,
        "keep_alive": 1800,
    });

    let _ = client
        .post("http://localhost:11434/v1/chat/completions")
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await;

    debug!("[ollama] warmup done for {}", model);
    Ok(())
}

fn parse_pull_pct(line: &str) -> u8 {
    // Ollama outputs lines like "pulling sha256:... 45% ▕████   ▏ 450 MB/1.0 GB"
    if let Some(pct_pos) = line.find('%') {
        let before = &line[..pct_pos];
        if let Some(num_start) = before.rfind(|c: char| c == ' ' || c == '\t') {
            if let Ok(n) = before[num_start..].trim().parse::<u8>() {
                return n;
            }
        }
    }
    0
}
