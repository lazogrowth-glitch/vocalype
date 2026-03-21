use crate::managers::model::ModelManager;
use crate::settings::{
    get_settings, now_ms, record_whisper_backend_failure, set_active_whisper_backend,
    write_settings, AdaptiveCalibrationState, AdaptiveMachineProfile, BenchPhase, CalibrationPhase,
    MachineTier, PowerMode, WhisperBackendPreference,
};
use log::{info, warn};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{path::BaseDirectory, AppHandle, Emitter, Manager};
use transcribe_rs::engines::whisper::{WhisperEngine, WhisperInferenceParams, WhisperModelParams};
use transcribe_rs::TranscriptionEngine;

static CALIBRATIONS_IN_PROGRESS: Lazy<Mutex<HashSet<String>>> =
    Lazy::new(|| Mutex::new(HashSet::new()));
static CALIBRATION_STATES: Lazy<Mutex<HashMap<String, CalibrationStatusSnapshot>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static CALIBRATION_EXECUTION_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

const CALIBRATION_SAMPLE_RESOURCE: &str = "resources/calibration_whisper.wav";
const QUICK_PHASE_DELAY_SECS: u64 = 0;
const FULL_PHASE_DELAY_SECS: u64 = 20;
const CRASH_COOLDOWN_MS: u64 = 7 * 24 * 60 * 60 * 1000;
const TIMEOUT_COOLDOWN_MS: u64 = 3 * 24 * 60 * 60 * 1000;
const EMPTY_OUTPUT_COOLDOWN_MS: u64 = 2 * 24 * 60 * 60 * 1000;
const TURBO_COOLDOWN_MS: u64 = 24 * 60 * 60 * 1000;
const TURBO_RETRY_WINDOW_MS: u64 = 7 * 24 * 60 * 60 * 1000;
const TURBO_MAX_AUTO_FAILURES_PER_BACKEND: usize = 2;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CalibrationStatusSnapshot {
    pub model_id: String,
    pub phase: CalibrationPhase,
    pub state: AdaptiveCalibrationState,
    pub detail: Option<String>,
    pub updated_at_ms: u64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum MachineStatusMode {
    Optimal,
    Battery,
    Saver,
    Thermal,
    MemoryLimited,
    Fallback,
    Calibrating,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct MachineStatusSnapshot {
    pub mode: MachineStatusMode,
    pub degraded: bool,
    pub headline: String,
    pub detail: String,
    pub active_model_id: Option<String>,
    pub active_backend: Option<WhisperBackendPreference>,
}

#[derive(Debug, Clone, Copy)]
struct CandidateConfig {
    backend: WhisperBackendPreference,
    threads: u8,
    chunk_seconds: u8,
    overlap_ms: u16,
}

#[derive(Debug, Clone)]
struct CandidateResult {
    candidate: CandidateConfig,
    short_latency_ms: u64,
    medium_latency_ms: u64,
    long_latency_ms: u64,
    failure_count: u32,
    empty_output_count: u32,
    stability_score: f32,
    overall_score: f32,
    backend_reason: String,
    config_reason: String,
}

fn calibration_key(model_id: &str, phase: CalibrationPhase) -> String {
    format!("{model_id}:{phase:?}")
}

fn set_calibration_state(
    app: &AppHandle,
    model_id: &str,
    phase: CalibrationPhase,
    state: AdaptiveCalibrationState,
    detail: Option<String>,
) {
    let snapshot = CalibrationStatusSnapshot {
        model_id: model_id.to_string(),
        phase,
        state,
        detail,
        updated_at_ms: now_ms(),
    };
    CALIBRATION_STATES
        .lock()
        .unwrap()
        .insert(model_id.to_string(), snapshot.clone());
    let _ = app.emit("adaptive-calibration-state", snapshot);
}

pub fn get_calibration_states() -> Vec<CalibrationStatusSnapshot> {
    CALIBRATION_STATES
        .lock()
        .unwrap()
        .values()
        .cloned()
        .collect()
}

pub fn derive_machine_status(
    profile: Option<&AdaptiveMachineProfile>,
    calibration_states: &[CalibrationStatusSnapshot],
    loaded_model_id: Option<&str>,
) -> Option<MachineStatusSnapshot> {
    let profile = profile?;
    let active_model_id = loaded_model_id
        .map(ToString::to_string)
        .or_else(|| profile.active_runtime_model_id.clone())
        .or_else(|| Some(profile.recommended_model_id.clone()));
    let active_backend = profile.active_backend;
    let active_model = active_model_id
        .clone()
        .unwrap_or_else(|| profile.recommended_model_id.clone());

    let calibration_running = calibration_states.iter().any(|state| {
        matches!(
            state.state,
            AdaptiveCalibrationState::Queued | AdaptiveCalibrationState::Running
        )
    });

    if profile.thermal_degraded {
        return Some(MachineStatusSnapshot {
            mode: MachineStatusMode::Thermal,
            degraded: true,
            headline: "CPU hot".to_string(),
            detail: "Transcription may be slower until the machine cools down.".to_string(),
            active_model_id,
            active_backend,
        });
    }

    if matches!(profile.power_mode, PowerMode::Saver) {
        return Some(MachineStatusSnapshot {
            mode: MachineStatusMode::Saver,
            degraded: true,
            headline: "Power saver active".to_string(),
            detail: format!("{active_model} is running with a reduced performance profile."),
            active_model_id,
            active_backend,
        });
    }

    if profile.on_battery == Some(true) {
        return Some(MachineStatusSnapshot {
            mode: MachineStatusMode::Battery,
            degraded: true,
            headline: "Battery mode".to_string(),
            detail: format!(
                "{} is active. Plug in for the best Whisper/Turbo performance.",
                active_model
            ),
            active_model_id,
            active_backend,
        });
    }

    if active_model == "small" && profile.total_memory_gb < 12 {
        return Some(MachineStatusSnapshot {
            mode: MachineStatusMode::MemoryLimited,
            degraded: true,
            headline: "Memory limited".to_string(),
            detail: "A lighter model is preferred on this machine to stay responsive.".to_string(),
            active_model_id,
            active_backend,
        });
    }

    if profile.active_runtime_model_id.as_deref() != Some(profile.recommended_model_id.as_str()) {
        return Some(MachineStatusSnapshot {
            mode: MachineStatusMode::Fallback,
            degraded: true,
            headline: "Fallback active".to_string(),
            detail: format!(
                "{} is running instead of {} for stability on this machine.",
                active_model, profile.recommended_model_id
            ),
            active_model_id,
            active_backend,
        });
    }

    if calibration_running {
        return Some(MachineStatusSnapshot {
            mode: MachineStatusMode::Calibrating,
            degraded: false,
            headline: "Optimizing machine profile".to_string(),
            detail: "Background calibration is refining speed and backend choices.".to_string(),
            active_model_id,
            active_backend,
        });
    }

    Some(MachineStatusSnapshot {
        mode: MachineStatusMode::Optimal,
        degraded: false,
        headline: "Optimal".to_string(),
        detail: format!(
            "{} is active{}.",
            active_model,
            active_backend
                .map(|backend| format!(" with {:?} backend", backend))
                .unwrap_or_default()
        ),
        active_model_id,
        active_backend,
    })
}

fn should_calibrate_model(model_id: &str) -> bool {
    matches!(model_id, "small" | "turbo" | "large")
}

fn load_wav(path: &Path) -> Result<(Vec<f32>, u32, u16), Box<dyn std::error::Error>> {
    let mut reader = hound::WavReader::open(path)?;
    let spec = reader.spec();
    let samples = match spec.sample_format {
        hound::SampleFormat::Float => reader.samples::<f32>().collect::<Result<Vec<_>, _>>()?,
        hound::SampleFormat::Int => {
            let max = ((1_i64 << (spec.bits_per_sample - 1)) - 1) as f32;
            reader
                .samples::<i32>()
                .map(|sample| sample.map(|value| value as f32 / max))
                .collect::<Result<Vec<_>, _>>()?
        }
    };
    Ok((samples, spec.sample_rate, spec.channels))
}

fn mono_resample_16k(samples: Vec<f32>, sample_rate: u32, channels: u16) -> Vec<f32> {
    let mono = if channels == 1 {
        samples
    } else {
        samples
            .chunks_exact(channels as usize)
            .map(|frame| frame.iter().copied().sum::<f32>() / channels as f32)
            .collect::<Vec<_>>()
    };

    if sample_rate == 16_000 {
        return mono;
    }

    let ratio = 16_000.0 / sample_rate as f32;
    let out_len = (mono.len() as f32 * ratio).round() as usize;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let src_pos = i as f32 / ratio;
        let left = src_pos.floor() as usize;
        let right = (left + 1).min(mono.len().saturating_sub(1));
        let frac = src_pos - left as f32;
        let left_val = mono.get(left).copied().unwrap_or(0.0);
        let right_val = mono.get(right).copied().unwrap_or(left_val);
        out.push(left_val + (right_val - left_val) * frac);
    }

    out
}

fn calibration_audio(app: &AppHandle) -> Result<Vec<f32>, Box<dyn std::error::Error>> {
    let mut candidates = Vec::new();

    if let Ok(resolved) = app
        .path()
        .resolve(CALIBRATION_SAMPLE_RESOURCE, BaseDirectory::Resource)
    {
        candidates.push(resolved);
    }

    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("resources").join("calibration_whisper.wav"));
        candidates.push(
            cwd.join("src-tauri")
                .join("resources")
                .join("calibration_whisper.wav"),
        );
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.push(parent.join("resources").join("calibration_whisper.wav"));
            candidates.push(
                parent
                    .join("..")
                    .join("resources")
                    .join("calibration_whisper.wav"),
            );
            candidates.push(
                parent
                    .join("..")
                    .join("..")
                    .join("src-tauri")
                    .join("resources")
                    .join("calibration_whisper.wav"),
            );
        }
    }

    let sample_path = candidates
        .into_iter()
        .find(|path| path.exists())
        .ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::NotFound,
                format!(
                    "calibration sample not found for candidates rooted at resource={}",
                    CALIBRATION_SAMPLE_RESOURCE
                ),
            )
        })?;

    info!(
        "Using adaptive calibration sample at {}",
        sample_path.display()
    );
    let (samples, sample_rate, channels) = load_wav(&sample_path)?;
    Ok(mono_resample_16k(samples, sample_rate, channels))
}

