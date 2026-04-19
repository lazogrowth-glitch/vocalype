//! Code dictation — converts spoken dictation patterns to code syntax.
//!
//! When the user dictates in a code editor, spoken phrases like "let x equals 5"
//! or "open paren close paren" are converted to their code equivalents.
//!
//! Rules are applied in order: multi-word phrases first, single symbols last.

use crate::context_detector::CodeLanguage;

// ── Public entry point ────────────────────────────────────────────────────────

/// Apply code-dictation conversions to `text`.
/// `language` refines which language-specific rules are applied on top of
/// the universal symbol rules.
pub fn apply_code_dictation(text: &str, language: Option<CodeLanguage>) -> String {
    let mut out = text.to_string();

    // Order matters: longer phrases must be replaced before their sub-words.
    apply_multi_word_operators(&mut out);
    apply_language_specific(&mut out, language);
    apply_symbol_words(&mut out);
    apply_spacing_cleanup(&mut out);

    out
}

// ── Multi-word operator phrases ───────────────────────────────────────────────

fn apply_multi_word_operators(s: &mut String) {
    // Each entry: (spoken phrase, code output)
    // Listed longest-first so sub-phrases don't match early.
    const OPERATORS: &[(&str, &str)] = &[
        // Equality / comparison
        ("triple equals",           "==="),
        ("strict equals",           "==="),
        ("double equals",           "=="),
        ("equals equals",           "=="),
        ("not equals",              "!="),
        ("not equal",               "!="),
        ("bang equals",             "!="),
        ("strictly not equal",      "!=="),
        ("greater than or equal to",">="),
        ("greater than or equal",   ">="),
        ("greater or equal",        ">="),
        ("less than or equal to",   "<="),
        ("less than or equal",      "<="),
        ("less or equal",           "<="),
        ("greater than",            ">"),
        ("less than",               "<"),
        // Logical
        ("double ampersand",        "&&"),
        ("and and",                 "&&"),
        ("logical and",             "&&"),
        ("double pipe",             "||"),
        ("pipe pipe",               "||"),
        ("logical or",              "||"),
        // Arrows
        ("fat arrow",               "=>"),
        ("double arrow",            "=>"),
        ("right arrow",             "->"),
        ("thin arrow",              "->"),
        ("left arrow",              "<-"),
        // Brackets
        ("open parenthesis",        "("),
        ("close parenthesis",       ")"),
        ("open paren",              "("),
        ("close paren",             ")"),
        ("left paren",              "("),
        ("right paren",             ")"),
        ("open bracket",            "["),
        ("close bracket",           "]"),
        ("left bracket",            "["),
        ("right bracket",           "]"),
        ("open brace",              "{"),
        ("close brace",             "}"),
        ("left brace",              "{"),
        ("right brace",             "}"),
        ("open curly",              "{"),
        ("close curly",             "}"),
        ("open angle",              "<"),
        ("close angle",             ">"),
        // Arithmetic
        ("plus equals",             "+="),
        ("minus equals",            "-="),
        ("times equals",            "*="),
        ("divide equals",           "/="),
        ("modulo equals",           "%="),
        // Bitwise
        ("bitwise and",             "&"),
        ("bitwise or",              "|"),
        ("bitwise xor",             "^"),
        ("shift left",              "<<"),
        ("shift right",             ">>"),
        // Double-char symbols
        ("double colon",            "::"),
        ("double slash",            "//"),
        ("double dot",              ".."),
        ("triple dot",              "..."),
        ("spread operator",         "..."),
        ("rest operator",           "..."),
        // Whitespace
        ("new line",                "\n"),
        ("newline",                 "\n"),
        ("tab character",           "\t"),
    ];

    for (phrase, symbol) in OPERATORS {
        *s = replace_word_phrase(s, phrase, symbol);
    }
}

// ── Language-specific rules ───────────────────────────────────────────────────

fn apply_language_specific(s: &mut String, language: Option<CodeLanguage>) {
    match language {
        Some(CodeLanguage::Rust) => {
            *s = replace_word_phrase(s, "arrow",     "->");
            *s = replace_word_phrase(s, "lifetime",  "'");
        }
        Some(CodeLanguage::Python) => {
            *s = replace_word_phrase(s, "arrow",     "->");
            // Python doesn't use semicolons — leave "semicolon" for the universal pass
        }
        Some(CodeLanguage::JavaScript) | Some(CodeLanguage::TypeScript) => {
            *s = replace_word_phrase(s, "arrow",     "=>");
        }
        Some(CodeLanguage::Go) => {
            *s = replace_word_phrase(s, "arrow",     "<-");
            *s = replace_word_phrase(s, "short assign", ":=");
        }
        _ => {
            // Default: arrow → =>
            *s = replace_word_phrase(s, "arrow", "=>");
        }
    }
}

// ── Single-word symbol replacements ──────────────────────────────────────────

