use log::{error, info, warn};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::llm::llm_client;
use crate::platform::agent_overlay;
use crate::settings::get_settings;

const AGENT_SYSTEM_PROMPT: &str = "\
You are a helpful voice AI assistant integrated into a dictation app. \
The user spoke a voice command or question. \
Answer concisely and clearly in plain text without markdown formatting \
unless the user explicitly asks for it.";

#[derive(Serialize, Clone)]
pub struct AgentResponsePayload {
    pub question: String,
    pub response: Option<String>,
    pub error: Option<String>,
}

pub async fn run_agent_mode(app: &AppHandle, _operation_id: u64, question: &str) {
    if question.trim().is_empty() {
        return;
    }

    info!("Agent mode: processing question ({} chars)", question.len());

    let settings = get_settings(app);

    let provider = match settings.active_post_process_provider() {
        Some(p) => p.clone(),
        None => {
            warn!("Agent mode: no LLM provider configured");
            let _ = app.emit(
                "agent-response",
                AgentResponsePayload {
                    question: question.to_string(),
                    response: None,
                    error: Some(
                        "No AI provider configured. Go to Settings → Processing to add one."
                            .to_string(),
                    ),
                },
            );
            agent_overlay::show_agent_overlay(app);
            return;
        }
    };

    let model = settings
        .post_process_models
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();

    if model.trim().is_empty() {
        warn!(
            "Agent mode: no model configured for provider '{}'",
            provider.id
        );
        let _ = app.emit(
            "agent-response",
            AgentResponsePayload {
                question: question.to_string(),
                response: None,
                error: Some(
                    "No AI model selected. Go to Settings → Processing to choose a model."
                        .to_string(),
                ),
            },
        );
        agent_overlay::show_agent_overlay(app);
        return;
    }

    let api_key = settings
        .post_process_api_keys
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();

    // Show overlay immediately in loading state (response=null, error=null)
    let _ = app.emit(
        "agent-response",
        AgentResponsePayload {
            question: question.to_string(),
            response: None,
            error: None,
        },
    );
    agent_overlay::show_agent_overlay(app);

    match llm_client::send_chat_completion_with_schema(
        &provider,
        api_key,
        &model,
        question.to_string(),
        Some(AGENT_SYSTEM_PROMPT.to_string()),
        None,
    )
    .await
    {
        Ok(Some(text)) => {
            info!("Agent mode: response received ({} chars)", text.len());
            let _ = app.emit(
                "agent-response",
                AgentResponsePayload {
                    question: question.to_string(),
                    response: Some(text),
                    error: None,
                },
            );
        }
        Ok(None) => {
            let _ = app.emit(
                "agent-response",
                AgentResponsePayload {
                    question: question.to_string(),
                    response: Some("(No response from AI)".to_string()),
                    error: None,
                },
            );
        }
        Err(e) => {
            error!("Agent mode LLM error: {}", e);
            let _ = app.emit(
                "agent-response",
                AgentResponsePayload {
                    question: question.to_string(),
                    response: None,
                    error: Some(format!("AI error: {}", e)),
                },
            );
        }
    }
}
