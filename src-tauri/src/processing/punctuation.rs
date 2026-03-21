//! Lightweight punctuation corrector for transcription post-processing.
//!
//! Runs **after** filler-word removal and **before** dictionary replacement.
//! Pure Rust — no LLM, no network call, negligible latency (<1 µs).
//!
//! # Rules (applied in order)
//!
//! | # | Rule | Skipped for |
//! |---|------|-------------|
//! | 1 | Collapse multiple spaces; trim leading/trailing whitespace | — |
//! | 2 | Remove spaces immediately before `.  !  ?  ,  ;  :  …` | — |
//! | 3 | Append `.` if text has no terminal punctuation | Code (bypass), Chat (casual) |
//! | 4 | Capitalize the first character | Code (bypass) |
//!
//! **Code** context bypasses the function entirely (raw identifiers, casing matters).
//! **Chat** context skips rules 3 and 4 (casual register, no forced period/capital).

use crate::context_detector::AppContextCategory;
use once_cell::sync::Lazy;
use regex::Regex;

// ── Pre-compiled regexes ──────────────────────────────────────────────────────

/// One or more spaces immediately before a punctuation character.
static SPACE_BEFORE_PUNCT: Lazy<Regex> = Lazy::new(|| Regex::new(r" +([.!?,;:…])").unwrap());

/// Two or more consecutive space characters.
static MULTI_SPACE: Lazy<Regex> = Lazy::new(|| Regex::new(r" {2,}").unwrap());

// ── Public API ────────────────────────────────────────────────────────────────

