use super::profiler::PipelineProfiler;
use crate::context_detector::{AppContextCategory, AppTranscriptionContext};
use crate::post_processing::{
    maybe_convert_chinese_variant, post_process_transcription, process_action,
    voice_to_code_completion,
};
use crate::utils::show_processing_overlay;
use crate::vocabulary_store::VocabularyStoreState;
use crate::voice_profile::VoiceProfileState;
use crate::TranscriptionCoordinator;
use log::debug;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::{AppHandle, Emitter, Manager};

pub(super) struct PostProcessOutcome {
    pub final_text: String,
    pub post_processed_text: Option<String>,
    pub post_process_prompt: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum PostProcessMode {
    SnippetOnly,
    VoiceToCode,
    SkipForCodeContext,
    SelectedAction,
    StandardPrompt,
    None,
}

pub(super) fn decide_post_process_mode(
    snippet_matched: bool,
    is_code_context: bool,
    voice_to_code_enabled: bool,
    has_selected_action: bool,
    post_process: bool,
) -> PostProcessMode {
    if snippet_matched {
        PostProcessMode::SnippetOnly
    } else if is_code_context && voice_to_code_enabled {
        PostProcessMode::VoiceToCode
    } else if has_selected_action {
        PostProcessMode::SelectedAction
    } else if post_process {
        PostProcessMode::StandardPrompt
    } else if is_code_context {
        PostProcessMode::SkipForCodeContext
    } else {
        PostProcessMode::None
    }
}

pub(super) async fn process_transcription_text(
    app: &AppHandle,
    operation_id: u64,
    transcription: &str,
    active_app_context: Option<&AppTranscriptionContext>,
    selected_action_key: Option<u8>,
    post_process: bool,
    // Language name (e.g. "French") when drift was detected — passed to LLM.
    language_correction: Option<String>,
    samples: &[f32],
    profiler: &Arc<Mutex<PipelineProfiler>>,
) -> PostProcessOutcome {
    let settings = crate::settings::get_settings(app);
    let mut final_text = transcription.to_string();
    let mut post_processed_text: Option<String> = None;
    let mut post_process_prompt: Option<String> = None;

    let chinese_convert_started = Instant::now();
    if let Some(converted) = maybe_convert_chinese_variant(&settings, transcription).await {
        final_text = converted;
    }
    if let Ok(mut p) = profiler.lock() {
        p.push_step_since(
            "post_convert_chinese_variant",
            chinese_convert_started,
            Some(format!("changed={}", final_text != transcription)),
        );
    }

    let filler_started = Instant::now();
    let before_filler = final_text.clone();
    final_text = crate::filler::clean_transcript(&final_text);
    if let Ok(mut p) = profiler.lock() {
        p.push_step_since(
            "filler_removal",
            filler_started,
            Some(format!("changed={}", final_text != before_filler)),
        );
    }

    let punct_started = Instant::now();
    let before_punct = final_text.clone();
    let punct_category = active_app_context
        .as_ref()
        .map(|ctx| ctx.category)
        .unwrap_or(AppContextCategory::Unknown);
    final_text = crate::punctuation::fix_punctuation(&final_text, punct_category);
    if let Ok(mut p) = profiler.lock() {
        p.push_step_since(
            "punctuation_fix",
            punct_started,
            Some(format!("changed={}", final_text != before_punct)),
        );
    }

    let dict_started = Instant::now();
    let before_dict = final_text.clone();
    if let Some(dict) = app.try_state::<std::sync::Arc<crate::dictionary::DictionaryManager>>() {
        let patterns = dict.compiled_entries();
        final_text = crate::dictionary::apply_dictionary(&final_text, &patterns);
    }
    if let Ok(mut p) = profiler.lock() {
        p.push_step_since(
            "dictionary_replacement",
            dict_started,
            Some(format!("changed={}", final_text != before_dict)),
        );
    }

    // Code-dictation conversion: spoken symbols → code syntax (Code context only).
    let is_code_ctx_early = active_app_context
        .as_ref()
        .map(|ctx| ctx.category.skip_post_processing())
        .unwrap_or(false);
    if is_code_ctx_early {
        let code_dict_started = Instant::now();
        let before_code = final_text.clone();
        let code_language = active_app_context
            .as_ref()
            .and_then(|ctx| ctx.code_language);
        final_text = crate::code_dictation::apply_code_dictation(&final_text, code_language);
        if let Ok(mut p) = profiler.lock() {
            p.push_step_since(
                "code_dictation",
                code_dict_started,
                Some(format!("changed={}", final_text != before_code)),
            );
        }
    }

    let snippet_matched = if let Some(expanded) =
        crate::settings::apply_voice_snippets(&final_text, &settings.voice_snippets)
    {
        debug!(
            "Voice snippet matched — expanding to {} chars",
            expanded.len()
        );
        final_text = expanded;
        post_processed_text = Some(final_text.clone());
        true
    } else {
        false
    };

    let selected_action = selected_action_key.and_then(|key| {
        settings
            .post_process_actions
            .iter()
            .find(|a| a.key == key)
            .cloned()
    });

    let is_code_context = active_app_context
        .as_ref()
        .map(|ctx| ctx.category.skip_post_processing())
        .unwrap_or(false);

    // First time the user dictates in a code editor → show the discovery prompt.
    if is_code_context && !settings.voice_to_code_onboarding_done {
        let _ = app.emit("voice-to-code-onboarding", ());
        let mut s = crate::settings::get_settings(app);
        s.voice_to_code_onboarding_done = true;
        crate::settings::write_settings(app, s);
    }

    let mode = decide_post_process_mode(
        snippet_matched,
        is_code_context,
        settings.voice_to_code_enabled,
        selected_action.is_some(),
        post_process,
    );

    if matches!(
        mode,
        PostProcessMode::VoiceToCode
            | PostProcessMode::SelectedAction
            | PostProcessMode::StandardPrompt
    ) {
        show_processing_overlay(app);
        if let Some(coordinator) = app.try_state::<TranscriptionCoordinator>() {
            let _ = coordinator.mark_processing(app, operation_id, "post-process");
        }
    }

    let post_process_started = Instant::now();
    let processed = match mode {
        PostProcessMode::SnippetOnly => None,
        PostProcessMode::VoiceToCode => {
            debug!("Voice-to-Code mode — sending to local Ollama");
            voice_to_code_completion(&settings, &final_text).await
        }
        PostProcessMode::SkipForCodeContext => {
            debug!("Code context detected — skipping LLM post-processing");
            None
        }
        PostProcessMode::SelectedAction => {
            if let Some(action) = selected_action.as_ref() {
                process_action(
                    &settings,
                    &final_text,
                    &action.prompt,
                    action.model.as_deref(),
                    action.provider_id.as_deref(),
                )
                .await
            } else {
                None
            }
        }
        PostProcessMode::StandardPrompt => {
            post_process_transcription(
                &settings,
                &final_text,
                active_app_context,
                language_correction.as_deref(),
            )
            .await
        }
        PostProcessMode::None => None,
    };
    if let Ok(mut p) = profiler.lock() {
        p.push_step_since(
            "post_process",
            post_process_started,
            Some(format!("applied={}", processed.is_some())),
        );
    }

    if let Some(processed_text) = processed {
        post_processed_text = Some(processed_text.clone());
        final_text = processed_text;

        if let Some(action) = selected_action {
            post_process_prompt = Some(action.prompt);
        } else if let Some(prompt_id) = &settings.post_process_selected_prompt_id {
            if let Some(prompt) = settings
                .post_process_prompts
                .iter()
                .find(|prompt| &prompt.id == prompt_id)
            {
                post_process_prompt = Some(prompt.prompt.clone());
            }
        }
    } else if final_text != transcription {
        post_processed_text = Some(final_text.clone());
    }

    if settings.adaptive_voice_profile_enabled {
        let voice_profile_started = Instant::now();
        if let Some(state) = app.try_state::<VoiceProfileState>() {
            if let Ok(mut profile) = state.0.lock() {
                let active_model_id = app
                    .try_state::<Arc<crate::managers::transcription::TranscriptionManager>>()
                    .and_then(|manager| manager.get_current_model())
                    .unwrap_or_else(|| settings.selected_model.clone());
                profile.update_from_session(
                    samples,
                    &final_text,
                    &settings.custom_words,
                    &active_model_id,
                    &settings.selected_language,
                );
                profile.save(app);
            }
        }
        if let Ok(mut p) = profiler.lock() {
            p.push_step_since(
                "voice_profile_update",
                voice_profile_started,
                Some(format!("enabled=true chars={}", final_text.chars().count())),
            );
        }
    }

    if settings.adaptive_vocabulary_enabled && !final_text.trim().is_empty() {
        let vocabulary_started = Instant::now();
        if let Some(state) = app.try_state::<VocabularyStoreState>() {
            if let Ok(mut store) = state.0.lock() {
                let active_model_id = app
                    .try_state::<Arc<crate::managers::transcription::TranscriptionManager>>()
                    .and_then(|manager| manager.get_current_model())
                    .unwrap_or_else(|| settings.selected_model.clone());
                store.learn_confirmed_transcription(
                    active_app_context,
                    &active_model_id,
                    &settings.selected_language,
                    &final_text,
                    &settings.custom_words,
                );
                store.save(app);
            }
        }
        if let Ok(mut p) = profiler.lock() {
            p.push_step_since(
                "adaptive_vocabulary_update",
                vocabulary_started,
                Some(format!("enabled=true chars={}", final_text.chars().count())),
            );
        }
    }

    PostProcessOutcome {
        final_text,
        post_processed_text,
        post_process_prompt,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snippet_wins_over_everything() {
        assert_eq!(
            decide_post_process_mode(true, true, true, true, true),
            PostProcessMode::SnippetOnly
        );
    }

    #[test]
    fn voice_to_code_when_enabled() {
        assert_eq!(
            decide_post_process_mode(false, true, true, true, true),
            PostProcessMode::VoiceToCode
        );
    }

    #[test]
    fn code_context_skips_llm_when_voice_to_code_disabled() {
        assert_eq!(
            decide_post_process_mode(false, true, false, true, true),
            PostProcessMode::SkipForCodeContext
        );
    }
}
