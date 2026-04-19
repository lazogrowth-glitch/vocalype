//! Code dictation — converts spoken dictation patterns to code syntax.
//!
//! When the user dictates in a code editor, spoken phrases like "let x equals 5"
//! or "open paren close paren" are converted to their code equivalents.
//!
//! Rules are applied in order: multi-word phrases first, single symbols last.

use crate::context_detector::CodeLanguage;
use regex::Regex;

// ── Code-speak detector ───────────────────────────────────────────────────────

/// Returns true if `text` contains spoken code patterns that strongly indicate
/// the user is dictating code — regardless of which app they are in.
///
/// Uses two tiers:
/// - **Unambiguous** phrases (open paren, camel case…): 1 hit is enough.
/// - **Ambiguous** keywords (function, equals, slash…): need ≥ 2 hits.
pub fn contains_spoken_code_patterns(text: &str) -> bool {
    let lower = text.to_lowercase();

    // Tier 1 — unambiguous spoken-code phrases. One match = code context.
    const UNAMBIGUOUS: &[&str] = &[
        "open paren",
        "close paren",
        "open parenthesis",
        "close parenthesis",
        "open bracket",
        "close bracket",
        "open brace",
        "close brace",
        "open curly",
        "close curly",
        "camel case",
        "snake case",
        "pascal case",
        "triple equals",
        "double equals",
        "not equals",
        "fat arrow",
        "thin arrow",
        "right arrow",
        "plus equals",
        "minus equals",
        "bang equals",
    ];
    if UNAMBIGUOUS.iter().any(|p| lower.contains(p)) {
        return true;
    }

    // Tier 2 — ambiguous keywords. Need ≥ 2 to avoid false positives.
    const AMBIGUOUS: &[&str] = &[
        "function",
        "const ",
        "let ",
        "var ",
        "return",
        "async",
        "await",
        "import",
        "export",
        "interface",
        "semicolon",
        "backtick",
        "underscore",
        "backslash",
        "equals",
        "slash",
    ];
    let hits = AMBIGUOUS.iter().filter(|p| lower.contains(*p)).count();
    hits >= 2
}

// ── Public entry point ────────────────────────────────────────────────────────

/// Apply code-dictation conversions to `text`.
/// `language` refines which language-specific rules are applied on top of
/// the universal symbol rules.
pub fn apply_code_dictation(text: &str, language: Option<CodeLanguage>) -> String {
    let mut out = text.to_string();

    // Casing commands run first so "camel case use state" → "useState" before
    // any symbol replacement touches the words.
    apply_casing_commands(&mut out);
    // Order matters: longer phrases must be replaced before their sub-words.
    apply_multi_word_operators(&mut out);
    apply_language_specific(&mut out, language);
    apply_symbol_words(&mut out);
    apply_spacing_cleanup(&mut out);

    out
}

// ── Casing commands ───────────────────────────────────────────────────────────

/// Convert spoken casing commands into the right identifier format.
///
/// Supported triggers (case-insensitive):
///   "camel case <words>"    → camelCase
///   "snake case <words>"    → snake_case
///   "pascal case <words>"   → PascalCase
///   "constant case <words>" → CONSTANT_CASE
///
/// Captures up to 6 lowercase words after the trigger keyword.
fn apply_casing_commands(s: &mut String) {
    let word_group = r"([a-z]+(?:\s+[a-z]+){0,5})";

    let rules: &[(&str, fn(&str) -> String)] = &[
        (r"(?i)\bcamel\s+case\s+", to_camel_case),
        (r"(?i)\bsnake\s+case\s+", to_snake_case),
        (r"(?i)\bpascal\s+case\s+", to_pascal_case),
        (r"(?i)\bconstant\s+case\s+", to_screaming_snake),
    ];

    for (trigger, converter) in rules {
        let pattern = format!("{}{}", trigger, word_group);
        if let Ok(re) = Regex::new(&pattern) {
            *s = re
                .replace_all(s, |caps: &regex::Captures| converter(&caps[1]))
                .to_string();
        }
    }
}

