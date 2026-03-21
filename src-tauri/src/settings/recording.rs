use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Type)]
#[serde(rename_all = "snake_case")]
pub enum RecordingRetentionPeriod {
    Never,
    PreserveLimit,
    Days3,
    Weeks2,
    Months3,
}

/// How the user starts and stops a recording session.
///
/// Replaces the two booleans `push_to_talk` and `always_on_microphone` that
/// previously co-existed and could produce an ambiguous combined state.
///
/// ## Migration (T11)
/// - Old `push_to_talk = true`         → `RecordingMode::PushToTalk`
/// - Old `always_on_microphone = true`  → `RecordingMode::AlwaysOn`
/// - Both `false` (the default)         → `RecordingMode::Toggle`
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Type, Default)]
#[serde(rename_all = "snake_case")]
pub enum RecordingMode {
    /// Press shortcut once to start, press again to stop (default).
    #[default]
    Toggle,
    /// Hold shortcut to record, release to stop.
    PushToTalk,
    /// Microphone is always listening; VAD decides when a utterance starts/ends.
    AlwaysOn,
}

impl RecordingMode {
    /// Returns `true` when the mode maps to the legacy `push_to_talk = true`.
    pub fn is_push_to_talk(self) -> bool {
        self == RecordingMode::PushToTalk
    }

    /// Returns `true` when the mode maps to the legacy `always_on_microphone = true`.
    pub fn is_always_on(self) -> bool {
        self == RecordingMode::AlwaysOn
    }

    /// Derive mode from the legacy boolean pair (used during settings migration).
    pub fn from_legacy(push_to_talk: bool, always_on_microphone: bool) -> Self {
        match (push_to_talk, always_on_microphone) {
            (_, true) => RecordingMode::AlwaysOn,
            (true, false) => RecordingMode::PushToTalk,
            _ => RecordingMode::Toggle,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::RecordingMode;

    #[test]
    fn from_legacy_always_on_wins_over_ptt() {
        assert_eq!(
            RecordingMode::from_legacy(true, true),
            RecordingMode::AlwaysOn
        );
    }

    #[test]
    fn from_legacy_push_to_talk() {
        assert_eq!(
            RecordingMode::from_legacy(true, false),
            RecordingMode::PushToTalk
        );
    }

    #[test]
    fn from_legacy_toggle_default() {
        assert_eq!(
            RecordingMode::from_legacy(false, false),
            RecordingMode::Toggle
        );
    }
}