fn clip_seconds(audio: &[f32], seconds: usize) -> Vec<f32> {
    audio
        .iter()
        .copied()
        .take(seconds.saturating_mul(16_000))
        .collect()
}

fn segments_for_phase(
    app: &AppHandle,
    phase: CalibrationPhase,
) -> Result<Vec<(String, Vec<f32>)>, Box<dyn std::error::Error>> {
    let audio = calibration_audio(app)?;
    let mut segments = vec![
        ("short".to_string(), clip_seconds(&audio, 2)),
        ("medium".to_string(), clip_seconds(&audio, 5)),
    ];
    if matches!(phase, CalibrationPhase::Full) {
        segments.push(("long".to_string(), clip_seconds(&audio, 10)));
    }
    Ok(segments
        .into_iter()
        .filter(|(_, segment)| !segment.is_empty())
        .collect())
}

fn chunk_audio(samples: &[f32], chunk_seconds: u8, overlap_ms: u16) -> Vec<Vec<f32>> {
    let interval = usize::from(chunk_seconds).max(1) * 16_000;
    let overlap = ((usize::from(overlap_ms) * 16_000) / 1000).min(interval.saturating_sub(1));
    if samples.len() <= interval {
        return vec![samples.to_vec()];
    }

    let mut chunks = Vec::new();
    let step = interval.saturating_sub(overlap).max(1);
    let mut start = 0usize;
    while start < samples.len() {
        let end = (start + interval).min(samples.len());
        chunks.push(samples[start..end].to_vec());
        if end >= samples.len() {
            break;
        }
        start = start.saturating_add(step);
    }
    chunks
}

