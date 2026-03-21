#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
use crate::apple_intelligence;
use crate::context_detector::{AppContextCategory, AppTranscriptionContext};
use crate::settings::{AppSettings, APPLE_INTELLIGENCE_PROVIDER_ID};
use ferrous_opencc::{config::BuiltinConfig, OpenCC};
use log::{debug, error, warn};

// ── Field name for structured output JSON schema ─────────────────────────────

pub(crate) const TRANSCRIPTION_FIELD: &str = "transcription";

// ── Text helpers ─────────────────────────────────────────────────────────────

/// Strip invisible Unicode characters that some LLMs may insert.
pub(crate) fn strip_invisible_chars(s: &str) -> String {
    s.replace(['\u{200B}', '\u{200C}', '\u{200D}', '\u{FEFF}'], "")
}

/// Build a system prompt from the user's prompt template.
/// Removes `${output}` placeholder since the transcription is sent as the user message.
pub(crate) fn build_system_prompt(prompt_template: &str) -> String {
    prompt_template.replace("${output}", "").trim().to_string()
}

pub(crate) fn language_code_to_name(code: &str) -> &'static str {
    match code {
        "fr" => "French",
        "en" => "English",
        "es" => "Spanish",
        "de" => "German",
        "it" => "Italian",
        "pt" => "Portuguese",
        "nl" => "Dutch",
        "ru" => "Russian",
        "ja" => "Japanese",
        "ko" => "Korean",
        "zh" | "zh-Hans" => "Chinese (Simplified)",
        "zh-Hant" => "Chinese (Traditional)",
        "ar" => "Arabic",
        "pl" => "Polish",
        "uk" => "Ukrainian",
        _ => "the language used by the speaker",
    }
}

// ── Chunk-assembly cleanup ────────────────────────────────────────────────────

/// Quick LLM pass to fix: boundary word repetitions, wrong-language words, punctuation.
/// Only runs if an LLM provider+model is configured.
pub(crate) async fn cleanup_assembled_transcription(
    settings: &AppSettings,
    text: &str,
) -> Option<String> {
    if text.trim().is_empty() {
        return None;
    }
    let provider = settings.active_post_process_provider().cloned()?;
    let model = settings
        .post_process_models
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();
    if model.trim().is_empty() {
        return None;
    }
    let api_key = settings
        .post_process_api_keys
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();

    let lang_name = if settings.selected_language == "auto" || settings.selected_language.is_empty()
    {
        "the language used by the speaker"
    } else {
        language_code_to_name(&settings.selected_language)
    };

    let system_prompt = format!(
        "You are a speech transcription cleaner. Fix ONLY these issues: \
        (1) Remove exact word or phrase repetitions caused by audio chunk boundaries \
        (e.g. \"bonjour bonjour\" → \"bonjour\"). \
        (2) If any words are in the wrong language, convert them to {}. \
        (3) Fix obvious punctuation errors. \
        Do NOT rephrase, summarize, add, or remove actual content. \
        Return ONLY the cleaned text, nothing else.",
        lang_name
    );

    debug!(
        "Running chunk cleanup pass (provider: {}, model: {})",
        provider.id, model
    );

    match crate::llm_client::send_chat_completion_with_schema(
        &provider,
        api_key,
        &model,
        text.to_string(),
        Some(system_prompt),
        None,
    )
    .await
    {
        Ok(Some(content)) if !content.trim().is_empty() => {
            let cleaned = strip_invisible_chars(&content);
            debug!(
                "Cleanup pass done. Input: {} chars → output: {} chars",
                text.len(),
                cleaned.len()
            );
            Some(cleaned)
        }
        _ => {
            debug!("Cleanup pass returned no result, keeping assembled text");
            None
        }
    }
}

// ── Post-processing ───────────────────────────────────────────────────────────

