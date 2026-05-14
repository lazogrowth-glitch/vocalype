use crate::settings::PostProcessProvider;
use log::debug;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE, REFERER, USER_AGENT};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

/// Maximum time to wait for any LLM HTTP response.
/// Long-form audio prompts can be large, but 30 s is enough for typical
/// dictation post-processing payloads (~2 KB).  Increase if you see
/// spurious timeouts with very long recordings.
const LLM_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Serialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Debug, Serialize)]
struct JsonSchema {
    name: String,
    strict: bool,
    schema: Value,
}

#[derive(Debug, Serialize)]
struct ResponseFormat {
    #[serde(rename = "type")]
    format_type: String,
    json_schema: JsonSchema,
}

#[derive(Debug, Serialize)]
struct ChatCompletionRequest {
    model: String,
    messages: Vec<ChatMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    response_format: Option<ResponseFormat>,
    /// Ollama-specific: -1 = keep model loaded indefinitely.
    /// Ignored by other providers (field is unknown → silently dropped).
    #[serde(skip_serializing_if = "Option::is_none")]
    keep_alive: Option<i64>,
    /// Cap generation length. For transcription cleanup the output is never
    /// longer than the input — 300 tokens covers even long dictations.
    /// Without this the model runs until EOS, which can be 3-5× the needed
    /// tokens, adding 1-3 s of unnecessary latency.
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
    /// Greedy decoding (temperature=0): deterministic output, fastest path
    /// through the sampler.  Post-processing is a deterministic editing task —
    /// there is no benefit to stochastic sampling here.
    temperature: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    reasoning_format: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    include_reasoning: Option<bool>,
    /// Stop generation at Qwen3 end-of-turn token — prevents the model from
    /// generating extra content after the answer, cutting latency on local providers.
    #[serde(skip_serializing_if = "Option::is_none")]
    stop: Option<Vec<&'static str>>,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<ChatChoice>,
}

#[derive(Debug, Deserialize)]
struct ChatChoice {
    message: ChatMessageResponse,
}

#[derive(Debug, Deserialize)]
struct ChatMessageResponse {
    content: Option<String>,
}

fn model_supports_hidden_reasoning(model: &str) -> bool {
    model.starts_with("qwen/")
}

fn model_supports_include_reasoning(model: &str) -> bool {
    model.starts_with("openai/gpt-oss-")
}

fn strip_reasoning_artifacts(content: &str) -> String {
    let mut cleaned = content.trim().to_string();

    loop {
        let Some(start) = cleaned.find("<think>") else {
            break;
        };
        let Some(end_relative) = cleaned[start..].find("</think>") else {
            cleaned.truncate(start);
            break;
        };
        let end = start + end_relative + "</think>".len();
        cleaned.replace_range(start..end, "");
    }

    cleaned.trim().to_string()
}

/// Build headers for API requests based on provider type
fn build_headers(provider: &PostProcessProvider, api_key: &str) -> Result<HeaderMap, String> {
    let mut headers = HeaderMap::new();

    // Common headers
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert(REFERER, HeaderValue::from_static("https://vocalype.com"));
    headers.insert(
        USER_AGENT,
        HeaderValue::from_static("Vocalype/1.0 (+https://vocalype.com)"),
    );
    headers.insert("X-Title", HeaderValue::from_static("Vocalype"));

    // Provider-specific auth headers
    if !api_key.is_empty() {
        if provider.id == "anthropic" {
            headers.insert(
                "x-api-key",
                HeaderValue::from_str(api_key)
                    .map_err(|e| format!("Invalid API key header value: {}", e))?,
            );
            headers.insert("anthropic-version", HeaderValue::from_static("2023-06-01"));
        } else {
            headers.insert(
                AUTHORIZATION,
                HeaderValue::from_str(&format!("Bearer {}", api_key))
                    .map_err(|e| format!("Invalid authorization header value: {}", e))?,
            );
        }
    }

    Ok(headers)
}

/// Create an HTTP client with provider-specific headers and a request timeout.
fn create_client(provider: &PostProcessProvider, api_key: &str) -> Result<reqwest::Client, String> {
    let headers = build_headers(provider, api_key)?;
    reqwest::Client::builder()
        .default_headers(headers)
        .timeout(LLM_REQUEST_TIMEOUT)
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))
}

/// Send a chat completion request to an OpenAI-compatible API
/// Returns Ok(Some(content)) on success, Ok(None) if response has no content,
/// or Err on actual errors (HTTP, parsing, etc.)
pub async fn send_chat_completion(
    provider: &PostProcessProvider,
    api_key: String,
    model: &str,
    prompt: String,
) -> Result<Option<String>, String> {
    send_chat_completion_with_schema(provider, api_key, model, prompt, None, None).await
}