fn inference_params(threads: u8) -> WhisperInferenceParams {
    WhisperInferenceParams {
        language: Some("en".to_string()),
        translate: false,
        greedy_best_of: Some(1),
        n_threads: Some(i32::from(threads.max(1))),
        debug_mode: false,
        no_context: true,
        no_timestamps: true,
        single_segment: true,
        temperature: Some(0.0),
        temperature_inc: Some(0.0),
        entropy_thold: Some(9_999.0),
        logprob_thold: Some(-9_999.0),
        ..Default::default()
    }
}

fn benchmark_candidate(
    model_path: &Path,
    phase: CalibrationPhase,
    segments: &[(String, Vec<f32>)],
    candidate: CandidateConfig,
) -> Result<CandidateResult, Box<dyn std::error::Error>> {
    let use_gpu = matches!(candidate.backend, WhisperBackendPreference::Gpu);
    let mut engine = WhisperEngine::new();
    engine.load_model_with_params(
        model_path,
        WhisperModelParams {
            use_gpu,
            flash_attn: use_gpu,
        },
    )?;

    let mut latencies: HashMap<String, u64> = HashMap::new();
    let mut failure_count = 0u32;
    let mut empty_output_count = 0u32;

    for (label, segment) in segments {
        let mut first_result_ms = 0u64;
        let started = Instant::now();
        let mut saw_text = false;
        for chunk in chunk_audio(segment, candidate.chunk_seconds, candidate.overlap_ms) {
            let chunk_started = Instant::now();
            let text =
                engine.transcribe_samples(chunk, Some(inference_params(candidate.threads)))?;
            let elapsed = chunk_started.elapsed().as_millis() as u64;
            if first_result_ms == 0 {
                first_result_ms = elapsed;
            }
            if text.text.trim().is_empty() {
                empty_output_count = empty_output_count.saturating_add(1);
            } else {
                saw_text = true;
            }
        }
        if !saw_text {
            failure_count = failure_count.saturating_add(1);
        }
        let total_ms = started.elapsed().as_millis() as u64;
        latencies.insert(label.clone(), first_result_ms.max(total_ms));
    }

    let short_latency_ms = *latencies.get("short").unwrap_or(&0);
    let medium_latency_ms = *latencies.get("medium").unwrap_or(&short_latency_ms);
    let long_latency_ms = match phase {
        CalibrationPhase::Full => *latencies.get("long").unwrap_or(&medium_latency_ms),
        _ => medium_latency_ms,
    };
    let stability_score = (1.0
        - ((failure_count as f32 * 0.6) + (empty_output_count as f32 * 0.15))
            / segments.len().max(1) as f32)
        .clamp(0.0, 1.0);
    let instability_penalty = (1.0 - stability_score) * 10_000.0
        + (failure_count as f32 * 10_000.0)
        + (empty_output_count as f32 * 2_500.0);
    let overall_score = short_latency_ms as f32 * 0.45
        + medium_latency_ms as f32 * 0.25
        + long_latency_ms as f32 * 0.15
        + instability_penalty
        - (stability_score * 1_000.0 * 0.15);

    Ok(CandidateResult {
        candidate,
        short_latency_ms,
        medium_latency_ms,
        long_latency_ms,
        failure_count,
        empty_output_count,
        stability_score,
        overall_score,
        backend_reason: format!(
            "{} won on {:?} with short={}ms medium={}ms long={}ms stability={:.2}",
            if use_gpu { "GPU" } else { "CPU" },
            phase,
            short_latency_ms,
            medium_latency_ms,
            long_latency_ms,
            stability_score
        ),
        config_reason: format!(
            "threads={} chunk={}s overlap={}ms failures={} empties={}",
            candidate.threads,
            candidate.chunk_seconds,
            candidate.overlap_ms,
            failure_count,
            empty_output_count
        ),
    })
}