pub(crate) async fn post_process_transcription(
    settings: &AppSettings,
    transcription: &str,
    app_context: Option<&AppTranscriptionContext>,
) -> Option<String> {
    let provider = match settings.active_post_process_provider().cloned() {
        Some(provider) => provider,
        None => {
            debug!("Post-processing enabled but no provider is selected");
            return None;
        }
    };

    let model = settings
        .post_process_models
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();

    if model.trim().is_empty() {
        debug!(
            "Post-processing skipped because provider '{}' has no model configured",
            provider.id
        );
        return None;
    }

    let selected_prompt_id = match &settings.post_process_selected_prompt_id {
        Some(id) => id.clone(),
        None => {
            debug!("Post-processing skipped because no prompt is selected");
            return None;
        }
    };

    let prompt = match settings
        .post_process_prompts
        .iter()
        .find(|prompt| prompt.id == selected_prompt_id)
    {
        Some(prompt) => prompt.prompt.clone(),
        None => {
            debug!(
                "Post-processing skipped because prompt '{}' was not found",
                selected_prompt_id
            );
            return None;
        }
    };

    if prompt.trim().is_empty() {
        debug!("Post-processing skipped because the selected prompt is empty");
        return None;
    }

    debug!(
        "Starting LLM post-processing with provider '{}' (model: {})",
        provider.id, model
    );

    let api_key = settings
        .post_process_api_keys
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();

    // One-line context hint prepended to the system prompt when available.
    // Code context is already blocked upstream; Browser/Unknown produce no hint.
    let context_hint: Option<&'static str> = app_context.and_then(|ctx| match ctx.category {
        AppContextCategory::Email => {
            Some("Context: email — formal tone, complete punctuation, capitalize names properly.")
        }
        AppContextCategory::Chat => {
            Some("Context: chat message — casual tone, light punctuation, conversational style.")
        }
        AppContextCategory::Notes => {
            Some("Context: notes — preserve markdown structure, bullet points and headings.")
        }
        AppContextCategory::Document => {
            Some("Context: document — formal language, complete sentences, proper paragraphs.")
        }
        _ => None,
    });

    if provider.supports_structured_output {
        debug!("Using structured outputs for provider '{}'", provider.id);

        let base_prompt = build_system_prompt(&prompt);
        let system_prompt = match context_hint {
            Some(hint) => format!("{hint}\n\n{base_prompt}"),
            None => base_prompt,
        };
        let user_content = transcription.to_string();

        // Handle Apple Intelligence separately since it uses native Swift APIs
        if provider.id == APPLE_INTELLIGENCE_PROVIDER_ID {
            #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
            {
                if !apple_intelligence::check_apple_intelligence_availability() {
                    debug!(
                        "Apple Intelligence selected but not currently available on this device"
                    );
                    return None;
                }

                let token_limit = model.trim().parse::<i32>().unwrap_or(0);
                return match apple_intelligence::process_text_with_system_prompt(
                    &system_prompt,
                    &user_content,
                    token_limit,
                ) {
                    Ok(result) => {
                        if result.trim().is_empty() {
                            debug!("Apple Intelligence returned an empty response");
                            None
                        } else {
                            let result = strip_invisible_chars(&result);
                            debug!(
                                "Apple Intelligence post-processing succeeded. Output length: {} chars",
                                result.len()
                            );
                            Some(result)
                        }
                    }
                    Err(err) => {
                        error!("Apple Intelligence post-processing failed: {}", err);
                        None
                    }
                };
            }

            #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
            {
                debug!("Apple Intelligence provider selected on unsupported platform");
                return None;
            }
        }

        // Define JSON schema for transcription output
        let json_schema = serde_json::json!({
            "type": "object",
            "properties": {
                (TRANSCRIPTION_FIELD): {
                    "type": "string",
                    "description": "The cleaned and processed transcription text"
                }
            },
            "required": [TRANSCRIPTION_FIELD],
            "additionalProperties": false
        });

        match crate::llm_client::send_chat_completion_with_schema(
            &provider,
            api_key.clone(),
            &model,
            user_content,
            Some(system_prompt),
            Some(json_schema),
        )
        .await
        {
            Ok(Some(content)) => {
                // Parse the JSON response to extract the transcription field
                match serde_json::from_str::<serde_json::Value>(&content) {
                    Ok(json) => {
                        if let Some(transcription_value) =
                            json.get(TRANSCRIPTION_FIELD).and_then(|t| t.as_str())
                        {
                            let result = strip_invisible_chars(transcription_value);
                            debug!(
                                "Structured output post-processing succeeded for provider '{}'. Output length: {} chars",
                                provider.id,
                                result.len()
                            );
                            return Some(result);
                        } else {
                            warn!(
                                "Structured output response missing '{}' field; using original transcription",
                                TRANSCRIPTION_FIELD
                            );
                            return Some(strip_invisible_chars(transcription));
                        }
                    }
                    Err(e) => {
                        warn!(
                            "Failed to parse structured output JSON: {}. Using original transcription.",
                            e
                        );
                        return Some(strip_invisible_chars(transcription));
                    }
                }
            }
            Ok(None) => {
                error!("LLM API response has no content");
                return None;
            }
            Err(e) => {
                warn!(
                    "Structured output failed for provider '{}': {}. Falling back to legacy mode.",
                    provider.id, e
                );
                // Fall through to legacy mode below
            }
        }
    }

    // Legacy mode: Replace ${output} variable in the prompt with the actual text
    let processed_prompt = prompt.replace("${output}", transcription);
    debug!("Processed prompt length: {} chars", processed_prompt.len());

    match crate::llm_client::send_chat_completion(&provider, api_key, &model, processed_prompt)
        .await
    {
        Ok(Some(content)) => {
            let content = strip_invisible_chars(&content);
            debug!(
                "LLM post-processing succeeded for provider '{}'. Output length: {} chars",
                provider.id,
                content.len()
            );
            Some(content)
        }
        Ok(None) => {
            error!("LLM API response has no content");
            None
        }
        Err(e) => {
            error!(
                "LLM post-processing failed for provider '{}': {}. Falling back to original transcription.",
                provider.id,
                e
            );
            None
        }
    }
}

