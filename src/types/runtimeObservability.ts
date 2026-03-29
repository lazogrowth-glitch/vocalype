export type TranscriptionLifecycleState =
  | "idle"
  | "preparing_microphone"
  | "recording"
  | "paused"
  | "stopping"
  | "transcribing"
  | "processing"
  | "pasting"
  | "completed"
  | "cancelled"
  | "error";

export type RuntimeErrorStage =
  | "capture"
  | "vad"
  | "transcription"
  | "post_process"
  | "paste"
  | "shortcut"
  | "model"
  | "system"
  | "unknown";

export type AppContextCategory =
  | "code"
  | "email"
  | "chat"
  | "document"
  | "browser"
  | "unknown";

export interface AppTranscriptionContext {
  process_name?: string | null;
  window_title?: string | null;
  category: AppContextCategory;
  detected_at_ms: number;
}

export interface LifecycleStateEvent {
  state: TranscriptionLifecycleState;
  operation_id?: number | null;
  binding_id?: string | null;
  detail?: string | null;
  recoverable: boolean;
  timestamp_ms: number;
}

export interface RuntimeErrorEvent {
  code: string;
  stage: RuntimeErrorStage;
  message: string;
  recoverable: boolean;
  operation_id?: number | null;
  device_name?: string | null;
  model_id?: string | null;
  timestamp_ms: number;
}

export type PowerMode = "normal" | "saver" | "unknown";
export type GpuKind = "none" | "integrated" | "dedicated" | "unknown";
export type NpuKind = "none" | "qualcomm" | "intel" | "amd" | "unknown";
export type CalibrationPhase = "none" | "quick" | "full";
export type AdaptiveCalibrationState =
  | "idle"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "fallback_applied";
export type MachineStatusMode =
  | "optimal"
  | "battery"
  | "saver"
  | "thermal"
  | "memory_limited"
  | "fallback"
  | "calibrating";

export interface MachineScoreDetails {
  ram_score: number;
  cpu_threads_score: number;
  cpu_family_score: number;
  gpu_prebench_bonus: number;
  npu_prebench_bonus: number;
  low_power_penalty: number;
  power_penalty: number;
  thermal_penalty: number;
  final_score: number;
  tier_reason: string;
}

export interface UnsafeBackendRecord {
  backend: string;
  unsafe_until_ms: number;
  reason: string;
  failed_at_ms: number;
}

export interface WhisperModelAdaptiveConfigSnapshot {
  backend: string;
  threads: number;
  chunk_seconds: number;
  overlap_ms: number;
  active_backend: string;
  active_threads: number;
  active_chunk_seconds: number;
  active_overlap_ms: number;
  short_latency_ms: number;
  medium_latency_ms: number;
  long_latency_ms: number;
  stability_score: number;
  overall_score: number;
  failure_count: number;
  calibrated_phase: CalibrationPhase;
  unsafe_backends: UnsafeBackendRecord[];
  unsafe_until?: number | null;
  last_failure_reason?: string | null;
  last_failure_at?: number | null;
  last_quick_bench_at?: number | null;
  last_full_bench_at?: number | null;
  backend_decision_reason?: string | null;
  config_decision_reason?: string | null;
}

export interface AdaptiveMachineProfileSnapshot {
  profile_schema_version: number;
  app_version: string;
  backend_version: string;
  machine_score_details: MachineScoreDetails;
  machine_tier: "low" | "medium" | "high";
  cpu_brand: string;
  logical_cores: number;
  total_memory_gb: number;
  low_power_cpu: boolean;
  gpu_detected: boolean;
  gpu_kind: GpuKind;
  gpu_name?: string | null;
  npu_detected: boolean;
  npu_kind: NpuKind;
  npu_name?: string | null;
  copilot_plus_detected: boolean;
  on_battery?: boolean | null;
  power_mode: PowerMode;
  thermal_degraded: boolean;
  runtime_power_snapshot_at?: number | null;
  recommended_model_id: string;
  secondary_model_id?: string | null;
  active_runtime_model_id?: string | null;
  recommended_backend?: string | null;
  active_backend?: string | null;
  calibrated_models: string[];
  bench_phase: "none" | "quick_done" | "full_done";
  bench_completed_at?: number | null;
  last_quick_bench_at?: number | null;
  last_full_bench_at?: number | null;
  calibration_state: AdaptiveCalibrationState;
  calibration_reason?: string | null;
  large_skip_reason?: string | null;
  whisper: {
    small: WhisperModelAdaptiveConfigSnapshot;
    medium: WhisperModelAdaptiveConfigSnapshot;
    turbo: WhisperModelAdaptiveConfigSnapshot;
    large: WhisperModelAdaptiveConfigSnapshot;
  };
}