fn candidate_configs(model_id: &str, phase: CalibrationPhase) -> &'static [CandidateConfig] {
    match (model_id, phase) {
        ("small", CalibrationPhase::Quick) => &[
            CandidateConfig {
                backend: WhisperBackendPreference::Cpu,
                threads: 4,
                chunk_seconds: 8,
                overlap_ms: 500,
            },
            CandidateConfig {
                backend: WhisperBackendPreference::Cpu,
                threads: 6,
                chunk_seconds: 10,
                overlap_ms: 500,
            },
            CandidateConfig {
                backend: WhisperBackendPreference::Cpu,
                threads: 8,
                chunk_seconds: 12,
                overlap_ms: 500,
            },
            CandidateConfig {
                backend: WhisperBackendPreference::Gpu,
                threads: 4,
                chunk_seconds: 8,
                overlap_ms: 500,
            },
            CandidateConfig {
                backend: WhisperBackendPreference::Gpu,
                threads: 6,
                chunk_seconds: 10,
                overlap_ms: 500,
            },
            CandidateConfig {
                backend: WhisperBackendPreference::Gpu,
                threads: 8,
                chunk_seconds: 12,
                overlap_ms: 500,
            },
        ],
        ("small", CalibrationPhase::Full) => &[
            CandidateConfig {
                backend: WhisperBackendPreference::Cpu,
                threads: 4,
                chunk_seconds: 8,
                overlap_ms: 500,
            },
            CandidateConfig {
                backend: WhisperBackendPreference::Cpu,
                threads: 6,
                chunk_seconds: 10,
                overlap_ms: 500,
            },
            CandidateConfig {
                backend: WhisperBackendPreference::Cpu,
                threads: 8,
                chunk_seconds: 12,
                overlap_ms: 500,
            },
            CandidateConfig {
                backend: WhisperBackendPreference::Gpu,
                threads: 4,
                chunk_seconds: 8,
                overlap_ms: 500,
            },
            CandidateConfig {
                backend: WhisperBackendPreference::Gpu,
                threads: 6,
                chunk_seconds: 10,
                overlap_ms: 500,
            },
            CandidateConfig {
                backend: WhisperBackendPreference::Gpu,
                threads: 8,
                chunk_seconds: 12,
                overlap_ms: 500,
            },
        ],
        ("turbo", CalibrationPhase::Quick) => &[
            CandidateConfig {
                backend: WhisperBackendPreference::Cpu,
                threads: 4,
                chunk_seconds: 8,
                overlap_ms: 500,
            },
            CandidateConfig {
                backend: WhisperBackendPreference::Cpu,
                threads: 6,
                chunk_seconds: 10,
                overlap_ms: 500,
            },
            CandidateConfig {
                backend: WhisperBackendPreference::Gpu,
                threads: 4,
                chunk_seconds: 8,
                overlap_ms: 500,
            },
            CandidateConfig {
                backend: WhisperBackendPreference::Gpu,
                threads: 6,
                chunk_seconds: 10,
                overlap_ms: 500,
            },
            CandidateConfig {
                backend: WhisperBackendPreference::Gpu,
                threads: 8,
                chunk_seconds: 12,
                overlap_ms: 500,
            },
        ],
        ("turbo", CalibrationPhase::Full) => &[
            CandidateConfig {
                backend: WhisperBackendPreference::Cpu,
                threads: 4,
                chunk_seconds: 8,
                overlap_ms: 500,
            },
            CandidateConfig {
                backend: WhisperBackendPreference::Cpu,
                threads: 6,
                chunk_seconds: 10,
                overlap_ms: 500,
            },
            CandidateConfig {
                backend: WhisperBackendPreference::Cpu,
                threads: 8,
                chunk_seconds: 12,
                overlap_ms: 500,
            },
            CandidateConfig {
                backend: WhisperBackendPreference::Gpu,
                threads: 4,
                chunk_seconds: 8,
                overlap_ms: 500,
            },
            CandidateConfig {
                backend: WhisperBackendPreference::Gpu,
                threads: 6,
                chunk_seconds: 10,
                overlap_ms: 500,
            },
            CandidateConfig {
                backend: WhisperBackendPreference::Gpu,
                threads: 8,
                chunk_seconds: 12,
                overlap_ms: 500,
            },
        ],
        ("large", _) => &[
            CandidateConfig {
                backend: WhisperBackendPreference::Cpu,
                threads: 4,
                chunk_seconds: 10,
                overlap_ms: 750,
            },
            CandidateConfig {
                backend: WhisperBackendPreference::Cpu,
                threads: 6,
                chunk_seconds: 12,
                overlap_ms: 750,
            },
            CandidateConfig {
                backend: WhisperBackendPreference::Gpu,
                threads: 4,
                chunk_seconds: 10,
                overlap_ms: 750,
            },
            CandidateConfig {
                backend: WhisperBackendPreference::Gpu,
                threads: 6,
                chunk_seconds: 12,
                overlap_ms: 750,
            },
            CandidateConfig {
                backend: WhisperBackendPreference::Gpu,
                threads: 6,
                chunk_seconds: 15,
                overlap_ms: 750,
            },
        ],
        _ => &[],
    }
}

