//! Transcription telemetry — writes one JSON line per event to
//! `<app_log_dir>/transcription_telemetry.jsonl`.
//!
//! Each line is a self-contained JSON object with at minimum:
//!   { "event": "<name>", "ts_ms": <epoch_ms>, "session_id": <u64>, … }
//!
//! The file is opened in append mode so it survives across restarts.
//! All writes are synchronous but tiny (< 1 KB each); the mutex ensures
//! thread-safety without a background queue.

use serde::Serialize;
use std::fs::{File, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

// ── Public state type ─────────────────────────────────────────────────────────

pub struct TranscriptionTelemetry {
    writer: Mutex<Option<BufWriter<File>>>,
    /// Absolute path shown in logs so the user can locate the file.
    pub log_path: Option<std::path::PathBuf>,
}

impl TranscriptionTelemetry {
    /// Opens (or creates) the telemetry file at `log_path` in append mode.
    pub fn new(log_path: &Path) -> Self {
        if let Some(parent) = log_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(log_path)
            .ok()
            .map(BufWriter::new);
        if file.is_none() {
            log::warn!(
                "[telemetry] failed to open log file: {}",
                log_path.display()
            );
        }
        Self {
            writer: Mutex::new(file),
            log_path: Some(log_path.to_path_buf()),
        }
    }

    /// Telemetry disabled (e.g. log dir unavailable).
    pub fn disabled() -> Self {
        Self {
            writer: Mutex::new(None),
            log_path: None,
        }
    }

    fn now_ms() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0)
    }

    fn write_line<T: Serialize>(&self, event: &T) {
        let Ok(mut guard) = self.writer.lock() else {
            return;
        };
        let Some(w) = guard.as_mut() else {
            return;
        };
        if let Ok(mut line) = serde_json::to_string(event) {
            line.push('\n');
            let _ = w.write_all(line.as_bytes());
            let _ = w.flush();
        }
    }
}

// ── Event helpers ─────────────────────────────────────────────────────────────

impl TranscriptionTelemetry {
    /// Called when a background chunk is dispatched to the worker.
    ///
    /// * `flush_type`  — `"vad"`, `"interval"`, or `"final"`
    /// * `energy`      — mean-squared energy of the last 300 ms (-1.0 if N/A)
    pub fn log_chunk_sent(
        &self,
        session_id: u64,
        chunk_idx: usize,
        flush_type: &str,
        new_samples: usize,
        total_samples: usize,
        energy: f32,
        overlap_samples: usize,
        cutoff_secs: f32,
    ) {
        #[derive(Serialize)]
        struct E<'a> {
            event: &'static str,
            ts_ms: u64,
            session_id: u64,
            chunk_idx: usize,
            flush_type: &'a str,
            new_samples: usize,
            total_samples: usize,
            /// Duration of new audio in this chunk (seconds).
            new_secs: f32,
            /// Mean-squared energy of last 300 ms. -1 = not computed.
            energy: f32,
            overlap_samples: usize,
            cutoff_secs: f32,
        }
        self.write_line(&E {
            event: "chunk_sent",
            ts_ms: Self::now_ms(),
            session_id,
            chunk_idx,
            flush_type,
            new_samples,
            total_samples,
            new_secs: new_samples as f32 / 16_000.0,
            energy,
            overlap_samples,
            cutoff_secs,
        });
    }

    /// Called after the worker receives and transcribes a chunk.
    ///
    /// * `words_in`   — words in the raw engine output
    /// * `words_out`  — words kept after overlap trimming
    pub fn log_chunk_result(
        &self,
        session_id: u64,
        chunk_idx: usize,
        latency_ms: u64,
        cutoff_secs: f32,
        words_in: usize,
        words_out: usize,
        words_trimmed: usize,
        text_preview: &str,
    ) {
        #[derive(Serialize)]
        struct E<'a> {
            event: &'static str,
            ts_ms: u64,
            session_id: u64,
            chunk_idx: usize,
            latency_ms: u64,
            cutoff_secs: f32,
            words_in: usize,
            words_out: usize,
            words_trimmed: usize,
            text_preview: &'a str,
        }
        self.write_line(&E {
            event: "chunk_result",
            ts_ms: Self::now_ms(),
            session_id,
            chunk_idx,
            latency_ms,
            cutoff_secs,
            words_in,
            words_out,
            words_trimmed,
            text_preview,
        });
    }

    /// Called when a chunk fails to transcribe.
    pub fn log_chunk_error(&self, session_id: u64, chunk_idx: usize, error: &str) {
        #[derive(Serialize)]
        struct E<'a> {
            event: &'static str,
            ts_ms: u64,
            session_id: u64,
            chunk_idx: usize,
            error: &'a str,
        }
        self.write_line(&E {
            event: "chunk_error",
            ts_ms: Self::now_ms(),
            session_id,
            chunk_idx,
            error,
        });
    }

    /// Called once per recording session after all chunks are assembled.
    pub fn log_session_end(
        &self,
        session_id: u64,
        total_chunks: usize,
        failed_chunks: usize,
        duration_samples: usize,
        assembled_word_count: usize,
        assembled_preview: &str,
    ) {
        #[derive(Serialize)]
        struct E<'a> {
            event: &'static str,
            ts_ms: u64,
            session_id: u64,
            total_chunks: usize,
            failed_chunks: usize,
            duration_samples: usize,
            duration_secs: f32,
            assembled_word_count: usize,
            assembled_preview: &'a str,
        }
        self.write_line(&E {
            event: "session_end",
            ts_ms: Self::now_ms(),
            session_id,
            total_chunks,
            failed_chunks,
            duration_samples,
            duration_secs: duration_samples as f32 / 16_000.0,
            assembled_word_count,
            assembled_preview,
        });
    }
}
