use log::debug;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Serialize, Type)]
pub struct OllamaStatus {
    pub available: bool,
    pub models: Vec<String>,
}

#[derive(Deserialize)]
struct OllamaTagsResponse {
    models: Vec<OllamaModel>,
}

#[derive(Deserialize)]
struct OllamaModel {
    name: String,
}

/// Check whether Ollama is running locally and return the list of available models.
/// Uses the native Ollama API at http://localhost:11434 rather than the OpenAI-compat
/// endpoint, so no API key is needed and the response is stable across Ollama versions.
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
                    let models: Vec<String> = tags.models.into_iter().map(|m| m.name).collect();
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
