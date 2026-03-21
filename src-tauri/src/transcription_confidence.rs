use serde::{Deserialize, Serialize};
use specta::Type;
use transcribe_rs::TranscriptionSegment;

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct ConfidenceWord {
    pub text: String,
    pub confidence: f32,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct TranscriptionConfidencePayload {
    pub engine: String,
    pub overall_confidence: f32,
    pub mapping_stable: bool,
    pub words: Vec<ConfidenceWord>,
}

fn normalize_for_mapping(text: &str) -> String {
    text.to_lowercase()
        .chars()
        .map(|ch| {
            if ch.is_alphanumeric() || ch.is_whitespace() {
                ch
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn average_confidence<I>(values: I) -> Option<f32>
where
    I: IntoIterator<Item = f32>,
{
    let mut total = 0.0f32;
    let mut count = 0usize;
    for value in values {
        total += value.clamp(0.0, 1.0);
        count += 1;
    }

    (count > 0).then_some((total / count as f32).clamp(0.0, 1.0))
}

pub fn build_whisper_confidence_payload(
    segments: &[TranscriptionSegment],
    final_text: &str,
) -> Option<TranscriptionConfidencePayload> {
    let raw_text = segments
        .iter()
        .map(|segment| segment.text.as_str())
        .collect::<String>()
        .trim()
        .to_string();

    let mut words = Vec::new();
    for segment in segments {
        if let Some(segment_words) = &segment.words {
            words.extend(segment_words.iter().filter_map(|word| {
                let text = word.text.trim();
                (!text.is_empty()).then(|| ConfidenceWord {
                    text: text.to_string(),
                    confidence: word.confidence.clamp(0.0, 1.0),
                })
            }));
        }
    }

    let overall_confidence = average_confidence(
        words
            .iter()
            .map(|word| word.confidence)
            .chain(segments.iter().filter_map(|segment| segment.confidence)),
    )?;

    let mapping_stable = normalize_for_mapping(&raw_text) == normalize_for_mapping(final_text);
    let words = if mapping_stable { words } else { Vec::new() };

    Some(TranscriptionConfidencePayload {
        engine: "whisper".to_string(),
        overall_confidence,
        mapping_stable,
        words,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use transcribe_rs::TranscriptionWord;

    #[test]
    fn clears_word_mapping_when_text_changes_meaningfully() {
        let payload = build_whisper_confidence_payload(
            &[TranscriptionSegment {
                start: 0.0,
                end: 1.0,
                text: "hello world".to_string(),
                confidence: Some(0.8),
                words: Some(vec![
                    TranscriptionWord {
                        text: "hello".to_string(),
                        confidence: 0.7,
                    },
                    TranscriptionWord {
                        text: "world".to_string(),
                        confidence: 0.9,
                    },
                ]),
            }],
            "different output entirely",
        )
        .expect("payload");

        assert!(!payload.mapping_stable);
        assert!(payload.words.is_empty());
    }

    #[test]
    fn keeps_words_when_only_punctuation_changes() {
        let payload = build_whisper_confidence_payload(
            &[TranscriptionSegment {
                start: 0.0,
                end: 1.0,
                text: "hello world".to_string(),
                confidence: Some(0.8),
                words: Some(vec![
                    TranscriptionWord {
                        text: "hello".to_string(),
                        confidence: 0.7,
                    },
                    TranscriptionWord {
                        text: "world".to_string(),
                        confidence: 0.9,
                    },
                ]),
            }],
            "Hello, world!",
        )
        .expect("payload");

        assert!(payload.mapping_stable);
        assert_eq!(payload.words.len(), 2);
    }
}
