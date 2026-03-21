//! Filler-word removal for transcription post-processing.
//!
//! Removes spoken hesitations (euh, um…), self-correction phrases
//! (je veux dire, I mean…), and immediate word repetitions before
//! the text is injected or copied to clipboard.

use once_cell::sync::Lazy;
use regex::Regex;

// ---------------------------------------------------------------------------
// Compiled patterns
// ---------------------------------------------------------------------------

/// Pure fillers — stripped whenever they appear as an isolated word.
/// These are unambiguous hesitation sounds with no semantic value.
static PURE_FILLER_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\b(euh|heu|um|uh|erm|ben|bah|hein|nan)\b").unwrap());

/// Self-correction phrases — everything before *and including* the phrase
/// is dropped; what follows becomes the new text.
/// Searched case-insensitively; listed longest-first to avoid partial matches.
const CORRECTION_PHRASES: &[&str] = &[
    "je veux dire ",
    "veux dire ",
    "I mean ",
    "i mean ",
    "wait ",
    "enfin ",
];

/// Clause-start-only fillers — removed only when they open the utterance.
/// Kept mid-sentence to avoid false positives ("that's actually great").
const CLAUSE_START_FILLERS: &[&str] = &[
    "actually ",
    "basically ",
    "voilà ",
    "voila ",
    "genre ",
    "ouais ",
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Remove filler words and self-correction artefacts from `text`.
/// Runs up to 5 passes until the output stabilises.
pub fn clean_transcript(text: &str) -> String {
    if text.trim().is_empty() {
        return text.to_string();
    }

    let original_starts_upper = text
        .chars()
        .next()
        .map(|c| c.is_uppercase())
        .unwrap_or(false);

    let mut s = text.to_string();

    for _ in 0..5 {
        let prev = s.clone();
        s = apply_pass(&s);
        if s == prev {
            break;
        }
    }

    if original_starts_upper {
        s = capitalize_first(&s);
    }

    s
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

fn apply_pass(text: &str) -> String {
    let mut s = text.to_string();

    // 1. Double-start: "WORD WORD rest" → "rest" (same word repeated at opening).
    s = strip_double_start(&s);
    s = normalize_whitespace(&s);

    // 2. Self-correction phrases — keep only what follows the phrase.
    let s_lower = s.to_lowercase();
    'correction: for &phrase in CORRECTION_PHRASES {
        if let Some(pos) = s_lower.find(phrase.to_lowercase().as_str()) {
            let after = s[pos + phrase.len()..].trim_start();
            if !after.is_empty() {
                s = after.to_string();
                break 'correction;
            }
        }
    }
    s = normalize_whitespace(&s);

    // 3. Pure filler words — remove wherever they appear as isolated tokens.
    s = PURE_FILLER_RE.replace_all(&s, "").into_owned();
    s = normalize_whitespace(&s);

    // 4. Clause-start-only fillers — only when they open the utterance.
    let s_lower = s.to_lowercase();
    for &filler in CLAUSE_START_FILLERS {
        if s_lower.starts_with(filler) {
            s = s[filler.len()..].to_string();
            break;
        }
    }
    s = normalize_whitespace(&s);

    s
}

fn strip_double_start(text: &str) -> String {
    let trimmed = text.trim_start();
    let mut words = trimmed.splitn(3, char::is_whitespace);
    let Some(first) = words.next() else {
        return text.to_string();
    };
    let Some(second) = words.next() else {
        return text.to_string();
    };
    let Some(rest) = words.next() else {
        return text.to_string();
    };

    if first.eq_ignore_ascii_case(second) {
        rest.trim_start().to_string()
    } else {
        text.to_string()
    }
}

fn normalize_whitespace(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut prev_space = true; // start true to trim leading whitespace
    for c in text.chars() {
        if c == ' ' || c == '\t' {
            if !prev_space {
                result.push(' ');
            }
            prev_space = true;
        } else {
            result.push(c);
            prev_space = false;
        }
    }
    if result.ends_with(' ') {
        result.pop();
    }
    result
}

fn capitalize_first(text: &str) -> String {
    let mut chars = text.chars();
    match chars.next() {
        None => String::new(),
        Some(first) => {
            let upper: String = first.to_uppercase().collect();
            upper + chars.as_str()
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fr_pure_filler_at_start() {
        assert_eq!(
            clean_transcript("euh je veux envoyer ce message"),
            "je veux envoyer ce message"
        );
    }

    #[test]
    fn en_pure_filler_then_clause_start() {
        assert_eq!(
            clean_transcript("um actually I need to send this"),
            "I need to send this"
        );
    }

    #[test]
    fn fr_double_start_and_correction_phrase() {
        assert_eq!(clean_transcript("je je veux dire envoyer"), "envoyer");
    }

    #[test]
    fn fr_quoi_mid_sentence_preserved() {
        assert_eq!(
            clean_transcript("tu sais quoi c'est bien"),
            "tu sais quoi c'est bien"
        );
    }

    #[test]
    fn en_actually_mid_sentence_preserved() {
        assert_eq!(
            clean_transcript("that's actually great"),
            "that's actually great"
        );
    }

    #[test]
    fn no_cross_language_false_positive() {
        assert_eq!(clean_transcript("le the message"), "le the message");
    }

    #[test]
    fn fr_double_non_false_start() {
        assert_eq!(clean_transcript("non non c'est pas ça"), "c'est pas ça");
    }
}