pub(crate) async fn process_action(
    settings: &AppSettings,
    transcription: &str,
    prompt: &str,
    action_model: Option<&str>,
    action_provider_id: Option<&str>,
) -> Option<String> {
    let provider = if let Some(pid) = action_provider_id.filter(|p| !p.is_empty()) {
        match settings.post_process_provider(pid).cloned() {
            Some(p) => p,
            None => {
                debug!(
                    "Action provider '{}' not found, falling back to active provider",
                    pid
                );
                settings.active_post_process_provider().cloned()?
            }
        }
    } else {
        match settings.active_post_process_provider().cloned() {
            Some(p) => p,
            None => {
                debug!("Action processing skipped: no provider configured");
                return None;
            }
        }
    };

    let model = action_model
        .filter(|m| !m.trim().is_empty())
        .map(|m| m.to_string())
        .or_else(|| settings.post_process_models.get(&provider.id).cloned())
        .unwrap_or_default();

    let full_prompt = if prompt.contains("${output}") {
        prompt.replace("${output}", transcription)
    } else {
        format!("{}\n\n{}", prompt, transcription)
    };

    debug!(
        "Starting action processing with provider '{}', model '{}', prompt length: {}",
        provider.id,
        model,
        full_prompt.len()
    );

    // Handle Apple Intelligence via native Swift APIs
    if provider.id == APPLE_INTELLIGENCE_PROVIDER_ID {
        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        {
            if !apple_intelligence::check_apple_intelligence_availability() {
                debug!("Apple Intelligence selected but not available for action processing");
                return None;
            }
            let token_limit = model.trim().parse::<i32>().unwrap_or(0);
            return match apple_intelligence::process_text_with_system_prompt(
                &full_prompt,
                transcription,
                token_limit,
            ) {
                Ok(result) if !result.trim().is_empty() => {
                    let result = strip_invisible_chars(&result);
                    debug!(
                        "Apple Intelligence action processing succeeded. Output length: {} chars",
                        result.len()
                    );
                    Some(result)
                }
                Ok(_) => {
                    debug!("Apple Intelligence action returned empty result");
                    None
                }
                Err(err) => {
                    error!("Apple Intelligence action processing failed: {}", err);
                    None
                }
            };
        }

        #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
        {
            debug!("Apple Intelligence provider selected on unsupported platform");
            return None;
        }
    }

    if model.trim().is_empty() {
        debug!(
            "Action processing skipped: no model configured for provider '{}'",
            provider.id
        );
        return None;
    }

    let api_key = settings
        .post_process_api_keys
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();

    let system_prompt = "You are a text processing assistant. Output ONLY the final processed text. Do not add any explanation, commentary, preamble, or formatting such as markdown code blocks. Just output the raw result text, nothing else.".to_string();

    match crate::llm_client::send_chat_completion_with_schema(
        &provider,
        api_key,
        &model,
        full_prompt,
        Some(system_prompt),
        None,
    )
    .await
    {
        Ok(Some(content)) if !content.is_empty() => {
            let result = strip_invisible_chars(&content);
            debug!(
                "Action processing succeeded for provider '{}'. Output length: {} chars",
                provider.id,
                result.len()
            );
            Some(result)
        }
        Ok(_) => {
            debug!("Action processing returned empty result");
            None
        }
        Err(e) => {
            error!(
                "Action processing failed for provider '{}': {}",
                provider.id, e
            );
            None
        }
    }
}

