use super::model_selection::{model_supports_selected_language, resolve_runtime_model_override};
use super::paste::dispatch_text_insertion;
use super::post_processing::process_transcription_text;
use super::profiler::PipelineProfiler;
use super::ActiveActionState;
use crate::audio_feedback::{play_feedback_sound, play_feedback_sound_blocking, SoundType};
use crate::chunking::{
    chunking_profile_for_model, deduplicate_boundary, ActiveChunkingHandle, ChunkingHandle,
    ChunkingSharedState, CHUNK_SAMPLER_POLL_MS, MAX_PENDING_BACKGROUND_CHUNKS,
};
use crate::context_detector::{detect_current_app_context, ActiveAppContextState};
use crate::managers::audio::AudioRecordingManager;
use crate::managers::history::HistoryManager;
use crate::managers::model::ModelManager;
use crate::managers::transcription::{TranscriptionManager, TranscriptionRequest};
use crate::model_ids::is_parakeet_v3_model_id;
use crate::post_processing::cleanup_assembled_transcription;
use crate::runtime_observability::{emit_runtime_error, RuntimeErrorStage};
use crate::settings::get_settings;
use crate::shortcut;
use crate::tray::{change_tray_icon, TrayIconState};
use crate::utils::{self, show_recording_overlay, show_transcribing_overlay};
use crate::TranscriptionCoordinator;
use log::{debug, error, info, warn};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

struct FinishGuard {
    app: AppHandle,
    binding_id: String,
}

impl Drop for FinishGuard {
    fn drop(&mut self) {
        if let Some(c) = self.app.try_state::<TranscriptionCoordinator>() {
            c.notify_processing_finished();
        }
        if let Some(state) = self.app.try_state::<ActiveAppContextState>() {
            if let Ok(mut snapshot) = state.0.lock() {
                snapshot.clear_active_context(&self.binding_id);
            }
        }
    }
}

struct TranscriptionResult {
    samples: Vec<f32>,
    transcription: String,
    confidence_payload: Option<crate::transcription_confidence::TranscriptionConfidencePayload>,
    #[allow(dead_code)]
    chunk_count: usize,
}

pub(super) fn should_switch_to_long_audio_model(
    duration_seconds: f32,
    threshold_seconds: f32,
    current_model_id: Option<&str>,
    long_model_id: Option<&str>,
) -> bool {
    let Some(long_model_id) = long_model_id else {
        return false;
    };

    duration_seconds > threshold_seconds && current_model_id != Some(long_model_id)
}

