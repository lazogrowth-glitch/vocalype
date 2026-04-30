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

const AUDIO_SILENCE_ENERGY_THRESHOLD: f32 = 1e-5;
const AUDIO_TRAILING_END_PUNCT_MS: usize = 420;
const AUDIO_TRAILING_STRONG_END_PUNCT_MS: usize = 700;

// ── Pre-compiled regexes ──────────────────────────────────────────────────────

/// One or more spaces immediately before a punctuation character.
static SPACE_BEFORE_PUNCT: Lazy<Regex> = Lazy::new(|| Regex::new(r" +([.!?,;:…])").unwrap());

/// Two or more consecutive space characters.
static MULTI_SPACE: Lazy<Regex> = Lazy::new(|| Regex::new(r" {2,}").unwrap());

/// Informal salutation + name word + optional comma + body.
/// Covers single-word greetings in all supported languages.
/// The name is captured in group 2 so subject pronouns can be rejected in code.
static EMAIL_SALUTATION_WITH_NAME_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(concat!(
        r"(?i)^(",
        // FR
        r"Bonjour|Bonsoir|Salut|Cher|Chère|Madame|Monsieur|",
        // EN
        r"Hello|Hi|Hey|Dear|",
        // DE
        r"Hallo|Hej|",
        // ES
        r"Hola|",
        // IT
        r"Ciao|Salve|",
        // PT
        r"Olá|",
        // PL
        r"Cześć|Witaj|",
        // CS
        r"Ahoj|",
        // TR
        r"Merhaba|",
        // RU
        r"Привет|Здравствуйте|",
        // UK
        r"Привіт|Вітаю|",
        // VI
        r"Chào|",
        // Multi-word (EN already present above as prefix)
        r"Good\s+(?:morning|afternoon|evening)",
        r")\s+(\w+),?\s+",
    ))
    .unwrap()
});

/// Any salutation immediately followed by a comma + body (no separate name capture).
/// Covers formal/multi-word greetings that always use a comma.
static EMAIL_SALUTATION_COMMA_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(concat!(
        r"(?i)^(",
        // FR
        r"Bonjour|Bonsoir|Salut|Cher|Chère|Madame|Monsieur|",
        // EN
        r"Hello|Hi|Hey|Dear|Good\s+(?:morning|afternoon|evening)|",
        // DE
        r"Hallo|Hej|Liebe[rs]?|Sehr\s+geehrte[rsm]?|Guten\s+(?:Morgen|Tag|Abend)|",
        // ES
        r"Hola|Estimad[ao]|Querid[ao]|Buenos\s+d[íi]as|Buenas\s+(?:tardes|noches)|",
        // IT
        r"Ciao|Salve|Gentile|Egregio|Egregia|Buongiorno|Buonasera|",
        // PT
        r"Olá|Car[ao]|Prezad[ao]|Bom\s+dia|Boa\s+(?:tarde|noite)|",
        // PL
        r"Cześć|Witaj(?:cie)?|Szanowny|Szanowna|Drogi|Droga|",
        // CS
        r"Ahoj|Dobr[yý]\s+den|Vážený|Vážená|Milý|Milá|",
        // TR
        r"Merhaba|Say[ıi]n|",
        // RU
        r"Привет|Здравствуйте|Уважаемый|Уважаемая|Дорогой|Дорогая|Добрый\s+(?:день|вечер|утро)|",
        // UK
        r"Привіт|Вітаю|Шановний|Шановна|Добрий\s+день|Доброго\s+дня|",
        // AR
        r"مرحبا|السلام\s+عليكم|عزيزي|عزيزتي|",
        // KO
        r"안녕하세요|",
        // JA
        r"こんにちは|お世話になっております|",
        // ZH
        r"你好|您好|亲爱的",
        r"),\s+",
    ))
    .unwrap()
});

