use crate::runtime_observability::{collect_runtime_diagnostics, now_ms, RuntimeDiagnostics};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const VOICE_FEEDBACK_DIR: &str = "voice-feedback";
const VOICE_FEEDBACK_JSONL: &str = "entries.jsonl";
const MAX_FEEDBACK_NOTE_LEN: usize = 2_000;
const MAX_FEEDBACK_TEXT_LEN: usize = 8_000;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct VoiceFeedbackInput {
    pub expected_text: String,
    pub actual_text: String,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub selected_language: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub keep_audio_reference: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct VoiceFeedbackEntry {
    pub id: String,
    pub created_at_ms: u64,
    pub expected_text: String,
    pub actual_text: String,
    pub notes: Option<String>,
    pub selected_language: Option<String>,
    pub tags: Vec<String>,
    pub keep_audio_reference: bool,
    pub runtime: RuntimeDiagnostics,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct VoiceFeedbackSummary {
    pub total_entries: usize,
    pub top_languages: Vec<(String, usize)>,
    pub top_tags: Vec<(String, usize)>,
    pub top_input_levels: Vec<(String, usize)>,
    pub top_issues: Vec<(String, usize)>,
}

fn feedback_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
    Ok(app_data.join(VOICE_FEEDBACK_DIR))
}

fn feedback_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(feedback_dir(app)?.join(VOICE_FEEDBACK_JSONL))
}

fn normalize_feedback_text(text: &str, max_len: usize) -> String {
    text.trim().chars().take(max_len).collect()
}

fn normalize_feedback_tags(tags: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    for tag in tags {
        let normalized = tag.trim().to_ascii_lowercase();
        if normalized.len() < 2 || normalized.len() > 48 {
            continue;
        }
        if normalized
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '/'))
            && !out.iter().any(|existing: &String| existing == &normalized)
        {
            out.push(normalized);
        }
    }
    out
}

pub fn submit_voice_feedback(
    app: &AppHandle,
    input: VoiceFeedbackInput,
) -> Result<VoiceFeedbackEntry, String> {
    let expected_text = normalize_feedback_text(&input.expected_text, MAX_FEEDBACK_TEXT_LEN);
    let actual_text = normalize_feedback_text(&input.actual_text, MAX_FEEDBACK_TEXT_LEN);
    if expected_text.is_empty() && actual_text.is_empty() {
        return Err("Voice feedback requires expected_text or actual_text".to_string());
    }

    let notes = input
        .notes
        .as_deref()
        .map(|value| normalize_feedback_text(value, MAX_FEEDBACK_NOTE_LEN))
        .filter(|value| !value.is_empty());
    let selected_language = input
        .selected_language
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    let tags = normalize_feedback_tags(&input.tags);
    let created_at_ms = now_ms();
    let entry = VoiceFeedbackEntry {
        id: format!("voice-feedback-{}", created_at_ms),
        created_at_ms,
        expected_text,
        actual_text,
        notes,
        selected_language,
        tags,
        keep_audio_reference: input.keep_audio_reference,
        runtime: collect_runtime_diagnostics(app),
    };

    let dir = feedback_dir(app)?;
    fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create voice feedback directory: {}", e))?;
    let path = feedback_file(app)?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("Failed to open voice feedback file: {}", e))?;
    let line = serde_json::to_string(&entry)
        .map_err(|e| format!("Failed to serialize voice feedback entry: {}", e))?;
    writeln!(file, "{}", line).map_err(|e| format!("Failed to write voice feedback: {}", e))?;
    log::info!("Saved voice feedback entry {}", entry.id);
    Ok(entry)
}

pub fn list_voice_feedback(
    app: &AppHandle,
    limit: usize,
) -> Result<Vec<VoiceFeedbackEntry>, String> {
    let path = feedback_file(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }

    let file =
        fs::File::open(&path).map_err(|e| format!("Failed to open voice feedback file: {}", e))?;
    let reader = BufReader::new(file);
    let mut entries = Vec::new();
    for line in reader.lines() {
        let line = line.map_err(|e| format!("Failed to read voice feedback line: {}", e))?;
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(entry) = serde_json::from_str::<VoiceFeedbackEntry>(&line) {
            entries.push(entry);
        }
    }
    entries.sort_by(|a, b| b.created_at_ms.cmp(&a.created_at_ms));
    entries.truncate(limit.max(1));
    Ok(entries)
}

fn top_counts(map: HashMap<String, usize>, limit: usize) -> Vec<(String, usize)> {
    let mut values: Vec<_> = map.into_iter().collect();
    values.sort_by(|(left_key, left_count), (right_key, right_count)| {
        right_count
            .cmp(left_count)
            .then_with(|| left_key.cmp(right_key))
    });
    values.truncate(limit);
    values
}

pub fn summarize_voice_feedback(
    app: &AppHandle,
    limit: usize,
) -> Result<VoiceFeedbackSummary, String> {
    let entries = list_voice_feedback(app, limit.max(1_000))?;
    let mut languages = HashMap::new();
    let mut tags = HashMap::new();
    let mut input_levels = HashMap::new();
    let mut issues = HashMap::new();

    for entry in &entries {
        if let Some(language) = entry.selected_language.as_ref().or(entry
            .runtime
            .parakeet_diagnostics
            .active_session
            .as_ref()
            .map(|s| &s.selected_language))
        {
            *languages.entry(language.to_ascii_lowercase()).or_insert(0) += 1;
        }

        for tag in &entry.tags {
            *tags.entry(tag.to_ascii_lowercase()).or_insert(0) += 1;
        }

        *input_levels
            .entry(format!("{:?}", entry.runtime.input_level_state).to_ascii_lowercase())
            .or_insert(0) += 1;

        if let Some(session) = &entry.runtime.parakeet_diagnostics.active_session {
            *issues
                .entry(format!("{:?}", session.estimated_issue).to_ascii_lowercase())
                .or_insert(0) += 1;
        }
    }

    Ok(VoiceFeedbackSummary {
        total_entries: entries.len(),
        top_languages: top_counts(languages, 5),
        top_tags: top_counts(tags, 8),
        top_input_levels: top_counts(input_levels, 5),
        top_issues: top_counts(issues, 6),
    })
}
