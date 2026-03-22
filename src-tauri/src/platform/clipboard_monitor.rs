//! Auto-learn dictionary: after a paste, monitor the clipboard for corrections.
//!
//! When enabled, this module waits a short delay after a successful paste, reads
//! the clipboard, and compares it to the original pasted text.  If the user has
//! copied a corrected version of the text, any word-level substitutions are
//! automatically added to the custom dictionary.
//!
//! ## How it works
//!
//! 1. `schedule_clipboard_diff_check` is called immediately after a paste.
//! 2. A background thread sleeps 2 seconds (giving the user time to edit and copy).
//! 3. It reads the clipboard on the main thread (required by Tauri).
//! 4. `compute_word_substitutions` aligns both token lists and extracts substitutions.
//! 5. Each new substitution pair is silently added to the `DictionaryManager`.
//!
//! The heuristic aborts early when the clipboard content is clearly unrelated
//! (very different length, no token overlap) to avoid false positives.

use crate::processing::dictionary::DictionaryManager;
use crate::settings::get_settings;
use log::debug;
use std::sync::{mpsc, Arc};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;

/// Maximum number of substitutions to learn from a single paste event.
const MAX_SUBSTITUTIONS: usize = 5;

/// Maximum ratio difference in word count between original and clipboard text.
const MAX_LENGTH_RATIO_DIFF: f64 = 0.3;

/// Minimum similarity score (0..1) for the overall texts to be considered related.
const MIN_SIMILARITY_SCORE: f64 = 0.4;

/// Schedules a clipboard diff check to run 2 seconds after a paste.
///
/// This is intentionally fire-and-forget: it never blocks the paste pipeline.
pub fn schedule_clipboard_diff_check(app: AppHandle, original_text: String) {
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(2000));

        // Read clipboard on the main thread (Tauri clipboard requires main thread).
        let (tx, rx) = mpsc::channel::<String>();
        let app_for_read = app.clone();
        let dispatch_result = app.run_on_main_thread(move || {
            let text = app_for_read.clipboard().read_text().unwrap_or_default();
            let _ = tx.send(text);
        });

        if dispatch_result.is_err() {
            return;
        }

        let clipboard_text = match rx.recv_timeout(Duration::from_millis(500)) {
            Ok(t) => t,
            Err(_) => return,
        };

        // Bail if the clipboard is empty or unchanged.
        if clipboard_text.is_empty() || clipboard_text == original_text {
            return;
        }

        let settings = get_settings(&app);
        if !settings.auto_learn_dictionary {
            return;
        }

        let substitutions = compute_word_substitutions(&original_text, &clipboard_text);
        if substitutions.is_empty() {
            return;
        }

        let dict = app.state::<Arc<DictionaryManager>>();
        for (from, to) in substitutions {
            debug!("auto-learn: adding dictionary entry '{}' → '{}'", from, to);
            match dict.add(from.clone(), to.clone()) {
                Ok(()) => debug!("auto-learn: added '{}' → '{}'", from, to),
                Err(e) => debug!("auto-learn: skipped '{}' → '{}': {}", from, to, e),
            }
        }
    });
}

/// Returns word-level substitution pairs `(original_word, corrected_word)`.
///
/// The algorithm:
/// 1. Reject if word-count ratio differs by more than `MAX_LENGTH_RATIO_DIFF`.
/// 2. Reject if overall string similarity is below `MIN_SIMILARITY_SCORE`.
/// 3. Align both word lists positionally and collect substituted pairs.
/// 4. Ignore pairs where words differ only in casing.
/// 5. Return at most `MAX_SUBSTITUTIONS` pairs.
fn compute_word_substitutions(original: &str, corrected: &str) -> Vec<(String, String)> {
    let orig_words: Vec<&str> = original.split_whitespace().collect();
    let corr_words: Vec<&str> = corrected.split_whitespace().collect();

    if orig_words.is_empty() || corr_words.is_empty() {
        return vec![];
    }

    // Reject if the word count differs too much.
    let orig_len = orig_words.len() as f64;
    let corr_len = corr_words.len() as f64;
    let ratio_diff = (orig_len - corr_len).abs() / orig_len.max(corr_len);
    if ratio_diff > MAX_LENGTH_RATIO_DIFF {
        return vec![];
    }

    // Reject if the overall strings are not similar enough.
    let similarity = strsim::normalized_levenshtein(original, corrected);
    if similarity < MIN_SIMILARITY_SCORE {
        return vec![];
    }

    // Positional alignment: compare word-by-word up to the shorter list.
    let min_len = orig_words.len().min(corr_words.len());
    let mut substitutions = Vec::new();

    for i in 0..min_len {
        let from = orig_words[i];
        let to = corr_words[i];

        if from == to {
            continue;
        }

        // Skip pure case changes (e.g. "Hello" vs "hello") — not useful.
        if from.to_lowercase() == to.to_lowercase() {
            continue;
        }

        // Skip very short tokens (single letters, punctuation).
        if from.len() < 3 || to.len() < 3 {
            continue;
        }

        // Only learn if the corrected word is meaningfully different.
        let word_sim = strsim::normalized_levenshtein(from, to);
        if word_sim < 0.3 || word_sim > 0.95 {
            // Either completely different (probably unrelated text) or too similar.
            continue;
        }

        substitutions.push((from.to_string(), to.to_string()));
        if substitutions.len() >= MAX_SUBSTITUTIONS {
            break;
        }
    }

    substitutions
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_single_substitution() {
        let subs =
            compute_word_substitutions("I use vocal type every day", "I use Vocalype every day");
        assert_eq!(subs.len(), 1);
        assert_eq!(subs[0].0, "vocal");
    }

    #[test]
    fn rejects_completely_different_text() {
        let subs = compute_word_substitutions(
            "hello world how are you",
            "completely unrelated content here today",
        );
        // Should be empty or very few — overall similarity too low.
        assert!(subs.len() <= 1);
    }

    #[test]
    fn rejects_case_only_changes() {
        let subs = compute_word_substitutions("hello world", "Hello World");
        assert!(subs.is_empty());
    }

    #[test]
    fn rejects_too_different_lengths() {
        let subs =
            compute_word_substitutions("one two three", "one two three four five six seven eight");
        assert!(subs.is_empty());
    }
}
