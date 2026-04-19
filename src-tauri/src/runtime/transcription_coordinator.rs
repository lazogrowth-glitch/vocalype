use crate::actions::ACTION_MAP;
use crate::overlay::{emit_action_deselected, emit_action_selected};
use crate::runtime_observability::{
    emit_lifecycle_state_with_context, TranscriptionLifecycleState,
};
use crate::settings::get_settings;
use log::{debug, error, warn};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::AppHandle;

const DEBOUNCE: Duration = Duration::from_millis(30);

#[derive(Debug)]
enum Command {
    Input {
        binding_id: String,
        hotkey_string: String,
        is_pressed: bool,
        push_to_talk: bool,
    },
    SelectAction {
        key: u8,
    },
}

#[derive(Debug, Clone)]
struct CoordinatorRuntimeState {
    next_operation_id: u64,
    active_operation_id: Option<u64>,
    active_binding_id: Option<String>,
    selected_action: Option<u8>,
    lifecycle_state: TranscriptionLifecycleState,
    cancelled_at_stage: Option<TranscriptionLifecycleState>,
    partial_result: bool,
    latest_preview_text: Option<String>,
}

impl Default for CoordinatorRuntimeState {
    fn default() -> Self {
        Self {
            next_operation_id: 1,
            active_operation_id: None,
            active_binding_id: None,
            selected_action: None,
            lifecycle_state: TranscriptionLifecycleState::Idle,
            cancelled_at_stage: None,
            partial_result: false,
            latest_preview_text: None,
        }
    }
}

impl CoordinatorRuntimeState {
    fn can_start(&self) -> bool {
        matches!(
            self.lifecycle_state,
            TranscriptionLifecycleState::Idle
                | TranscriptionLifecycleState::Completed
                | TranscriptionLifecycleState::Cancelled
                | TranscriptionLifecycleState::Error
        )
    }

    fn is_recording_like(&self) -> bool {
        matches!(
            self.lifecycle_state,
            TranscriptionLifecycleState::Recording | TranscriptionLifecycleState::Paused
        )
    }
}

pub struct TranscriptionCoordinator {
    tx: Sender<Command>,
    state: Arc<Mutex<CoordinatorRuntimeState>>,
}

pub fn is_transcribe_binding(id: &str) -> bool {
    matches!(
        id,
        "transcribe" | "transcribe_with_post_process" | "agent_key" | "meeting_key" | "note_key"
    )
}

pub fn is_launch_hidden_binding(id: &str) -> bool {
    matches!(
        id,
        "agent_key" | "meeting_key" | "note_key" | "command_mode" | "whisper_mode"
    )
}

pub fn is_action_binding(id: &str) -> bool {
    id.starts_with("action_")
}

pub fn parse_action_key(id: &str) -> Option<u8> {
    id.strip_prefix("action_").and_then(|k| k.parse().ok())
}

