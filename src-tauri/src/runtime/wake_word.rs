//! Hands-free wake-word detection for Vocalype.
//!
//! When `settings.wake_word_enabled` is true this module:
//!   1. Keeps a 2.5-second ring buffer of raw 16 kHz audio fed by the
//!      `AudioRecordingManager` preview callback (fires even while idle).
//!   2. Every 1.5 s it runs Parakeet V3 inference on that buffer.
//!   3. If the transcript contains the word "dictate" it triggers
//!      `start_transcription_action("wake-word")` and then monitors VAD
//!      output to auto-stop when the user stops speaking.
//!
//! The module requires no new dependencies — it reuses the already-loaded
//! Parakeet engine and the existing Silero VAD inside the AudioRecorder.
//!
//! Adaptive silence threshold: pause tracking is done by `AudioRecordingManager`
//! across ALL recording sessions (not just wake-word), so by the time the user
//! triggers a wake-word session the threshold is already calibrated.

use std::collections::VecDeque;
use std::sync::{
    atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering},
    Arc,
};
use std::time::{Duration, Instant};

use log::{debug, info};
use parking_lot::Mutex;
use tauri::Manager;

use crate::audio_toolkit::VadDecision;
use crate::managers::audio::AudioRecordingManager;
use crate::managers::transcription::TranscriptionManager;

/// Ring buffer size: last 2.5 s at 16 kHz.
const RING_CAPACITY: usize = 40_000; // 2.5 * 16 000

/// How often the wake-word poll thread runs inference.
const POLL_INTERVAL_MS: u64 = 1_500;

/// Minimum samples in the ring buffer before running inference (avoids
/// wasting time on near-empty buffers right after stream open).
const MIN_SAMPLES: usize = 8_000; // 0.5 s

/// How often the auto-stop monitor wakes up to check elapsed silence.
const AUTO_STOP_POLL_MS: u64 = 50;

/// Safety valve: force-stop after this many seconds in case silence is never
/// detected (very noisy environment, VAD tuned loose, etc.).
const MAX_RECORDING_SECS: u64 = 45;

// ── Level 3 — energy bypass of VAD hangover ───────────────────────────── //
//
//   SmoothedVad has a ~600 ms hangover.  We track RMS energy independently:
//   when the EMA drops below ENERGY_RELATIVE_THRESHOLD × peak, the silence
//   countdown starts immediately — bypassing the hangover entirely.
//
//   The adaptive silence threshold (how long to wait) is computed by
//   `AudioRecordingManager` across ALL recording sessions and exposed via
//   `get_adaptive_threshold()`.  This file only handles the energy tracking
//   needed for the hangover bypass.

/// EMA smoothing factor (0.20 → ~7 frames / 210 ms to decay through a breath pause).
const ENERGY_ALPHA: f32 = 0.20;

/// Energy below this fraction of peak = "silence" for the energy path.
const ENERGY_RELATIVE_THRESHOLD: f32 = 0.15;

/// Minimum peak EMA required to trust the energy path.
const MIN_PEAK_ENERGY: f32 = 0.003;

/// Don't trigger auto-stop before this many ms (gap between "dictate" and speech).
const MIN_RECORDING_MS: u64 = 600;

/// Fallback silence threshold when energy path is unavailable (no peak yet).
const SAFE_SILENCE_MS: u64 = 1_000;

/// Default silence threshold before the manager has enough data (warmup).
const DEFAULT_SILENCE_MS: u64 = 1_200;

/// Binding ID used for wake-word-triggered recording sessions.
pub(crate) const WAKE_WORD_BINDING_ID: &str = "__wake_word__";

// ── Public handle ────────────────────────────────────────────────────────── //

pub struct WakeWordManager {
    shutdown: Arc<AtomicBool>,
    audio_manager: Arc<AudioRecordingManager>,
    /// Kept alive so the thread lives until the manager is dropped.
    _thread: std::thread::JoinHandle<()>,
}