pub(super) fn start_transcription_action(app: &AppHandle, binding_id: &str) {
    let start_time = Instant::now();
    debug!("TranscribeAction::start called for binding: {}", binding_id);

    if let Err(err) = crate::license::enforce_any_access(app, "dictation") {
        warn!("Access gate denied transcription start: {}", err);
        let _ = app.emit("premium-access-denied", err.clone());
        return;
    }

    if !crate::startup_warmup::can_start_recording(app) {
        let message = crate::startup_warmup::block_message(app);
        warn!(
            "Blocking transcription start until warmup completes: {}",
            message
        );
        let _ = app.emit("transcription-warmup-blocked", message);
        crate::startup_warmup::ensure_startup_warmup(app, "transcription-blocked");
        return;
    }

    if crate::license::current_plan(app).as_deref() == Some("basic") {
        let since = (chrono::Utc::now() - chrono::Duration::days(7)).timestamp();
        let hm = app.state::<Arc<HistoryManager>>();
        match hm.count_recent_transcriptions(since) {
            Ok(count) if count >= 30 => {
                warn!(
                    "Basic quota exceeded ({}/30), blocking transcription start",
                    count
                );
                let _ = app.emit(
                    "transcription-quota-exceeded",
                    serde_json::json!({ "count": count, "limit": 30 }),
                );
                return;
            }
            Err(e) => {
                warn!("Failed to check transcription quota: {}", e);
            }
            _ => {}
        }
    }

    let captured_app_context = detect_current_app_context();

    let tm = app.state::<Arc<TranscriptionManager>>();
    tm.initiate_model_load();

    let binding_id = binding_id.to_string();
    change_tray_icon(app, TrayIconState::Recording);
    show_recording_overlay(app);

    let rm = app.state::<Arc<AudioRecordingManager>>();
    let settings = get_settings(app);
    let is_always_on = settings.always_on_microphone;
    debug!("Microphone mode - always_on: {}", is_always_on);

    let mut recording_started = false;
    if is_always_on {
        debug!("Always-on mode: Playing audio feedback immediately");
        let rm_clone = Arc::clone(&rm);
        let app_clone = app.clone();
        std::thread::spawn(move || {
            play_feedback_sound_blocking(&app_clone, SoundType::Start);
            rm_clone.apply_mute();
        });

        recording_started = rm.try_start_recording(&binding_id);
        debug!("Recording started: {}", recording_started);
    } else {
        debug!("On-demand mode: Starting recording first, then audio feedback");
        let recording_start_time = Instant::now();
        if rm.try_start_recording(&binding_id) {
            recording_started = true;
            debug!("Recording started in {:?}", recording_start_time.elapsed());
            let app_clone = app.clone();
            let rm_clone = Arc::clone(&rm);
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(100));
                debug!("Handling delayed audio feedback/mute sequence");
                play_feedback_sound_blocking(&app_clone, SoundType::Start);
                rm_clone.apply_mute();
            });
        } else {
            debug!("Failed to start recording");
        }
    }

    if recording_started {
        if let Some(state) = app.try_state::<ActiveAppContextState>() {
            if let Ok(mut snapshot) = state.0.lock() {
                snapshot.set_active_context(&binding_id, captured_app_context.clone());
            }
        }
        shortcut::register_cancel_shortcut(app);
        shortcut::register_pause_shortcut(app);
        shortcut::register_action_shortcuts(app);

        let current_model_info = app.try_state::<Arc<ModelManager>>().and_then(|mm| {
            let settings = get_settings(app);
            let model_id = if settings.selected_model.is_empty() {
                app.state::<Arc<TranscriptionManager>>().get_current_model()
            } else {
                Some(settings.selected_model)
            }?;
            mm.get_model_info(&model_id)
        });
        let chunking_profile =
            chunking_profile_for_model(app, current_model_info.as_ref(), &settings);

        if let Some(chunking_profile) = chunking_profile {
            let rm_s = Arc::clone(&*app.state::<Arc<AudioRecordingManager>>());
            let tm_s = Arc::clone(&*app.state::<Arc<TranscriptionManager>>());

            let shared_state = Arc::new(Mutex::new(ChunkingSharedState {
                last_committed_idx: 0,
                next_chunk_idx: 0,
            }));
            let results: Arc<Mutex<Vec<(usize, String)>>> = Arc::new(Mutex::new(Vec::new()));
            let pending_chunks = Arc::new(AtomicUsize::new(0));

            let (chunk_tx, chunk_rx) = std::sync::mpsc::channel::<Option<(Vec<f32>, usize)>>();

            let shared_s = Arc::clone(&shared_state);
            let tx_s = chunk_tx.clone();
            let pending_s = Arc::clone(&pending_chunks);
            let sampler_handle = std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_millis(CHUNK_SAMPLER_POLL_MS));

                let snapshot = match rm_s.snapshot_recording() {
                    Some(s) => s,
                    None => break,
                };

                let total = snapshot.len();
                let (last_committed, next_idx) = {
                    let s = shared_s.lock().unwrap_or_else(|e| e.into_inner());
                    (s.last_committed_idx, s.next_chunk_idx)
                };
                let new_samples = total.saturating_sub(last_committed);

                if new_samples >= chunking_profile.interval_samples {
                    if pending_s.load(Ordering::Relaxed) >= MAX_PENDING_BACKGROUND_CHUNKS {
                        continue;
                    }

                    let chunk_start =
                        last_committed.saturating_sub(chunking_profile.overlap_samples);
                    let chunk_end = last_committed + chunking_profile.interval_samples;
                    let chunk = snapshot[chunk_start..chunk_end].to_vec();

                    pending_s.fetch_add(1, Ordering::Relaxed);
                    match tx_s.send(Some((chunk, next_idx))) {
                        Ok(()) => {
                            let mut s = shared_s.lock().unwrap_or_else(|e| e.into_inner());
                            s.last_committed_idx = chunk_end;
                            s.next_chunk_idx += 1;
                        }
                        Err(_) => {
                            pending_s.fetch_sub(1, Ordering::Relaxed);
                            break;
                        }
                    }
                }
            });

            let results_w = Arc::clone(&results);
            let pending_w = Arc::clone(&pending_chunks);
            let worker_handle = std::thread::spawn(move || {
                while let Ok(message) = chunk_rx.recv() {
                    let Some((audio, idx)) = message else {
                        break;
                    };

                    match tm_s.transcribe_request(TranscriptionRequest {
                        audio,
                        app_context: None,
                    }) {
                        Ok(text) => {
                            results_w
                                .lock()
                                .unwrap_or_else(|e| e.into_inner())
                                .push((idx, text));
                        }
                        Err(err) => {
                            warn!("Chunk transcription failed for chunk {}: {}", idx, err);
                        }
                    }
                    pending_w.fetch_sub(1, Ordering::Relaxed);
                }
                debug!("Chunk worker thread exited");
            });

            if let Some(ch) = app.try_state::<ActiveChunkingHandle>() {
                *ch.0.lock().unwrap_or_else(|e| e.into_inner()) = Some(ChunkingHandle {
                    sampler_handle,
                    worker_handle,
                    chunk_tx,
                    shared_state,
                    results,
                    pending_chunks,
                    chunk_overlap_samples: chunking_profile.overlap_samples,
                });
            }
        } else if let Some(info) = current_model_info {
            debug!(
                "Skipping background chunking for model '{}' ({}) to preserve full-context transcription",
                info.name,
                info.id
            );
        }
    }

    debug!(
        "TranscribeAction::start completed in {:?}",
        start_time.elapsed()
    );
}

