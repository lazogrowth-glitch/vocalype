use crate::context_detector::{AppContextCategory, AppTranscriptionContext};
use std::collections::HashMap;

const MAX_SESSION_KEYTERMS: usize = 24;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SessionKeyterms {
    pub terms: Vec<String>,
}

fn is_stop_word(token: &str, selected_language: &str) -> bool {
    let token = token.to_ascii_lowercase();
    let common = matches!(
        token.as_str(),
        "the"
            | "and"
            | "for"
            | "that"
            | "this"
            | "with"
            | "have"
            | "from"
            | "into"
            | "then"
            | "than"
            | "just"
            | "what"
            | "when"
            | "where"
            | "while"
            | "because"
            | "about"
            | "comme"
            | "avec"
            | "dans"
            | "pour"
            | "mais"
            | "plus"
            | "cela"
            | "cette"
            | "vous"
            | "nous"
            | "elles"
            | "ils"
            | "elle"
            | "être"
            | "etre"
            | "sont"
            | "avoir"
            | "tous"
            | "toutes"
            | "tout"
    );

    if common {
        return true;
    }

    if selected_language.starts_with("fr") {
        matches!(
            token.as_str(),
            "est" | "une" | "des" | "les" | "que" | "qui" | "sur" | "pas" | "par" | "dans"
        )
    } else {
        matches!(token.as_str(), "are" | "was" | "were" | "they" | "them" | "your")
    }
}

fn canonical_term(term: &str) -> Option<String> {
    let trimmed = term.trim().trim_matches(|c: char| c == '"' || c == '\'');
    if trimmed.is_empty() {
        return None;
    }

    let collapsed = trimmed.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.is_empty() {
        return None;
    }

    Some(collapsed)
}

fn split_identifier_like(text: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut previous_was_lower = false;

    for ch in text.chars() {
        if ch.is_alphanumeric() {
            if ch.is_uppercase() && previous_was_lower && !current.is_empty() {
                tokens.push(current.clone());
                current.clear();
            }
            previous_was_lower = ch.is_lowercase();
            current.push(ch);
        } else if !current.is_empty() {
            tokens.push(current.clone());
            current.clear();
            previous_was_lower = false;
        } else {
            previous_was_lower = false;
        }
    }

    if !current.is_empty() {
        tokens.push(current);
    }

    tokens
}

fn looks_valuable(token: &str, category: Option<AppContextCategory>, selected_language: &str) -> bool {
    if token.len() < 3 {
        return false;
    }

    if is_stop_word(token, selected_language) {
        return false;
    }

    let technical = token.contains('_')
        || token.contains('-')
        || token.chars().any(|c| c.is_ascii_digit())
        || token.chars().any(|c| c.is_uppercase());

    if technical {
        return true;
    }

    if matches!(category, Some(AppContextCategory::Code)) {
        return token.len() >= 4;
    }

    token.len() >= 5
}

fn title_segments(title: &str) -> Vec<String> {
    title
        .split(['|', '-', ':', '•', '—', '–'])
        .map(str::trim)
        .filter(|segment| !segment.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn score_term(
    scores: &mut HashMap<String, (String, i32)>,
    term: &str,
    score: i32,
) {
    let Some(canonical) = canonical_term(term) else {
        return;
    };
    let key = canonical.to_ascii_lowercase();
    let entry = scores.entry(key).or_insert_with(|| (canonical.clone(), 0));
    entry.0 = canonical;
    entry.1 += score;
}

pub fn build_session_keyterms(
    context: Option<&AppTranscriptionContext>,
    selected_language: &str,
    custom_words: &[String],
    voice_terms: &[String],
    vocabulary_terms: &[String],
) -> SessionKeyterms {
    let mut scores: HashMap<String, (String, i32)> = HashMap::new();
    let category = context.map(|ctx| ctx.category);

    for term in custom_words {
        score_term(&mut scores, term, 14);
    }
    for term in voice_terms {
        score_term(&mut scores, term, 10);
    }
    for term in vocabulary_terms {
        score_term(&mut scores, term, 8);
    }

    if let Some(context) = context {
        if let Some(process_name) = context.process_name.as_deref() {
            let process_base = process_name
                .rsplit_once('.')
                .map(|(base, _)| base)
                .unwrap_or(process_name);
            score_term(&mut scores, process_base, 6);
            for token in split_identifier_like(process_base) {
                if looks_valuable(&token, category, selected_language) {
                    score_term(&mut scores, &token, 5);
                }
            }
        }

        if let Some(title) = context.window_title.as_deref() {
            for segment in title_segments(title) {
                if looks_valuable(&segment, category, selected_language) {
                    score_term(&mut scores, &segment, 6);
                }
                for token in split_identifier_like(&segment) {
                    if looks_valuable(&token, category, selected_language) {
                        score_term(&mut scores, &token, 4);
                    }
                }
            }
        }
    }

    let mut ranked: Vec<(String, i32)> = scores.into_values().collect();
    ranked.sort_by(|(left_term, left_score), (right_term, right_score)| {
        right_score
            .cmp(left_score)
            .then_with(|| right_term.len().cmp(&left_term.len()))
            .then_with(|| left_term.cmp(right_term))
    });

    SessionKeyterms {
        terms: ranked
            .into_iter()
            .map(|(term, _)| term)
            .take(MAX_SESSION_KEYTERMS)
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn code_context() -> AppTranscriptionContext {
        AppTranscriptionContext {
            process_name: Some("Code.exe".to_string()),
            window_title: Some("VocalypeSpeech.tsx - vocalype-desktop | GitHub Copilot".to_string()),
            category: AppContextCategory::Code,
            detected_at_ms: 1,
        }
    }

    #[test]
    fn prioritizes_custom_and_contextual_terms() {
        let keyterms = build_session_keyterms(
            Some(&code_context()),
            "en",
            &["Parakeet V3".to_string(), "OpenAI".to_string()],
            &["Yassine".to_string()],
            &["Vocalype".to_string(), "transcribe-rs".to_string()],
        );

        assert!(keyterms.terms.iter().any(|term| term == "Parakeet V3"));
        assert!(keyterms.terms.iter().any(|term| term == "OpenAI"));
        assert!(keyterms.terms.iter().any(|term| term == "Yassine"));
        assert!(keyterms
            .terms
            .iter()
            .any(|term| term == "Vocalype" || term.contains("Vocalype")));
        assert!(keyterms.terms.iter().any(|term| term == "transcribe-rs"));
    }

    #[test]
    fn filters_short_and_stopword_noise() {
        let keyterms = build_session_keyterms(
            Some(&AppTranscriptionContext {
                process_name: Some("chat.exe".to_string()),
                window_title: Some("the and for with this".to_string()),
                category: AppContextCategory::Chat,
                detected_at_ms: 1,
            }),
            "en",
            &[],
            &[],
            &[],
        );

        assert!(keyterms.terms.is_empty() || keyterms.terms.iter().all(|term| term.len() >= 3));
        assert!(!keyterms.terms.iter().any(|term| term.eq_ignore_ascii_case("the")));
    }
}
