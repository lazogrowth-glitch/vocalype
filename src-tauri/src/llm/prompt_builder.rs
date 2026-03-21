use crate::context_detector::{AppContextCategory, AppTranscriptionContext};
use crate::settings::AppSettings;
use crate::vocabulary_store::{default_seed_terms_for_context, VocabularyStore};
use std::collections::BTreeSet;

const MAX_PROMPT_TERMS: usize = 16;
const MAX_PROMPT_CHARS: usize = 420;

fn context_instruction(
    settings: &AppSettings,
    context: Option<&AppTranscriptionContext>,
) -> Option<&'static str> {
    let is_french = settings.selected_language.starts_with("fr");

    match context.map(|ctx| ctx.category) {
        Some(AppContextCategory::Code) => Some(if is_french {
            "Dictee de code. Preserve la casse exacte, les noms d'API, de fichiers, camelCase et snake_case."
        } else {
            "Code dictation. Preserve exact casing, API names, file names, camelCase and snake_case."
        }),
        Some(AppContextCategory::Email) => Some(if is_french {
            "Dictee d'email. Garde un ton professionnel et une ponctuation propre."
        } else {
            "Email dictation. Keep professional punctuation and names clean."
        }),
        Some(AppContextCategory::Chat) => Some(if is_french {
            "Dictee de chat. Garde un style naturel et une ponctuation legere."
        } else {
            "Chat dictation. Keep a natural tone and light punctuation."
        }),
        Some(AppContextCategory::Document) => Some(if is_french {
            "Dictee de document. Garde une structure propre et des phrases completes."
        } else {
            "Document dictation. Keep clean structure and complete sentences."
        }),
        Some(AppContextCategory::Notes) => Some(if is_french {
            "Dictee de notes. Preserve la structure markdown, les listes et les titres."
        } else {
            "Notes dictation. Preserve markdown structure, bullet points and headings."
        }),
        _ => None,
    }
}

pub fn build_whisper_initial_prompt(
    settings: &AppSettings,
    context: Option<&AppTranscriptionContext>,
    vocabulary_store: &VocabularyStore,
    extra_preferred_terms: &[String],
) -> Option<String> {
    if !settings.adaptive_vocabulary_enabled && extra_preferred_terms.is_empty() {
        return None;
    }

    let mut terms = BTreeSet::new();
    if settings.adaptive_vocabulary_enabled {
        for word in default_seed_terms_for_context(context, &settings.custom_words) {
            terms.insert(word);
            if terms.len() >= MAX_PROMPT_TERMS {
                break;
            }
        }

        for word in vocabulary_store.terms_for_context(context, MAX_PROMPT_TERMS) {
            terms.insert(word);
            if terms.len() >= MAX_PROMPT_TERMS {
                break;
            }
        }
    }

    for word in extra_preferred_terms {
        if !word.trim().is_empty() {
            terms.insert(word.trim().to_string());
        }
        if terms.len() >= MAX_PROMPT_TERMS {
            break;
        }
    }

    let instruction = context_instruction(settings, context);
    if instruction.is_none() && terms.is_empty() {
        return None;
    }

    let preferred_terms = if terms.is_empty() {
        None
    } else if settings.selected_language.starts_with("fr") {
        Some(format!(
            "Orthographes preferees: {}",
            terms.into_iter().collect::<Vec<_>>().join(", ")
        ))
    } else {
        Some(format!(
            "Preferred spellings: {}",
            terms.into_iter().collect::<Vec<_>>().join(", ")
        ))
    };

    let mut prompt = String::new();
    if let Some(instruction) = instruction {
        prompt.push_str(instruction);
    }
    if let Some(terms_line) = preferred_terms {
        if !prompt.is_empty() {
            prompt.push(' ');
        }
        prompt.push_str(&terms_line);
    }

    if prompt.len() > MAX_PROMPT_CHARS {
        prompt.truncate(MAX_PROMPT_CHARS);
    }

    Some(prompt)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::get_default_settings;

    fn code_context() -> AppTranscriptionContext {
        AppTranscriptionContext {
            process_name: Some("code.exe".to_string()),
            window_title: Some("VS Code".to_string()),
            category: AppContextCategory::Code,
            detected_at_ms: 1,
        }
    }

    #[test]
    fn returns_none_when_disabled() {
        let settings = get_default_settings();
        let prompt =
            build_whisper_initial_prompt(&settings, None, &VocabularyStore::default(), &[]);
        assert!(prompt.is_none());
    }

    #[test]
    fn builds_code_prompt_with_terms() {
        let mut settings = get_default_settings();
        settings.adaptive_vocabulary_enabled = true;
        settings.custom_words = vec!["VocalType".to_string(), "transcribe-rs".to_string()];

        let prompt = build_whisper_initial_prompt(
            &settings,
            Some(&code_context()),
            &VocabularyStore::default(),
            &[],
        )
        .expect("prompt should exist");

        assert!(prompt.contains("VocalType"));
        assert!(prompt.contains("camelCase"));
        assert!(prompt.len() <= MAX_PROMPT_CHARS);
    }
}
