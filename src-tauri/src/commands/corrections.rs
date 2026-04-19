use crate::processing::correction_tracker::{diff_words, CorrectionTracker, AUTO_ADD_THRESHOLD};
use crate::processing::dictionary::DictionaryManager;
use crate::settings::{get_settings, write_settings};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::sync::Arc;
use tauri::{AppHandle, State};

// ── Learning stats ────────────────────────────────────────────────────────────

/// A single entry in the top-corrections list.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct TopCorrection {
    pub from: String,
    pub to: String,
    pub count: u32,
}

/// Aggregated stats about what Vocalype has learned from user corrections.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LearningStats {
    /// Total number of correction events recorded (may include repeated pairs).
    pub total_corrections_recorded: u32,
    /// Number of distinct (from, to) pairs seen at least once.
    pub distinct_corrections: usize,
    /// Total entries in the user dictionary (manual + auto-learned).
    pub dictionary_entries: usize,
    /// Pairs that have reached the auto-add threshold (≥ AUTO_ADD_THRESHOLD).
    pub auto_learned_pairs: usize,
    /// Top 5 most-corrected pairs, sorted by count descending.
    pub top_corrections: Vec<TopCorrection>,
}

/// Return aggregated learning stats for the current user.
#[tauri::command]
#[specta::specta]
pub fn get_learning_stats(
    dictionary: State<'_, Arc<DictionaryManager>>,
    correction_tracker: State<'_, Arc<CorrectionTracker>>,
) -> Result<LearningStats, String> {
    let counts = correction_tracker.all_counts();

    let total_corrections_recorded: u32 = counts.values().sum();
    let distinct_corrections = counts.len();
    let auto_learned_pairs = counts
        .values()
        .filter(|&&c| c >= AUTO_ADD_THRESHOLD)
        .count();

    let mut top: Vec<TopCorrection> = counts
        .iter()
        .map(|(key, &count)| {
            let parts: Vec<&str> = key.splitn(2, '\x00').collect();
            TopCorrection {
                from: parts.first().copied().unwrap_or("").to_string(),
                to: parts.get(1).copied().unwrap_or("").to_string(),
                count,
            }
        })
        .collect();
    top.sort_by(|a, b| b.count.cmp(&a.count));
    top.truncate(5);

    let dictionary_entries = dictionary.entries().len();

    Ok(LearningStats {
        total_corrections_recorded,
        distinct_corrections,
        dictionary_entries,
        auto_learned_pairs,
        top_corrections: top,
    })
}

// ── User profile ──────────────────────────────────────────────────────────────

/// The user's learned vocabulary profile.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct UserProfile {
    /// Words the model knows to look for (custom_words in settings).
    pub learned_terms: Vec<String>,
    /// How many of those were synced automatically from the dictionary.
    pub auto_synced_count: usize,
}

/// Return the current user profile (learned terms + metadata).
#[tauri::command]
#[specta::specta]
pub fn get_user_profile(app: AppHandle) -> Result<UserProfile, String> {
    let settings = get_settings(&app);
    Ok(UserProfile {
        auto_synced_count: 0, // placeholder — enriched by sync_dictionary_to_profile
        learned_terms: settings.custom_words,
    })
}

/// Scan every dictionary `to` value and promote single-word proper-looking
/// terms into `custom_words` so the model is aware of them during transcription.
///
/// Safe to call multiple times — duplicates are skipped.
/// Returns the number of new terms added.
#[tauri::command]
#[specta::specta]
pub fn sync_dictionary_to_profile(
    app: AppHandle,
    dictionary: State<'_, Arc<DictionaryManager>>,
) -> Result<usize, String> {
    let entries = dictionary.entries();
    let mut settings = get_settings(&app);

    let existing: std::collections::HashSet<String> = settings
        .custom_words
        .iter()
        .map(|w| w.to_lowercase())
        .collect();

    let mut added = 0usize;
    for entry in &entries {
        let to = entry.to.trim();
        // Only single-word terms (no spaces) that look like proper nouns
        if !to.contains(' ') && is_proper_noun_candidate(to) {
            let lower = to.to_lowercase();
            if !existing.contains(&lower) {
                settings.custom_words.push(to.to_string());
                added += 1;
            }
        }
    }

    if added > 0 {
        write_settings(&app, settings);
    }

    Ok(added)
}