fn to_camel_case(words: &str) -> String {
    let mut parts = words.split_whitespace();
    let first = parts.next().unwrap_or("").to_lowercase();
    let rest: String = parts
        .map(|w| {
            let mut chars = w.chars();
            match chars.next() {
                None => String::new(),
                Some(f) => f.to_uppercase().to_string() + chars.as_str(),
            }
        })
        .collect();
    first + &rest
}

fn to_snake_case(words: &str) -> String {
    words
        .split_whitespace()
        .map(|w| w.to_lowercase())
        .collect::<Vec<_>>()
        .join("_")
}

fn to_pascal_case(words: &str) -> String {
    words
        .split_whitespace()
        .map(|w| {
            let mut chars = w.chars();
            match chars.next() {
                None => String::new(),
                Some(f) => f.to_uppercase().to_string() + &chars.as_str().to_lowercase(),
            }
        })
        .collect()
}

fn to_screaming_snake(words: &str) -> String {
    words
        .split_whitespace()
        .map(|w| w.to_uppercase())
        .collect::<Vec<_>>()
        .join("_")
}

// ── Multi-word operator phrases ───────────────────────────────────────────────

fn apply_multi_word_operators(s: &mut String) {
    // Each entry: (spoken phrase, code output)
    // Listed longest-first so sub-phrases don't match early.
    const OPERATORS: &[(&str, &str)] = &[
        // Equality / comparison
        ("triple equals", "==="),
        ("strict equals", "==="),
        ("double equals", "=="),
        ("equals equals", "=="),
        ("not equals", "!="),
        ("not equal", "!="),
        ("bang equals", "!="),
        ("strictly not equal", "!=="),
        ("greater than or equal to", ">="),
        ("greater than or equal", ">="),
        ("greater or equal", ">="),
        ("less than or equal to", "<="),
        ("less than or equal", "<="),
        ("less or equal", "<="),
        ("greater than", ">"),
        ("less than", "<"),
        // Logical
        ("double ampersand", "&&"),
        ("and and", "&&"),
        ("logical and", "&&"),
        ("double pipe", "||"),
        ("pipe pipe", "||"),
        ("logical or", "||"),
        // Arrows
        ("fat arrow", "=>"),
        ("double arrow", "=>"),
        ("right arrow", "->"),
        ("thin arrow", "->"),
        ("left arrow", "<-"),
        // Brackets
        ("open parenthesis", "("),
        ("close parenthesis", ")"),
        ("open paren", "("),
        ("close paren", ")"),
        ("left paren", "("),
        ("right paren", ")"),
        ("open bracket", "["),
        ("close bracket", "]"),
        ("left bracket", "["),
        ("right bracket", "]"),
        ("open brace", "{"),
        ("close brace", "}"),
        ("left brace", "{"),
        ("right brace", "}"),
        ("open curly", "{"),
        ("close curly", "}"),
        ("open angle", "<"),
        ("close angle", ">"),
        // Arithmetic
        ("plus equals", "+="),
        ("minus equals", "-="),
        ("times equals", "*="),
        ("divide equals", "/="),
        ("modulo equals", "%="),
        // Bitwise
        ("bitwise and", "&"),
        ("bitwise or", "|"),
        ("bitwise xor", "^"),
        ("shift left", "<<"),
        ("shift right", ">>"),
        // Double-char symbols
        ("double colon", "::"),
        ("double slash", "//"),
        ("double dot", ".."),
        ("triple dot", "..."),
        ("spread operator", "..."),
        ("rest operator", "..."),
        // Whitespace
        ("new line", "\n"),
        ("newline", "\n"),
        ("tab character", "\t"),
    ];

    for (phrase, symbol) in OPERATORS {
        *s = replace_word_phrase(s, phrase, symbol);
    }
}

// ── Language-specific rules ───────────────────────────────────────────────────

