#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
use crate::apple_intelligence;
use crate::context_detector::{AppContextCategory, AppTranscriptionContext};
use crate::settings::{AppSettings, APPLE_INTELLIGENCE_PROVIDER_ID};
use ferrous_opencc::{config::BuiltinConfig, OpenCC};
use log::{debug, error, warn};

// ── Field name for structured output JSON schema ─────────────────────────────

pub(crate) const TRANSCRIPTION_FIELD: &str = "transcription";

#[derive(Debug, Clone, Default)]
pub(crate) struct ChunkCleanupStrategy {
    pub multi_chunk: bool,
    pub long_form: bool,
    pub preserve_self_corrections: bool,
    pub preserve_filler_structure: bool,
    pub conservative_punctuation: bool,
    pub selected_language_hint: Option<String>,
}

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

fn build_chunk_cleanup_system_prompt(
    strategy: &ChunkCleanupStrategy,
    selected_language: &str,
) -> String {
    let lang_name = if selected_language == "auto" || selected_language.is_empty() {
        "the language used by the speaker".to_string()
    } else {
        language_code_to_name(selected_language).to_string()
    };

    let mut parts = vec![
        format!("Clean this {lang_name} speech transcript. Fix ONLY:"),
        "duplicate words from chunk boundaries, wrong-language words, punctuation.".to_string(),
    ];

    if strategy.multi_chunk {
        parts.push("Multi-chunk: prioritize boundary joins.".to_string());
    }
    if strategy.long_form {
        parts.push("Long-form: preserve all content, do not shorten.".to_string());
    }
    if strategy.preserve_self_corrections {
        parts.push("Keep self-corrections (\"no wait\", \"I mean\").".to_string());
    }
    if strategy.conservative_punctuation {
        parts.push("Minimal punctuation changes only.".to_string());
    } else {
        parts.push("Restore natural punctuation.".to_string());
    }
    if let Some(language_hint) = &strategy.selected_language_hint {
        parts.push(format!("Output language: {language_hint}."));
    }

    parts.push("Return ONLY the cleaned text, nothing else.".to_string());
    parts.join(" ")
}

// ── Chunk-assembly cleanup ────────────────────────────────────────────────────

