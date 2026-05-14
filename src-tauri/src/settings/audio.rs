use serde::{Deserialize, Serialize};
use specta::Type;
use strsim::{levenshtein, normalized_levenshtein};

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Type)]
#[serde(rename_all = "snake_case")]
pub enum SoundTheme {
    Marimba,
    Pop,
    Custom,
}

impl SoundTheme {
    fn as_str(&self) -> &'static str {
        match self {
            SoundTheme::Marimba => "marimba",
            SoundTheme::Pop => "pop",
            SoundTheme::Custom => "custom",
        }
    }

    pub fn to_start_path(&self) -> String {
        format!("resources/{}_start.wav", self.as_str())
    }

    pub fn to_stop_path(&self) -> String {
        format!("resources/{}_stop.wav", self.as_str())
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Type)]
#[serde(rename_all = "snake_case")]
pub enum TypingTool {
    Auto,
    Wtype,
    Kwtype,
    Dotool,
    Ydotool,
    Xdotool,
}

impl Default for TypingTool {
    fn default() -> Self {
        TypingTool::Auto
    }
}

/// A voice snippet: if the entire transcription matches `trigger` (case-insensitive,
/// trimmed), it is replaced by `expansion` before being pasted.
#[derive(Serialize, Deserialize, Debug, Clone, Type)]
pub struct VoiceSnippet {
    pub id: String,
    pub trigger: String,
    pub expansion: String,
}

fn normalize_snippet_match(value: &str) -> String {
    let separator_normalized = value
        .chars()
        .map(|c| match c {
            '-' | '–' | '—' => ' ',
            _ => c,
        })
        .collect::<String>();
    let collapsed = separator_normalized
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let trimmed = collapsed.trim();
    let without_edges = trimmed.trim_matches(|c: char| {
        c.is_whitespace()
            || matches!(
                c,
                '.' | ','
                    | '!'
                    | '?'
                    | ';'
                    | ':'
                    | '"'
                    | '\''
                    | '`'
                    | '…'
                    | '('
                    | ')'
                    | '['
                    | ']'
                    | '{'
                    | '}'
            )
    });
    without_edges.to_lowercase()
}

fn token_edit_budget(token: &str) -> usize {
    match token.chars().count() {
        0..=4 => 0,
        5..=8 => 1,
        9..=14 => 2,
        _ => 3,
    }
}

fn tokens_match_fuzzily(left: &str, right: &str) -> bool {
    if left == right {
        return true;
    }

    let allowed_edits = token_edit_budget(left).max(token_edit_budget(right));
    if allowed_edits == 0 {
        return false;
    }

    let distance = levenshtein(left, right);
    if distance > allowed_edits {
        return false;
    }

    normalized_levenshtein(left, right) >= 0.72
}

fn snippet_trigger_matches(trigger: &str, spoken_text: &str) -> bool {
    if trigger == spoken_text {
        return true;
    }

    let trigger_tokens = trigger.split_whitespace().collect::<Vec<_>>();
    let spoken_tokens = spoken_text.split_whitespace().collect::<Vec<_>>();

    if trigger_tokens.is_empty() || trigger_tokens.len() != spoken_tokens.len() {
        return false;
    }

    let mut changed_tokens = 0usize;
    let mut total_distance = 0usize;

    for (trigger_token, spoken_token) in trigger_tokens.iter().zip(spoken_tokens.iter()) {
        if trigger_token == spoken_token {
            continue;
        }

        if !tokens_match_fuzzily(trigger_token, spoken_token) {
            return false;
        }

        changed_tokens += 1;
        total_distance += levenshtein(trigger_token, spoken_token);
    }

    let max_changed_tokens = if trigger_tokens.len() <= 3 { 1 } else { 2 };
    let max_total_distance = if trigger_tokens.len() <= 3 { 2 } else { 3 };

    changed_tokens <= max_changed_tokens && total_distance <= max_total_distance
}

/// Apply voice snippets: if `text` matches a trigger after light normalization
/// (trim, case-fold, collapse inner spaces, ignore surrounding punctuation),
/// return the corresponding expansion. Also tolerates small word-level
/// transcription drift such as a trailing plural or one minor typo on a short
/// trigger phrase. Otherwise return `None`.
pub fn apply_voice_snippets(text: &str, snippets: &[VoiceSnippet]) -> Option<String> {
    let normalized = normalize_snippet_match(text);
    if normalized.is_empty() {
        return None;
    }
    snippets
        .iter()
        .find(|s| snippet_trigger_matches(&normalize_snippet_match(&s.trigger), &normalized))
        .map(|s| s.expansion.clone())
}

#[cfg(test)]
mod tests {
    use super::{apply_voice_snippets, VoiceSnippet};

    fn snippet(trigger: &str, expansion: &str) -> VoiceSnippet {
        VoiceSnippet {
            id: "test".to_string(),
            trigger: trigger.to_string(),
            expansion: expansion.to_string(),
        }
    }

    #[test]
    fn matches_case_insensitively() {
        let snippets = vec![snippet("faire caca", "replacement")];
        assert_eq!(
            apply_voice_snippets("Faire Caca", &snippets),
            Some("replacement".to_string())
        );
    }

    #[test]
    fn matches_with_terminal_punctuation() {
        let snippets = vec![snippet("faire caca", "replacement")];
        assert_eq!(
            apply_voice_snippets("Faire caca.", &snippets),
            Some("replacement".to_string())
        );
        assert_eq!(
            apply_voice_snippets("faire caca!", &snippets),
            Some("replacement".to_string())
        );
    }

    #[test]
    fn matches_with_wrapping_punctuation_and_extra_spaces() {
        let snippets = vec![snippet("faire caca", "replacement")];
        assert_eq!(
            apply_voice_snippets("  \"Faire   caca.\"  ", &snippets),
            Some("replacement".to_string())
        );
    }

    #[test]
    fn does_not_match_when_extra_words_are_present() {
        let snippets = vec![snippet("faire caca", "replacement")];
        assert_eq!(
            apply_voice_snippets("faire caca maintenant", &snippets),
            None
        );
    }

    #[test]
    fn matches_small_plural_variation() {
        let snippets = vec![snippet("shortlist client", "replacement")];
        assert_eq!(
            apply_voice_snippets("shortlist clients", &snippets),
            Some("replacement".to_string())
        );
    }

    #[test]
    fn matches_small_single_word_variation_inside_phrase() {
        let snippets = vec![snippet("envoyer le compte rendu", "replacement")];
        assert_eq!(
            apply_voice_snippets("envoyer le compte-rendu", &snippets),
            Some("replacement".to_string())
        );
    }

    #[test]
    fn does_not_match_when_multiple_words_drift_too_far() {
        let snippets = vec![snippet("shortlist client", "replacement")];
        assert_eq!(
            apply_voice_snippets("shortlists candidats", &snippets),
            None
        );
    }
}
