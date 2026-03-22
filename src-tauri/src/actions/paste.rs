use super::profiler::{emit_paste_failed_event, PipelineProfiler};
use crate::runtime_observability::{
    emit_lifecycle_state, emit_runtime_error, RuntimeErrorStage, TranscriptionLifecycleState,
};
use crate::tray::{change_tray_icon, TrayIconState};
use crate::utils;
use log::{debug, error, info};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum PasteExecutionMode {
    ClipboardOnlyBasic,
    NativePasteAllowed,
}

pub(super) fn decide_paste_execution_mode(is_basic_plan: bool) -> PasteExecutionMode {
    if is_basic_plan {
        PasteExecutionMode::ClipboardOnlyBasic
    } else {
        PasteExecutionMode::NativePasteAllowed
    }
}

pub(super) fn dispatch_text_insertion(
    app: &AppHandle,
    operation_id: u64,
    final_text: String,
    is_basic_plan: bool,
    profiler: Arc<Mutex<PipelineProfiler>>,
    on_success: Option<Box<dyn FnOnce() + Send + 'static>>,
) {
    let app_clone = app.clone();
    let fallback_text = final_text.clone();
    let main_thread_fallback_text = fallback_text.clone();
    let paste_time = Instant::now();

    if let Ok(mut p) = profiler.lock() {
        p.set_transcription_chars(&final_text);
    }

    if let Some(coordinator) = app.try_state::<crate::TranscriptionCoordinator>() {
        if !coordinator.mark_pasting(app, operation_id) {
            return;
        }
    } else {
        emit_lifecycle_state(
            app,
            TranscriptionLifecycleState::Pasting,
            None,
            Some("paste-dispatch"),
        );
    }

    let profiler_for_paste = Arc::clone(&profiler);
    app.run_on_main_thread(move || {
        let mut on_success = on_success;
        if let Some(coordinator) = app_clone.try_state::<crate::TranscriptionCoordinator>() {
            if !coordinator.is_operation_active(operation_id) {
                return;
            }
        }
        if let Ok(mut p) = profiler_for_paste.lock() {
            p.push_step_since("paste_dispatch_wait", paste_time, None);
        }

        let text_for_fallback = fallback_text.clone();
        let paste_exec_started = Instant::now();

        match decide_paste_execution_mode(is_basic_plan) {
            PasteExecutionMode::ClipboardOnlyBasic => {
                match app_clone.clipboard().write_text(&final_text) {
                    Ok(()) => {
                        debug!("Basic tier: copied transcription to clipboard");
                        let _ = app_clone.emit("basic-copied-to-clipboard", ());
                        if let Ok(mut p) = profiler_for_paste.lock() {
                            p.push_step_since(
                                "paste_execute",
                                paste_exec_started,
                                Some("basic_clipboard".to_string()),
                            );
                            p.mark_completed();
                            p.emit(&app_clone);
                        }
                        if let Some(callback) = on_success.take() {
                            callback();
                        }
                        crate::platform::clipboard_monitor::schedule_clipboard_diff_check(
                            app_clone.clone(),
                            final_text.clone(),
                        );
                        if let Some(coordinator) =
                            app_clone.try_state::<crate::TranscriptionCoordinator>()
                        {
                            let _ = coordinator.complete_operation(
                                &app_clone,
                                operation_id,
                                "clipboard-copy-completed",
                            );
                        }
                    }
                    Err(e) => {
                        error!("Basic tier clipboard write failed: {}", e);
                        emit_paste_failed_event(&app_clone, e.to_string(), false);
                    }
                }
            }
            PasteExecutionMode::NativePasteAllowed => match utils::paste(final_text.clone(), app_clone.clone()) {
                Ok(()) => {
                    debug!("Text pasted in {:?}", paste_time.elapsed());
                        if let Ok(mut p) = profiler_for_paste.lock() {
                            p.push_step_since(
                                "paste_execute",
                                paste_exec_started,
                                Some("ok".to_string()),
                        );
                            p.mark_completed();
                            p.emit(&app_clone);
                        }
                        if let Some(callback) = on_success.take() {
                            callback();
                        }
                        crate::platform::clipboard_monitor::schedule_clipboard_diff_check(
                            app_clone.clone(),
                            final_text.clone(),
                        );
                        if let Some(coordinator) =
                            app_clone.try_state::<crate::TranscriptionCoordinator>()
                        {
                        let _ =
                            coordinator.complete_operation(&app_clone, operation_id, "pasted");
                    }
                }
                Err(e) => {
                    let reason = format!("Failed to paste transcription: {}", e);
                    error!("{}", reason);
                    let copied_to_clipboard = match app_clone.clipboard().write_text(&text_for_fallback)
                    {
                        Ok(()) => {
                            info!("Paste failed, copied transcription to clipboard as fallback");
                            true
                        }
                        Err(copy_err) => {
                            error!(
                                "Fallback clipboard write failed after paste error: {}",
                                copy_err
                            );
                            false
                        }
                    };
                    emit_runtime_error(
                        &app_clone,
                        "PASTE_FAILED",
                        RuntimeErrorStage::Paste,
                        reason.clone(),
                        true,
                    );
                    emit_paste_failed_event(&app_clone, reason, copied_to_clipboard);
                    if let Ok(mut p) = profiler_for_paste.lock() {
                        p.push_step_since(
                            "paste_execute",
                            paste_exec_started,
                            Some(format!("fallback_clipboard={}", copied_to_clipboard)),
                        );
                        p.mark_error("PASTE_FAILED");
                        p.emit(&app_clone);
                    }
                    if let Some(coordinator) =
                        app_clone.try_state::<crate::TranscriptionCoordinator>()
                    {
                        let _ = coordinator.fail_operation(&app_clone, operation_id, "paste-failed");
                    }
                }
            },
        }

        utils::hide_recording_overlay(&app_clone);
        change_tray_icon(&app_clone, TrayIconState::Idle);
    })
    .unwrap_or_else(|e| {
        let reason = format!("Failed to run paste on main thread: {:?}", e);
        error!("{}", reason);
        let copied_to_clipboard = match app.clipboard().write_text(&main_thread_fallback_text) {
            Ok(()) => {
                info!(
                    "Main-thread paste dispatch failed, copied transcription to clipboard as fallback"
                );
                true
            }
            Err(copy_err) => {
                error!(
                    "Fallback clipboard write failed after main-thread dispatch error: {}",
                    copy_err
                );
                false
            }
        };
        emit_runtime_error(
            app,
            "PASTE_MAIN_THREAD_DISPATCH_FAILED",
            RuntimeErrorStage::Paste,
            reason.clone(),
            true,
        );
        emit_paste_failed_event(app, reason, copied_to_clipboard);
        if let Ok(mut p) = profiler.lock() {
            p.push_step_since(
                "paste_dispatch_wait",
                paste_time,
                Some("dispatch-failed".to_string()),
            );
            p.mark_error("PASTE_MAIN_THREAD_DISPATCH_FAILED");
            p.emit(app);
        }
        if let Some(coordinator) = app.try_state::<crate::TranscriptionCoordinator>() {
            let _ = coordinator.fail_operation(app, operation_id, "paste-dispatch-failed");
        }
        utils::hide_recording_overlay(app);
        change_tray_icon(app, TrayIconState::Idle);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn basic_plan_uses_clipboard_mode() {
        assert_eq!(
            decide_paste_execution_mode(true),
            PasteExecutionMode::ClipboardOnlyBasic
        );
    }

    #[test]
    fn premium_plan_keeps_native_paste() {
        assert_eq!(
            decide_paste_execution_mode(false),
            PasteExecutionMode::NativePasteAllowed
        );
    }
}