export interface CalibrationStatusSnapshot {
  model_id: string;
  phase: CalibrationPhase;
  state: AdaptiveCalibrationState;
  detail?: string | null;
  updated_at_ms: number;
}

export interface VoiceProfileSnapshot {
  sessions_count: number;
  avg_words_per_minute: number;
  avg_pause_ms: number;
  preferred_terms: string[];
  last_updated_ms?: number | null;
}

export interface VoiceRuntimeAdjustmentSnapshot {
  adjusted_chunk_seconds: number;
  adjusted_overlap_ms: number;
  vad_hangover_frames_delta: number;
  reason?: string | null;
}

export interface MachineStatusSnapshot {
  mode: MachineStatusMode;
  degraded: boolean;
  headline: string;
  detail: string;
  active_model_id?: string | null;
  active_backend?: string | null;
}

export type ParakeetFailureMode =
  | "healthy"
  | "underchunking_long_utterance"
  | "overtrim_overlap"
  | "missing_word_timestamps"
  | "retry_recovered_chunk"
  | "final_chunk_hallucination"
  | "low_audio_density"
  | "boundary_word_loss";

export interface ParakeetSessionDiagnosticsSnapshot {
  session_id: number;
  operation_id?: number | null;
  binding_id: string;
  model_id: string;
  model_name?: string | null;
  provider: string;
  selected_language: string;
  device_name?: string | null;
  recording_mode: string;
  chunk_interval_samples: number;
  chunk_overlap_samples: number;
  total_chunks: number;
  empty_chunks: number;
  retry_chunks: number;
  filtered_chunks: number;
  trimmed_words_total: number;
  chunks_without_word_timestamps: number;
  chunk_candidates_rejected: number;
  chunk_candidates_sent: number;
  output_words: number;
  duration_secs: number;
  audio_to_word_ratio: number;
  estimated_issue: ParakeetFailureMode;
  quality_risk_score: number;
  assembled_preview: string;
  last_updated_ms: number;
}

export interface ParakeetDiagnosticsSnapshot {
  active_session?: ParakeetSessionDiagnosticsSnapshot | null;
  recent_sessions: ParakeetSessionDiagnosticsSnapshot[];
}

export interface RuntimeDiagnosticsSnapshot {
  captured_at_ms: number;
  app_version: string;
  lifecycle_state: TranscriptionLifecycleState;
  last_lifecycle_event: LifecycleStateEvent;
  recent_errors: RuntimeErrorEvent[];
  selected_model: string;
  loaded_model_id?: string | null;
  loaded_model_name?: string | null;
  model_loaded: boolean;
  paste_method: string;
  clipboard_handling: string;
  selected_language: string;
  selected_microphone?: string | null;
  selected_output_device?: string | null;
  is_recording: boolean;
  is_paused: boolean;
  operation_id?: number | null;
  active_stage?: TranscriptionLifecycleState | null;
  last_audio_error?: string | null;
  partial_result: boolean;
  device_resolution?: string | null;
  cancelled_at_stage?: TranscriptionLifecycleState | null;
  current_app_context?: AppTranscriptionContext | null;
  last_transcription_app_context?: AppTranscriptionContext | null;
  adaptive_voice_profile_enabled: boolean;
  adaptive_voice_profile?: VoiceProfileSnapshot | null;
  active_voice_runtime_adjustment?: VoiceRuntimeAdjustmentSnapshot | null;
  machine_status?: MachineStatusSnapshot | null;
  parakeet_diagnostics: ParakeetDiagnosticsSnapshot;
  adaptive_machine_profile?: AdaptiveMachineProfileSnapshot | null;
  adaptive_calibration_state?: CalibrationStatusSnapshot[];
}