pub(super) fn stop_transcription_action(app: &AppHandle, binding_id: &str, post_process: bool) {
    crate::shortcut::handler::reset_cancel_confirmation();
    shortcut::unregister_cancel_shortcut(app);
    shortcut::unregister_pause_shortcut(app);
    shortcut::unregister_action_shortcuts(app);

    let stop_time = Instant::now();
    debug!("TranscribeAction::stop called for binding: {}", binding_id);

    let ah = app.clone();
    let rm = Arc::clone(&app.state::<Arc<AudioRecordingManager>>());
    let tm = Arc::clone(&app.state::<Arc<TranscriptionManager>>());
    let hm = Arc::clone(&app.state::<Arc<HistoryManager>>());
    let is_basic_plan = crate::license::current_plan(app).as_deref() == Some("basic");

    change_tray_icon(app, TrayIconState::Transcribing);
    show_transcribing_overlay(app);

    rm.remove_mute();
    play_feedback_sound(app, SoundType::Stop);

    let binding_id = binding_id.to_string();
    let active_app_context = if get_settings(app).app_context_enabled {
        if let Some(state) = app.try_state::<ActiveAppContextState>() {
            if let Ok(snapshot) = state.0.lock() {
                snapshot.active_context_for_binding(&binding_id)
            } else {
                None
            }
        } else {
            None
        }
    } else {
        None
    };

    let selected_action_key = app
        .try_state::<ActiveActionState>()
        .and_then(|s| match s.0.lock() {
            Ok(mut guard) => guard.take(),
            Err(poisoned) => {
                error!("ActiveActionState mutex poisoned, recovering");
                poisoned.into_inner().take()
            }
        });

    let chunking_handle = app
        .try_state::<ActiveChunkingHandle>()
        .and_then(|s| s.0.lock().ok().map(|mut g| g.take()))
        .flatten();

    tauri::async_runtime::spawn(async move {
        let _guard = FinishGuard {
            app: ah.clone(),
            binding_id: binding_id.clone(),
        };
        let binding_id = binding_id.clone();
        let profiler = Arc::new(Mutex::new(PipelineProfiler::new(
            binding_id.clone(),
            if chunking_handle.is_some() {
                "chunked"
            } else {
                "single-shot"
            },
            tm.get_current_model(),
            tm.get_current_model_name(),
        )));
        debug!(
            "Starting async transcription task for binding: {}, action: {:?}",
            binding_id, selected_action_key
        );

        let stop_recording_time = Instant::now();
        let result: Option<TranscriptionResult> = if let Some(ch) = chunking_handle {
            let all_samples = match rm.stop_recording(&binding_id) {
                Some(s) => s,
                None => {
                    let reason = format!(
                        "No samples returned when stopping recording for binding '{}' (chunked path)",
                        binding_id
                    );
                    warn!("{}", reason);
                    emit_runtime_error(
                        &ah,
                        "CAPTURE_NO_SAMPLES",
                        RuntimeErrorStage::Capture,
                        reason,
                        true,
                    );
                    if let Ok(mut p) = profiler.lock() {
                        p.mark_error("CAPTURE_NO_SAMPLES");
                        p.push_step_since(
                            "stop_recording",
                            stop_recording_time,
                            Some("chunked-path".to_string()),
                        );
                        p.emit(&ah);
                    }
                    utils::hide_recording_overlay(&ah);
                    change_tray_icon(&ah, TrayIconState::Idle);
                    return;
                }
            };
            if let Ok(mut p) = profiler.lock() {
                p.set_audio_duration_samples(all_samples.len());
                p.push_step_since(
                    "stop_recording",
                    stop_recording_time,
                    Some("chunked-path".to_string()),
                );
            }
            debug!(
                "Recording stopped in {:?}, {} samples total",
                stop_recording_time.elapsed(),
                all_samples.len()
            );

            let chunk_finalize_started = Instant::now();
            let (assembled, chunk_count, all_samples) = tokio::task::spawn_blocking(move || {
                let _ = ch.sampler_handle.join();

                let (last_committed, next_idx) = {
                    let s = ch.shared_state.lock().unwrap_or_else(|e| e.into_inner());
                    (s.last_committed_idx, s.next_chunk_idx)
                };

                let overlap_start = last_committed.saturating_sub(ch.chunk_overlap_samples);
                let remaining = all_samples[overlap_start..].to_vec();
                let sent_final = !remaining.is_empty();
                if sent_final {
                    ch.pending_chunks.fetch_add(1, Ordering::Relaxed);
                    if ch.chunk_tx.send(Some((remaining, next_idx))).is_err() {
                        ch.pending_chunks.fetch_sub(1, Ordering::Relaxed);
                    }
                }
                let _ = ch.chunk_tx.send(None);

                let _ = ch.worker_handle.join();

                let mut results = ch.results.lock().unwrap_or_else(|e| e.into_inner());
                results.sort_by_key(|r| r.0);

                let chunk_count = results.len();
                let assembled = if results.is_empty() {
                    String::new()
                } else if results.len() == 1 {
                    results[0].1.clone()
                } else {
                    let mut parts = vec![results[0].1.clone()];
                    for i in 1..results.len() {
                        let d = deduplicate_boundary(&results[i - 1].1, &results[i].1);
                        if !d.is_empty() {
                            parts.push(d);
                        }
                    }
                    parts.join(" ")
                };

                (assembled, chunk_count, all_samples)
            })
            .await
            .unwrap_or_else(|_| (String::new(), 0, Vec::new()));
            if let Ok(mut p) = profiler.lock() {
                p.push_step_since(
                    "chunk_finalize_and_assemble",
                    chunk_finalize_started,
                    Some(format!("chunks={}", chunk_count)),
                );
            }

            debug!(
                "Chunked assembly done: {} chunks → '{}' (first 80 chars)",
                chunk_count,
                &assembled.chars().take(80).collect::<String>()
            );

            let chunk_cleanup_started = Instant::now();
            let transcription = if chunk_count >= 2 && !assembled.is_empty() {
                let settings_for_cleanup = get_settings(&ah);
                cleanup_assembled_transcription(&settings_for_cleanup, &assembled)
                    .await
                    .unwrap_or(assembled)
            } else {
                assembled
            };
            if let Ok(mut p) = profiler.lock() {
                p.push_step_since(
                    "chunk_cleanup",
                    chunk_cleanup_started,
                    Some(format!(
                        "applied={}",
                        chunk_count >= 2 && !transcription.is_empty()
                    )),
                );
            }

            Some(TranscriptionResult {
                samples: all_samples,
                transcription,
                confidence_payload: None,
                chunk_count,
            })
        } else {
            let samples = match rm.stop_recording(&binding_id) {
                Some(s) => s,
                None => {
                    let reason = format!(
                        "No samples returned when stopping recording for binding '{}'",
                        binding_id
                    );
                    warn!("{}", reason);
                    emit_runtime_error(
                        &ah,
                        "CAPTURE_NO_SAMPLES",
                        RuntimeErrorStage::Capture,
                        reason,
                        true,
                    );
                    if let Ok(mut p) = profiler.lock() {
                        p.mark_error("CAPTURE_NO_SAMPLES");
                        p.push_step_since(
                            "stop_recording",
                            stop_recording_time,
                            Some("single-shot-path".to_string()),
                        );
                        p.emit(&ah);
                    }
                    utils::hide_recording_overlay(&ah);
                    change_tray_icon(&ah, TrayIconState::Idle);
                    return;
                }
            };
            if let Ok(mut p) = profiler.lock() {
                p.set_audio_duration_samples(samples.len());
                p.push_step_since(
                    "stop_recording",
                    stop_recording_time,
                    Some("single-shot-path".to_string()),
                );
            }
            debug!(
                "Recording stopped in {:?}, {} samples",
                stop_recording_time.elapsed(),
                samples.len()
            );

            let duration_seconds = samples.len() as f32 / 16_000.0;
            let settings_for_model = get_settings(&ah);
            let original_model = tm.get_current_model();
            let mut switched_model = false;
            let model_manager = ah.state::<Arc<ModelManager>>();
            let selected_model_info = original_model
                .as_deref()
                .and_then(|model_id| model_manager.get_model_info(model_id));

            if let Some((fallback_model, reason)) = resolve_runtime_model_override(
                selected_model_info.as_ref(),
                &model_manager,
                &settings_for_model,
            ) {
                if original_model.as_deref() != Some(fallback_model.id.as_str()) {
                    let model_switch_started = Instant::now();
                    info!(
                        "{}. Temporarily switching from Parakeet V3 to '{}' ({})",
                        reason, fallback_model.name, fallback_model.id
                    );
                    if let Err(err) = tm.load_model(&fallback_model.id) {
                        warn!(
                            "Failed to load fallback model '{}' after Parakeet V3 compatibility check: {}",
                            fallback_model.id,
                            err
                        );
                    } else {
                        switched_model = true;
                        if let Ok(mut p) = profiler.lock() {
                            p.set_model(
                                Some(fallback_model.id.clone()),
                                Some(fallback_model.name.clone()),
                            );
                            p.push_step_since(
                                "model_switch_runtime_override",
                                model_switch_started,
                                Some(reason),
                            );
                        }
                    }
                }
            } else if let Some(info) = selected_model_info.as_ref() {
                if is_parakeet_v3_model_id(&info.id)
                    && settings_for_model.selected_language != "auto"
                    && !model_supports_selected_language(info, &settings_for_model)
                {
                    warn!(
                        "Parakeet V3 is being used with unsupported language '{}', and no downloaded fallback model was available.",
                        settings_for_model.selected_language
                    );
                }
            }

            if should_switch_to_long_audio_model(
                duration_seconds,
                settings_for_model.long_audio_threshold_seconds,
                original_model.as_deref(),
                settings_for_model.long_audio_model.as_deref(),
            ) {
                if let Some(ref long_model_id) = settings_for_model.long_audio_model {
                    let long_model_switch_started = Instant::now();
                    debug!(
                        "Audio {:.1}s > threshold {:.1}s, switching to long model: {}",
                        duration_seconds,
                        settings_for_model.long_audio_threshold_seconds,
                        long_model_id
                    );
                    if let Err(e) = tm.load_model(long_model_id) {
                        warn!("Failed to load long audio model: {}", e);
                    } else {
                        switched_model = true;
                        if let Ok(mut p) = profiler.lock() {
                            p.set_model(Some(long_model_id.clone()), tm.get_current_model_name());
                            p.push_step_since(
                                "model_switch_long_audio",
                                long_model_switch_started,
                                Some(format!(
                                    "{:.1}s>{:.1}s",
                                    duration_seconds,
                                    settings_for_model.long_audio_threshold_seconds
                                )),
                            );
                        }
                    }
                }
            }

            let transcription_time = Instant::now();
            let samples_clone_fb = samples.clone();
            let transcription_output = match tm.transcribe_detailed_request(TranscriptionRequest {
                audio: samples.clone(),
                app_context: active_app_context.clone(),
            }) {
                Ok(mut output) => {
                    if let Ok(mut p) = profiler.lock() {
                        p.push_step_since(
                            "transcribe_primary",
                            transcription_time,
                            Some(format!(
                                "chars={}, duration_s={:.2}",
                                output.text.chars().count(),
                                duration_seconds
                            )),
                        );
                    }
                    debug!(
                        "Transcription in {:?}: '{}'",
                        transcription_time.elapsed(),
                        output.text
                    );
                    if output.text.is_empty() && duration_seconds > 1.0 && !switched_model {
                        if let Some(ref long_model_id) = settings_for_model.long_audio_model {
                            if original_model.as_deref() != Some(long_model_id.as_str()) {
                                let retry_started = Instant::now();
                                info!(
                                    "Empty result for {:.1}s audio, retrying with long model",
                                    duration_seconds
                                );
                                if tm.load_model(long_model_id).is_ok() {
                                    if let Ok(retry) =
                                        tm.transcribe_detailed_request(TranscriptionRequest {
                                            audio: samples_clone_fb,
                                            app_context: active_app_context.clone(),
                                        })
                                    {
                                        if !retry.text.is_empty() {
                                            output = retry;
                                        }
                                    }
                                    if let Ok(mut p) = profiler.lock() {
                                        p.set_model(
                                            Some(long_model_id.clone()),
                                            tm.get_current_model_name(),
                                        );
                                        p.push_step_since(
                                            "transcribe_retry_long_model",
                                            retry_started,
                                            Some(format!("chars={}", output.text.chars().count())),
                                        );
                                    }
                                }
                            }
                        }
                    }
                    output
                }
                Err(err) => {
                    let reason = format!("Transcription error: {}", err);
                    error!("{}", reason);
                    emit_runtime_error(
                        &ah,
                        "TRANSCRIPTION_FAILED",
                        RuntimeErrorStage::Transcription,
                        reason,
                        true,
                    );
                    if let Ok(mut p) = profiler.lock() {
                        p.mark_error("TRANSCRIPTION_FAILED");
                        p.push_step_since(
                            "transcribe_primary",
                            transcription_time,
                            Some("error".to_string()),
                        );
                        p.emit(&ah);
                    }
                    utils::hide_recording_overlay(&ah);
                    change_tray_icon(&ah, TrayIconState::Idle);
                    if switched_model {
                        if let Some(ref orig_id) = original_model {
                            let _ = tm.load_model(orig_id);
                        }
                    }
                    return;
                }
            };

            if switched_model {
                if let Some(ref orig_id) = original_model {
                    let restore_started = Instant::now();
                    if let Err(e) = tm.load_model(orig_id) {
                        warn!("Failed to restore original model: {}", e);
                    } else if let Ok(mut p) = profiler.lock() {
                        p.push_step_since(
                            "restore_original_model",
                            restore_started,
                            Some(orig_id.clone()),
                        );
                        p.set_model(original_model.clone(), tm.get_current_model_name());
                    }
                }
            }

            Some(TranscriptionResult {
                samples,
                transcription: transcription_output.text,
                confidence_payload: transcription_output.confidence_payload,
                chunk_count: 1,
            })
        };

        if let Some(TranscriptionResult {
            samples,
            transcription,
            confidence_payload,
            ..
        }) = result
        {
            if let Some(context) = active_app_context.clone() {
                if let Some(state) = ah.try_state::<ActiveAppContextState>() {
                    if let Ok(mut snapshot) = state.0.lock() {
                        snapshot.set_last_transcription_context(context);
                    }
                }
            }

            let duration_seconds = samples.len() as f32 / 16_000.0;
            let samples_clone = samples.clone();

            if !transcription.is_empty() {
                let outcome = process_transcription_text(
                    &ah,
                    &transcription,
                    active_app_context.as_ref(),
                    selected_action_key,
                    post_process,
                    &samples,
                    &profiler,
                )
                .await;

                dispatch_text_insertion(
                    &ah,
                    outcome.final_text.clone(),
                    is_basic_plan,
                    Arc::clone(&profiler),
                );

                if !transcription.is_empty() || duration_seconds > 1.0 {
                    let hm_clone = Arc::clone(&hm);
                    let transcription_for_history = transcription.clone();
                    let model_name_for_history = tm.get_current_model_name();
                    let action_key_for_history = if outcome.post_processed_text.is_some() {
                        selected_action_key
                    } else {
                        None
                    };
                    if let Ok(mut p) = profiler.lock() {
                        p.push_step(
                            "history_enqueue",
                            Duration::from_millis(0),
                            Some(format!(
                                "chars={}, post_processed={}",
                                transcription_for_history.chars().count(),
                                outcome.post_processed_text.is_some()
                            )),
                        );
                    }
                    tauri::async_runtime::spawn(async move {
                        if let Err(e) = hm_clone
                            .save_transcription(
                                samples_clone,
                                transcription_for_history,
                                confidence_payload,
                                outcome.post_processed_text,
                                outcome.post_process_prompt,
                                action_key_for_history,
                                model_name_for_history,
                            )
                            .await
                        {
                            error!("Failed to save transcription to history: {}", e);
                        }
                    });
                }
            } else {
                warn!("Empty transcription result; skipping automatic paste");
                emit_runtime_error(
                    &ah,
                    "TRANSCRIPTION_EMPTY",
                    RuntimeErrorStage::Transcription,
                    "Transcription produced empty output; paste skipped",
                    true,
                );
                if let Ok(mut p) = profiler.lock() {
                    p.set_transcription_chars("");
                    p.mark_error("TRANSCRIPTION_EMPTY");
                    p.emit(&ah);
                }
                utils::hide_recording_overlay(&ah);
                change_tray_icon(&ah, TrayIconState::Idle);
            }
        }
    });

    debug!(
        "TranscribeAction::stop completed in {:?}",
        stop_time.elapsed()
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn long_audio_switch_requires_threshold_and_different_model() {
        assert!(should_switch_to_long_audio_model(
            31.0,
            30.0,
            Some("small"),
            Some("large")
        ));
        assert!(!should_switch_to_long_audio_model(
            29.0,
            30.0,
            Some("small"),
            Some("large")
        ));
        assert!(!should_switch_to_long_audio_model(
            31.0,
            30.0,
            Some("large"),
            Some("large")
        ));
    }
}
