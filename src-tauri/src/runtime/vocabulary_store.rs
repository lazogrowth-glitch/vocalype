use crate::context_detector::{AppContextCategory, AppTranscriptionContext};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

const VOCABULARY_STORE_PATH: &str = "adaptive_vocabulary.json";
const MAX_TERMS_PER_SCOPE: usize = 64;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct VocabularyEntry {
    pub canonical_word: String,
    pub observed_variants: Vec<String>,
    pub promotion_count: u32,
    pub last_used_at_ms: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, Type)]
pub struct VocabularyStore {
    pub scopes: HashMap<String, HashMap<String, VocabularyEntry>>,
}

pub struct VocabularyStoreState(pub Mutex<VocabularyStore>);

fn now_ms() -> u64 {
    crate::runtime_observability::now_ms()
}

fn normalize_term(term: &str) -> Option<String> {
    let trimmed = term.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.to_string())
}

fn scope_keys_for_context(context: Option<&AppTranscriptionContext>) -> Vec<String> {
    let mut keys = vec!["global".to_string()];

    if let Some(context) = context {
        keys.push(format!("category:{:?}", context.category).to_ascii_lowercase());
        if let Some(process_name) = context.process_name.as_ref() {
            keys.push(format!("process:{}", process_name.to_ascii_lowercase()));
        }
    }

    keys
}

fn normalize_language(selected_language: &str) -> String {
    let trimmed = selected_language.trim().to_ascii_lowercase();
    if trimmed.is_empty() {
        "auto".to_string()
    } else if trimmed.starts_with("fr") {
        "fr".to_string()
    } else if trimmed.starts_with("en") {
        "en".to_string()
    } else if trimmed.starts_with("zh") {
        "zh".to_string()
    } else {
        trimmed
    }
}

fn scope_keys_for_session(
    context: Option<&AppTranscriptionContext>,
    model_id: &str,
    selected_language: &str,
) -> Vec<String> {
    let mut keys = scope_keys_for_context(context);
    let normalized_model = model_id.trim().to_ascii_lowercase();
    let normalized_language = normalize_language(selected_language);
    if !normalized_language.is_empty() {
        keys.push(format!("language:{normalized_language}"));
    }
    if !normalized_model.is_empty() {
        keys.push(format!("model:{normalized_model}"));
        keys.push(format!("model_language:{normalized_model}:{normalized_language}"));
    }
    keys
}

fn is_stop_term(term: &str) -> bool {
    matches!(
        term,
        "the"
            | "and"
            | "for"
            | "that"
            | "this"
            | "with"
            | "have"
            | "from"
            | "into"
            | "then"
            | "than"
            | "just"
            | "what"
            | "when"
            | "where"
            | "while"
            | "because"
            | "about"
            | "est"
            | "une"
            | "des"
            | "les"
            | "que"
            | "qui"
            | "sur"
            | "pas"
            | "par"
            | "dans"
            | "avec"
            | "pour"
            | "mais"
            | "plus"
            | "cela"
            | "cette"
            | "vous"
            | "nous"
            | "elle"
            | "elles"
            | "ils"
            | "tout"
            | "tous"
            | "toutes"
    )
}

fn extract_session_terms(text: &str, custom_words: &[String]) -> Vec<String> {
    let mut scores: HashMap<String, (String, u32)> = HashMap::new();

    for term in custom_words.iter().filter_map(|term| normalize_term(term)) {
        let key = term.to_ascii_lowercase();
        scores
            .entry(key)
            .and_modify(|entry| entry.1 = entry.1.saturating_add(5))
            .or_insert((term, 5));
    }

    for raw in text.split_whitespace() {
        let token = raw
            .trim_matches(|c: char| !c.is_alphanumeric() && c != '_' && c != '-')
            .trim();
        if token.len() < 4 {
            continue;
        }

        let lower = token.to_ascii_lowercase();
        if is_stop_term(&lower) {
            continue;
        }

        let looks_special = token.contains('_')
            || token.contains('-')
            || token.chars().any(|c| c.is_ascii_digit())
            || token.chars().any(|c| c.is_uppercase());
        let score = if looks_special { 3 } else { 1 };

        scores
            .entry(lower)
            .and_modify(|entry| entry.1 = entry.1.saturating_add(score))
            .or_insert((token.to_string(), score));
    }

    let mut ranked: Vec<_> = scores.into_values().collect();
    ranked.sort_by(|(left_term, left_score), (right_term, right_score)| {
        right_score
            .cmp(left_score)
            .then_with(|| right_term.len().cmp(&left_term.len()))
            .then_with(|| left_term.cmp(right_term))
    });

    ranked.into_iter().take(16).map(|(term, _)| term).collect()
}

