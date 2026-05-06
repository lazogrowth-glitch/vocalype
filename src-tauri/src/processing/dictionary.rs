//! Custom dictionary — user-defined word replacements applied after filler
//! removal and before LLM post-processing.
//!
//! Entries are stored in `{app_data}/dictionary.json` as a JSON array:
//! ```json
//! [{ "from": "vocal type", "to": "Vocalype" }]
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
use std::sync::{Arc, LazyLock, Mutex};
use tauri::{AppHandle, Manager};

const DICTIONARY_FILE: &str = "dictionary.json";

static DEVELOPER_VOCABULARY: LazyLock<Vec<(Regex, &'static str)>> = LazyLock::new(|| {
    [
        ("a p i", "API"),
        ("api", "API"),
        ("j w t", "JWT"),
        ("jwt", "JWT"),
        ("json web token", "JWT"),
        ("s d k", "SDK"),
        ("sdk", "SDK"),
        ("c l i", "CLI"),
        ("cli", "CLI"),
        ("s q l", "SQL"),
        ("sql", "SQL"),
        ("sequel", "SQL"),
        ("o auth", "OAuth"),
        ("oauth", "OAuth"),
        ("react", "React"),
        ("tauri", "Tauri"),
        ("typescript", "TypeScript"),
        ("javascript", "JavaScript"),
        ("node js", "Node.js"),
        ("next js", "Next.js"),
        ("user id", "userId"),
        ("user identifier", "userId"),
        ("auth token", "authToken"),
        ("access token", "accessToken"),
        ("refresh token", "refreshToken"),
        ("use state", "useState"),
        ("use effect", "useEffect"),
        ("n p m", "npm"),
        ("npm", "npm"),
        ("git hub", "GitHub"),
        ("github", "GitHub"),
    ]
    .into_iter()
    .filter_map(|(from, to)| build_pattern(from).map(|re| (re, to)))
    .collect()
});

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

type SharedCompiledPatterns = Arc<[(Regex, String)]>;

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