impl WakeWordManager {
    pub fn new(app: tauri::AppHandle) -> Self {
        let ring_buffer: Arc<Mutex<VecDeque<f32>>> =
            Arc::new(Mutex::new(VecDeque::with_capacity(RING_CAPACITY)));
        let shutdown = Arc::new(AtomicBool::new(false));

        // Attach the preview callback — fires on every 16 kHz frame from the
        // microphone, even between recording sessions.
        {
            let rm = Arc::clone(&*app.state::<Arc<AudioRecordingManager>>());
            let ring_w = Arc::clone(&ring_buffer);
            rm.set_preview_callback(move |frame: &[f32]| {
                let mut buf = ring_w.lock();
                buf.extend(frame.iter().copied());
                while buf.len() > RING_CAPACITY {
                    buf.pop_front();
                }
            });
        }

        let shutdown_clone = Arc::clone(&shutdown);
        let thread = {
            let app = app.clone();
            std::thread::spawn(move || {
                run_wake_word_loop(app, ring_buffer, shutdown_clone);
            })
        };

        WakeWordManager {
            shutdown,
            audio_manager: Arc::clone(&*app.state::<Arc<AudioRecordingManager>>()),
            _thread: thread,
        }
    }
}

impl Drop for WakeWordManager {
    fn drop(&mut self) {
        self.shutdown.store(true, Ordering::Relaxed);
        self.audio_manager.clear_preview_callback();
    }
}

// ── Internal poll loop ───────────────────────────────────────────────────── //

fn run_wake_word_loop(
    app: tauri::AppHandle,
    ring_buffer: Arc<Mutex<VecDeque<f32>>>,
    shutdown: Arc<AtomicBool>,
) {
    while !shutdown.load(Ordering::Relaxed) {
        std::thread::sleep(Duration::from_millis(POLL_INTERVAL_MS));

        if shutdown.load(Ordering::Relaxed) {
            break;
        }

        // Feature gate: only run when the user has enabled wake-word mode.
        let settings = crate::settings::get_settings(&app);
        if !settings.wake_word_enabled {
            continue;
        }

        // Don't compete with an active recording session.
        let rm = Arc::clone(&*app.state::<Arc<AudioRecordingManager>>());
        if rm.is_recording() {
            continue;
        }

        // Grab a snapshot of the ring buffer.
        let samples: Vec<f32> = {
            let buf = ring_buffer.lock();
            buf.iter().copied().collect::<Vec<f32>>()
        };

        if samples.len() < MIN_SAMPLES {
            continue;
        }

        // Run inference on the accumulated audio.
        let tm = Arc::clone(&*app.state::<Arc<TranscriptionManager>>());
        let text = match tm.transcribe(samples) {
            Ok(t) => t,
            Err(e) => {
                debug!("Wake-word inference failed (model not loaded?): {}", e);
                continue;
            }
        };

        if text.is_empty() {
            continue;
        }

        debug!("Wake-word poll transcript: '{}'", text);

        // Detect the wake word — accept minor mishearings like "dictate",
        // "Dictate", "dic tate".
        let lower = text.to_lowercase();
        let lower_no_space = lower.replace(' ', "");
        if lower_no_space.contains("dictate") {
            info!(
                "Wake word detected ('{}'). Starting hands-free recording.",
                text
            );

            // Clear ring buffer so we don't re-trigger on the same audio.
            ring_buffer.lock().clear();

            // Kick off the real recording session.
            crate::actions::transcribe::start_transcription_action(&app, WAKE_WORD_BINDING_ID);

            // Block this thread while we monitor for auto-stop.
            auto_stop_on_silence(&app, &rm);
        }
    }
}

// ── Auto-stop monitor — energy bypass + manager adaptive threshold ────────── //
//
// Pause tracking (inter-word pause observation + adaptive threshold computation)
// is delegated entirely to `AudioRecordingManager`, which runs it on every
// recording session.  Here we only handle the energy bypass of the VAD hangover
// and read the pre-computed threshold via `rm.get_adaptive_threshold()`.