/// Subject pronouns that are never email recipient names (lowercase, all 17 languages).
const EMAIL_SUBJECT_PRONOUNS: &[&str] = &[
    // FR
    "je", "tu", "vous", "il", "elle", "nous", "ils", "elles", "on", "y", "en", // EN
    "i", "you", "we", "he", "she", "they", "it", // DE
    "ich", "du", "sie", "er", "wir", "ihr", "man", // ES
    "yo", "tú", "usted", "él", "ella", "nosotros", "vosotros", "ellos", "ellas", // IT
    "io", "tu", "lei", "lui", "noi", "voi", "loro", // PT
    "eu", "tu", "você", "ele", "ela", "nós", "vós", "eles", "elas", // PL
    "ja", "ty", "pan", "pani", "on", "ona", "my", "wy", "oni", "one", // CS
    "já", "ty", "on", "ona", "my", "vy", "oni", // TR
    "ben", "sen", "siz", "o", "biz", "onlar", // RU
    "я", "ты", "вы", "он", "она", "мы", "они", // UK
    "я", "ти", "ви", "він", "вона", "ми", "вони", // VI
    "tôi", "bạn", "anh", "chị", "em",
];

/// Common email closing phrase preceded by whitespace, at the end of the text.
static EMAIL_CLOSING_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(concat!(
        r"(?i)\s+(",
        // FR
        r"Cordialement|Bien\s+à\s+vous|Bonne\s+journ[ée]e|[AÀ]\s+bient[oô]t|Amicalement|Bien\s+cordialement|",
        // EN
        r"Best\s+regards|Kind\s+regards|Warm\s+regards|Sincerely(?:\s+yours)?|Yours\s+(?:sincerely|truly|faithfully)|Regards|Cheers|Best|",
        // DE
        r"Mit\s+freundlichen\s+Gr[üu][ßs]en|Viele\s+Gr[üu][ßs]e|Liebe\s+Gr[üu][ßs]e|Freundliche\s+Gr[üu][ßs]e|Hochachtungsvoll|MfG|",
        // ES
        r"Atentamente|Cordialmente|Saludos\s+cordiales|Un\s+saludo|Saludos|Con\s+cari[ñn]o|",
        // IT
        r"Cordiali\s+saluti|Distinti\s+saluti|A\s+presto|Saluti|",
        // PT
        r"Atenciosamente|Abra[çc]os|Com\s+os\s+melhores\s+cumprimentos|Sauda[çc][õo]es|",
        // PL
        r"Z\s+powa[żz]aniem|Pozdrawiam|Serdecznie\s+pozdrawiam|Z\s+wyrazami\s+szacunku|",
        // CS
        r"S\s+pozdravem|S\s+[uú]ctou|Se\s+srde[čc]n[yý]m\s+pozdravem|",
        // TR
        r"Sayg[ıi]lar[ıi]mla|Sayg[ıi]lar[ıi]m[ıi]zla|Selamlar[ıi]mla|",
        // RU
        r"С\s+уважением|Всего\s+хорошего|С\s+наилучшими\s+пожеланиями|Искренне\s+ваш|",
        // UK
        r"З\s+повагою|З\s+найкращими\s+побажаннями|Щиро\s+ваш|",
        // AR
        r"مع\s+التحية|تحياتي|مع\s+خالص\s+التحيات|بكل\s+احترام|",
        // VI
        r"Trân\s+trọng|Thân\s+ái|Kính\s+thư|",
        // KO / JA / ZH (common sign-offs)
        r"감사합니다|よろしくお願いいたします|此致",
        r")[,.]?\s*$",
    ))
    .unwrap()
});

// ── Public API ────────────────────────────────────────────────────────────────

/// Apply lightweight punctuation corrections based on the active app category.
///
/// The function is intentionally conservative: it only fixes the most common
/// speech-to-text artefacts without modifying the user's wording.
pub fn fix_punctuation_with_audio(
    text: &str,
    category: AppContextCategory,
    audio_samples: Option<&[f32]>,
) -> String {
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
    let trailing_silence_ms = audio_samples.map(trailing_silence_ms).unwrap_or(usize::MAX);
    let enough_terminal_pause =
        trailing_silence_ms >= AUDIO_TRAILING_END_PUNCT_MS || audio_samples.is_none();
    if !has_terminal_punct(&s)
        && !has_terminal_soft_separator(&s)
        && !looks_like_open_ended_tail(&s)
        && !ends_with_continuation_marker(&s)
        && enough_terminal_pause
    {
        s.push(if looks_like_question(&s) { '?' } else { '.' });
    }

    // ── Rule 4: capitalize first character ────────────────────────────────────
    s = capitalize_first(s);

    // ── Rule 5 (Email only): structure with line breaks ───────────────────────
    // Detects "Salutation, body" → "Salutation,\n\nBody" and moves a closing
    // phrase to its own paragraph.  Runs after rules 1–4 so the text is already
    // trimmed and has terminal punctuation before we re-split it.
    if matches!(category, AppContextCategory::Email) {
        s = apply_email_structure(s);
    }

    s
}

