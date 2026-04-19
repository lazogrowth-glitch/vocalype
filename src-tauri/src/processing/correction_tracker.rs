//! Correction tracker — records user corrections of transcriptions and
//! identifies word-level substitution candidates for the dictionary.
//!
//! # How it works
//!
//! When a user edits a transcription (e.g. "tremblan appelle moi se soir" →
//! "Tremblay appelle-moi ce soir"), we diff the two strings at the word level
//! and produce `CorrectionCandidate` pairs like ("tremblan" → "Tremblay").
//!
//! Each candidate is tracked in `correction_counts.json`. When the count
//! reaches `AUTO_ADD_THRESHOLD`, the correction is ready to be silently added
//! to the user dictionary.

use log::warn;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};

const COUNTS_FILE: &str = "correction_counts.json";
/// Number of times a correction must be seen before auto-adding to dictionary.
pub const AUTO_ADD_THRESHOLD: u32 = 2;
/// Minimum character length for a word to be a dictionary candidate.
const MIN_WORD_LEN: usize = 3;

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawCandidate {
    pub from: String,
    pub to: String,
}

// ── Tracker ───────────────────────────────────────────────────────────────────

pub struct CorrectionTracker {
    counts: Mutex<HashMap<String, u32>>,
    file_path: PathBuf,
}

impl CorrectionTracker {
    pub fn new(app_handle: &AppHandle) -> Arc<Self> {
        let app_data_dir = app_handle
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| PathBuf::from("."));
        let file_path = app_data_dir.join(COUNTS_FILE);
        let counts = load_counts(&file_path).unwrap_or_default();
        Arc::new(Self {
            counts: Mutex::new(counts),
            file_path,
        })
    }

    /// Increment the count for a `(from, to)` pair and persist.
    /// Returns the new count.
    pub fn record(&self, from: &str, to: &str) -> u32 {
        let key = make_key(from, to);
        let mut counts = self.counts.lock().unwrap_or_else(|e| e.into_inner());
        let entry = counts.entry(key).or_insert(0);
        *entry += 1;
        let new_count = *entry;
        if let Err(e) = save_counts(&self.file_path, &counts) {
            warn!("correction_tracker: failed to persist counts: {}", e);
        }
        new_count
    }

    pub fn get_count(&self, from: &str, to: &str) -> u32 {
        let key = make_key(from, to);
        self.counts
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(&key)
            .copied()
            .unwrap_or(0)
    }

    /// Return a snapshot of all (key → count) pairs for stats computation.
    pub fn all_counts(&self) -> std::collections::HashMap<String, u32> {
        self.counts
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }
}

fn make_key(from: &str, to: &str) -> String {
    format!("{}\x00{}", from.to_lowercase(), to.to_lowercase())
}

// ── Word-level diff ───────────────────────────────────────────────────────────

/// Produce word-level substitution candidates between `original` and `corrected`.
///
/// Uses a longest-common-subsequence approach to align the two sequences and
/// extracts (deleted_segment → inserted_segment) hunks as candidates.
pub fn diff_words(original: &str, corrected: &str) -> Vec<RawCandidate> {
    let orig = tokenize(original);
    let corr = tokenize(corrected);

    if orig.is_empty() || corr.is_empty() {
        return vec![];
    }

    let m = orig.len();
    let n = corr.len();

    // Build a compact LCS table. Tokens are already normalized, so the inner
    // loop avoids repeated lowercase allocations on every comparison.
    let stride = n + 1;
    let mut dp = vec![0usize; (m + 1) * stride];
    for i in 1..=m {
        for j in 1..=n {
            let idx = i * stride + j;
            if orig[i - 1].norm == corr[j - 1].norm {
                dp[idx] = dp[(i - 1) * stride + (j - 1)] + 1;
            } else {
                dp[idx] = dp[(i - 1) * stride + j].max(dp[i * stride + (j - 1)]);
            }
        }
    }

    // Backtrack: collect consecutive delete/insert hunks
    let mut result = Vec::new();
    let (mut i, mut j) = (m, n);
    let mut del_buf: Vec<String> = Vec::new();
    let mut ins_buf: Vec<String> = Vec::new();

    while i > 0 || j > 0 {
        if i > 0 && j > 0 && orig[i - 1].norm == corr[j - 1].norm {
            // Match — flush pending hunk first
            flush(&mut del_buf, &mut ins_buf, &mut result);
            i -= 1;
            j -= 1;
        } else if j > 0 && (i == 0 || dp[i * stride + (j - 1)] >= dp[(i - 1) * stride + j]) {
            ins_buf.push(corr[j - 1].text.clone());
            j -= 1;
        } else {
            del_buf.push(orig[i - 1].text.clone());
            i -= 1;
        }
    }
    flush(&mut del_buf, &mut ins_buf, &mut result);

    result
}