/// Remove a term from the user's learned profile (custom_words).
#[tauri::command]
#[specta::specta]
pub fn remove_profile_term(app: AppHandle, term: String) -> Result<(), String> {
    let mut settings = get_settings(&app);
    settings
        .custom_words
        .retain(|w| !w.eq_ignore_ascii_case(&term));
    write_settings(&app, settings);
    Ok(())
}

/// A term is a proper noun candidate if it:
/// - Starts with an uppercase letter, OR is fully uppercase (acronym)
/// - Contains at least one alphabetic character
/// - Is at least 3 characters long
fn is_proper_noun_candidate(word: &str) -> bool {
    if word.len() < 3 {
        return false;
    }
    // Accept proper nouns (Tremblay), camelCase (useState), and acronyms (RSI)
    word.chars().any(|c| c.is_uppercase())
}

// ── Correction commands ───────────────────────────────────────────────────────

/// A suggested dictionary entry derived from a user correction.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CorrectionSuggestion {
    /// The original (wrong) word or phrase.
    pub from: String,
    /// The corrected word or phrase.
    pub to: String,
    /// How many times this exact correction has been recorded (including this one, if `record` was called).
    pub count: u32,
    /// True if `from` is already in the dictionary.
    pub already_in_dict: bool,
    /// True if the count has reached the auto-add threshold.
    pub auto_add: bool,
}

/// Analyse the difference between an original transcription and a user correction.
/// Returns word-level substitution candidates enriched with dictionary state and counts.
/// Does NOT record the correction — call `record_correction` separately.
#[tauri::command]
#[specta::specta]
pub fn analyze_correction(
    dictionary: State<'_, Arc<DictionaryManager>>,
    correction_tracker: State<'_, Arc<CorrectionTracker>>,
    original: String,
    corrected: String,
) -> Result<Vec<CorrectionSuggestion>, String> {
    let raw = diff_words(&original, &corrected);
    if raw.is_empty() {
        return Ok(vec![]);
    }

    let dict_entries = dictionary.entries();
    let suggestions = raw
        .into_iter()
        .map(|c| {
            let count = correction_tracker.get_count(&c.from, &c.to);
            let already_in_dict = dict_entries
                .iter()
                .any(|e| e.from.to_lowercase() == c.from.to_lowercase());
            CorrectionSuggestion {
                from: c.from,
                to: c.to,
                count,
                already_in_dict,
                auto_add: count >= AUTO_ADD_THRESHOLD,
            }
        })
        .collect();

    Ok(suggestions)
}

/// Record a correction and optionally add it to the dictionary.
///
/// - If `add_to_dict` is true, the entry is added immediately.
/// - If the running count reaches `AUTO_ADD_THRESHOLD`, the entry is added automatically.
///
/// When the `to` value is a single proper-noun word, it is also added to
/// `custom_words` so the transcription model is aware of it in future sessions.
///
/// Returns the new count for this correction pair.
#[tauri::command]
#[specta::specta]
pub fn record_correction(
    app: AppHandle,
    dictionary: State<'_, Arc<DictionaryManager>>,
    correction_tracker: State<'_, Arc<CorrectionTracker>>,
    from: String,
    to: String,
    add_to_dict: bool,
) -> Result<u32, String> {
    let new_count = correction_tracker.record(&from, &to);

    let should_add = add_to_dict || new_count >= AUTO_ADD_THRESHOLD;

    if should_add {
        // Add to dictionary (silently ignore if already present)
        let _ = dictionary.add(from, to.clone());

        // If it's a single proper-noun word, also add to custom_words so the
        // model's fuzzy matcher knows about it — without requiring the user to
        // manually go to Advanced settings.
        if !to.contains(' ') && is_proper_noun_candidate(&to) {
            let mut settings = get_settings(&app);
            let already_known = settings
                .custom_words
                .iter()
                .any(|w| w.eq_ignore_ascii_case(&to));
            if !already_known {
                settings.custom_words.push(to);
                write_settings(&app, settings);
            }
        }
    }

    Ok(new_count)
}
