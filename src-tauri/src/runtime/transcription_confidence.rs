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

#[derive(Clone, Debug, Default)]
pub struct ParakeetConfidenceInputs<'a> {
    pub final_text: &'a str,
    pub selected_language: &'a str,
    pub samples: &'a [f32],
    pub mapping_stable: bool,
    pub retry_chunks: usize,
    pub filtered_chunks: usize,
    pub empty_chunks: usize,
    pub words_without_timestamps: usize,
    pub trimmed_words_total: usize,
    pub finalization_recoveries: usize,
    pub has_language_drift: bool,
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

fn lerp(value: f32, from_low: f32, from_high: f32, to_low: f32, to_high: f32) -> f32 {
    if (from_high - from_low).abs() <= f32::EPSILON {
        return to_high;
    }
    let t = ((value - from_low) / (from_high - from_low)).clamp(0.0, 1.0);
    to_low + (to_high - to_low) * t
}

fn audio_rms_and_peak(samples: &[f32]) -> (f32, f32) {
    if samples.is_empty() {
        return (0.0, 0.0);
    }

    let sum = samples.iter().map(|sample| sample * sample).sum::<f32>();
    let peak = samples
        .iter()
        .map(|sample| sample.abs())
        .fold(0.0_f32, f32::max);
    ((sum / samples.len() as f32).sqrt(), peak)
}

fn parakeet_density_score(word_count: usize, duration_secs: f32) -> f32 {
    if word_count == 0 || duration_secs <= 0.0 {
        return 0.0;
    }

    let words_per_sec = word_count as f32 / duration_secs.max(0.1);
    if words_per_sec < 0.20 {
        0.15
    } else if words_per_sec < 0.60 {
        lerp(words_per_sec, 0.20, 0.60, 0.35, 0.75)
    } else if words_per_sec <= 5.20 {
        1.0
    } else if words_per_sec <= 7.00 {
        lerp(words_per_sec, 5.20, 7.00, 1.0, 0.62)
    } else {
        0.45
    }
}

fn parakeet_audio_score(rms: f32, peak: f32) -> f32 {
    if rms < 0.0035 {
        0.28
    } else if rms < 0.01 {
        0.55
    } else if rms < 0.02 {
        0.72
    } else if peak > 0.995 {
        0.55
    } else if peak > 0.98 {
        0.75
    } else {
        1.0
    }
}

fn parakeet_timestamp_score(words_without_timestamps: usize, trimmed_words_total: usize) -> f32 {
    let missing_penalty = (words_without_timestamps as f32 * 0.18).min(0.72);
    let trim_penalty = (trimmed_words_total as f32 / 48.0).min(0.22);
    (1.0 - missing_penalty - trim_penalty).clamp(0.0, 1.0)
}

fn parakeet_stability_score(
    retry_chunks: usize,
    filtered_chunks: usize,
    empty_chunks: usize,
    finalization_recoveries: usize,
    mapping_stable: bool,
) -> f32 {
    let mut penalty = 0.0_f32;
    penalty += (retry_chunks as f32 * 0.12).min(0.36);
    penalty += (filtered_chunks as f32 * 0.10).min(0.20);
    penalty += (empty_chunks as f32 * 0.08).min(0.24);
    penalty += (finalization_recoveries as f32 * 0.05).min(0.15);
    if !mapping_stable {
        penalty += 0.25;
    }
    (1.0 - penalty).clamp(0.0, 1.0)
}

