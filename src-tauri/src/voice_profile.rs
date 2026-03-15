use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

const VOICE_PROFILE_STORE_PATH: &str = "voice_profile.json";
const MAX_PREFERRED_TERMS: usize = 24;
const FRAME_SIZE_SAMPLES: usize = 320; // 20ms @ 16kHz
const MIN_PAUSE_FRAMES: usize = 8; // 160ms
const SILENCE_RMS_THRESHOLD: f32 = 0.012;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct VoiceProfile {
    #[serde(default)]
    pub sessions_count: u32,
    #[serde(default)]
    pub avg_words_per_minute: f32,
    #[serde(default)]
    pub avg_pause_ms: f32,
    #[serde(default)]
    pub preferred_terms: Vec<String>,
    #[serde(default)]
    pub last_updated_ms: Option<u64>,
}

impl Default for VoiceProfile {
    fn default() -> Self {
        Self {
            sessions_count: 0,
            avg_words_per_minute: 0.0,
            avg_pause_ms: 0.0,
            preferred_terms: Vec::new(),
            last_updated_ms: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct VoiceRuntimeAdjustment {
    pub adjusted_chunk_seconds: u8,
    pub adjusted_overlap_ms: u16,
    pub vad_hangover_frames_delta: i8,
    pub reason: Option<String>,
}

pub struct VoiceProfileState(pub Mutex<VoiceProfile>);

fn now_ms() -> u64 {
    crate::runtime_observability::now_ms()
}

fn voice_profile_file(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(VOICE_PROFILE_STORE_PATH)
}

fn ewma(previous: f32, next: f32, alpha: f32) -> f32 {
    if previous <= 0.0 {
        next
    } else {
        previous * (1.0 - alpha) + next * alpha
    }
}

fn frame_rms(frame: &[f32]) -> f32 {
    if frame.is_empty() {
        return 0.0;
    }
    let sum = frame.iter().map(|sample| sample * sample).sum::<f32>();
    (sum / frame.len() as f32).sqrt()
}

fn estimate_avg_pause_ms(samples: &[f32]) -> Option<f32> {
    if samples.len() < FRAME_SIZE_SAMPLES {
        return None;
    }

    let mut pause_lengths_ms = Vec::new();
    let mut current_silent_frames = 0usize;
    for frame in samples.chunks(FRAME_SIZE_SAMPLES) {
        let silent = frame_rms(frame) < SILENCE_RMS_THRESHOLD;
        if silent {
            current_silent_frames = current_silent_frames.saturating_add(1);
        } else if current_silent_frames >= MIN_PAUSE_FRAMES {
            pause_lengths_ms.push((current_silent_frames as f32) * 20.0);
            current_silent_frames = 0;
        } else {
            current_silent_frames = 0;
        }
    }

    if current_silent_frames >= MIN_PAUSE_FRAMES {
        pause_lengths_ms.push((current_silent_frames as f32) * 20.0);
    }

    if pause_lengths_ms.is_empty() {
        None
    } else {
        Some(pause_lengths_ms.iter().sum::<f32>() / pause_lengths_ms.len() as f32)
    }
}

fn normalized_words(text: &str) -> Vec<String> {
    text.split_whitespace()
        .map(|word| {
            word.trim_matches(|c: char| !c.is_alphanumeric() && c != '_' && c != '-')
                .to_string()
        })
        .filter(|word| !word.is_empty())
        .collect()
}

fn stop_words() -> &'static [&'static str] {
    &[
        "the", "and", "for", "that", "this", "with", "have", "from", "vous", "pour", "avec",
        "dans", "mais", "plus", "cela", "comme", "est", "une", "des", "les", "que", "qui",
        "sur", "pas", "par", "and", "you", "your", "are", "was", "were", "they", "them",
        "then", "than", "just", "what", "when", "where",
    ]
}

fn extract_preferred_terms(text: &str, custom_words: &[String]) -> Vec<String> {
    let words = normalized_words(text);
    if words.is_empty() {
        return Vec::new();
    }

    let mut scores: HashMap<String, u32> = HashMap::new();
    for word in words {
        let lower = word.to_ascii_lowercase();
        if word.len() < 4 || stop_words().contains(&lower.as_str()) {
            continue;
        }

        let looks_special = word.contains('_')
            || word.contains('-')
            || word.chars().any(|c| c.is_uppercase())
            || word.chars().any(|c| c.is_ascii_digit());

        let entry = scores.entry(word.clone()).or_insert(0);
        *entry = entry.saturating_add(if looks_special { 3 } else { 1 });
    }

    for word in custom_words {
        let trimmed = word.trim();
        if !trimmed.is_empty() {
            let entry = scores.entry(trimmed.to_string()).or_insert(0);
            *entry = entry.saturating_add(4);
        }
    }

    let mut ranked: Vec<_> = scores.into_iter().collect();
    ranked.sort_by(|(left_word, left_score), (right_word, right_score)| {
        right_score
            .cmp(left_score)
            .then_with(|| right_word.len().cmp(&left_word.len()))
    });

    ranked
        .into_iter()
        .take(MAX_PREFERRED_TERMS)
        .map(|(word, _)| word)
        .collect()
}

fn model_bounds(model_id: &str, base_chunk_seconds: u8, base_overlap_ms: u16) -> (u8, u8, u16, u16) {
    match model_id {
        "small" => (8, 14, 400, 900),
        "medium" => (6, 10, 400, 900),
        "turbo" => (8, 14, 500, 1000),
        "large" => (8, 16, 500, 1400),
        _ => (
            base_chunk_seconds.saturating_sub(2).max(4),
            base_chunk_seconds.saturating_add(2),
            base_overlap_ms.saturating_sub(100).max(250),
            base_overlap_ms.saturating_add(300),
        ),
    }
}

pub fn derive_runtime_adjustment(
    profile: &VoiceProfile,
    model_id: &str,
    base_chunk_seconds: u8,
    base_overlap_ms: u16,
) -> VoiceRuntimeAdjustment {
    let mut chunk = i16::from(base_chunk_seconds);
    let mut overlap = i32::from(base_overlap_ms);
    let mut vad_hangover_frames_delta = 0i8;
    let mut reasons = Vec::new();

    if profile.avg_words_per_minute >= 170.0 {
        chunk -= 2;
        overlap += 200;
        reasons.push("fast speech");
    } else if profile.avg_words_per_minute >= 145.0 {
        chunk -= 1;
        overlap += 120;
        reasons.push("higher speech rate");
    } else if profile.avg_words_per_minute > 0.0 && profile.avg_words_per_minute <= 95.0 {
        chunk += 1;
        reasons.push("slower speech rate");
    }

    if profile.avg_pause_ms >= 750.0 {
        chunk += 1;
        vad_hangover_frames_delta += 4;
        reasons.push("long pauses");
    } else if profile.avg_pause_ms >= 550.0 {
        vad_hangover_frames_delta += 2;
        reasons.push("relaxed pauses");
    } else if profile.avg_pause_ms > 0.0 && profile.avg_pause_ms <= 220.0 {
        overlap += 100;
        vad_hangover_frames_delta -= 2;
        reasons.push("tight pauses");
    }

    let (min_chunk, max_chunk, min_overlap, max_overlap) =
        model_bounds(model_id, base_chunk_seconds, base_overlap_ms);
    let adjusted_chunk_seconds = chunk.clamp(i16::from(min_chunk), i16::from(max_chunk)) as u8;
    let adjusted_overlap_ms = overlap.clamp(i32::from(min_overlap), i32::from(max_overlap)) as u16;

    VoiceRuntimeAdjustment {
        adjusted_chunk_seconds,
        adjusted_overlap_ms,
        vad_hangover_frames_delta,
        reason: if reasons.is_empty() {
            None
        } else {
            Some(reasons.join(", "))
        },
    }
}

impl VoiceProfile {
    pub fn load(app: &AppHandle) -> Self {
        let path = voice_profile_file(app);
        let Ok(content) = fs::read_to_string(path) else {
            return Self::default();
        };

        serde_json::from_str(&content).unwrap_or_default()
    }

    pub fn save(&self, app: &AppHandle) {
        let path = voice_profile_file(app);
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }

        if let Ok(content) = serde_json::to_string_pretty(self) {
            let _ = fs::write(path, content);
        }
    }

    pub fn update_from_session(
        &mut self,
        samples: &[f32],
        transcription: &str,
        custom_words: &[String],
    ) {
        let words = normalized_words(transcription);
        if words.is_empty() || samples.is_empty() {
            return;
        }

        let duration_minutes = (samples.len() as f32 / 16_000.0) / 60.0;
        if duration_minutes <= 0.0 {
            return;
        }

        let wpm = words.len() as f32 / duration_minutes;
        let pause_ms = estimate_avg_pause_ms(samples).unwrap_or(0.0);

        self.sessions_count = self.sessions_count.saturating_add(1);
        self.avg_words_per_minute = ewma(self.avg_words_per_minute, wpm, 0.25);
        if pause_ms > 0.0 {
            self.avg_pause_ms = ewma(self.avg_pause_ms, pause_ms, 0.25);
        }
        self.preferred_terms = extract_preferred_terms(transcription, custom_words);
        self.last_updated_ms = Some(now_ms());
    }
}

pub fn current_voice_profile(app: &AppHandle) -> Option<VoiceProfile> {
    app.try_state::<VoiceProfileState>()
        .and_then(|state| state.0.lock().ok().map(|profile| profile.clone()))
}

pub fn current_runtime_adjustment(
    app: &AppHandle,
    model_id: &str,
    base_chunk_seconds: u8,
    base_overlap_ms: u16,
) -> Option<VoiceRuntimeAdjustment> {
    let settings = crate::settings::get_settings(app);
    if !settings.adaptive_voice_profile_enabled {
        return None;
    }

    let profile = current_voice_profile(app)?;
    if profile.sessions_count == 0 {
        return None;
    }

    Some(derive_runtime_adjustment(
        &profile,
        model_id,
        base_chunk_seconds,
        base_overlap_ms,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn voice_adjustment_reduces_chunk_for_fast_speech() {
        let profile = VoiceProfile {
            sessions_count: 4,
            avg_words_per_minute: 182.0,
            avg_pause_ms: 180.0,
            preferred_terms: vec![],
            last_updated_ms: None,
        };

        let adjustment = derive_runtime_adjustment(&profile, "turbo", 12, 500);
        assert!(adjustment.adjusted_chunk_seconds < 12);
        assert!(adjustment.adjusted_overlap_ms >= 500);
    }

    #[test]
    fn voice_adjustment_relaxes_vad_for_long_pauses() {
        let profile = VoiceProfile {
            sessions_count: 3,
            avg_words_per_minute: 110.0,
            avg_pause_ms: 820.0,
            preferred_terms: vec![],
            last_updated_ms: None,
        };

        let adjustment = derive_runtime_adjustment(&profile, "small", 10, 500);
        assert!(adjustment.vad_hangover_frames_delta > 0);
        assert!(adjustment.adjusted_chunk_seconds >= 10);
    }
}
