//! Smart paste adaptation — adjusts pasted text to fit naturally in context.
//!
//! Applied in `platform/clipboard.rs` just before text injection.
//!
//! Rules (applied in order)
//! ────────────────────────
//! 1. **Code context** (terminal / IDE):
//!    Strip the trailing auto-period that speech models add.
//!    No other changes — identifiers, casing and spacing are untouched.
//!
//! 2. **Leading space** (non-Code):
//!    If the cursor is preceded by a non-space character and the text to paste
//!    doesn't already start with whitespace, prepend a space.
//!    Prevents "wordsrunningtogether" when dictating mid-sentence.
//!
//! 3. **Capitalization** (non-Code):
//!    • Sentence start (`.` `!` `?` or empty field) → uppercase first letter.
//!    • Mid-sentence after `,` `;` `:` → lowercase first letter,
//!      unless it is the standalone first-person pronoun "I".

use crate::context_detector::AppContextCategory;
use crate::platform::cursor_context::CursorContext;
use log::debug;

// ── Public API ────────────────────────────────────────────────────────────── //

pub struct PasteAdaptation {
    pub text: String,
}

/// Adapt `text` for natural insertion at the current cursor position.
pub fn adapt(text: &str, ctx: &CursorContext, category: AppContextCategory) -> PasteAdaptation {
    if text.is_empty() {
        return PasteAdaptation {
            text: String::new(),
        };
    }

    // ── Code / terminal ─────────────────────────────────────────────────── //
    if matches!(category, AppContextCategory::Code) {
        let result = strip_trailing_auto_period(text);
        if result != text {
            debug!("[SmartPaste] code: stripped trailing period");
        }
        return PasteAdaptation { text: result };
    }

    // ── Context unavailable → no adaptation ─────────────────────────────── //
    if !ctx.is_available {
        return PasteAdaptation {
            text: text.to_string(),
        };
    }

    let mut result = text.to_string();
    let mut changes: Vec<&str> = Vec::new();

    // ── Rule 2: leading space ────────────────────────────────────────────── //
    let needs_space = !ctx.has_trailing_whitespace()
        && !result.starts_with(|c: char| c.is_whitespace())
        && !preceded_by_no_space_char(&ctx.preceding_text);

    if needs_space {
        result.insert(0, ' ');
        changes.push("leading-space");
    }

    // ── Rule 3: capitalization ───────────────────────────────────────────── //
    // `content_start` = char index of the first "real" character (past any
    // inserted leading space).
    let content_start = usize::from(needs_space);

    if ctx.is_at_sentence_start() {
        result = capitalize_at(result, content_start);
        changes.push("capitalize");
    } else if ctx.is_mid_sentence() {
        result = lowercase_at(result, content_start);
        changes.push("lowercase");
    }

    if !changes.is_empty() {
        debug!("[SmartPaste] {:?}: {:?} → {:?}", changes, text, result);
    }

    PasteAdaptation { text: result }
}

// ── Helpers ───────────────────────────────────────────────────────────────── //

/// Strip a single trailing period that the speech model added automatically.
/// Does NOT strip `!`, `?`, or ellipsis (`...`).
/// Preserves any trailing space appended by the "append_trailing_space" setting.
fn strip_trailing_auto_period(text: &str) -> String {
    let has_trailing_space = text.ends_with(' ');
    let trimmed = text.trim_end_matches(' ');
    if trimmed.is_empty() {
        return text.to_string();
    }
    if trimmed.ends_with('.') && !trimmed.ends_with("..") {
        // Remove exactly the one trailing period ('.' is always 1 byte in UTF-8).
        let without = &trimmed[..trimmed.len() - 1];
        let result = without.trim_end().to_string();
        if has_trailing_space {
            format!("{} ", result)
        } else {
            result
        }
    } else {
        text.to_string()
    }
}

/// True when `preceding_text` ends with a character after which no leading space
/// should be inserted (opening brackets, quotes, hyphens, slashes…).
fn preceded_by_no_space_char(preceding_text: &str) -> bool {
    matches!(
        preceding_text.chars().last(),
        Some('(' | '[' | '{' | '"' | '\'' | '«' | '\u{201C}' | '-' | '/')
    )
}

/// Uppercase the first alphabetic character at or after char-index `from`.
fn capitalize_at(text: String, from: usize) -> String {
    let prefix: String = text.chars().take(from).collect();
    let rest: String = text.chars().skip(from).collect();
    let mut result = prefix;
    let mut done = false;
    for c in rest.chars() {
        if !done && c.is_alphabetic() {
            result.extend(c.to_uppercase());
            done = true;
        } else {
            result.push(c);
        }
    }
    if done {
        result
    } else {
        text
    } // no alphabetic char → unchanged
}

/// Lowercase the first alphabetic character at or after char-index `from`,
/// unless it is the standalone first-person pronoun "I".
fn lowercase_at(text: String, from: usize) -> String {
    let prefix: String = text.chars().take(from).collect();
    let rest: String = text.chars().skip(from).collect();

    // Walk `rest` to find the first alphabetic character.
    let mut pre_alpha = String::new();
    let mut chars = rest.chars();
    let first_alpha = loop {
        match chars.next() {
            None => return text, // no alphabetic char
            Some(c) if c.is_alphabetic() => break c,
            Some(c) => pre_alpha.push(c),
        }
    };

    // Keep standalone "I" uppercase.
    if first_alpha == 'I' {
        let next = chars.clone().next();
        if next.map(|c| !c.is_alphabetic()).unwrap_or(true) {
            return text;
        }
    }

    if !first_alpha.is_uppercase() {
        return text;
    }

    let lowered: String = first_alpha.to_lowercase().collect();
    let tail: String = chars.collect();
    format!("{}{}{}{}", prefix, pre_alpha, lowered, tail)
}

