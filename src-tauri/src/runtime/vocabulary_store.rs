use crate::context_detector::{AppContextCategory, AppTranscriptionContext};
use regex::Regex;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use strsim::normalized_levenshtein;
use tauri::{AppHandle, Manager};

const VOCABULARY_STORE_PATH: &str = "adaptive_vocabulary.json";
const MAX_TERMS_PER_SCOPE: usize = 64;
const MAX_VARIANTS_PER_TERM: usize = 8;
const MIN_VARIANT_SIMILARITY: f64 = 0.66;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct VocabularyEntry {
    pub canonical_word: String,
    pub observed_variants: Vec<String>,
    #[serde(default)]
    pub observed_variant_counts: HashMap<String, u32>,
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
    let normalized_model = model_id.trim().to_ascii_lowercase();
    let normalized_language = normalize_language(selected_language);
    let mut keys = vec![format!("language:{normalized_language}")];

    if !normalized_model.is_empty() {
        keys.push(format!(
            "model_language:{normalized_model}:{normalized_language}"
        ));
    }

    if let Some(context) = context {
        let category = format!("{:?}", context.category).to_ascii_lowercase();
        keys.push(format!(
            "category_language:{category}:{normalized_language}"
        ));
        if !normalized_model.is_empty() {
            keys.push(format!(
                "model_category_language:{normalized_model}:{category}:{normalized_language}"
            ));
        }

        if let Some(process_name) = context.process_name.as_ref() {
            let process = process_name.to_ascii_lowercase();
            keys.push(format!("process_language:{process}:{normalized_language}"));
            if !normalized_model.is_empty() {
                keys.push(format!(
                    "model_process_language:{normalized_model}:{process}:{normalized_language}"
                ));
            }
        }
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

fn looks_distinctive(term: &str) -> bool {
    term.contains('_')
        || term.contains('-')
        || term.chars().any(|c| c.is_ascii_digit())
        || term.chars().any(|c| c.is_uppercase())
}

fn safe_feedback_variant(canonical: &str, variant: &str) -> bool {
    let canonical_key = canonical.to_ascii_lowercase();
    let variant_key = variant.to_ascii_lowercase();
    if canonical_key == variant_key
        || canonical_key.len() < 4
        || variant_key.len() < 4
        || is_stop_term(&canonical_key)
        || is_stop_term(&variant_key)
    {
        return false;
    }

    let same_first_char = canonical_key.chars().next() == variant_key.chars().next();
    (same_first_char || looks_distinctive(canonical))
        && normalized_levenshtein(&canonical_key, &variant_key) >= MIN_VARIANT_SIMILARITY
}

fn apply_exact_variant_replacement(text: &str, variant: &str, canonical: &str) -> String {
    if !safe_feedback_variant(canonical, variant) {
        return text.to_string();
    }

    let pattern = format!(r"(?i)\b{}\b", regex::escape(variant));
    let Ok(regex) = Regex::new(&pattern) else {
        return text.to_string();
    };
    regex.replace_all(text, canonical).to_string()
}

fn variant_observation_count(entry: &VocabularyEntry, variant: &str) -> u32 {
    entry
        .observed_variant_counts
        .iter()
        .find(|(candidate, _)| candidate.eq_ignore_ascii_case(variant))
        .map(|(_, count)| *count)
        .unwrap_or(0)
}

fn variant_is_promoted(entry: &VocabularyEntry, variant: &str) -> bool {
    variant_observation_count(entry, variant) >= 2
        || looks_distinctive(&entry.canonical_word)
        || looks_distinctive(variant)
}

fn trim_observed_variants(entry: &mut VocabularyEntry) {
    let canonical_key = entry.canonical_word.to_ascii_lowercase();
    let canonical_word = entry.canonical_word.clone();
    let counts = entry.observed_variant_counts.clone();
    entry.observed_variants.retain(|variant| {
        variant.eq_ignore_ascii_case(&canonical_word)
            || counts.keys().any(|key| key.eq_ignore_ascii_case(variant))
    });
    entry.observed_variants.sort_by(|left, right| {
        let left_count = if left.eq_ignore_ascii_case(&canonical_word) {
            u32::MAX
        } else {
            counts
                .iter()
                .find(|(candidate, _)| candidate.eq_ignore_ascii_case(left))
                .map(|(_, count)| *count)
                .unwrap_or(0)
        };
        let right_count = if right.eq_ignore_ascii_case(&canonical_word) {
            u32::MAX
        } else {
            counts
                .iter()
                .find(|(candidate, _)| candidate.eq_ignore_ascii_case(right))
                .map(|(_, count)| *count)
                .unwrap_or(0)
        };
        right_count
            .cmp(&left_count)
            .then_with(|| right.len().cmp(&left.len()))
            .then_with(|| left.cmp(right))
    });
    entry
        .observed_variants
        .dedup_by(|left, right| left.eq_ignore_ascii_case(right));
    entry.observed_variants.truncate(MAX_VARIANTS_PER_TERM);
    entry.observed_variant_counts.retain(|variant, _| {
        variant != &canonical_key
            && entry
                .observed_variants
                .iter()
                .any(|kept| kept.eq_ignore_ascii_case(variant))
    });
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
                    observed_variant_counts: HashMap::new(),
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
                    observed_variant_counts: HashMap::new(),
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

    pub fn learn_feedback_correction(
        &mut self,
        context: Option<&AppTranscriptionContext>,
        model_id: &str,
        selected_language: &str,
        expected_text: &str,
        actual_text: &str,
        custom_words: &[String],
    ) {
        let actual_terms = extract_session_terms(actual_text, &[]);
        let expected_terms = extract_session_terms(expected_text, custom_words);
        let actual_term_keys: HashSet<String> = actual_terms
            .iter()
            .map(|term| term.to_ascii_lowercase())
            .collect();
        let expected_term_keys: HashSet<String> = expected_terms
            .iter()
            .map(|term| term.to_ascii_lowercase())
            .collect();
        let corrected_terms: Vec<String> = expected_terms
            .iter()
            .filter(|term| !actual_term_keys.contains(&term.to_ascii_lowercase()))
            .cloned()
            .collect();

        self.learn_terms_for_session(
            context,
            model_id,
            selected_language,
            corrected_terms.clone(),
        );

        let extra_actual_terms: Vec<String> = actual_terms
            .into_iter()
            .filter(|term| !expected_term_keys.contains(&term.to_ascii_lowercase()))
            .collect();
        self.learn_feedback_variants(
            context,
            model_id,
            selected_language,
            &corrected_terms,
            &extra_actual_terms,
        );
    }

    fn learn_feedback_variants(
        &mut self,
        context: Option<&AppTranscriptionContext>,
        model_id: &str,
        selected_language: &str,
        canonical_terms: &[String],
        observed_terms: &[String],
    ) {
        if canonical_terms.is_empty()
            || observed_terms.is_empty()
            || canonical_terms.len() > 4
            || observed_terms.len() > 4
        {
            return;
        }

        let scope_keys = scope_keys_for_session(context, model_id, selected_language);
        let timestamp = now_ms();
        let mut used_observed = HashSet::new();

        for canonical in canonical_terms {
            let Some((observed_idx, observed)) = observed_terms
                .iter()
                .enumerate()
                .filter(|(idx, observed)| {
                    !used_observed.contains(idx) && safe_feedback_variant(canonical, observed)
                })
                .max_by(|(_, left), (_, right)| {
                    normalized_levenshtein(
                        &canonical.to_ascii_lowercase(),
                        &left.to_ascii_lowercase(),
                    )
                    .partial_cmp(&normalized_levenshtein(
                        &canonical.to_ascii_lowercase(),
                        &right.to_ascii_lowercase(),
                    ))
                    .unwrap_or(std::cmp::Ordering::Equal)
                })
            else {
                continue;
            };
            used_observed.insert(observed_idx);

            let key = canonical.to_ascii_lowercase();
            for scope_key in &scope_keys {
                if let Some(scope) = self.scopes.get_mut(scope_key) {
                    if let Some(entry) = scope.get_mut(&key) {
                        entry.last_used_at_ms = timestamp;
                        let count_key = observed.to_ascii_lowercase();
                        let count = entry.observed_variant_counts.entry(count_key).or_insert(0);
                        *count = count.saturating_add(1);
                        if !entry
                            .observed_variants
                            .iter()
                            .any(|variant| variant.eq_ignore_ascii_case(observed))
                        {
                            entry.observed_variants.push(observed.clone());
                        }
                        trim_observed_variants(entry);
                    }
                }
            }
        }
    }

    pub fn apply_learned_corrections(
        &self,
        context: Option<&AppTranscriptionContext>,
        model_id: &str,
        selected_language: &str,
        text: &str,
    ) -> String {
        let mut entries: Vec<VocabularyEntry> = Vec::new();
        for scope_key in scope_keys_for_session(context, model_id, selected_language) {
            if let Some(scope) = self.scopes.get(&scope_key) {
                entries.extend(scope.values().cloned());
            }
        }

        entries.sort_by(|left, right| {
            right
                .promotion_count
                .cmp(&left.promotion_count)
                .then_with(|| right.last_used_at_ms.cmp(&left.last_used_at_ms))
        });

        let mut corrected = text.to_string();
        for entry in entries {
            let mut variants = entry.observed_variants.clone();
            variants.sort_by_key(|variant| std::cmp::Reverse(variant.len()));
            for variant in variants {
                if variant.eq_ignore_ascii_case(&entry.canonical_word) {
                    continue;
                }
                if !variant_is_promoted(&entry, &variant) {
                    continue;
                }
                corrected =
                    apply_exact_variant_replacement(&corrected, &variant, &entry.canonical_word);
            }
        }

        corrected
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

/// Convert a camelCase or PascalCase identifier to its space-separated form.
///
/// "useState"   → "use state"
/// "MyComponent" → "my component"
/// "useEffect"  → "use effect"
/// Returns `None` if the word has no uppercase letters (no split needed).
fn camel_to_words(s: &str) -> Option<String> {
    if !s.chars().any(|c| c.is_uppercase()) {
        return None;
    }
    let mut result = String::with_capacity(s.len() + 4);
    for (i, ch) in s.chars().enumerate() {
        if i > 0 && ch.is_uppercase() {
            result.push(' ');
        }
        result.push(ch.to_ascii_lowercase());
    }
    let result = result.trim().to_string();
    // Only useful if we actually produced multiple words
    if result.contains(' ') {
        Some(result)
    } else {
        None
    }
}

/// For every camelCase term in `custom_words`, replace its spoken split form
/// back to the canonical identifier in `text`.
///
/// Example: `custom_words = ["useState"]`, text contains "use state"
/// → replaced with "useState".
///
/// Only applied in code context where such identifiers are expected.
/// Uses word-boundary regex so "use state machines" is not disturbed
/// (only exact "use state" matches).
pub fn apply_custom_word_splits(text: &str, custom_words: &[String]) -> String {
    let mut result = text.to_string();

    for word in custom_words {
        let word = word.trim();
        // Only process multi-char camelCase / PascalCase terms
        if word.len() < 4 {
            continue;
        }
        let Some(split_form) = camel_to_words(word) else {
            continue;
        };
        // Only replace if split form is at least 2 words and reasonably long
        if split_form.split_whitespace().count() < 2 {
            continue;
        }
        let pattern = format!(r"(?i)\b{}\b", regex::escape(&split_form));
        let Ok(re) = Regex::new(&pattern) else {
            continue;
        };
        result = re.replace_all(&result, word).to_string();
    }

    result
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
            code_language: None,
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

        let terms =
            store.terms_for_session(Some(&context), "parakeet-tdt-0.6b-v3-multilingual", "fr", 8);
        assert!(terms.iter().any(|term| term == "Yassine"));
        assert!(terms.iter().any(|term| term == "Vocalype"));
    }

    #[test]
    fn feedback_corrections_are_scoped_by_language() {
        let mut store = VocabularyStore::default();
        let context = code_context();
        store.learn_feedback_correction(
            Some(&context),
            "parakeet-tdt-0.6b-v3-multilingual",
            "fr",
            "Je travaille sur Vocalype avec Yassine",
            "Je travaille sur vocal type avec machine",
            &[],
        );

        let french_terms =
            store.terms_for_session(Some(&context), "parakeet-tdt-0.6b-v3-multilingual", "fr", 8);
        let english_terms =
            store.terms_for_session(Some(&context), "parakeet-tdt-0.6b-v3-multilingual", "en", 8);

        assert!(french_terms.iter().any(|term| term == "Vocalype"));
        assert!(french_terms.iter().any(|term| term == "Yassine"));
        assert!(!english_terms.iter().any(|term| term == "Yassine"));
    }

    #[test]
    fn feedback_variants_apply_only_inside_matching_language_scope() {
        let mut store = VocabularyStore::default();
        let context = code_context();
        store.learn_feedback_correction(
            Some(&context),
            "parakeet-tdt-0.6b-v3-multilingual",
            "fr",
            "Je parle avec Yassine",
            "Je parle avec Yacine",
            &[],
        );

        let french = store.apply_learned_corrections(
            Some(&context),
            "parakeet-tdt-0.6b-v3-multilingual",
            "fr",
            "Je parle avec Yacine",
        );
        let english = store.apply_learned_corrections(
            Some(&context),
            "parakeet-tdt-0.6b-v3-multilingual",
            "en",
            "I spoke with Yacine",
        );

        assert_eq!(french, "Je parle avec Yassine");
        assert_eq!(english, "I spoke with Yacine");
    }

    #[test]
    fn generic_feedback_variants_wait_for_confirmation() {
        let mut store = VocabularyStore::default();
        let context = code_context();
        store.learn_feedback_correction(
            Some(&context),
            "parakeet-tdt-0.6b-v3-multilingual",
            "fr",
            "la transcription reste stable",
            "la transcription reste stabel",
            &[],
        );

        let first_pass = store.apply_learned_corrections(
            Some(&context),
            "parakeet-tdt-0.6b-v3-multilingual",
            "fr",
            "la transcription reste stabel",
        );
        assert_eq!(first_pass, "la transcription reste stabel");

        store.learn_feedback_correction(
            Some(&context),
            "parakeet-tdt-0.6b-v3-multilingual",
            "fr",
            "la transcription reste stable",
            "la transcription reste stabel",
            &[],
        );

        let second_pass = store.apply_learned_corrections(
            Some(&context),
            "parakeet-tdt-0.6b-v3-multilingual",
            "fr",
            "la transcription reste stabel",
        );
        assert_eq!(second_pass, "la transcription reste stable");
    }

    #[test]
    fn confirming_one_generic_variant_does_not_promote_another() {
        let mut store = VocabularyStore::default();
        let context = code_context();
        for _ in 0..2 {
            store.learn_feedback_correction(
                Some(&context),
                "parakeet-tdt-0.6b-v3-multilingual",
                "fr",
                "la transcription reste stable",
                "la transcription reste stabel",
                &[],
            );
        }
        store.learn_feedback_correction(
            Some(&context),
            "parakeet-tdt-0.6b-v3-multilingual",
            "fr",
            "la transcription reste stable",
            "la transcription reste stabl",
            &[],
        );

        let confirmed = store.apply_learned_corrections(
            Some(&context),
            "parakeet-tdt-0.6b-v3-multilingual",
            "fr",
            "la transcription reste stabel",
        );
        let unconfirmed = store.apply_learned_corrections(
            Some(&context),
            "parakeet-tdt-0.6b-v3-multilingual",
            "fr",
            "la transcription reste stabl",
        );

        assert_eq!(confirmed, "la transcription reste stable");
        assert_eq!(unconfirmed, "la transcription reste stabl");
    }

    #[test]
    fn observed_variants_are_capped_per_term() {
        let mut entry = VocabularyEntry {
            canonical_word: "Vocalype".to_string(),
            observed_variants: vec!["Vocalype".to_string()],
            observed_variant_counts: HashMap::new(),
            promotion_count: 1,
            last_used_at_ms: 1,
        };

        for idx in 0..16 {
            let variant = format!("Vocalyp{idx}");
            entry.observed_variant_counts.insert(variant.clone(), idx);
            entry.observed_variants.push(variant);
        }

        trim_observed_variants(&mut entry);

        assert!(entry
            .observed_variants
            .iter()
            .any(|variant| variant == "Vocalype"));
        assert!(entry.observed_variants.len() <= MAX_VARIANTS_PER_TERM);
        assert!(entry.observed_variant_counts.len() <= MAX_VARIANTS_PER_TERM - 1);
    }

    #[test]
    fn camel_split_use_state() {
        let result = apply_custom_word_splits(
            "const value equals use state open paren null close paren",
            &["useState".to_string()],
        );
        assert!(result.contains("useState"), "got: {result}");
    }

    #[test]
    fn camel_split_use_effect() {
        let result = apply_custom_word_splits(
            "use effect open paren arrow fetch data close paren",
            &["useEffect".to_string()],
        );
        assert!(result.contains("useEffect"), "got: {result}");
    }

    #[test]
    fn camel_split_pascal_component() {
        let result = apply_custom_word_splits(
            "return my component props",
            &["MyComponent".to_string()],
        );
        assert!(result.contains("MyComponent"), "got: {result}");
    }

    #[test]
    fn camel_split_no_false_positive_for_lowercase() {
        // "async" has no uppercase — should not be touched
        let result = apply_custom_word_splits("run async task", &["async".to_string()]);
        assert_eq!(result, "run async task");
    }

    #[test]
    fn camel_split_no_match_without_custom_word() {
        // "use state" is NOT replaced if "useState" is not in custom_words
        let result = apply_custom_word_splits(
            "use state open paren null close paren",
            &["useEffect".to_string()],
        );
        assert!(!result.contains("useState"), "got: {result}");
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