fn current_model_config(
    profile: &AdaptiveMachineProfile,
    model_id: &str,
) -> Option<(f32, CandidateConfig, bool)> {
    let config = match model_id {
        "small" => &profile.whisper.small,
        "turbo" => &profile.whisper.turbo,
        "large" => &profile.whisper.large,
        _ => return None,
    };
    Some((
        config.overall_score,
        CandidateConfig {
            backend: if matches!(config.active_backend, WhisperBackendPreference::Auto) {
                config.backend
            } else {
                config.active_backend
            },
            threads: if config.active_threads > 0 {
                config.active_threads
            } else {
                config.threads
            },
            chunk_seconds: if config.active_chunk_seconds > 0 {
                config.active_chunk_seconds
            } else {
                config.chunk_seconds
            },
            overlap_ms: if config.active_overlap_ms > 0 {
                config.active_overlap_ms
            } else {
                config.overlap_ms
            },
        },
        config.failure_count > 0
            || config
                .unsafe_until
                .map(|value| value > now_ms())
                .unwrap_or(false),
    ))
}

fn backend_in_cooldown(
    profile: &AdaptiveMachineProfile,
    model_id: &str,
    backend: WhisperBackendPreference,
) -> bool {
    let config = match model_id {
        "small" => &profile.whisper.small,
        "turbo" => &profile.whisper.turbo,
        "large" => &profile.whisper.large,
        _ => return false,
    };
    let now = now_ms();
    config
        .unsafe_backends
        .iter()
        .any(|entry| entry.backend == backend && entry.unsafe_until_ms > now)
}

fn backend_retry_limit_reached(
    profile: &AdaptiveMachineProfile,
    model_id: &str,
    backend: WhisperBackendPreference,
) -> bool {
    if model_id != "turbo" {
        return false;
    }

    let config = match model_id {
        "small" => &profile.whisper.small,
        "turbo" => &profile.whisper.turbo,
        "large" => &profile.whisper.large,
        _ => return false,
    };

    let window_start = now_ms().saturating_sub(TURBO_RETRY_WINDOW_MS);
    config
        .unsafe_backends
        .iter()
        .filter(|entry| entry.backend == backend && entry.failed_at_ms >= window_start)
        .count()
        >= TURBO_MAX_AUTO_FAILURES_PER_BACKEND
}