/// Flush a pending hunk (del_buf, ins_buf) into candidates.
/// Both buffers are in reverse order at call time.
fn flush(del: &mut Vec<String>, ins: &mut Vec<String>, out: &mut Vec<RawCandidate>) {
    if del.is_empty() || ins.is_empty() {
        del.clear();
        ins.clear();
        return;
    }

    del.reverse();
    ins.reverse();

    let candidate = match (del.len(), ins.len()) {
        // Simple 1-to-1 word substitution: "tremblan" → "Tremblay"
        (1, 1) => {
            let from = del[0].clone();
            let to = ins[0].clone();
            if from.to_lowercase() != to.to_lowercase() && is_worth_learning(&from) {
                Some(RawCandidate { from, to })
            } else {
                None
            }
        }
        // Multi-word → single word: "vocal type" → "Vocalype"
        (_, 1) => {
            let from = del.join(" ");
            let to = ins[0].clone();
            if from.to_lowercase() != to.to_lowercase() {
                Some(RawCandidate { from, to })
            } else {
                None
            }
        }
        // Single word → multi-word: "rsi" → "R.S.I."
        (1, _) => {
            let from = del[0].clone();
            let to = ins.join(" ");
            if from.to_lowercase() != to.to_lowercase() && is_worth_learning(&from) {
                Some(RawCandidate { from, to })
            } else {
                None
            }
        }
        // N-to-M (complex replacement): skip to avoid noisy entries
        _ => None,
    };

    if let Some(c) = candidate {
        out.push(c);
    }

    del.clear();
    ins.clear();
}

/// Split text into word tokens, stripping surrounding punctuation.
fn tokenize(text: &str) -> Vec<Token> {
    text.split_whitespace()
        .filter_map(|w| {
            let cleaned = w
                .trim_matches(|c: char| !c.is_alphanumeric() && c != '\'' && c != '-')
                .to_string();
            if cleaned.is_empty() {
                None
            } else {
                Some(Token {
                    norm: cleaned.to_lowercase(),
                    text: cleaned,
                })
            }
        })
        .collect()
}

#[derive(Debug, Clone)]
struct Token {
    text: String,
    norm: String,
}

/// Return true if this word is a viable dictionary candidate.
/// Filters out very short words (articles, prepositions, punctuation-only).
fn is_worth_learning(word: &str) -> bool {
    word.chars().filter(|c| c.is_alphabetic()).count() >= MIN_WORD_LEN
}

// ── Persistence ───────────────────────────────────────────────────────────────

fn load_counts(path: &PathBuf) -> Option<HashMap<String, u32>> {
    let content = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

fn save_counts(path: &PathBuf, counts: &HashMap<String, u32>) -> Result<(), String> {
    let content = serde_json::to_string(counts).map_err(|e| e.to_string())?;
    std::fs::write(path, content).map_err(|e| e.to_string())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn candidates(orig: &str, corr: &str) -> Vec<(String, String)> {
        diff_words(orig, corr)
            .into_iter()
            .map(|c| (c.from, c.to))
            .collect()
    }

    #[test]
    fn single_word_substitution() {
        let c = candidates(
            "tremblan appelle moi ce soir",
            "Tremblay appelle moi ce soir",
        );
        assert_eq!(c, vec![("tremblan".to_string(), "Tremblay".to_string())]);
    }

    #[test]
    fn multi_word_to_single() {
        let c = candidates(
            "j'utilise vocal type au quotidien",
            "j'utilise Vocalype au quotidien",
        );
        assert_eq!(c, vec![("vocal type".to_string(), "Vocalype".to_string())]);
    }

    #[test]
    fn no_change() {
        let c = candidates("bonjour tout le monde", "bonjour tout le monde");
        assert!(c.is_empty());
    }

    #[test]
    fn case_only_change_ignored() {
        // "tremblay" → "Tremblay" — same word, different case only; skip
        let c = candidates("tremblay est là", "Tremblay est là");
        assert!(c.is_empty(), "got: {:?}", c);
    }

    #[test]
    fn two_substitutions() {
        let c = candidates("tremblan appelle se soir", "Tremblay appelle ce soir");
        // "tremblan"→"Tremblay" and "se"→"ce" — but "se" is only 2 chars, filtered
        assert!(
            c.iter().any(|(f, _)| f == "tremblan"),
            "missing tremblan: {:?}",
            c
        );
    }

    #[test]
    fn short_word_filtered() {
        // "se" → "ce" should be ignored (< MIN_WORD_LEN alphabetic chars)
        let c = candidates("va se soir", "va ce soir");
        assert!(c.is_empty(), "got: {:?}", c);
    }
}