fn sort_and_trim_scope(entries: &mut HashMap<String, VocabularyEntry>) {
    if entries.len() <= MAX_TERMS_PER_SCOPE {
        return;
    }

    let mut values: Vec<_> = entries.values().cloned().collect();
    values.sort_by(|a, b| {
        b.promotion_count
            .cmp(&a.promotion_count)
            .then_with(|| b.last_used_at_ms.cmp(&a.last_used_at_ms))
    });
    values.truncate(MAX_TERMS_PER_SCOPE);

    let retained: HashMap<String, VocabularyEntry> = values
        .into_iter()
        .map(|entry| (entry.canonical_word.to_ascii_lowercase(), entry))
        .collect();
    *entries = retained;
}

impl VocabularyStore {
    pub fn load(app: &AppHandle) -> Self {
        let path = vocabulary_store_file(app);
        let Ok(content) = fs::read_to_string(path) else {
            return Self::default();
        };

        serde_json::from_str(&content).unwrap_or_default()
    }

    pub fn save(&self, app: &AppHandle) {
        let path = vocabulary_store_file(app);
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }

        if let Ok(content) = serde_json::to_string_pretty(self) {
            let _ = fs::write(path, content);
        }
    }

    pub fn learn_terms(
        &mut self,
        context: Option<&AppTranscriptionContext>,
        terms: impl IntoIterator<Item = String>,
    ) {
        let scope_keys = scope_keys_for_context(context);
        let timestamp = now_ms();

        for term in terms.into_iter().filter_map(|term| normalize_term(&term)) {
            let key = term.to_ascii_lowercase();
            for scope_key in &scope_keys {
                let scope = self.scopes.entry(scope_key.clone()).or_default();
                let entry = scope.entry(key.clone()).or_insert_with(|| VocabularyEntry {
                    canonical_word: term.clone(),
                    observed_variants: vec![term.clone()],
                    promotion_count: 0,
                    last_used_at_ms: timestamp,
                });

                entry.promotion_count = entry.promotion_count.saturating_add(1);
                entry.last_used_at_ms = timestamp;
                entry.canonical_word = term.clone();
                if !entry
                    .observed_variants
                    .iter()
                    .any(|variant| variant.eq_ignore_ascii_case(&term))
                {
                    entry.observed_variants.push(term.clone());
                }
                sort_and_trim_scope(scope);
            }
        }
    }

    pub fn learn_terms_for_session(
        &mut self,
        context: Option<&AppTranscriptionContext>,
        model_id: &str,
        selected_language: &str,
        terms: impl IntoIterator<Item = String>,
    ) {
        let scope_keys = scope_keys_for_session(context, model_id, selected_language);
        let timestamp = now_ms();

        for term in terms.into_iter().filter_map(|term| normalize_term(&term)) {
            let key = term.to_ascii_lowercase();
            for scope_key in &scope_keys {
                let scope = self.scopes.entry(scope_key.clone()).or_default();
                let entry = scope.entry(key.clone()).or_insert_with(|| VocabularyEntry {
                    canonical_word: term.clone(),
                    observed_variants: vec![term.clone()],
                    promotion_count: 0,
                    last_used_at_ms: timestamp,
                });

                entry.promotion_count = entry.promotion_count.saturating_add(1);
                entry.last_used_at_ms = timestamp;
                entry.canonical_word = term.clone();
                if !entry
                    .observed_variants
                    .iter()
                    .any(|variant| variant.eq_ignore_ascii_case(&term))
                {
                    entry.observed_variants.push(term.clone());
                }
                sort_and_trim_scope(scope);
            }
        }
    }

    pub fn learn_confirmed_transcription(
        &mut self,
        context: Option<&AppTranscriptionContext>,
        model_id: &str,
        selected_language: &str,
        text: &str,
        custom_words: &[String],
    ) {
        let terms = extract_session_terms(text, custom_words);
        self.learn_terms_for_session(context, model_id, selected_language, terms);
    }

    pub fn terms_for_context(
        &self,
        context: Option<&AppTranscriptionContext>,
        limit: usize,
    ) -> Vec<String> {
        let mut merged: HashMap<String, VocabularyEntry> = HashMap::new();

        for scope_key in scope_keys_for_context(context) {
            if let Some(scope) = self.scopes.get(&scope_key) {
                for (key, entry) in scope {
                    let existing = merged.entry(key.clone()).or_insert_with(|| entry.clone());
                    if entry.promotion_count > existing.promotion_count
                        || entry.last_used_at_ms > existing.last_used_at_ms
                    {
                        *existing = entry.clone();
                    }
                }
            }
        }

        let mut values: Vec<_> = merged.into_values().collect();
        values.sort_by(|a, b| {
            b.promotion_count
                .cmp(&a.promotion_count)
                .then_with(|| b.last_used_at_ms.cmp(&a.last_used_at_ms))
        });

        values
            .into_iter()
            .take(limit)
            .map(|entry| entry.canonical_word)
            .collect()
    }

    pub fn terms_for_session(
        &self,
        context: Option<&AppTranscriptionContext>,
        model_id: &str,
        selected_language: &str,
        limit: usize,
    ) -> Vec<String> {
        let mut merged: HashMap<String, VocabularyEntry> = HashMap::new();

        for scope_key in scope_keys_for_session(context, model_id, selected_language) {
            if let Some(scope) = self.scopes.get(&scope_key) {
                for (key, entry) in scope {
                    let existing = merged.entry(key.clone()).or_insert_with(|| entry.clone());
                    if entry.promotion_count > existing.promotion_count
                        || entry.last_used_at_ms > existing.last_used_at_ms
                    {
                        *existing = entry.clone();
                    }
                }
            }
        }

        let mut values: Vec<_> = merged.into_values().collect();
        values.sort_by(|a, b| {
            b.promotion_count
                .cmp(&a.promotion_count)
                .then_with(|| b.last_used_at_ms.cmp(&a.last_used_at_ms))
        });

        values
            .into_iter()
            .take(limit)
            .map(|entry| entry.canonical_word)
            .collect()
    }
}