/// Quick LLM pass to fix: boundary word repetitions, wrong-language words, punctuation.
/// Only runs if an LLM provider+model is configured.
pub(crate) async fn cleanup_assembled_transcription_with_strategy(
    settings: &AppSettings,
    text: &str,
    strategy: &ChunkCleanupStrategy,
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

    let _system_prompt = format!(
        "You are a speech transcription cleaner. Fix ONLY these issues: \
        (1) Remove exact word or phrase repetitions caused by audio chunk boundaries \
        (e.g. \"bonjour bonjour\" → \"bonjour\"). \
        (2) If any words are in the wrong language, convert them to {}. \
        (3) Fix obvious punctuation errors. \
        Do NOT rephrase, summarize, add, or remove actual content. \
        Return ONLY the cleaned text, nothing else.",
        lang_name
    );

    let system_prompt = build_chunk_cleanup_system_prompt(strategy, &settings.selected_language);
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

pub(crate) async fn cleanup_assembled_transcription(
    settings: &AppSettings,
    text: &str,
) -> Option<String> {
    cleanup_assembled_transcription_with_strategy(settings, text, &ChunkCleanupStrategy::default())
        .await
}

pub(crate) async fn post_process_transcription(
    settings: &AppSettings,
    transcription: &str,
    app_context: Option<&AppTranscriptionContext>,
    // When language drift was detected: target language name (e.g. "French").
    // Injected as a hard instruction at the top of the system prompt.
    language_correction: Option<&str>,
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

    // For vocalype-cloud, use the user's JWT from keyring as the Bearer token.
    // The backend validates it and proxies to Cerebras.
    let api_key = if provider.id == "vocalype-cloud" {
        match crate::security::secret_store::get_auth_token() {
            Ok(Some(token)) => token,
            _ => {
                debug!("Vocalype Cloud post-processing skipped: no auth token in keyring");
                return None;
            }
        }
    } else {
        settings
            .post_process_api_keys
            .get(&provider.id)
            .cloned()
            .unwrap_or_default()
    };

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

    // One-line context hint prepended to the system prompt when available.
    // Code context is already blocked upstream; Browser/Unknown produce no hint.
    let context_hint: Option<&'static str> = app_context.and_then(|ctx| match ctx.category {
        AppContextCategory::Email => {
            Some("Context: email — formal tone, complete punctuation, capitalize names properly. Structure the email with proper line breaks: salutation on its own line followed by a blank line, body paragraphs separated by blank lines, closing phrase on its own line.")
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

    // Language-drift correction instruction — prepended with highest priority so the
    // LLM fixes wrong-language segments before applying any other transformation.
    let drift_instruction: Option<String> = language_correction.map(|lang| {
        format!(
            "CRITICAL: The user speaks {lang}. Some words or phrases in the input \
             may be in the wrong language (e.g. English instead of {lang}). \
             Translate those portions back to {lang} before doing anything else.",
        )
    });

    if provider.supports_structured_output {
        debug!("Using structured outputs for provider '{}'", provider.id);

        let base_prompt = build_system_prompt(&prompt);
        let system_prompt = match (drift_instruction.as_deref(), context_hint) {
            (Some(drift), Some(hint)) => format!("{drift}\n\n{hint}\n\n{base_prompt}"),
            (Some(drift), None) => format!("{drift}\n\n{base_prompt}"),
            (None, Some(hint)) => format!("{hint}\n\n{base_prompt}"),
            (None, None) => base_prompt,
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

    // Legacy mode: isolate instructions from user data to prevent prompt injection.
    // The transcription is sent as a separate user message; the prompt template
    // becomes the system message so injected text cannot override instructions.
    let (system_msg, user_content) = if prompt.contains("${output}") {
        let instruction = prompt.replace("${output}", "");
        let instruction = instruction.trim();
        if instruction.is_empty() {
            (drift_instruction, transcription.to_string())
        } else {
            let full = match drift_instruction.as_deref() {
                Some(drift) => format!("{drift}\n\n{instruction}"),
                None => instruction.to_string(),
            };
            (Some(full), transcription.to_string())
        }
    } else {
        let full = match drift_instruction.as_deref() {
            Some(drift) => format!("{drift}\n\n{}", prompt),
            None => prompt.to_string(),
        };
        (Some(full), transcription.to_string())
    };
    debug!(
        "Processed prompt — system: {} chars, user: {} chars",
        system_msg.as_deref().map_or(0, |s| s.len()),
        user_content.len()
    );

    match crate::llm_client::send_chat_completion_with_schema(
        &provider,
        api_key,
        &model,
        user_content,
        system_msg,
        None,
    )
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

    // Separate instructions from data to prevent prompt injection:
    // instructions go to the system role, transcription to the user role.
    let (action_system, action_user) = if prompt.contains("${output}") {
        let instruction = prompt.replace("${output}", "");
        let instruction = instruction.trim();
        if instruction.is_empty() {
            (None, transcription.to_string())
        } else {
            (Some(instruction.to_string()), transcription.to_string())
        }
    } else {
        (Some(prompt.to_string()), transcription.to_string())
    };

    debug!(
        "Starting action processing with provider '{}', model '{}', system: {} chars, user: {} chars",
        provider.id,
        model,
        action_system.as_deref().map_or(0, |s| s.len()),
        action_user.len()
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
            let apple_instruction = action_system.as_deref().unwrap_or("");
            return match apple_intelligence::process_text_with_system_prompt(
                apple_instruction,
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

    // Base system prompt enforces output format; user's action instruction is appended.
    let base_system = "You are a text processing assistant. Output ONLY the final processed text. Do not add any explanation, commentary, preamble, or formatting such as markdown code blocks. Just output the raw result text, nothing else.";
    let system_prompt = match &action_system {
        Some(instruction) => format!("{}\n\n{}", base_system, instruction),
        None => base_system.to_string(),
    };

    match crate::llm_client::send_chat_completion_with_schema(
        &provider,
        api_key,
        &model,
        action_user,
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

/// System prompt for Voice-to-Code mode. Instructs the LLM to return only raw
/// code — no markdown fences, no explanation — ready to be pasted into an editor.
const VOICE_TO_CODE_SYSTEM_PROMPT: &str = "\
You are an expert senior full-stack developer. \
The user dictates naturally in French or English. \
Transform the phrase into clean, well-indented, modern, professional code.\n\
\n\
Rules:\n\
- Automatically detect the programming language (TypeScript, Python, Rust, JavaScript, etc.) \
from context clues in the request.\n\
- Follow best practices for the detected language.\n\
- Add comments only when they genuinely help understanding.\n\
- Return ONLY the raw code block — no explanation before or after, no markdown fences. \
The output will be pasted directly into the editor.\n\
- Preserve proper indentation (2-space or 4-space as appropriate for the language).\n\
- If the request mentions refactoring or modifying existing code, adapt to the surrounding style.\
";

/// Send a voice dictation to a local Ollama model and return generated code.
/// Falls back silently (returns `None`) if Ollama is unreachable or not configured.
pub(crate) async fn voice_to_code_completion(
    settings: &AppSettings,
    transcription: &str,
) -> Option<String> {
    // Use the active post-process provider so no extra setup is needed.
    // voice_to_code_model is an optional override; falls back to the
    // provider's already-configured model.
    let provider = settings.active_post_process_provider().cloned()?;

    let model = {
        let override_model = settings.voice_to_code_model.trim().to_string();
        if override_model.is_empty() {
            settings
                .post_process_models
                .get(&provider.id)
                .cloned()
                .unwrap_or_default()
        } else {
            override_model
        }
    };

    if model.trim().is_empty() {
        debug!(
            "Voice-to-Code skipped: no model configured for provider '{}'",
            provider.id
        );
        return None;
    }

    let api_key = settings
        .post_process_api_keys
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();

    debug!(
        "Voice-to-Code: sending {} chars to {} / {}",
        transcription.len(),
        provider.id,
        model
    );

    match crate::llm_client::send_chat_completion_with_schema(
        &provider,
        api_key,
        &model,
        transcription.to_string(),
        Some(VOICE_TO_CODE_SYSTEM_PROMPT.to_string()),
        None,
    )
    .await
    {
        Ok(Some(content)) if !content.trim().is_empty() => {
            let code = strip_invisible_chars(&content);
            debug!("Voice-to-Code completed. Output: {} chars", code.len());
            Some(code)
        }
        Ok(_) => {
            debug!("Voice-to-Code: LLM returned empty response");
            None
        }
        Err(e) => {
            debug!("Voice-to-Code failed ({}), using raw transcription", e);
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
