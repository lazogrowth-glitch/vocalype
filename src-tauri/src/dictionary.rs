//! Custom dictionary — user-defined word replacements applied after filler
//! removal and before LLM post-processing.
//!
//! Entries are stored in `{app_data}/dictionary.json` as a JSON array:
//! ```json
//! [{ "from": "vocal type", "to": "VocalType" }]
//! ```
//!
//! Matching is case-insensitive and word-boundary-aware, so "react" does
//! not replace inside "reactive".
//!
//! # Performance
//! Regex patterns are compiled once at load time and after every mutation.
//! `apply_dictionary` receives pre-compiled `&[(Regex, String)]` and performs
//! zero regex compilation at dictation time.

use log::warn;
use regex::Regex;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};

const DICTIONARY_FILE: &str = "dictionary.json";

// ---------------------------------------------------------------------------
// Public data type (serializable, used by Tauri commands)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct DictionaryEntry {
    pub from: String,
    pub to: String,
}

// ---------------------------------------------------------------------------
// Internal type — holds the pre-compiled regex alongside the entry data
// ---------------------------------------------------------------------------

struct CompiledEntry {
    from: String,
    to: String,
    re: Regex,
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

pub struct DictionaryManager {
    /// Compiled entries — single source of truth.  Regex is cheap to clone.
    compiled: Mutex<Vec<CompiledEntry>>,
    file_path: PathBuf,
}

impl DictionaryManager {
    /// Loads entries from disk and pre-compiles every pattern.
    /// Never fails — dictionary errors must not block the app.
    pub fn new(app_handle: &AppHandle) -> Arc<Self> {
        let app_data_dir = app_handle
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| PathBuf::from("."));
        let file_path = app_data_dir.join(DICTIONARY_FILE);
        let raw = load_from_file(&file_path).unwrap_or_default();
        let compiled = compile_all(&raw);
        Arc::new(Self {
            compiled: Mutex::new(compiled),
            file_path,
        })
    }

    /// Serializable snapshot — used by the `get_dictionary` Tauri command.
    pub fn entries(&self) -> Vec<DictionaryEntry> {
        self.compiled
            .lock()
            .unwrap()
            .iter()
            .map(|e| DictionaryEntry {
                from: e.from.clone(),
                to: e.to.clone(),
            })
            .collect()
    }

    /// Pre-compiled patterns — pass directly to `apply_dictionary`.
    /// Cloning `Regex` is O(1) (Arc-backed internally).
    pub fn compiled_entries(&self) -> Vec<(Regex, String)> {
        self.compiled
            .lock()
            .unwrap()
            .iter()
            .map(|e| (e.re.clone(), e.to.clone()))
            .collect()
    }

    /// Adds an entry. Returns an error if `from` already exists (case-insensitive).
    pub fn add(&self, from: String, to: String) -> Result<(), String> {
        let from = from.trim().to_string();
        let to = to.trim().to_string();
        if from.is_empty() {
            return Err("Le champ 'de' ne peut pas être vide".to_string());
        }
        let re = build_pattern(&from).ok_or_else(|| format!("Pattern invalide pour '{}'", from))?;
        let mut compiled = self.compiled.lock().unwrap();
        if compiled
            .iter()
            .any(|e| e.from.to_lowercase() == from.to_lowercase())
        {
            return Err(format!("'{}' est déjà dans le dictionnaire", from));
        }
        compiled.push(CompiledEntry { from, to, re });
        save_to_file(&self.file_path, &to_raw(&compiled))
    }

    /// Removes the entry matching `from` (case-insensitive).
    pub fn remove(&self, from: &str) -> Result<(), String> {
        let mut compiled = self.compiled.lock().unwrap();
        let before = compiled.len();
        compiled.retain(|e| e.from.to_lowercase() != from.to_lowercase());
        if compiled.len() == before {
            return Err(format!("'{}' introuvable dans le dictionnaire", from));
        }
        save_to_file(&self.file_path, &to_raw(&compiled))
    }

    /// Updates the replacement for the entry matching `from` (case-insensitive).
    pub fn update(&self, from: &str, to: String) -> Result<(), String> {
        let to = to.trim().to_string();
        let mut compiled = self.compiled.lock().unwrap();
        let entry = compiled
            .iter_mut()
            .find(|e| e.from.to_lowercase() == from.to_lowercase())
            .ok_or_else(|| format!("'{}' introuvable dans le dictionnaire", from))?;
        entry.to = to;
        save_to_file(&self.file_path, &to_raw(&compiled))
    }

    /// Removes all entries.
    pub fn clear(&self) -> Result<(), String> {
        let mut compiled = self.compiled.lock().unwrap();
        compiled.clear();
        save_to_file(&self.file_path, &[])
    }
}

// ---------------------------------------------------------------------------
// Pattern helpers
// ---------------------------------------------------------------------------