fn apply_language_specific(s: &mut String, language: Option<CodeLanguage>) {
    match language {
        Some(CodeLanguage::Rust) => {
            *s = replace_word_phrase(s, "arrow", "->");
            *s = replace_word_phrase(s, "lifetime", "'");
        }
        Some(CodeLanguage::Python) => {
            *s = replace_word_phrase(s, "arrow", "->");
            // Python doesn't use semicolons — leave "semicolon" for the universal pass
        }
        Some(CodeLanguage::JavaScript) | Some(CodeLanguage::TypeScript) => {
            *s = replace_word_phrase(s, "arrow", "=>");
        }
        Some(CodeLanguage::Go) => {
            *s = replace_word_phrase(s, "arrow", "<-");
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
        ("equals", "="),
        // Arithmetic
        ("plus", "+"),
        ("minus", "-"),
        ("times", "*"),
        ("multiply", "*"),
        ("divided", "/"),
        ("divide", "/"),
        ("slash", "/"),
        ("modulo", "%"),
        ("percent", "%"),
        // Punctuation
        ("semicolon", ";"),
        ("colon", ":"),
        ("comma", ","),
        ("period", "."),
        ("dot", "."),
        ("bang", "!"),
        ("exclamation", "!"),
        // Quotes & special
        ("backtick", "`"),
        ("tilde", "~"),
        ("caret", "^"),
        ("ampersand", "&"),
        ("pipe", "|"),
        ("at", "@"),
        ("hash", "#"),
        ("pound", "#"),
        ("dollar", "$"),
        ("underscore", "_"),
        ("backslash", "\\"),
        ("question", "?"),
        // Quotes
        ("quote", "\""),
        ("apostrophe", "'"),
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
    const NO_SPACE_AFTER: &[char] = &['(', '[', '{', '.'];

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

            let drop_space = NO_SPACE_BEFORE.contains(&next) || NO_SPACE_AFTER.contains(&prev);

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
            let before_ok =
                pos == 0 || !bytes[pos - 1].is_ascii_alphanumeric() && bytes[pos - 1] != b'_';
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
        let result = apply_code_dictation(
            "fn foo open paren close paren arrow String",
            Some(CodeLanguage::Rust),
        );
        assert!(result.contains("->"), "expected '->' in: {result}");
    }

    #[test]
    fn js_uses_fat_arrow() {
        let result = apply_code_dictation(
            "const f equals open paren x close paren arrow x plus 1",
            Some(CodeLanguage::JavaScript),
        );
        assert!(result.contains("=>"), "expected '=>' in: {result}");
    }

    #[test]
    fn camel_case_use_state() {
        let result = apply_code_dictation("camel case use state", None);
        assert_eq!(result, "useState", "got: {result}");
    }

    #[test]
    fn camel_case_multi_word() {
        let result = apply_code_dictation("camel case my function name", None);
        assert_eq!(result, "myFunctionName", "got: {result}");
    }

    #[test]
    fn snake_case_basic() {
        let result = apply_code_dictation("snake case my variable", None);
        assert_eq!(result, "my_variable", "got: {result}");
    }

    #[test]
    fn pascal_case_component() {
        let result = apply_code_dictation("pascal case my component", None);
        assert_eq!(result, "MyComponent", "got: {result}");
    }

    #[test]
    fn constant_case_basic() {
        let result = apply_code_dictation("constant case max retries", None);
        assert_eq!(result, "MAX_RETRIES", "got: {result}");
    }

    #[test]
    fn casing_in_sentence() {
        let result = apply_code_dictation("const camel case handle click equals", None);
        assert!(result.contains("handleClick"), "got: {result}");
    }

    #[test]
    fn triple_equals_before_double() {
        let result = apply_code_dictation("if x triple equals y", None);
        assert!(result.contains("==="), "got: {result}");
        assert!(
            !result.contains("===="),
            "should not have four equals: {result}"
        );
    }
}