/// Send a chat completion request with structured output support
/// When json_schema is provided, uses structured outputs mode
/// system_prompt is used as the system message when provided
pub async fn send_chat_completion_with_schema(
    provider: &PostProcessProvider,
    api_key: String,
    model: &str,
    user_content: String,
    system_prompt: Option<String>,
    json_schema: Option<Value>,
) -> Result<Option<String>, String> {
    // Route Gemini requests to the sibling gemini_client module
    if provider.id == "gemini" {
        let sys = system_prompt.unwrap_or_default();
        match super::gemini_client::generate_text(&api_key, model, &sys, &user_content).await {
            Ok(text) if !text.is_empty() => return Ok(Some(text)),
            Ok(_) => return Ok(None),
            Err(e) => return Err(format!("Gemini API error: {}", e)),
        }
    }

    let base_url = provider.base_url.trim_end_matches('/');
    let url = format!("{}/chat/completions", base_url);

    debug!("Sending chat completion request to: {}", url);

    let client = create_client(provider, &api_key)?;

    // Build messages vector
    let mut messages = Vec::new();

    // Add system prompt if provided
    if let Some(system) = system_prompt {
        messages.push(ChatMessage {
            role: "system".to_string(),
            content: system,
        });
    }

    // Add user message
    messages.push(ChatMessage {
        role: "user".to_string(),
        content: user_content,
    });

    // Build response_format if schema is provided
    let response_format = json_schema.map(|schema| ResponseFormat {
        format_type: "json_schema".to_string(),
        json_schema: JsonSchema {
            name: "transcription_output".to_string(),
            strict: true,
            schema,
        },
    });

    let request_body = ChatCompletionRequest {
        model: model.to_string(),
        messages,
        response_format,
        // Keep model hot for 5 min after last use — matches ModelUnloadTimeout::Min5.
        keep_alive: if provider.id == "ollama" || provider.id == "vocalype-llm" {
            Some(300)
        } else {
            None
        },
        // 500 tokens = ~375 words — covers structured email output (greeting +
        // multi-paragraph body + closing) without unnecessary generation overhead.
        max_tokens: Some(500),
        // Greedy decoding: fastest + deterministic for editing tasks.
        temperature: 0.0,
        reasoning_format: if model_supports_hidden_reasoning(model) {
            Some("hidden")
        } else {
            None
        },
        include_reasoning: if model_supports_include_reasoning(model) {
            Some(false)
        } else {
            None
        },
        // Qwen3 end-of-turn stop token — halts generation immediately after the
        // answer so llama-server doesn't pad with extra tokens.
        stop: if provider.id == "vocalype-llm" || provider.id == "ollama" {
            Some(vec!["<|im_end|>"])
        } else {
            None
        },
    };

    let response = client
        .post(&url)
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Failed to read error response".to_string());
        return Err(format!(
            "API request failed with status {}: {}",
            status, error_text
        ));
    }

    let completion: ChatCompletionResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse API response: {}", e))?;

    Ok(completion.choices.first().and_then(|choice| {
        choice
            .message
            .content
            .as_deref()
            .map(strip_reasoning_artifacts)
            .filter(|content| !content.is_empty())
    }))
}

/// Fetch available models from an OpenAI-compatible API
/// Returns a list of model IDs
pub async fn fetch_models(
    provider: &PostProcessProvider,
    api_key: String,
) -> Result<Vec<String>, String> {
    // Gemini uses a different models API — handled in the sibling module
    if provider.id == "gemini" {
        return fetch_gemini_models(&api_key).await;
    }

    let base_url = provider.base_url.trim_end_matches('/');
    let url = format!("{}/models", base_url);

    debug!("Fetching models from: {}", url);

    let client = create_client(provider, &api_key)?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch models: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!(
            "Model list request failed ({}): {}",
            status, error_text
        ));
    }

    let parsed: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    let mut models = Vec::new();

    // Handle OpenAI format: { data: [ { id: "..." }, ... ] }
    if let Some(data) = parsed.get("data").and_then(|d| d.as_array()) {
        for entry in data {
            if let Some(id) = entry.get("id").and_then(|i| i.as_str()) {
                models.push(id.to_string());
            } else if let Some(name) = entry.get("name").and_then(|n| n.as_str()) {
                models.push(name.to_string());
            }
        }
    }
    // Handle array format: [ "model1", "model2", ... ]
    else if let Some(array) = parsed.as_array() {
        for entry in array {
            if let Some(model) = entry.as_str() {
                models.push(model.to_string());
            }
        }
    }

    Ok(models)
}

async fn fetch_gemini_models(api_key: &str) -> Result<Vec<String>, String> {
    let url = "https://generativelanguage.googleapis.com/v1beta/models";

    let client = reqwest::Client::new();
    let response = client
        .get(url)
        .header("x-goog-api-key", api_key)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch Gemini models: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!(
            "Gemini model list request failed ({}): {}",
            status, error_text
        ));
    }

    let parsed: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Gemini response: {}", e))?;

    let mut models = Vec::new();
    if let Some(data) = parsed.get("models").and_then(|d| d.as_array()) {
        for entry in data {
            if let Some(name) = entry.get("name").and_then(|n| n.as_str()) {
                // Gemini returns "models/gemini-2.5-flash" - strip the prefix
                let model_id = name.strip_prefix("models/").unwrap_or(name);
                if model_id.contains("gemini") {
                    models.push(model_id.to_string());
                }
            }
        }
    }

    Ok(models)
}
