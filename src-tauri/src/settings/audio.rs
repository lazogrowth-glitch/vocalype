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

/// Apply voice snippets: if `text` (trimmed, lowercase) exactly matches a trigger,
/// return the corresponding expansion.  Otherwise return `None`.
pub fn apply_voice_snippets(text: &str, snippets: &[VoiceSnippet]) -> Option<String> {
    let normalized = text.trim().to_lowercase();
    if normalized.is_empty() {
        return None;
    }
    snippets
        .iter()
        .find(|s| s.trigger.trim().to_lowercase() == normalized)
        .map(|s| s.expansion.clone())
}