fn apply_symbol_words(s: &mut String) {
    const SYMBOLS: &[(&str, &str)] = &[
        // Assignment
        ("equals",      "="),
        // Arithmetic
        ("plus",        "+"),
        ("minus",       "-"),
        ("times",       "*"),
        ("multiply",    "*"),
        ("divided",     "/"),
        ("divide",      "/"),
        ("slash",       "/"),
        ("modulo",      "%"),
        ("percent",     "%"),
        // Punctuation
        ("semicolon",   ";"),
        ("colon",       ":"),
        ("comma",       ","),
        ("period",      "."),
        ("dot",         "."),
        ("bang",        "!"),
        ("exclamation", "!"),
        // Quotes & special
        ("backtick",    "`"),
        ("tilde",       "~"),
        ("caret",       "^"),
        ("ampersand",   "&"),
        ("pipe",        "|"),
        ("at",          "@"),
        ("hash",        "#"),
        ("pound",       "#"),
        ("dollar",      "$"),
        ("underscore",  "_"),
        ("backslash",   "\\"),
        ("question",    "?"),
        // Quotes
        ("quote",       "\""),
        ("apostrophe",  "'"),
    ];

    for (word, symbol) in SYMBOLS {
        *s = replace_word_phrase(s, word, symbol);
    }
}

// ── Spacing cleanup ───────────────────────────────────────────────────────────

/// Remove extra spaces that were left between symbols.
/// e.g. "console . log ( " → "console.log("
fn apply_spacing_cleanup(s: &mut String) {
    // Collapse spaces around punctuation-only tokens
    const NO_SPACE_BEFORE: &[char] = &['.', '(', '[', '{', ')', ']', '}', ',', ';', ':'];
    const NO_SPACE_AFTER: &[char]  = &['(', '[', '{', '.'];

    let mut out = String::with_capacity(s.len());
    let chars: Vec<char> = s.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        let ch = chars[i];

        // If this is a space, check context to decide whether to keep it.
        if ch == ' ' {
            let next = chars.get(i + 1).copied().unwrap_or(' ');
            let prev = out.chars().last().unwrap_or(' ');

            let drop_space = NO_SPACE_BEFORE.contains(&next)
                || NO_SPACE_AFTER.contains(&prev);

            if !drop_space {
                out.push(ch);
            }
        } else {
            out.push(ch);
        }
        i += 1;
    }

    *s = out;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Replace every whole-word occurrence of `phrase` (case-insensitive) with
/// `replacement`, keeping surrounding non-word characters intact.
fn replace_word_phrase(s: &str, phrase: &str, replacement: &str) -> String {
    let lower = s.to_lowercase();
    let phrase_lower = phrase.to_lowercase();
    let plen = phrase_lower.len();

    if !lower.contains(phrase_lower.as_str()) {
        return s.to_string();
    }

    let bytes = lower.as_bytes();
    let mut out = String::with_capacity(s.len());
    let mut pos = 0;

    while pos <= lower.len().saturating_sub(plen) {
        if lower[pos..].starts_with(phrase_lower.as_str()) {
            let before_ok = pos == 0
                || !bytes[pos - 1].is_ascii_alphanumeric() && bytes[pos - 1] != b'_';
            let after_pos = pos + plen;
            let after_ok = after_pos >= lower.len()
                || !bytes[after_pos].is_ascii_alphanumeric() && bytes[after_pos] != b'_';

            if before_ok && after_ok {
                out.push_str(replacement);
                pos += plen;
                continue;
            }
        }
        // Advance one character (UTF-8 safe via original string).
        let ch = s[pos..].chars().next().unwrap();
        out.push(ch);
        pos += ch.len_utf8();
    }

    // Append remainder.
    out.push_str(&s[pos..]);
    out
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_assignment() {
        let result = apply_code_dictation("let x equals 5", None);
        assert!(result.contains('='), "expected '=' in: {result}");
    }

    #[test]
    fn converts_comparison() {
        let result = apply_code_dictation("if x greater than 10", None);
        assert!(result.contains('>'), "expected '>' in: {result}");
    }

    #[test]
    fn converts_parens() {
        let result = apply_code_dictation("console dot log open paren x close paren", None);
        assert!(result.contains("console.log(x)"), "got: {result}");
    }

    #[test]
    fn rust_uses_thin_arrow() {
        let result = apply_code_dictation("fn foo open paren close paren arrow String", Some(CodeLanguage::Rust));
        assert!(result.contains("->"), "expected '->' in: {result}");
    }

    #[test]
    fn js_uses_fat_arrow() {
        let result = apply_code_dictation("const f equals open paren x close paren arrow x plus 1", Some(CodeLanguage::JavaScript));
        assert!(result.contains("=>"), "expected '=>' in: {result}");
    }

    #[test]
    fn triple_equals_before_double() {
        let result = apply_code_dictation("if x triple equals y", None);
        assert!(result.contains("==="), "got: {result}");
        assert!(!result.contains("===="), "should not have four equals: {result}");
    }
}