impl TranscriptionCoordinator {
    pub fn new(app: AppHandle) -> Self {
        let (tx, rx) = mpsc::channel();
        let state = Arc::new(Mutex::new(CoordinatorRuntimeState::default()));
        let state_for_thread = Arc::clone(&state);

        thread::spawn(move || {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let mut last_press: Option<Instant> = None;

                while let Ok(cmd) = rx.recv() {
                    match cmd {
                        Command::Input {
                            binding_id,
                            hotkey_string,
                            is_pressed,
                            push_to_talk,
                        } => {
                            if is_pressed {
                                let now = Instant::now();
                                if last_press.map_or(false, |t| now.duration_since(t) < DEBOUNCE) {
                                    debug!("Debounced press for '{binding_id}'");
                                    continue;
                                }
                                last_press = Some(now);
                            }

                            if push_to_talk {
                                if is_pressed {
                                    if current_stage(&state_for_thread).can_start() {
                                        start(&app, &binding_id, &hotkey_string);
                                    }
                                } else if matches_binding_in_stage(
                                    &state_for_thread,
                                    &binding_id,
                                    true,
                                ) {
                                    stop(&app, &binding_id, &hotkey_string);
                                }
                            } else if is_pressed {
                                let state_snapshot = current_stage(&state_for_thread);
                                if state_snapshot.can_start() {
                                    start(&app, &binding_id, &hotkey_string);
                                } else if matches_binding_in_stage(
                                    &state_for_thread,
                                    &binding_id,
                                    true,
                                ) {
                                    stop(&app, &binding_id, &hotkey_string);
                                } else {
                                    debug!("Ignoring press for '{binding_id}': pipeline busy");
                                }
                            }
                        }
                        Command::SelectAction { key } => {
                            let mut guard =
                                state_for_thread.lock().unwrap_or_else(|e| e.into_inner());
                            if guard.is_recording_like() {
                                if guard.selected_action == Some(key) {
                                    guard.selected_action = None;
                                    emit_action_deselected(&app);
                                    debug!("Action {} deselected during recording", key);
                                } else {
                                    guard.selected_action = Some(key);
                                    let settings = get_settings(&app);
                                    if let Some(action) =
                                        settings.post_process_actions.iter().find(|a| a.key == key)
                                    {
                                        emit_action_selected(&app, key, &action.name);
                                    }
                                    debug!("Action {} selected during recording", key);
                                }
                            } else {
                                debug!("Action selection ignored: not in recording state");
                            }
                        }
                    }
                }
                debug!("Transcription coordinator exited");
            }));
            if let Err(e) = result {
                error!("Transcription coordinator panicked: {e:?}");
            }
        });

        Self { tx, state }
    }

    pub fn send_input(
        &self,
        binding_id: &str,
        hotkey_string: &str,
        is_pressed: bool,
        push_to_talk: bool,
    ) {
        if self
            .tx
            .send(Command::Input {
                binding_id: binding_id.to_string(),
                hotkey_string: hotkey_string.to_string(),
                is_pressed,
                push_to_talk,
            })
            .is_err()
        {
            warn!("Transcription coordinator channel closed");
        }
    }

    pub fn select_action(&self, key: u8) {
        if self.tx.send(Command::SelectAction { key }).is_err() {
            warn!("Transcription coordinator channel closed");
        }
    }

    pub fn begin_preparing(&self, app: &AppHandle, binding_id: &str) -> Result<u64, String> {
        let mut guard = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if !guard.can_start() {
            return Err(format!(
                "pipeline busy in state {:?}",
                guard.lifecycle_state
            ));
        }

        let operation_id = guard.next_operation_id;
        guard.next_operation_id += 1;
        guard.active_operation_id = Some(operation_id);
        guard.active_binding_id = Some(binding_id.to_string());
        guard.selected_action = None;
        guard.cancelled_at_stage = None;
        guard.partial_result = false;
        guard.latest_preview_text = None;
        guard.lifecycle_state = TranscriptionLifecycleState::PreparingMicrophone;
        drop(guard);

        emit_lifecycle_state_with_context(
            app,
            TranscriptionLifecycleState::PreparingMicrophone,
            Some(operation_id),
            Some(binding_id),
            Some("preparing-microphone"),
            true,
        );
        Ok(operation_id)
    }

    pub fn mark_recording(&self, app: &AppHandle, operation_id: u64) -> bool {
        self.transition_active(
            app,
            operation_id,
            TranscriptionLifecycleState::Recording,
            Some("recording-started"),
            true,
        )
    }

    pub fn set_paused(&self, app: &AppHandle, operation_id: u64, paused: bool) -> bool {
        let target = if paused {
            TranscriptionLifecycleState::Paused
        } else {
            TranscriptionLifecycleState::Recording
        };
        let detail = if paused {
            "recording-paused"
        } else {
            "recording-resumed"
        };
        self.transition_active(app, operation_id, target, Some(detail), true)
    }

    pub fn mark_stopping(&self, app: &AppHandle, operation_id: u64) -> bool {
        self.transition_active(
            app,
            operation_id,
            TranscriptionLifecycleState::Stopping,
            Some("recording-stopping"),
            true,
        )
    }

    pub fn mark_transcribing(&self, app: &AppHandle, operation_id: u64) -> bool {
        self.transition_active(
            app,
            operation_id,
            TranscriptionLifecycleState::Transcribing,
            Some("transcribing"),
            true,
        )
    }

    pub fn mark_processing(&self, app: &AppHandle, operation_id: u64, detail: &str) -> bool {
        self.transition_active(
            app,
            operation_id,
            TranscriptionLifecycleState::Processing,
            Some(detail),
            true,
        )
    }

    pub fn mark_pasting(&self, app: &AppHandle, operation_id: u64) -> bool {
        self.transition_active(
            app,
            operation_id,
            TranscriptionLifecycleState::Pasting,
            Some("pasting"),
            true,
        )
    }

    pub fn mark_partial_result(&self, partial: bool) {
        self.state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .partial_result = partial;
    }

    pub fn update_live_preview(&self, operation_id: u64, text: Option<String>) {
        let mut guard = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if guard.active_operation_id != Some(operation_id) {
            return;
        }
        guard.latest_preview_text = text.and_then(|value| {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        });
    }

    pub fn latest_live_preview(&self, operation_id: u64) -> Option<String> {
        let guard = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if guard.active_operation_id == Some(operation_id) {
            guard.latest_preview_text.clone()
        } else {
            None
        }
    }

    pub fn complete_operation(&self, app: &AppHandle, operation_id: u64, detail: &str) -> bool {
        let (binding_id, transitioned) = {
            let mut guard = self.state.lock().unwrap_or_else(|e| e.into_inner());
            if guard.active_operation_id != Some(operation_id) {
                return false;
            }
            let binding_id = guard.active_binding_id.clone();
            guard.lifecycle_state = TranscriptionLifecycleState::Completed;
            guard.active_operation_id = None;
            guard.active_binding_id = None;
            guard.selected_action = None;
            guard.latest_preview_text = None;
            (binding_id, true)
        };

        if transitioned {
            emit_action_deselected(app);
            emit_lifecycle_state_with_context(
                app,
                TranscriptionLifecycleState::Completed,
                Some(operation_id),
                binding_id.as_deref(),
                Some(detail),
                true,
            );
        }

        transitioned
    }

    pub fn fail_operation(&self, app: &AppHandle, operation_id: u64, detail: &str) -> bool {
        let binding_id = {
            let mut guard = self.state.lock().unwrap_or_else(|e| e.into_inner());
            if guard.active_operation_id != Some(operation_id) {
                return false;
            }
            let binding_id = guard.active_binding_id.clone();
            guard.lifecycle_state = TranscriptionLifecycleState::Error;
            guard.active_operation_id = None;
            guard.active_binding_id = None;
            guard.selected_action = None;
            guard.latest_preview_text = None;
            binding_id
        };

        emit_action_deselected(app);
        emit_lifecycle_state_with_context(
            app,
            TranscriptionLifecycleState::Error,
            Some(operation_id),
            binding_id.as_deref(),
            Some(detail),
            false,
        );
        true
    }

    pub fn notify_cancel(&self, app: &AppHandle, detail: &str) -> Option<u64> {
        let (operation_id, binding_id) = {
            let mut guard = self.state.lock().unwrap_or_else(|e| e.into_inner());
            let operation_id = guard.active_operation_id?;
            let binding_id = guard.active_binding_id.clone();
            guard.cancelled_at_stage = Some(guard.lifecycle_state);
            guard.lifecycle_state = TranscriptionLifecycleState::Cancelled;
            guard.active_operation_id = None;
            guard.active_binding_id = None;
            guard.selected_action = None;
            guard.latest_preview_text = None;
            (operation_id, binding_id)
        };

        emit_action_deselected(app);
        emit_lifecycle_state_with_context(
            app,
            TranscriptionLifecycleState::Cancelled,
            Some(operation_id),
            binding_id.as_deref(),
            Some(detail),
            true,
        );
        Some(operation_id)
    }

    pub fn active_operation_id(&self) -> Option<u64> {
        self.state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .active_operation_id
    }

    pub fn is_operation_active(&self, operation_id: u64) -> bool {
        self.state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .active_operation_id
            == Some(operation_id)
    }

    pub fn selected_action(&self, operation_id: u64) -> Option<u8> {
        let guard = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if guard.active_operation_id == Some(operation_id) {
            guard.selected_action
        } else {
            None
        }
    }

    pub fn active_binding_id(&self) -> Option<String> {
        self.state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .active_binding_id
            .clone()
    }

    pub fn lifecycle_state(&self) -> TranscriptionLifecycleState {
        self.state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .lifecycle_state
    }

    pub fn diagnostics_snapshot(
        &self,
    ) -> (
        Option<u64>,
        Option<TranscriptionLifecycleState>,
        Option<TranscriptionLifecycleState>,
        bool,
    ) {
        let guard = self.state.lock().unwrap_or_else(|e| e.into_inner());
        (
            guard.active_operation_id,
            guard.active_operation_id.map(|_| guard.lifecycle_state),
            guard.cancelled_at_stage,
            guard.partial_result,
        )
    }

    fn transition_active(
        &self,
        app: &AppHandle,
        operation_id: u64,
        state: TranscriptionLifecycleState,
        detail: Option<&str>,
        recoverable: bool,
    ) -> bool {
        let binding_id = {
            let mut guard = self.state.lock().unwrap_or_else(|e| e.into_inner());
            if guard.active_operation_id != Some(operation_id) {
                return false;
            }
            guard.lifecycle_state = state;
            guard.active_binding_id.clone()
        };

        emit_lifecycle_state_with_context(
            app,
            state,
            Some(operation_id),
            binding_id.as_deref(),
            detail,
            recoverable,
        );
        true
    }
}