fn large_eligibility_reason(profile: &AdaptiveMachineProfile) -> Option<String> {
    if profile.machine_tier == MachineTier::Low {
        Some("machine tier is low".to_string())
    } else if profile.total_memory_gb < 16 {
        Some("ram is below 16 GB".to_string())
    } else if profile.low_power_cpu {
        Some("cpu is low power".to_string())
    } else if profile.thermal_degraded {
        Some("thermal degradation detected".to_string())
    } else if matches!(profile.power_mode, PowerMode::Saver) {
        Some("power saver is enabled".to_string())
    } else if profile.on_battery == Some(true) && profile.machine_tier == MachineTier::Medium {
        Some("medium tier machine is on battery".to_string())
    } else {
        None
    }
}

fn phase_skip_reason(
    profile: &AdaptiveMachineProfile,
    model_id: &str,
    phase: CalibrationPhase,
) -> Option<String> {
    if model_id == "large" {
        return large_eligibility_reason(profile);
    }

    if model_id == "turbo" {
        if profile.total_memory_gb < 12 {
            return Some("turbo auto calibration requires at least 12 GB RAM".to_string());
        }
        if matches!(phase, CalibrationPhase::Full)
            && (profile.on_battery == Some(true) || matches!(profile.power_mode, PowerMode::Saver))
        {
            return Some("turbo full calibration skipped on battery or saver mode".to_string());
        }
    }

    if model_id == "small"
        && matches!(phase, CalibrationPhase::Full)
        && (profile.on_battery == Some(true) || matches!(profile.power_mode, PowerMode::Saver))
    {
        return Some("small full calibration deferred on battery or saver mode".to_string());
    }

    None
}

fn candidate_skip_reason(
    profile: &AdaptiveMachineProfile,
    model_id: &str,
    phase: CalibrationPhase,
    candidate: CandidateConfig,
) -> Option<String> {
    if matches!(candidate.backend, WhisperBackendPreference::Gpu)
        && backend_in_cooldown(profile, model_id, candidate.backend)
    {
        return Some("backend is in cooldown".to_string());
    }

    if backend_retry_limit_reached(profile, model_id, candidate.backend) {
        return Some("turbo backend retry limit reached".to_string());
    }

    if model_id == "turbo" && profile.total_memory_gb < 12 {
        if matches!(candidate.backend, WhisperBackendPreference::Cpu) {
            return Some("turbo cpu calibration skipped on low-memory machine".to_string());
        }
        if candidate.threads > 6 {
            return Some("turbo high-thread calibration skipped on low-memory machine".to_string());
        }
    }

    if model_id == "small"
        && matches!(phase, CalibrationPhase::Quick)
        && (profile.on_battery == Some(true) || matches!(profile.power_mode, PowerMode::Saver))
        && (candidate.threads != 6 || candidate.chunk_seconds != 10)
    {
        return Some("small quick calibration narrowed for battery or saver mode".to_string());
    }

    if matches!(profile.power_mode, PowerMode::Saver) && candidate.threads > 6 {
        return Some("high-thread candidate skipped in saver mode".to_string());
    }

    None
}

fn should_replace_config(
    current: Option<(f32, CandidateConfig, bool)>,
    candidate: &CandidateResult,
) -> bool {
    let Some((current_score, current_config, current_unstable)) = current else {
        return true;
    };
    if current_unstable {
        return true;
    }
    if current_score <= 0.0 {
        return true;
    }

    let improvement = ((current_score - candidate.overall_score) / current_score).max(0.0);
    let backend_changed = current_config.backend != candidate.candidate.backend;
    let config_changed = current_config.threads != candidate.candidate.threads
        || current_config.chunk_seconds != candidate.candidate.chunk_seconds
        || current_config.overlap_ms != candidate.candidate.overlap_ms;
    let less_stable = candidate.stability_score + 0.001 < 0.95;

    if less_stable && improvement < 0.15 {
        return false;
    }
    if backend_changed && improvement < 0.08 {
        return false;
    }
    if config_changed && improvement < 0.05 {
        return false;
    }
    improvement > 0.0
}

