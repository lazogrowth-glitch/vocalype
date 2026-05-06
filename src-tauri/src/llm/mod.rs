//! LLM client abstractions.
//!
//! ## Provider routing
//!
//! `llm_client::send_chat_completion` is the single entry point for all text
//! post-processing. Internally it routes Gemini requests to `gemini_client`
//! and all OpenAI-compatible/Anthropic requests through a shared HTTP path.
//!
//! ## Adding a new provider
//!
//! Implement [`LlmTextProvider`] and add a branch in
//! `llm_client::send_chat_completion_with_schema`.
#![allow(dead_code)]

pub mod gemini_client;
pub mod llama_server;
pub mod llm_client;
pub mod prompt_builder;

use crate::settings::PostProcessProvider;
use anyhow::Result;
use std::future::Future;
use std::pin::Pin;

/// Minimal trait for text-completion LLM providers used in post-processing.
///
/// Implementations: [`GeminiProvider`] (via `gemini_client`) and the inline
/// OpenAI-compatible path in `llm_client`. Future: Claude, Mistral, etc.
pub trait LlmTextProvider: Send + Sync {
    /// Provider identifier (matches `PostProcessProvider::id`).
    fn provider_id(&self) -> &str;

    /// Complete a prompt, returning the generated text.
    fn complete<'a>(
        &'a self,
        system_prompt: Option<&'a str>,
        user_content: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<Option<String>>> + Send + 'a>>;
}

/// Thin wrapper around `gemini_client` implementing [`LlmTextProvider`].
pub struct GeminiProvider {
    pub api_key: String,
    pub model: String,
}

impl LlmTextProvider for GeminiProvider {
    fn provider_id(&self) -> &str {
        "gemini"
    }

    fn complete<'a>(
        &'a self,
        system_prompt: Option<&'a str>,
        user_content: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<Option<String>>> + Send + 'a>> {
        Box::pin(async move {
            let sys = system_prompt.unwrap_or_default();
            match gemini_client::generate_text(&self.api_key, &self.model, sys, user_content).await
            {
                Ok(text) if !text.is_empty() => Ok(Some(text)),
                Ok(_) => Ok(None),
                Err(e) => Err(anyhow::anyhow!("Gemini API error: {}", e)),
            }
        })
    }
}

/// Factory: create the right provider from settings.
/// Use this instead of branching on `provider.id` in call sites.
///
/// `model` is the currently selected model ID for this provider (stored
/// separately in `AppSettings::post_process_model` or equivalent).
pub fn text_provider_for(
    provider: &PostProcessProvider,
    api_key: String,
    model: String,
) -> Option<Box<dyn LlmTextProvider>> {
    if provider.id == "gemini" {
        Some(Box::new(GeminiProvider { api_key, model }))
    } else {
        // OpenAI-compatible and Anthropic are handled directly in llm_client
        None
    }
}