fn current_stage(state: &Arc<Mutex<CoordinatorRuntimeState>>) -> CoordinatorRuntimeState {
    state.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

fn matches_binding_in_stage(
    state: &Arc<Mutex<CoordinatorRuntimeState>>,
    binding_id: &str,
    recording_only: bool,
) -> bool {
    let guard = state.lock().unwrap_or_else(|e| e.into_inner());
    let stage_matches = if recording_only {
        guard.is_recording_like()
    } else {
        !guard.can_start()
    };
    stage_matches && guard.active_binding_id.as_deref() == Some(binding_id)
}

fn start(app: &AppHandle, binding_id: &str, hotkey_string: &str) {
    let Some(action) = ACTION_MAP.get(binding_id) else {
        warn!("No action in ACTION_MAP for '{binding_id}'");
        return;
    };
    action.start(app, binding_id, hotkey_string);
}

fn stop(app: &AppHandle, binding_id: &str, hotkey_string: &str) {
    let Some(action) = ACTION_MAP.get(binding_id) else {
        warn!("No action in ACTION_MAP for '{binding_id}'");
        return;
    };
    action.stop(app, binding_id, hotkey_string);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_state_can_start() {
        assert!(CoordinatorRuntimeState::default().can_start());
    }

    #[test]
    fn launch_hidden_bindings_stay_registered_but_blocked() {
        assert!(is_transcribe_binding("agent_key"));
        assert!(is_transcribe_binding("meeting_key"));
        assert!(is_transcribe_binding("note_key"));
        assert!(is_launch_hidden_binding("agent_key"));
        assert!(is_launch_hidden_binding("meeting_key"));
        assert!(is_launch_hidden_binding("note_key"));
        assert!(is_launch_hidden_binding("command_mode"));
        assert!(is_launch_hidden_binding("whisper_mode"));
        assert!(!is_launch_hidden_binding("transcribe"));
    }

    #[test]
    fn paused_counts_as_recording_state() {
        let mut state = CoordinatorRuntimeState::default();
        state.lifecycle_state = TranscriptionLifecycleState::Paused;
        assert!(state.is_recording_like());
    }

    #[test]
    fn terminal_states_allow_next_operation() {
        for lifecycle_state in [
            TranscriptionLifecycleState::Completed,
            TranscriptionLifecycleState::Cancelled,
            TranscriptionLifecycleState::Error,
        ] {
            let mut state = CoordinatorRuntimeState::default();
            state.lifecycle_state = lifecycle_state;
            assert!(
                state.can_start(),
                "{lifecycle_state:?} should allow restart"
            );
        }
    }

    #[test]
    fn active_pipeline_states_block_next_operation() {
        for lifecycle_state in [
            TranscriptionLifecycleState::PreparingMicrophone,
            TranscriptionLifecycleState::Recording,
            TranscriptionLifecycleState::Paused,
            TranscriptionLifecycleState::Stopping,
            TranscriptionLifecycleState::Transcribing,
            TranscriptionLifecycleState::Processing,
            TranscriptionLifecycleState::Pasting,
        ] {
            let mut state = CoordinatorRuntimeState::default();
            state.lifecycle_state = lifecycle_state;
            assert!(
                !state.can_start(),
                "{lifecycle_state:?} should block restart"
            );
        }
    }
}