// ── Tests ─────────────────────────────────────────────────────────────────── //

#[cfg(test)]
mod tests {
    use super::*;
    use crate::context_detector::AppContextCategory;
    use crate::platform::cursor_context::CursorContext;

    fn ctx(text: &str) -> CursorContext {
        CursorContext::available(text.to_string())
    }
    fn no_ctx() -> CursorContext {
        CursorContext::unavailable()
    }

    // ── Leading space ──────────────────────────────────────────────────── //

    #[test]
    fn adds_space_when_preceding_ends_with_word() {
        let r = adapt("world", &ctx("hello"), AppContextCategory::Unknown);
        assert_eq!(r.text, " world");
    }

    #[test]
    fn no_space_when_preceding_ends_with_space() {
        let r = adapt("world", &ctx("hello "), AppContextCategory::Unknown);
        assert_eq!(r.text, "world");
    }

    #[test]
    fn no_space_at_start_of_field() {
        // Empty preceding → start of field → capitalize, no space.
        let r = adapt("hello", &ctx(""), AppContextCategory::Unknown);
        assert_eq!(r.text, "Hello");
    }

    #[test]
    fn no_space_after_opening_bracket() {
        let r = adapt("hello", &ctx("("), AppContextCategory::Unknown);
        assert_eq!(r.text, "hello");
    }

    // ── Capitalization ─────────────────────────────────────────────────── //

    #[test]
    fn capitalizes_after_period_with_trailing_space() {
        let r = adapt(
            "hello world",
            &ctx("End of sentence. "),
            AppContextCategory::Unknown,
        );
        assert_eq!(r.text, "Hello world");
    }

    #[test]
    fn capitalizes_after_period_no_space() {
        // "done." → no trailing space → needs leading space AND capitalize.
        let r = adapt("hello", &ctx("done."), AppContextCategory::Unknown);
        assert_eq!(r.text, " Hello");
    }

    #[test]
    fn capitalizes_at_empty_field() {
        let r = adapt("hello", &ctx(""), AppContextCategory::Unknown);
        assert_eq!(r.text, "Hello");
    }

    #[test]
    fn lowercases_after_comma() {
        let r = adapt(
            "Hello world",
            &ctx("first part, "),
            AppContextCategory::Unknown,
        );
        assert_eq!(r.text, "hello world");
    }

    #[test]
    fn lowercases_after_semicolon() {
        let r = adapt("Hello", &ctx("part one; "), AppContextCategory::Unknown);
        assert_eq!(r.text, "hello");
    }

    #[test]
    fn lowercases_after_colon() {
        let r = adapt("Hello", &ctx("Note: "), AppContextCategory::Unknown);
        assert_eq!(r.text, "hello");
    }

    #[test]
    fn keeps_standalone_i_uppercase_after_comma() {
        let r = adapt("I think so", &ctx("well, "), AppContextCategory::Unknown);
        assert_eq!(r.text, "I think so");
    }

    #[test]
    fn lowercases_word_starting_with_i_after_comma() {
        // "In" is not the standalone pronoun "I".
        let r = adapt("In my opinion", &ctx("well, "), AppContextCategory::Unknown);
        assert_eq!(r.text, "in my opinion");
    }

    #[test]
    fn combined_space_and_capitalize() {
        // Preceding ends with '.' but no space → add space AND capitalize.
        let r = adapt("hello", &ctx("done."), AppContextCategory::Unknown);
        assert_eq!(r.text, " Hello");
    }

    // ── Code context ───────────────────────────────────────────────────── //

    #[test]
    fn code_strips_trailing_period() {
        let r = adapt("return true.", &no_ctx(), AppContextCategory::Code);
        assert_eq!(r.text, "return true");
    }

    #[test]
    fn code_strips_period_preserves_trailing_space() {
        let r = adapt("return true. ", &no_ctx(), AppContextCategory::Code);
        assert_eq!(r.text, "return true ");
    }

    #[test]
    fn code_preserves_ellipsis() {
        let r = adapt("wait...", &no_ctx(), AppContextCategory::Code);
        assert_eq!(r.text, "wait...");
    }

    #[test]
    fn code_preserves_exclamation() {
        let r = adapt("panic!", &no_ctx(), AppContextCategory::Code);
        assert_eq!(r.text, "panic!");
    }

    #[test]
    fn code_no_capitalization_or_space() {
        let r = adapt("return value.", &ctx(""), AppContextCategory::Code);
        assert_eq!(r.text, "return value");
    }

    // ── No context → passthrough ───────────────────────────────────────── //

    #[test]
    fn no_adaptation_without_context() {
        let r = adapt("hello World", &no_ctx(), AppContextCategory::Unknown);
        assert_eq!(r.text, "hello World");
    }

    // ── Strip period helper ────────────────────────────────────────────── //

    #[test]
    fn strip_period_does_not_touch_question_mark() {
        assert_eq!(strip_trailing_auto_period("Really?"), "Really?");
    }

    #[test]
    fn strip_period_preserves_path_extension() {
        // "config.py" ends in a letter after the dot — not a lone period.
        assert_eq!(strip_trailing_auto_period("config.py"), "config.py");
    }
}
