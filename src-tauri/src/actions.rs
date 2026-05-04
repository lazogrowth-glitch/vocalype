mod agent;
pub mod meeting;
mod model_selection;
pub mod note;
mod paste;
mod post_processing;
mod profiler;
pub(crate) mod transcribe;

use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};

pub trait ShortcutAction: Send + Sync {
    fn start(&self, app: &AppHandle, binding_id: &str, shortcut_str: &str);
    fn stop(&self, app: &AppHandle, binding_id: &str, shortcut_str: &str);
}

struct TranscribeAction {
    post_process: bool,
}

impl ShortcutAction for TranscribeAction {
    fn start(&self, app: &AppHandle, binding_id: &str, _shortcut_str: &str) {
        transcribe::start_transcription_action(app, binding_id);
    }

    fn stop(&self, app: &AppHandle, binding_id: &str, _shortcut_str: &str) {
        transcribe::stop_transcription_action(app, binding_id, self.post_process);
    }
}

struct CancelAction;

impl ShortcutAction for CancelAction {
    fn start(&self, app: &AppHandle, _binding_id: &str, _shortcut_str: &str) {
        // Must NOT call cancel_current_operation synchronously here — this may be invoked
        // from the native shortcut manager thread, which is the same thread that processes
        // Unregister commands. cancel_current_operation calls unregister_*_shortcut which
        // sends an Unregister command and blocks on rx.recv(), causing a self-deadlock.
        let app_clone = app.clone();
        tauri::async_runtime::spawn(async move {
            crate::utils::cancel_current_operation(&app_clone);
        });
    }

    fn stop(&self, _app: &AppHandle, _binding_id: &str, _shortcut_str: &str) {}
}

struct TestAction;

impl ShortcutAction for TestAction {
    fn start(&self, app: &AppHandle, binding_id: &str, shortcut_str: &str) {
        log::info!(
            "Shortcut ID '{}': Started - {} (App: {})",
            binding_id,
            shortcut_str,
            app.package_info().name
        );
    }

    fn stop(&self, app: &AppHandle, binding_id: &str, shortcut_str: &str) {
        log::info!(
            "Shortcut ID '{}': Stopped - {} (App: {})",
            binding_id,
            shortcut_str,
            app.package_info().name
        );
    }
}

struct WhisperModeAction;

impl ShortcutAction for WhisperModeAction {
    fn start(&self, app: &AppHandle, _binding_id: &str, _shortcut_str: &str) {
        let rm = app.state::<Arc<crate::managers::audio::AudioRecordingManager>>();
        let currently_active = rm.is_whisper_mode();
        let new_state = !currently_active;

        if let Err(e) = rm.set_whisper_mode(new_state) {
            log::error!("Failed to set whisper mode: {}", e);
            let _ = app.emit("whisper-mode-error", e.to_string());
            return;
        }

        let mut settings = crate::settings::get_settings(app);
        settings.whisper_mode = new_state;
        crate::settings::write_settings(app, settings);

        let _ = app.emit("whisper-mode-changed", new_state);
        log::info!("Whisper mode toggled to {}", new_state);
    }

    fn stop(&self, _app: &AppHandle, _binding_id: &str, _shortcut_str: &str) {}
}

struct ToggleLanguageAction;

impl ShortcutAction for ToggleLanguageAction {
    fn start(&self, app: &AppHandle, _binding_id: &str, _shortcut_str: &str) {
        // Cycle: auto → fr → en → auto
        const CYCLE: &[&str] = &["auto", "fr", "en"];

        let mut settings = crate::settings::get_settings(app);
        let current = settings.selected_language.as_str();

        let next = CYCLE
            .iter()
            .position(|&l| l == current)
            .map(|i| CYCLE[(i + 1) % CYCLE.len()])
            .unwrap_or("auto");

        settings.selected_language = next.to_string();
        crate::settings::write_settings(app, settings);

        let _ = app.emit("language-toggled", next);
        log::info!("Language toggled to '{}'", next);
    }

    fn stop(&self, _app: &AppHandle, _binding_id: &str, _shortcut_str: &str) {}
}

pub static ACTION_MAP: Lazy<HashMap<String, Arc<dyn ShortcutAction>>> = Lazy::new(|| {
    let mut map = HashMap::new();
    map.insert(
        "transcribe".to_string(),
        Arc::new(TranscribeAction {
            post_process: false,
        }) as Arc<dyn ShortcutAction>,
    );
    map.insert(
        "transcribe_with_post_process".to_string(),
        Arc::new(TranscribeAction { post_process: true }) as Arc<dyn ShortcutAction>,
    );
    map.insert(
        "cancel".to_string(),
        Arc::new(CancelAction) as Arc<dyn ShortcutAction>,
    );
    map.insert(
        "test".to_string(),
        Arc::new(TestAction) as Arc<dyn ShortcutAction>,
    );
    map.insert(
        "command_mode".to_string(),
        Arc::new(crate::command_mode::CommandModeAction) as Arc<dyn ShortcutAction>,
    );
    map.insert(
        "whisper_mode".to_string(),
        Arc::new(WhisperModeAction) as Arc<dyn ShortcutAction>,
    );
    map.insert(
        "toggle_language".to_string(),
        Arc::new(ToggleLanguageAction) as Arc<dyn ShortcutAction>,
    );
    map
});