/// Apply lightweight punctuation corrections based on the active app category.
///
/// The function is intentionally conservative: it only fixes the most common
/// speech-to-text artefacts without modifying the user's wording.
pub fn fix_punctuation(text: &str, category: AppContextCategory) -> String {
    // Code: bypass everything — raw identifiers must not be touched.
    if matches!(category, AppContextCategory::Code) {
        return text.to_string();
    }

    // Nothing to do for empty / whitespace-only input.
    if text.trim().is_empty() {
        return text.to_string();
    }

    // ── Rule 1: collapse multiple spaces + trim ────────────────────────────────
    let trimmed = text.trim();
    let mut s: String = MULTI_SPACE.replace_all(trimmed, " ").into_owned();

    // ── Rule 2: remove spaces before punctuation ──────────────────────────────
    // Applies to all contexts including Chat.
    // Examples: "bonjour ." → "bonjour."  /  "merci !" → "merci!"
    s = SPACE_BEFORE_PUNCT.replace_all(&s, "$1").into_owned();

    // Chat: intentionally casual register — no forced terminal punct or capital.
    if matches!(category, AppContextCategory::Chat) {
        return s;
    }

    // ── Rule 3: ensure terminal punctuation ───────────────────────────────────
    if !has_terminal_punct(&s) {
        s.push('.');
    }

    // ── Rule 4: capitalize first character ────────────────────────────────────
    s = capitalize_first(s);

    s
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/// Returns `true` if the last character of `text` is recognised terminal
/// punctuation: `.`, `!`, `?`, `…`, or the three-character sequence `...`.
fn has_terminal_punct(text: &str) -> bool {
    match text.chars().last() {
        Some('.' | '!' | '?' | '…') => true,
        // Three-dot ellipsis written as ASCII
        _ => text.ends_with("..."),
    }
}

/// Return `text` with its first Unicode scalar value upper-cased.
/// Characters that have no upper-case form (digits, punctuation…) are unchanged.
fn capitalize_first(text: String) -> String {
    let mut chars = text.chars();
    match chars.next() {
        None => String::new(),
        Some(first) => {
            // `to_uppercase()` may expand one char into multiple (e.g., ß → SS).
            let upper: String = first.to_uppercase().collect();
            upper + chars.as_str()
        }
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── Context shortcuts ──────────────────────────────────────────────────────
    const DEFAULT: AppContextCategory = AppContextCategory::Unknown;
    const CHAT: AppContextCategory = AppContextCategory::Chat;
    const CODE: AppContextCategory = AppContextCategory::Code;
    const EMAIL: AppContextCategory = AppContextCategory::Email;

    // ── Rule 3 + 4: add period AND capitalize ─────────────────────────────────

    #[test]
    fn adds_period_and_capitalizes() {
        assert_eq!(
            fix_punctuation("bonjour comment ça va", DEFAULT),
            "Bonjour comment ça va."
        );
    }

    #[test]
    fn already_has_period_no_double_period() {
        assert_eq!(
            fix_punctuation("bonjour comment ça va.", DEFAULT),
            "Bonjour comment ça va."
        );
    }

    // ── Rule 3: no period when terminal punct already present ──────────────────

    #[test]
    fn exclamation_present_no_extra_period() {
        // Rule 2 removes the space before !; rule 3 sees ! and skips; rule 4 capitalizes.
        assert_eq!(
            fix_punctuation("bonjour comment ça va !", DEFAULT),
            "Bonjour comment ça va!"
        );
    }

    #[test]
    fn question_mark_present_no_extra_period() {
        assert_eq!(
            fix_punctuation("comment tu vas ?", DEFAULT),
            "Comment tu vas?"
        );
    }

    #[test]
    fn ellipsis_char_no_extra_period() {
        assert_eq!(fix_punctuation("je sais pas…", DEFAULT), "Je sais pas…");
    }

    #[test]
    fn three_dot_ellipsis_no_extra_period() {
        assert_eq!(fix_punctuation("hmm...", DEFAULT), "Hmm...");
    }

    // ── Rule 2: remove spaces before punctuation ──────────────────────────────

    #[test]
    fn removes_space_before_period() {
        assert_eq!(fix_punctuation("bonjour .", DEFAULT), "Bonjour.");
    }

    #[test]
    fn removes_space_before_exclamation() {
        assert_eq!(fix_punctuation("merci !", DEFAULT), "Merci!");
    }

    #[test]
    fn removes_multiple_spaces_before_comma() {
        assert_eq!(fix_punctuation("oui , bien sûr", DEFAULT), "Oui, bien sûr.");
    }

    // ── Chat context: no rule 3 or 4, rule 2 still fires ──────────────────────

    #[test]
    fn chat_no_period_no_capitalize() {
        // User spec: "ouais c'est bon" → "ouais c'est bon"
        assert_eq!(fix_punctuation("ouais c'est bon", CHAT), "ouais c'est bon");
    }

    #[test]
    fn chat_cleans_space_before_punct() {
        // Rule 2 still applies in Chat.
        assert_eq!(fix_punctuation("ok !", CHAT), "ok!");
    }

    #[test]
    fn chat_no_period_even_without_terminal_punct() {
        // No period forced in Chat.
        assert_eq!(fix_punctuation("salut c'est moi", CHAT), "salut c'est moi");
    }

    // ── Code context: full bypass ──────────────────────────────────────────────

    #[test]
    fn code_bypass_all() {
        // User spec: "myVariable = true" → "myVariable = true" (untouched)
        assert_eq!(
            fix_punctuation("myVariable = true", CODE),
            "myVariable = true"
        );
    }

    #[test]
    fn code_bypass_preserves_leading_spaces() {
        // Indented code — spaces must not be trimmed.
        assert_eq!(fix_punctuation("    return nil", CODE), "    return nil");
    }

    // ── Rule 1: collapse double spaces + trim ─────────────────────────────────

    #[test]
    fn collapses_double_spaces() {
        // After collapsing and trimming, rules 3+4 also fire in DEFAULT context.
        assert_eq!(
            fix_punctuation("  double   espace  ", DEFAULT),
            "Double espace."
        );
    }

    #[test]
    fn collapses_double_spaces_chat() {
        // Chat: only rules 1+2 fire — no period, no capitalize.
        assert_eq!(
            fix_punctuation("  double   espace  ", CHAT),
            "double espace"
        );
    }

    // ── Rule 4: capitalize ─────────────────────────────────────────────────────

    #[test]
    fn already_capitalized_stays_capitalized() {
        assert_eq!(fix_punctuation("Bonjour.", DEFAULT), "Bonjour.");
    }

    #[test]
    fn capitalizes_accented_start() {
        // é → É
        assert_eq!(fix_punctuation("écoutez bien", DEFAULT), "Écoutez bien.");
    }

    // ── Email context (same rules as DEFAULT) ─────────────────────────────────

    #[test]
    fn email_adds_period_and_capitalizes() {
        assert_eq!(
            fix_punctuation("merci pour votre message", EMAIL),
            "Merci pour votre message."
        );
    }

    // ── Edge cases ─────────────────────────────────────────────────────────────

    #[test]
    fn empty_string_unchanged() {
        assert_eq!(fix_punctuation("", DEFAULT), "");
    }

    #[test]
    fn whitespace_only_unchanged() {
        // trim().is_empty() guard fires — return original.
        assert_eq!(fix_punctuation("   ", DEFAULT), "   ");
    }

    #[test]
    fn single_word_gets_period_and_cap() {
        assert_eq!(fix_punctuation("ok", DEFAULT), "Ok.");
    }

    #[test]
    fn number_ending_gets_period() {
        // "version 3.0" already ends with '0', no terminal punct → period added.
        // Note: the '.' in "3.0" is mid-word, not terminal.
        assert_eq!(fix_punctuation("version 3.0", DEFAULT), "Version 3.0.");
    }
}
