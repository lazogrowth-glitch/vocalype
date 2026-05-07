use anyhow::Result;
use log::debug;
use reqwest::header::{HeaderMap, HeaderValue, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use std::time::Duration;

const GEMINI_API_BASE: &str = "https://generativelanguage.googleapis.com/v1beta/models";
/// Gemini audio uploads can be larger than typical text prompts; allow up to 60 s.
const GEMINI_REQUEST_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Serialize)]
struct Part {
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
}

#[derive(Serialize)]
struct Content {
    parts: Vec<Part>,
}

#[derive(Serialize)]
struct SystemInstruction {
    parts: Vec<Part>,
}

#[derive(Serialize)]
struct GenerateContentRequest {
    contents: Vec<Content>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "systemInstruction")]
    system_instruction: Option<SystemInstruction>,
}

#[derive(Deserialize)]
struct GenerateContentResponse {
    candidates: Option<Vec<Candidate>>,
}

#[derive(Deserialize)]
struct Candidate {
    content: Option<CandidateContent>,
}

#[derive(Deserialize)]
struct CandidateContent {
    parts: Option<Vec<ResponsePart>>,
}

#[derive(Deserialize)]
struct ResponsePart {
    text: Option<String>,
}

pub async fn generate_text(
    api_key: &str,
    model: &str,
    system_prompt: &str,
    user_text: &str,
) -> Result<String> {
    debug!(
        "Gemini generate_text: model={}, prompt_len={}, text_len={}",
        model,
        system_prompt.len(),
        user_text.len()
    );

    let url = format!("{}/{}:generateContent", GEMINI_API_BASE, model);

    let request = GenerateContentRequest {
        contents: vec![Content {
            parts: vec![Part {
                text: Some(user_text.to_string()),
            }],
        }],
        system_instruction: Some(SystemInstruction {
            parts: vec![Part {
                text: Some(system_prompt.to_string()),
            }],
        }),
    };

    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert(
        "x-goog-api-key",
        HeaderValue::from_str(api_key).map_err(|e| anyhow::anyhow!("Invalid API key: {}", e))?,
    );

    let client = reqwest::Client::builder()
        .timeout(GEMINI_REQUEST_TIMEOUT)
        .build()
        .unwrap_or_default();
    let response = client
        .post(&url)
        .headers(headers)
        .json(&request)
        .send()
        .await
        .map_err(|e| anyhow::anyhow!("Gemini text generation request failed: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Failed to read error response".to_string());
        return Err(anyhow::anyhow!(
            "Gemini API error ({}): {}",
            status,
            error_text
        ));
    }

    let resp: GenerateContentResponse = response
        .json()
        .await
        .map_err(|e| anyhow::anyhow!("Failed to parse Gemini response: {}", e))?;

    let text = resp
        .candidates
        .and_then(|c| c.into_iter().next())
        .and_then(|c| c.content)
        .and_then(|c| c.parts)
        .and_then(|p| p.into_iter().next())
        .and_then(|p| p.text)
        .ok_or_else(|| {
            anyhow::anyhow!(
                "Gemini text generation response missing text content (empty candidates or parts)"
            )
        })?;

    debug!("Gemini text generation result length: {}", text.len());
    Ok(text.trim().to_string())
}