pub fn vocabulary_store_file(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(VOCABULARY_STORE_PATH)
}

pub fn default_seed_terms_for_context(
    context: Option<&AppTranscriptionContext>,
    custom_words: &[String],
) -> Vec<String> {
    let mut words: Vec<String> = custom_words
        .iter()
        .filter_map(|word| normalize_term(word))
        .collect();

    if matches!(
        context.map(|ctx| ctx.category),
        Some(AppContextCategory::Code)
    ) {
        words.sort_by_key(|word| {
            let looks_technical = word.contains('-')
                || word.contains('_')
                || word.chars().any(|c| c.is_uppercase())
                || word.contains('.');
            (!looks_technical, word.len())
        });
    }

    words
}

#[cfg(test)]
mod tests {
    use super::*;

    fn code_context() -> AppTranscriptionContext {
        AppTranscriptionContext {
            process_name: Some("code.exe".to_string()),
            window_title: Some("VS Code".to_string()),
            category: AppContextCategory::Code,
            detected_at_ms: 1,
        }
    }

    #[test]
    fn learns_and_recovers_terms_for_same_context() {
        let mut store = VocabularyStore::default();
        let context = code_context();
        store.learn_terms(Some(&context), vec!["Vocalype".to_string()]);

        let terms = store.terms_for_context(Some(&context), 8);
        assert!(terms.iter().any(|term| term == "Vocalype"));
    }

    #[test]
    fn session_terms_can_be_scoped_by_model_and_language() {
        let mut store = VocabularyStore::default();
        let context = code_context();
        store.learn_terms_for_session(
            Some(&context),
            "parakeet-tdt-0.6b-v3-multilingual",
            "fr",
            vec!["Yassine".to_string(), "Vocalype".to_string()],
        );

        let terms = store.terms_for_session(
            Some(&context),
            "parakeet-tdt-0.6b-v3-multilingual",
            "fr",
            8,
        );
        assert!(terms.iter().any(|term| term == "Yassine"));
        assert!(terms.iter().any(|term| term == "Vocalype"));
    }

    #[test]
    fn default_seed_prefers_technical_code_words() {
        let words = default_seed_terms_for_context(
            Some(&code_context()),
            &[
                "hello".to_string(),
                "transcribe-rs".to_string(),
                "Vocalype".to_string(),
            ],
        );

        assert_eq!(words.first().map(String::as_str), Some("Vocalype"));
        assert!(words.iter().any(|word| word == "transcribe-rs"));
    }
}