pub(crate) async fn maybe_convert_chinese_variant(
    settings: &AppSettings,
    transcription: &str,
) -> Option<String> {
    // Check if language is set to Simplified or Traditional Chinese
    let is_simplified = settings.selected_language == "zh-Hans";
    let is_traditional = settings.selected_language == "zh-Hant";

    if !is_simplified && !is_traditional {
        debug!("selected_language is not Simplified or Traditional Chinese; skipping translation");
        return None;
    }

    debug!(
        "Starting Chinese translation using OpenCC for language: {}",
        settings.selected_language
    );

    // Use OpenCC to convert based on selected language
    let config = if is_simplified {
        // Convert Traditional Chinese to Simplified Chinese
        BuiltinConfig::Tw2sp
    } else {
        // Convert Simplified Chinese to Traditional Chinese
        BuiltinConfig::S2twp
    };

    match OpenCC::from_config(config) {
        Ok(converter) => {
            let converted = converter.convert(transcription);
            debug!(
                "OpenCC translation completed. Input length: {}, Output length: {}",
                transcription.len(),
                converted.len()
            );
            Some(converted)
        }
        Err(e) => {
            error!("Failed to initialize OpenCC converter: {}. Falling back to original transcription.", e);
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_strip_invisible_chars_removes_zero_width() {
        let input = "hel\u{200B}lo\u{200C} \u{200D}world\u{FEFF}";
        assert_eq!(strip_invisible_chars(input), "hello world");
    }

    #[test]
    fn test_strip_invisible_chars_preserves_normal_text() {
        let input = "Hello, World! 123";
        assert_eq!(strip_invisible_chars(input), "Hello, World! 123");
    }

    #[test]
    fn test_build_system_prompt_removes_placeholder() {
        let template = "Fix this: ${output} and return it.";
        let result = build_system_prompt(template);
        assert!(!result.contains("${output}"));
        assert_eq!(result, "Fix this:  and return it.");
    }

    #[test]
    fn test_build_system_prompt_trims_whitespace() {
        let template = "  ${output}  ";
        assert_eq!(build_system_prompt(template), "");
    }

    #[test]
    fn test_language_code_to_name_known_codes() {
        assert_eq!(language_code_to_name("fr"), "French");
        assert_eq!(language_code_to_name("en"), "English");
        assert_eq!(language_code_to_name("zh"), "Chinese (Simplified)");
        assert_eq!(language_code_to_name("zh-Hant"), "Chinese (Traditional)");
    }

    #[test]
    fn test_language_code_to_name_unknown_falls_back() {
        assert_eq!(
            language_code_to_name("xx"),
            "the language used by the speaker"
        );
    }
}