fn auto_stop_on_silence(app: &tauri::AppHandle, rm: &Arc<AudioRecordingManager>) {
    // Brief delay so `try_start_recording` has time to transition to Recording.
    std::thread::sleep(Duration::from_millis(400));

    info!(
        "[WW-autostop] starting (is_recording={})",
        rm.is_recording()
    );

    let started_at = Instant::now();

    // ── Energy-tracking shared state ───────────────────────────────────── //

    // Last ms (from started_at) where energy was above the relative threshold.
    let last_above_energy_ms: Arc<AtomicU64> = Arc::new(AtomicU64::new(0));

    // EMA of frame RMS energy (f32 bits stored in u32).
    let energy_ema: Arc<AtomicU32> = Arc::new(AtomicU32::new(0));

    // Maximum EMA seen so far — anchor for the relative threshold.
    let peak_energy: Arc<AtomicU32> = Arc::new(AtomicU32::new(0));

    // Last VAD Speech callback ms — fallback when energy path unavailable.
    let last_speech_ms: Arc<AtomicU64> = Arc::new(AtomicU64::new(0));

    {
        let last_above = Arc::clone(&last_above_energy_ms);
        let ema_cell = Arc::clone(&energy_ema);
        let peak_cell = Arc::clone(&peak_energy);
        let last_speech = Arc::clone(&last_speech_ms);
        let base = started_at;

        rm.set_vad_callback(move |decision, rms| {
            let now = base.elapsed().as_millis() as u64;

            // ── Energy tracking ──────────────────────────────────────── //
            let prev_ema = f32::from_bits(ema_cell.load(Ordering::Relaxed));
            let new_ema = ENERGY_ALPHA * rms + (1.0 - ENERGY_ALPHA) * prev_ema;
            ema_cell.store(new_ema.to_bits(), Ordering::Relaxed);

            let prev_peak = f32::from_bits(peak_cell.load(Ordering::Relaxed));
            if new_ema > prev_peak {
                peak_cell.store(new_ema.to_bits(), Ordering::Relaxed);
            }

            let rel_threshold = prev_peak * ENERGY_RELATIVE_THRESHOLD;
            let above = new_ema > rel_threshold && prev_peak > MIN_PEAK_ENERGY;

            if above {
                last_above.store(now, Ordering::Relaxed);
            }

            // Fallback: track last VAD Speech decision timestamp.
            if decision == VadDecision::Speech {
                last_speech.store(now, Ordering::Relaxed);
            }
        });
    }

    loop {
        std::thread::sleep(Duration::from_millis(AUTO_STOP_POLL_MS));

        if !rm.is_recording() {
            rm.clear_vad_callback();
            info!("[WW-autostop] recording stopped externally");
            break;
        }

        let now_ms = started_at.elapsed().as_millis() as u64;

        // Safety valve.
        if now_ms / 1_000 >= MAX_RECORDING_SECS {
            info!("[WW-autostop] max duration reached — sending stop");
            rm.clear_vad_callback();
            crate::actions::transcribe::stop_transcription_action(app, WAKE_WORD_BINDING_ID, false);
            break;
        }

        if now_ms < MIN_RECORDING_MS {
            continue;
        }

        let peak = f32::from_bits(peak_energy.load(Ordering::Relaxed));
        let ema = f32::from_bits(energy_ema.load(Ordering::Relaxed));
        let last_above = last_above_energy_ms.load(Ordering::Relaxed);

        // Read the adaptive threshold from the manager (computed across all sessions).
        let adaptive_threshold = rm.get_adaptive_threshold();

        let (silence_ms, threshold_ms, path) = if peak >= MIN_PEAK_ENERGY && last_above > 0 {
            // ── Energy path ───────────────────────────────────────────── //
            let effective = adaptive_threshold.unwrap_or(DEFAULT_SILENCE_MS);
            (now_ms.saturating_sub(last_above), effective, "adaptive")
        } else {
            // ── Fallback path ─────────────────────────────────────────── //
            let last_speech = last_speech_ms.load(Ordering::Relaxed);
            if last_speech == 0 {
                continue;
            }
            (
                now_ms.saturating_sub(last_speech),
                SAFE_SILENCE_MS,
                "fallback",
            )
        };

        if silence_ms >= threshold_ms {
            info!(
                "[WW-autostop] stop — path={} silence={}ms threshold={}ms ema={:.5} peak={:.5}",
                path, silence_ms, threshold_ms, ema, peak
            );
            rm.clear_vad_callback();
            crate::actions::transcribe::stop_transcription_action(app, WAKE_WORD_BINDING_ID, false);
            break;
        }
    }
}