/// Builds the word-boundary-aware, case-insensitive regex for `from`.
/// Returns `None` if `from` is empty (after trimming) or escaping fails.
fn build_pattern(from: &str) -> Option<Regex> {
    let term = from.trim();
    if term.is_empty() {
        return None;
    }
    let escaped = regex::escape(term);
    // (?<!\w) / (?!\w) work correctly for both single-word and multi-word
    // phrases — spaces inside the pattern are non-word chars, so boundaries
    // are only asserted at the outermost edges of the phrase.
    Regex::new(&format!(r"(?i)(?<!\w){}(?!\w)", escaped))
        .map_err(|e| {
            warn!(
                "dictionary: failed to compile pattern for '{}': {}",
                from, e
            );
        })
        .ok()
}

/// Compile a list of raw entries, skipping any whose pattern fails to build.
fn compile_all(raw: &[DictionaryEntry]) -> Vec<CompiledEntry> {
    raw.iter()
        .filter_map(|e| {
            let re = build_pattern(&e.from)?;
            Some(CompiledEntry {
                from: e.from.clone(),
                to: e.to.clone(),
                re,
            })
        })
        .collect()
}

/// Extract serializable entries from the compiled list.
fn to_raw(compiled: &[CompiledEntry]) -> Vec<DictionaryEntry> {
    compiled
        .iter()
        .map(|e| DictionaryEntry {
            from: e.from.clone(),
            to: e.to.clone(),
        })
        .collect()
}

// ---------------------------------------------------------------------------
// File I/O
// ---------------------------------------------------------------------------

fn load_from_file(path: &PathBuf) -> Option<Vec<DictionaryEntry>> {
    let content = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

fn save_to_file(path: &PathBuf, entries: &[DictionaryEntry]) -> Result<(), String> {
    let content =
        serde_json::to_string_pretty(entries).map_err(|e| format!("Serialization error: {}", e))?;
    std::fs::write(path, content).map_err(|e| format!("Failed to write dictionary: {}", e))
}

// ---------------------------------------------------------------------------
// Core replacement function — zero regex compilation at call time
// ---------------------------------------------------------------------------

/// Apply pre-compiled dictionary patterns to `text`, in order.
///
/// `patterns` comes from [`DictionaryManager::compiled_entries`] — every
/// `Regex` is already compiled and ready to use.
pub fn apply_dictionary(text: &str, patterns: &[(Regex, String)]) -> String {
    if patterns.is_empty() || text.is_empty() {
        return text.to_string();
    }
    let mut result = text.to_string();
    for (re, to) in patterns {
        result = re.replace_all(&result, to.as_str()).into_owned();
    }
    result
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a pre-compiled pattern pair the same way DictionaryManager does.
    fn compiled(from: &str, to: &str) -> (Regex, String) {
        (
            build_pattern(from).expect("test pattern should compile"),
            to.to_string(),
        )
    }

    #[test]
    fn basic_replacement() {
        assert_eq!(
            apply_dictionary(
                "vocal type is great",
                &[compiled("vocal type", "VocalType")]
            ),
            "VocalType is great"
        );
    }

    #[test]
    fn multi_word_phrase() {
        assert_eq!(
            apply_dictionary(
                "I use react query daily",
                &[compiled("react query", "React Query")]
            ),
            "I use React Query daily"
        );
    }

    #[test]
    fn no_partial_word_match() {
        assert_eq!(
            apply_dictionary("reactive components", &[compiled("react", "React")]),
            "reactive components"
        );
    }

    #[test]
    fn case_insensitive_matching() {
        assert_eq!(
            apply_dictionary(
                "VOCAL TYPE is great",
                &[compiled("vocal type", "VocalType")]
            ),
            "VocalType is great"
        );
    }

    #[test]
    fn hyphenated_name() {
        assert_eq!(
            apply_dictionary(
                "jean philippe est là",
                &[compiled("jean philippe", "Jean-Philippe")]
            ),
            "Jean-Philippe est là"
        );
    }

    #[test]
    fn empty_patterns() {
        assert_eq!(
            apply_dictionary("vocal type is great", &[]),
            "vocal type is great"
        );
    }

    #[test]
    fn entry_at_end_of_string() {
        assert_eq!(
            apply_dictionary("I love vocal type", &[compiled("vocal type", "VocalType")]),
            "I love VocalType"
        );
    }

    #[test]
    fn multiple_entries_applied_in_order() {
        let patterns = vec![
            compiled("vocal type", "VocalType"),
            compiled("react query", "React Query"),
        ];
        assert_eq!(
            apply_dictionary("vocal type uses react query", &patterns),
            "VocalType uses React Query"
        );
    }

    #[test]
    fn acronym_uppercase() {
        assert_eq!(
            apply_dictionary("lgtm on this PR", &[compiled("lgtm", "LGTM")]),
            "LGTM on this PR"
        );
    }
}