fn apply_candidate_result(
    app: &AppHandle,
    model_id: &str,
    phase: CalibrationPhase,
    result: &CandidateResult,
) {
    let mut settings = get_settings(app);
    let Some(profile) = settings.adaptive_machine_profile.as_mut() else {
        return;
    };
    let config = match model_id {
        "small" => &mut profile.whisper.small,
        "medium" => &mut profile.whisper.medium,
        "turbo" => &mut profile.whisper.turbo,
        "large" => &mut profile.whisper.large,
        _ => return,
    };

    config.backend = result.candidate.backend;
    config.threads = result.candidate.threads;
    config.chunk_seconds = result.candidate.chunk_seconds;
    config.overlap_ms = result.candidate.overlap_ms;
    config.active_backend = result.candidate.backend;
    config.active_threads = result.candidate.threads;
    config.active_chunk_seconds = result.candidate.chunk_seconds;
    config.active_overlap_ms = result.candidate.overlap_ms;
    config.short_latency_ms = result.short_latency_ms;
    config.medium_latency_ms = result.medium_latency_ms;
    config.long_latency_ms = result.long_latency_ms;
    config.stability_score = result.stability_score;
    config.overall_score = result.overall_score;
    config.failure_count = result.failure_count;
    config.calibrated_phase = phase;
    config.backend_decision_reason = Some(result.backend_reason.clone());
    config.config_decision_reason = Some(format!(
        "{}; empty_outputs={}",
        result.config_reason, result.empty_output_count
    ));
    config.last_quick_bench_at = if matches!(phase, CalibrationPhase::Quick) {
        Some(now_ms())
    } else {
        config.last_quick_bench_at
    };
    config.last_full_bench_at = if matches!(phase, CalibrationPhase::Full) {
        Some(now_ms())
    } else {
        config.last_full_bench_at
    };

    if !profile.calibrated_models.iter().any(|id| id == model_id) {
        profile.calibrated_models.push(model_id.to_string());
    }
    profile.recommended_backend = Some(result.candidate.backend);
    profile.active_backend = Some(result.candidate.backend);
    profile.calibration_state = AdaptiveCalibrationState::Completed;
    profile.calibration_reason = Some(result.backend_reason.clone());
    profile.bench_phase = match phase {
        CalibrationPhase::Quick => BenchPhase::QuickDone,
        CalibrationPhase::Full => BenchPhase::FullDone,
        CalibrationPhase::None => profile.bench_phase,
    };
    profile.bench_completed_at = Some(now_ms());
    if matches!(phase, CalibrationPhase::Quick) {
        profile.last_quick_bench_at = Some(now_ms());
    }
    if matches!(phase, CalibrationPhase::Full) {
        profile.last_full_bench_at = Some(now_ms());
    }

    write_settings(app, settings);
    let _ = app.emit("adaptive-profile-updated", ());
    set_active_whisper_backend(
        app,
        model_id,
        result.candidate.backend,
        Some(result.backend_reason.clone()),
    );
}

fn run_whisper_calibration(
    app: &AppHandle,
    model_manager: &Arc<ModelManager>,
    model_id: &str,
    phase: CalibrationPhase,
) -> Result<(), Box<dyn std::error::Error>> {
    let settings = get_settings(app);
    let Some(profile) = settings.adaptive_machine_profile.as_ref() else {
        return Ok(());
    };

    if let Some(reason) = phase_skip_reason(profile, model_id, phase) {
        let mut settings = get_settings(app);
        if let Some(profile) = settings.adaptive_machine_profile.as_mut() {
            if model_id == "large" {
                profile.large_skip_reason = Some(reason.clone());
            }
            profile.calibration_state = AdaptiveCalibrationState::Idle;
            profile.calibration_reason = Some(reason.clone());
            write_settings(app, settings);
            let _ = app.emit("adaptive-profile-updated", ());
        }
        set_calibration_state(
            app,
            model_id,
            phase,
            AdaptiveCalibrationState::Idle,
            Some(reason),
        );
        return Ok(());
    }

    let model_path = model_manager.get_model_path(model_id)?;
    let segments = segments_for_phase(app, phase)?;
    if segments.is_empty() {
        return Ok(());
    }

    let mut best: Option<CandidateResult> = None;
    for candidate in candidate_configs(model_id, phase) {
        if let Some(reason) = candidate_skip_reason(profile, model_id, phase, *candidate) {
            info!(
                "Skipping adaptive calibration candidate: model={} phase={:?} backend={:?} threads={} chunk={}s reason={}",
                model_id, phase, candidate.backend, candidate.threads, candidate.chunk_seconds, reason
            );
            continue;
        }

        match benchmark_candidate(&model_path, phase, &segments, *candidate) {
            Ok(result) => {
                info!(
                    "Adaptive calibration: model={} phase={:?} backend={:?} threads={} chunk={}s score={:.2}",
                    model_id,
                    phase,
                    result.candidate.backend,
                    result.candidate.threads,
                    result.candidate.chunk_seconds,
                    result.overall_score
                );
                let replace = best
                    .as_ref()
                    .map(|current| result.overall_score < current.overall_score)
                    .unwrap_or(true);
                if replace {
                    best = Some(result);
                }
            }
            Err(err) => {
                let reason = err.to_string();
                warn!(
                    "Adaptive calibration candidate failed: model={} phase={:?} backend={:?} threads={} chunk={}s: {}",
                    model_id, phase, candidate.backend, candidate.threads, candidate.chunk_seconds, reason
                );
                record_whisper_backend_failure(
                    app,
                    model_id,
                    candidate.backend,
                    &reason,
                    if model_id == "turbo" {
                        TURBO_COOLDOWN_MS
                    } else if reason.to_lowercase().contains("empty") {
                        EMPTY_OUTPUT_COOLDOWN_MS
                    } else if reason.to_lowercase().contains("timeout") {
                        TIMEOUT_COOLDOWN_MS
                    } else {
                        CRASH_COOLDOWN_MS
                    },
                );
            }
        }
    }

    let Some(best) = best else {
        return Ok(());
    };
    let current = get_settings(app)
        .adaptive_machine_profile
        .as_ref()
        .and_then(|profile| current_model_config(profile, model_id));

    if should_replace_config(current, &best) {
        apply_candidate_result(app, model_id, phase, &best);
    }

    Ok(())
}