pub fn build_parakeet_confidence_payload(
    inputs: ParakeetConfidenceInputs<'_>,
) -> Option<TranscriptionConfidencePayload> {
    let final_text = inputs.final_text.trim();
    if final_text.is_empty() || inputs.samples.is_empty() {
        return None;
    }

    let duration_secs = inputs.samples.len() as f32 / 16_000.0;
    let word_count = final_text.split_whitespace().count();
    let (rms, peak) = audio_rms_and_peak(inputs.samples);

    let density_score = parakeet_density_score(word_count, duration_secs);
    let audio_score = parakeet_audio_score(rms, peak);
    let timestamp_score =
        parakeet_timestamp_score(inputs.words_without_timestamps, inputs.trimmed_words_total);
    let stability_score = parakeet_stability_score(
        inputs.retry_chunks,
        inputs.filtered_chunks,
        inputs.empty_chunks,
        inputs.finalization_recoveries,
        inputs.mapping_stable,
    );
    let language_score = if inputs.selected_language == "auto" || !inputs.has_language_drift {
        1.0
    } else {
        0.35
    };

    let mut overall_confidence = density_score * 0.28
        + audio_score * 0.18
        + timestamp_score * 0.22
        + stability_score * 0.18
        + language_score * 0.14;

    if !inputs.mapping_stable {
        overall_confidence = overall_confidence.min(0.84);
    }
    if inputs.has_language_drift && inputs.selected_language != "auto" {
        overall_confidence = overall_confidence.min(0.74);
    }

    Some(TranscriptionConfidencePayload {
        engine: "parakeet-v3".to_string(),
        overall_confidence: overall_confidence.clamp(0.0, 1.0),
        mapping_stable: inputs.mapping_stable,
        words: Vec::new(),
    })
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

    #[test]
    fn parakeet_confidence_rewards_clean_runtime_signals() {
        let payload = build_parakeet_confidence_payload(ParakeetConfidenceInputs {
            final_text: "bonjour tout le monde on valide la transcription finale",
            selected_language: "fr",
            samples: &vec![0.05_f32; 16_000 * 3],
            mapping_stable: true,
            retry_chunks: 0,
            filtered_chunks: 0,
            empty_chunks: 0,
            words_without_timestamps: 0,
            trimmed_words_total: 0,
            finalization_recoveries: 0,
            has_language_drift: false,
        })
        .expect("payload");

        assert_eq!(payload.engine, "parakeet-v3");
        assert!(payload.overall_confidence >= 0.90);
        assert!(payload.words.is_empty());
    }

    #[test]
    fn parakeet_confidence_penalizes_drift_and_runtime_retries() {
        let payload = build_parakeet_confidence_payload(ParakeetConfidenceInputs {
            final_text: "hello there this chunk drifted badly from the selected language",
            selected_language: "fr",
            samples: &vec![0.006_f32; 16_000 * 6],
            mapping_stable: true,
            retry_chunks: 2,
            filtered_chunks: 1,
            empty_chunks: 1,
            words_without_timestamps: 1,
            trimmed_words_total: 6,
            finalization_recoveries: 1,
            has_language_drift: true,
        })
        .expect("payload");

        assert!(payload.overall_confidence <= 0.74);
    }

    #[test]
    fn parakeet_confidence_penalizes_missing_timestamps() {
        let clean = build_parakeet_confidence_payload(ParakeetConfidenceInputs {
            final_text: "this transcript has stable timestamps and no trimming",
            selected_language: "en",
            samples: &vec![0.05_f32; 16_000 * 4],
            mapping_stable: true,
            retry_chunks: 0,
            filtered_chunks: 0,
            empty_chunks: 0,
            words_without_timestamps: 0,
            trimmed_words_total: 0,
            finalization_recoveries: 0,
            has_language_drift: false,
        })
        .expect("clean");
        let noisy = build_parakeet_confidence_payload(ParakeetConfidenceInputs {
            final_text: "this transcript has unstable timestamps and heavier trimming",
            selected_language: "en",
            samples: &vec![0.05_f32; 16_000 * 4],
            mapping_stable: true,
            retry_chunks: 0,
            filtered_chunks: 0,
            empty_chunks: 0,
            words_without_timestamps: 3,
            trimmed_words_total: 14,
            finalization_recoveries: 0,
            has_language_drift: false,
        })
        .expect("noisy");

        assert!(noisy.overall_confidence < clean.overall_confidence);
    }
}