pub fn fix_punctuation(text: &str, category: AppContextCategory) -> String {
    fix_punctuation_with_audio(text, category, None)
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

fn has_terminal_soft_separator(text: &str) -> bool {
    matches!(text.chars().last(), Some(',' | ':' | ';'))
}

fn trailing_silence_ms(samples: &[f32]) -> usize {
    if samples.is_empty() {
        return 0;
    }
    let mut silent_samples = 0usize;
    for sample in samples.iter().rev() {
        if sample * sample <= AUDIO_SILENCE_ENERGY_THRESHOLD {
            silent_samples += 1;
        } else {
            break;
        }
    }
    (silent_samples * 1000) / 16_000
}

fn last_word_lower(text: &str) -> Option<String> {
    text.split_whitespace()
        .last()
        .map(|token| {
            token
                .chars()
                .filter(|c| c.is_alphanumeric() || matches!(c, '\'' | '’'))
                .collect::<String>()
                .to_lowercase()
        })
        .filter(|token| !token.is_empty())
}

fn trailing_words_lower(text: &str, max_words: usize) -> Vec<String> {
    let mut words: Vec<String> = text
        .split_whitespace()
        .map(|token| {
            token
                .chars()
                .filter(|c| c.is_alphanumeric() || matches!(c, '\'' | '’'))
                .collect::<String>()
                .to_lowercase()
        })
        .filter(|token| !token.is_empty())
        .collect();
    if words.len() > max_words {
        words.drain(0..words.len() - max_words);
    }
    words
}

fn looks_like_open_ended_tail(text: &str) -> bool {
    let Some(last) = last_word_lower(text) else {
        return false;
    };

    const OPEN_ENDED_TAILS: &[&str] = &[
        // French
        "et", "ou", "mais", "donc", "car", "que", "si", "quand", "comme", "avec", "pour", "sur",
        "dans", "de", "du", "des", "le", "la", "les", "un", "une", // English
        "and", "or", "but", "because", "that", "which", "who", "if", "when", "while", "with",
        "for", "to", "of", "in", "on", "at", "the", "a", "an", // Spanish
        "y", "o", "pero", "porque", "cuando", "como", "con", "para", "en", "del", "el", "los",
        "las", "una",
    ];

    OPEN_ENDED_TAILS.contains(&last.as_str())
}

fn ends_with_continuation_marker(text: &str) -> bool {
    const SINGLE_WORD_MARKERS: &[&str] = &[
        "etc", "etcetera", "genre", "style", "quoi", "bon", "well", "so", "okay", "ok", "anyway",
    ];
    const TWO_WORD_MARKERS: &[(&str, &str)] = &[
        // French
        ("et", "tout"),
        ("tu", "vois"),
        ("du", "coup"),
        ("comme", "ca"),
        ("comme", "ça"),
        // English
        ("you", "know"),
        ("i", "mean"),
        ("and", "stuff"),
        ("or", "something"),
        ("like", "that"),
        ("sort", "of"),
        ("kind", "of"),
        // Spanish
        ("y", "todo"),
        ("o", "algo"),
    ];

    let trailing = trailing_words_lower(text, 2);
    match trailing.as_slice() {
        [last] => SINGLE_WORD_MARKERS.contains(&last.as_str()),
        [second_last, last] => {
            TWO_WORD_MARKERS.contains(&(second_last.as_str(), last.as_str()))
                || SINGLE_WORD_MARKERS.contains(&last.as_str())
        }
        _ => false,
    }
}

fn starts_with_any(text: &str, prefixes: &[&str]) -> bool {
    let lower = text.trim().to_lowercase();
    prefixes.iter().any(|prefix| lower.starts_with(prefix))
}

fn looks_like_question(text: &str) -> bool {
    const QUESTION_PREFIXES: &[&str] = &[
        // French
        "pourquoi ",
        "comment ",
        "quand ",
        "ou ",
        "où ",
        "combien ",
        "quel ",
        "quelle ",
        "quels ",
        "quelles ",
        "est ce que ",
        "est-ce que ",
        "c'est quoi ",
        "tu peux ",
        "peux tu ",
        "peux-tu ",
        // English
        "why ",
        "how ",
        "when ",
        "where ",
        "what ",
        "who ",
        "which ",
        "can you ",
        "could you ",
        "would you ",
        "do you ",
        "did you ",
        "are you ",
        "is it ",
        "will you ",
        // Spanish
        "por que ",
        "por qué ",
        "como ",
        "cómo ",
        "cuando ",
        "cuándo ",
        "donde ",
        "dónde ",
        "cuanto ",
        "cuánto ",
        "que ",
        "qué ",
        "quien ",
        "quién ",
        "puedes ",
    ];

    starts_with_any(text, QUESTION_PREFIXES)
}

/// Add structural line-breaks to email text.
///
/// Two transformations are applied in order:
/// 1. Salutation detected at the start (e.g. "Bonjour Thomas, body…") →
///    "Bonjour Thomas,\n\nBody…"  (blank line between salutation and body).
/// 2. Closing phrase at the end preceded by body text →
///    "…body.\n\nCordialement."  (blank line before closing).
///
/// Only fires when both sides of the split are non-empty, so short standalone
/// salutations ("Bonjour Thomas.") and standalone closings ("Cordialement.")
/// are left untouched.
fn apply_email_structure(text: String) -> String {
    let mut result = text;

    // ── salutation → blank line → body ────────────────────────────────────────
    // Try "greeting + name" first (rejecting subject pronouns), then "greeting + comma".
    let sal_end: Option<usize> = EMAIL_SALUTATION_WITH_NAME_RE
        .captures(&result)
        .and_then(|caps| {
            let name = caps.get(2)?.as_str();
            // Use Unicode-aware lowercase comparison so Cyrillic/accented pronouns
            // (я, ти, vous, él…) are correctly recognised even if Whisper capitalises them.
            let name_lc = name.to_lowercase();
            let is_pronoun = EMAIL_SUBJECT_PRONOUNS
                .iter()
                .any(|p| *p == name_lc.as_str());
            if is_pronoun {
                None
            } else {
                EMAIL_SALUTATION_WITH_NAME_RE.find(&result).map(|m| m.end())
            }
        })
        .or_else(|| EMAIL_SALUTATION_COMMA_RE.find(&result).map(|m| m.end()));

    if let Some(end) = sal_end {
        let sal = result[..end].trim_end().to_string();
        let sal = if sal.ends_with(',') {
            sal
        } else {
            format!("{},", sal)
        };
        let body = result[end..].trim_start().to_string();
        if !body.is_empty() {
            result = format!("{}\n\n{}", sal, capitalize_first(body));
        }
    }

    // ── body → blank line → closing ───────────────────────────────────────────
    let snapshot = result.clone();
    if let Some(m) = EMAIL_CLOSING_RE.find(&snapshot) {
        let before = snapshot[..m.start()].trim_end();
        if !before.is_empty() {
            let closing = capitalize_first(snapshot[m.start()..].trim().to_string());
            result = format!("{}\n\n{}", before, closing);
        }
    }

    result
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

    // ── Email context: basic rules ────────────────────────────────────────────

    #[test]
    fn email_adds_period_and_capitalizes() {
        assert_eq!(
            fix_punctuation("merci pour votre message", EMAIL),
            "Merci pour votre message."
        );
    }

    // ── Email structure: salutation + body ────────────────────────────────────

    #[test]
    fn email_salutation_gets_blank_line_before_body() {
        assert_eq!(
            fix_punctuation("bonjour thomas, je voulais vous contacter", EMAIL),
            "Bonjour thomas,\n\nJe voulais vous contacter."
        );
    }

    #[test]
    fn email_salutation_no_name_gets_blank_line() {
        assert_eq!(
            fix_punctuation("bonjour, je voulais vous informer", EMAIL),
            "Bonjour,\n\nJe voulais vous informer."
        );
    }

    #[test]
    fn email_salutation_no_comma_gets_comma_and_blank_line() {
        // Whisper often omits the comma — we add it automatically.
        assert_eq!(
            fix_punctuation("bonjour thomas je voulais vous contacter", EMAIL),
            "Bonjour thomas,\n\nJe voulais vous contacter."
        );
    }

    #[test]
    fn email_standalone_salutation_unchanged() {
        // No body → no blank line injected.
        assert_eq!(fix_punctuation("bonjour thomas", EMAIL), "Bonjour thomas.");
    }

    #[test]
    fn email_closing_gets_blank_line_before() {
        assert_eq!(
            fix_punctuation("je vous contacte pour notre réunion. cordialement", EMAIL),
            "Je vous contacte pour notre réunion.\n\nCordialement."
        );
    }

    #[test]
    fn email_full_structure_salutation_body_closing() {
        assert_eq!(
            fix_punctuation(
                "bonjour thomas, je voulais vous contacter au sujet de notre réunion. cordialement",
                EMAIL
            ),
            "Bonjour thomas,\n\nJe voulais vous contacter au sujet de notre réunion.\n\nCordialement."
        );
    }

    #[test]
    fn email_standalone_closing_unchanged() {
        // No preceding body text → closing not moved to its own paragraph.
        assert_eq!(fix_punctuation("cordialement", EMAIL), "Cordialement.");
    }

    #[test]
    fn email_english_salutation() {
        assert_eq!(
            fix_punctuation("hello john, i wanted to follow up on our meeting", EMAIL),
            "Hello john,\n\nI wanted to follow up on our meeting."
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
    fn open_ended_french_tail_does_not_get_period() {
        assert_eq!(
            fix_punctuation("je veux lancer le projet avec", DEFAULT),
            "Je veux lancer le projet avec"
        );
    }

    #[test]
    fn open_ended_english_tail_does_not_get_period() {
        assert_eq!(
            fix_punctuation("i want to continue with", DEFAULT),
            "I want to continue with"
        );
    }

    #[test]
    fn clear_french_question_gets_question_mark() {
        assert_eq!(
            fix_punctuation("pourquoi tu fais ça", DEFAULT),
            "Pourquoi tu fais ça?"
        );
    }

    #[test]
    fn clear_english_question_gets_question_mark() {
        assert_eq!(
            fix_punctuation("why does this happen", DEFAULT),
            "Why does this happen?"
        );
    }

    #[test]
    fn continuation_marker_does_not_get_period_in_english() {
        assert_eq!(
            fix_punctuation("i want to keep going you know", DEFAULT),
            "I want to keep going you know"
        );
    }

    #[test]
    fn continuation_marker_does_not_get_period_in_french() {
        assert_eq!(
            fix_punctuation("je veux continuer et tout", DEFAULT),
            "Je veux continuer et tout"
        );
    }

    #[test]
    fn trailing_comma_does_not_get_forced_period() {
        assert_eq!(fix_punctuation("bonjour,", DEFAULT), "Bonjour,");
    }

    #[test]
    fn trailing_colon_does_not_get_forced_period() {
        assert_eq!(fix_punctuation("voici le plan:", DEFAULT), "Voici le plan:");
    }

    #[test]
    fn number_ending_gets_period() {
        // "version 3.0" already ends with '0', no terminal punct → period added.
        // Note: the '.' in "3.0" is mid-word, not terminal.
        assert_eq!(fix_punctuation("version 3.0", DEFAULT), "Version 3.0.");
    }

    #[test]
    fn audio_aware_punctuation_skips_period_without_terminal_pause() {
        let audio = vec![0.2_f32; 16_000];
        assert_eq!(
            fix_punctuation_with_audio("bonjour comment ça va", DEFAULT, Some(&audio)),
            "Bonjour comment ça va"
        );
    }

    #[test]
    fn audio_aware_punctuation_adds_period_with_terminal_pause() {
        let mut audio = vec![0.2_f32; 16_000];
        audio.extend(std::iter::repeat(0.0_f32).take(8_000));
        assert_eq!(
            fix_punctuation_with_audio("bonjour comment ça va", DEFAULT, Some(&audio)),
            "Bonjour comment ça va."
        );
    }

    #[test]
    fn audio_aware_punctuation_keeps_question_mark_with_pause() {
        let mut audio = vec![0.2_f32; 16_000];
        audio.extend(std::iter::repeat(0.0_f32).take(8_000));
        assert_eq!(
            fix_punctuation_with_audio("pourquoi tu fais ça", DEFAULT, Some(&audio)),
            "Pourquoi tu fais ça?"
        );
    }
}
