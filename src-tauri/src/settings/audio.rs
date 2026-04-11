use serde::{Deserialize, Serialize};
use specta::Type;

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
    let collapsed = value.split_whitespace().collect::<Vec<_>>().join(" ");
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

/// Apply voice snippets: if `text` matches a trigger after light normalization
/// (trim, case-fold, collapse inner spaces, ignore surrounding punctuation),
/// return the corresponding expansion. Otherwise return `None`.
pub fn apply_voice_snippets(text: &str, snippets: &[VoiceSnippet]) -> Option<String> {
    let normalized = normalize_snippet_match(text);
    if normalized.is_empty() {
        return None;
    }
    snippets
        .iter()
        .find(|s| normalize_snippet_match(&s.trigger) == normalized)
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
}