fn should_run_phase(
    profile: &AdaptiveMachineProfile,
    model_id: &str,
    phase: CalibrationPhase,
) -> bool {
    let config = match model_id {
        "small" => &profile.whisper.small,
        "turbo" => &profile.whisper.turbo,
        "large" => &profile.whisper.large,
        _ => return false,
    };

    match phase {
        CalibrationPhase::Quick => {
            config.last_quick_bench_at.is_none()
                || !profile.calibrated_models.iter().any(|id| id == model_id)
        }
        CalibrationPhase::Full => config.last_full_bench_at.is_none(),
        CalibrationPhase::None => false,
    }
}

fn schedule_phase(
    app: &AppHandle,
    model_manager: Arc<ModelManager>,
    model_id: &str,
    phase: CalibrationPhase,
    delay_secs: u64,
) {
    let key = calibration_key(model_id, phase);
    {
        let mut guard = CALIBRATIONS_IN_PROGRESS.lock().unwrap();
        if !guard.insert(key.clone()) {
            return;
        }
    }

    let app = app.clone();
    let model_id = model_id.to_string();
    std::thread::spawn(move || {
        let _calibration_guard = CALIBRATION_EXECUTION_LOCK.lock().unwrap();
        if delay_secs > 0 {
            std::thread::sleep(Duration::from_secs(delay_secs));
        }

        set_calibration_state(
            &app,
            &model_id,
            phase,
            AdaptiveCalibrationState::Running,
            None,
        );
        let result = run_whisper_calibration(&app, &model_manager, &model_id, phase);
        match result {
            Ok(()) => set_calibration_state(
                &app,
                &model_id,
                phase,
                AdaptiveCalibrationState::Completed,
                None,
            ),
            Err(err) => {
                warn!(
                    "Adaptive Whisper calibration failed for {} phase {:?}: {}",
                    model_id, phase, err
                );
                set_calibration_state(
                    &app,
                    &model_id,
                    phase,
                    AdaptiveCalibrationState::Failed,
                    Some(err.to_string()),
                );
            }
        }
        CALIBRATIONS_IN_PROGRESS.lock().unwrap().remove(&key);
    });
}

pub fn maybe_schedule_whisper_calibration(
    app: &AppHandle,
    model_manager: Arc<ModelManager>,
    model_id: &str,
) {
    if !should_calibrate_model(model_id) {
        return;
    }

    let settings = get_settings(app);
    let Some(profile) = settings.adaptive_machine_profile.as_ref() else {
        return;
    };
    let is_downloaded = model_manager
        .get_model_info(model_id)
        .map(|model| model.is_downloaded)
        .unwrap_or(false);
    if !is_downloaded {
        return;
    }

    if should_run_phase(profile, model_id, CalibrationPhase::Quick) {
        set_calibration_state(
            app,
            model_id,
            CalibrationPhase::Quick,
            AdaptiveCalibrationState::Queued,
            Some("quick benchmark queued".to_string()),
        );
        schedule_phase(
            app,
            model_manager.clone(),
            model_id,
            CalibrationPhase::Quick,
            QUICK_PHASE_DELAY_SECS,
        );
    }

    if should_run_phase(profile, model_id, CalibrationPhase::Full) {
        set_calibration_state(
            app,
            model_id,
            CalibrationPhase::Full,
            AdaptiveCalibrationState::Queued,
            Some("full benchmark queued".to_string()),
        );
        schedule_phase(
            app,
            model_manager,
            model_id,
            CalibrationPhase::Full,
            FULL_PHASE_DELAY_SECS,
        );
    }
}

pub fn recalibrate_whisper_model(
    app: &AppHandle,
    model_manager: Arc<ModelManager>,
    model_id: &str,
    phase: Option<CalibrationPhase>,
) {
    let phase = phase.unwrap_or(CalibrationPhase::Quick);
    set_calibration_state(
        app,
        model_id,
        phase,
        AdaptiveCalibrationState::Queued,
        Some("manual recalibration requested".to_string()),
    );
    schedule_phase(app, model_manager, model_id, phase, 0);
}