pub struct DictionaryManager {
    /// Compiled entries — single source of truth.  Regex is cheap to clone.
    compiled: Mutex<Vec<CompiledEntry>>,
    compiled_patterns: Mutex<SharedCompiledPatterns>,
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
        let compiled_patterns = compiled_patterns_from_entries(&compiled);
        Arc::new(Self {
            compiled: Mutex::new(compiled),
            compiled_patterns: Mutex::new(compiled_patterns),
            file_path,
        })
    }

    /// Serializable snapshot — used by the `get_dictionary` Tauri command.
    pub fn entries(&self) -> Vec<DictionaryEntry> {
        self.compiled
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .map(|e| DictionaryEntry {
                from: e.from.clone(),
                to: e.to.clone(),
            })
            .collect()
    }

    /// Pre-compiled patterns — pass directly to `apply_dictionary`.
    /// Cloning `Regex` is O(1) (Arc-backed internally).
    pub fn compiled_entries(&self) -> SharedCompiledPatterns {
        self.compiled_patterns
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    /// Adds an entry. Returns an error if `from` already exists (case-insensitive).
    ///
    /// Safety guard: `from` must be at least 5 characters long.  Short words
    /// (≤ 4 chars) like "est", "car", "le" cause false positives when learned
    /// automatically from correction diffs and would corrupt unrelated output.
    pub fn add(&self, from: String, to: String) -> Result<(), String> {
        let from = from.trim().to_string();
        let to = to.trim().to_string();
        if from.is_empty() {
            return Err("Le champ 'de' ne peut pas être vide".to_string());
        }
        if from.chars().count() < 5 {
            return Err(format!(
                "'{}' est trop court pour être appris automatiquement (minimum 5 caractères)",
                from
            ));
        }
        let re = build_pattern(&from).ok_or_else(|| format!("Pattern invalide pour '{}'", from))?;
        let mut compiled = self.compiled.lock().unwrap_or_else(|e| e.into_inner());
        if compiled
            .iter()
            .any(|e| e.from.to_lowercase() == from.to_lowercase())
        {
            return Err(format!("'{}' est déjà dans le dictionnaire", from));
        }
        compiled.push(CompiledEntry { from, to, re });
        let raw = to_raw(&compiled);
        let patterns = compiled_patterns_from_entries(&compiled);
        *self
            .compiled_patterns
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = patterns;
        save_to_file(&self.file_path, &raw)
    }

    /// Removes the entry matching `from` (case-insensitive).
    pub fn remove(&self, from: &str) -> Result<(), String> {
        let mut compiled = self.compiled.lock().unwrap_or_else(|e| e.into_inner());
        let before = compiled.len();
        compiled.retain(|e| e.from.to_lowercase() != from.to_lowercase());
        if compiled.len() == before {
            return Err(format!("'{}' not found in dictionary", from));
        }
        let raw = to_raw(&compiled);
        let patterns = compiled_patterns_from_entries(&compiled);
        *self
            .compiled_patterns
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = patterns;
        save_to_file(&self.file_path, &raw)
    }

    /// Updates the replacement for the entry matching `from` (case-insensitive).
    pub fn update(&self, from: &str, to: String) -> Result<(), String> {
        let to = to.trim().to_string();
        let mut compiled = self.compiled.lock().unwrap_or_else(|e| e.into_inner());
        let entry = compiled
            .iter_mut()
            .find(|e| e.from.to_lowercase() == from.to_lowercase())
            .ok_or_else(|| format!("'{}' not found in dictionary", from))?;
        entry.to = to;
        let raw = to_raw(&compiled);
        let patterns = compiled_patterns_from_entries(&compiled);
        *self
            .compiled_patterns
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = patterns;
        save_to_file(&self.file_path, &raw)
    }

    /// Removes all entries.
    pub fn clear(&self) -> Result<(), String> {
        let mut compiled = self.compiled.lock().unwrap_or_else(|e| e.into_inner());
        compiled.clear();
        *self
            .compiled_patterns
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Arc::from([]);
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
    // The Rust `regex` crate does not support look-around, so we capture the
    // surrounding non-word boundaries and preserve them during replacement.
    Regex::new(&format!(r"(?i)(^|[^\pL\pN_])({})([^\pL\pN_]|$)", escaped))
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

fn compiled_patterns_from_entries(compiled: &[CompiledEntry]) -> SharedCompiledPatterns {
    compiled
        .iter()
        .map(|e| (e.re.clone(), e.to.clone()))
        .collect::<Vec<_>>()
        .into()
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
    if text.is_empty() {
        return text.to_string();
    }
    let mut result = text.to_string();
    for (re, to) in DEVELOPER_VOCABULARY.iter() {
        if re.is_match(&result) {
            result = re
                .replace_all(&result, |caps: &regex::Captures<'_>| {
                    format!(
                        "{}{}{}",
                        caps.get(1).map_or("", |m| m.as_str()),
                        to,
                        caps.get(3).map_or("", |m| m.as_str())
                    )
                })
                .into_owned();
        }
    }
    for (re, to) in patterns {
        if re.is_match(&result) {
            result = re
                .replace_all(&result, |caps: &regex::Captures<'_>| {
                    format!(
                        "{}{}{}",
                        caps.get(1).map_or("", |m| m.as_str()),
                        to,
                        caps.get(3).map_or("", |m| m.as_str())
                    )
                })
                .into_owned();
        }
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
            apply_dictionary("vocal type is great", &[compiled("vocal type", "Vocalype")]),
            "Vocalype is great"
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
            apply_dictionary("VOCAL TYPE is great", &[compiled("vocal type", "Vocalype")]),
            "Vocalype is great"
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
            apply_dictionary("I love vocal type", &[compiled("vocal type", "Vocalype")]),
            "I love Vocalype"
        );
    }

    #[test]
    fn multiple_entries_applied_in_order() {
        let patterns = vec![
            compiled("vocal type", "Vocalype"),
            compiled("react query", "React Query"),
        ];
        assert_eq!(
            apply_dictionary("vocal type uses react query", &patterns),
            "Vocalype uses React Query"
        );
    }

    #[test]
    fn acronym_uppercase() {
        assert_eq!(
            apply_dictionary("lgtm on this PR", &[compiled("lgtm", "LGTM")]),
            "LGTM on this PR"
        );
    }

    #[test]
    fn developer_vocabulary_is_applied_without_user_dictionary() {
        assert_eq!(
            apply_dictionary("call the api with jwt from react and save auth token", &[]),
            "call the API with JWT from React and save authToken"
        );
    }

    #[test]
    fn developer_vocabulary_handles_spoken_letters_and_camel_case() {
        assert_eq!(
            apply_dictionary("run the c l i and check user id", &[]),
            "run the CLI and check userId"
        );
    }
}
