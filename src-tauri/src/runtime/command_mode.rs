//! Command Mode — capture selected text → record voice command → LLM transform → paste.
//!
//! Flow (press-once shortcut, no push-to-talk):
//!   1. Shortcut pressed → `CommandModeAction::start()` fires.
//!   2. Premium gate checked; LLM provider validated.
//!   3. Background thread waits 250 ms for modifier keys to release, then sends
//!      Ctrl+C to copy the current selection to clipboard.
//!   4. If clipboard is empty → toast error, abort.
//!   5. Recording starts (max `COMMAND_MAX_DURATION_SECS` seconds).
//!   6. `command-mode-started` event fires so the frontend can show a countdown UI.
//!   7. Recording stops automatically; samples are transcribed locally.
//!   8. Transcription + selected text sent to the configured LLM.
//!   9. LLM result pasted back into the active app via `crate::clipboard::paste`.
//!  10. `command-mode-finished` event fires so the frontend hides the overlay.
//!
//! `CommandModeAction::stop()` is intentionally a no-op: the shortcut is registered
//! as press-only in the handler.

use crate::input::EnigoState;
use crate::managers::audio::AudioRecordingManager;
use crate::managers::transcription::TranscriptionManager;
use crate::settings::get_settings;
use enigo::{Direction, Key, Keyboard};
use log::{debug, error, info, warn};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;

// ── Constants ─────────────────────────────────────────────────────────────────

/// Maximum recording duration for a voice command.
const COMMAND_MAX_DURATION_SECS: u64 = 8;

/// How long to wait after pressing the shortcut before sending Ctrl+C, so that
/// the modifier keys (Ctrl, Alt, …) used for the shortcut have time to be
/// released by the OS and do not bleed into the simulated key combo.
const PRE_COPY_DELAY_MS: u64 = 250;

/// How long to wait after sending Ctrl+C for the clipboard to be updated.
const CLIPBOARD_SETTLE_MS: u64 = 150;

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Simulate Ctrl+C (copy) using platform-appropriate virtual key codes.
fn send_copy_ctrl_c(enigo: &mut enigo::Enigo) -> Result<(), String> {
    // Use raw VK_C (0x43) on Windows so the combo works on any keyboard layout.
    #[cfg(target_os = "windows")]
    let c_key = Key::Other(0x43); // VK_C
    #[cfg(not(target_os = "windows"))]
    let c_key = Key::Unicode('c');

    enigo
        .key(Key::Control, Direction::Press)
        .map_err(|e| format!("Failed to press Control: {}", e))?;

    enigo
        .key(c_key, Direction::Click)
        .map_err(|e| format!("Failed to click C key: {}", e))?;

    // Small settle: the target app needs a moment to write to the clipboard.
    std::thread::sleep(Duration::from_millis(CLIPBOARD_SETTLE_MS));

    enigo
        .key(Key::Control, Direction::Release)
        .map_err(|e| format!("Failed to release Control: {}", e))?;

    Ok(())
}

/// Emit a user-facing error toast via the `command-mode-error` event.
fn emit_error(app: &AppHandle, message: impl Into<String>) {
    let msg = message.into();
    warn!("Command mode error: {}", msg);
    let _ = app.emit("command-mode-error", serde_json::json!({ "message": msg }));
}

/// Emit `command-mode-finished` to let the frontend hide any overlay.
fn emit_finished(app: &AppHandle) {
    let _ = app.emit("command-mode-finished", ());
}

// ── ShortcutAction ────────────────────────────────────────────────────────────

pub struct CommandModeAction;

impl crate::actions::ShortcutAction for CommandModeAction {
    /// Called when the shortcut is pressed.  Performs the full pipeline on a
    /// background task so the shortcut handler thread is never blocked.
    fn start(&self, app: &AppHandle, _binding_id: &str, _shortcut_str: &str) {
        // ── 1. Premium gate ────────────────────────────────────────────────────
        if let Err(err) = crate::license::enforce_premium_access(app, "command_mode") {
            warn!("Command mode blocked by license gate: {}", err);
            let _ = app.emit("premium-access-denied", err);
            return;
        }

        // ── 2. LLM provider configured? ───────────────────────────────────────
        {
            let settings = get_settings(app);
            if settings.active_post_process_provider().is_none() {
                emit_error(
                    app,
                    "Command Mode nécessite un fournisseur LLM. Configure-le dans Paramètres → Dictée.",
                );
                return;
            }
        }

        // ── 3. Spawn background task — never block the shortcut handler ────────
        let app_clone = app.clone();
        tauri::async_runtime::spawn(async move {
            run_command_mode(app_clone).await;
        });
    }

    /// No-op: this action is registered as press-only in the shortcut handler.
    fn stop(&self, _app: &AppHandle, _binding_id: &str, _shortcut_str: &str) {}
}

// ── Core pipeline ─────────────────────────────────────────────────────────────

async fn run_command_mode(app: AppHandle) {
    // ── Step 1: Wait for modifier keys to be physically released ──────────────
    // The shortcut (e.g., Ctrl+Alt+C) fires on key-down; the modifier keys may
    // still be held when our handler runs.  Waiting PRE_COPY_DELAY_MS lets the
    // OS report their release before we simulate Ctrl+C.
    tokio::time::sleep(Duration::from_millis(PRE_COPY_DELAY_MS)).await;

    // ── Step 2: Send Ctrl+C and capture selected text ─────────────────────────
    let clipboard = app.clipboard();

    // Save what was in the clipboard before so we can detect "nothing selected".
    let clipboard_before = clipboard.read_text().unwrap_or_default();

    // Send Ctrl+C from a blocking thread (enigo requires blocking I/O).
    if app.try_state::<EnigoState>().is_none() {
        emit_error(&app, "Système d'entrée non initialisé.");
        return;
    }

    let app_for_enigo = app.clone();
    let ctrl_c_result = tokio::task::spawn_blocking(move || {
        let enigo_state = app_for_enigo.state::<EnigoState>();
        let mut enigo = match enigo_state.0.lock() {
            Ok(e) => e,
            Err(p) => p.into_inner(),
        };
        send_copy_ctrl_c(&mut enigo)
    })
    .await;

    if let Err(e) = ctrl_c_result {
        error!("Command mode: spawn_blocking for Ctrl+C panicked: {}", e);
        emit_error(&app, "Erreur lors de la copie du texte sélectionné.");
        return;
    }
    // The blocking fn itself returns Result; unwrap the outer join result.
    if let Ok(Err(e)) = ctrl_c_result {
        warn!("Command mode: Ctrl+C failed: {}", e);
        // Non-fatal: the selection might already be in the clipboard.
    }

    // Small extra settle to let the clipboard stabilise.
    tokio::time::sleep(Duration::from_millis(50)).await;

    let selected_text = clipboard.read_text().unwrap_or_default();

    if selected_text.trim().is_empty() {
        emit_error(
            &app,
            "Sélectionne du texte avant d'utiliser le Command Mode.",
        );
        return;
    }

    // If clipboard didn't change at all, there might be no selection.
    // We still proceed — the user may have copied the text they want to edit
    // manually.  Emitting a warning is enough.
    if selected_text == clipboard_before {
        debug!(
            "Command mode: clipboard unchanged after Ctrl+C (possibly no selection, \
             proceeding with clipboard content)"
        );
    }

    debug!(
        "Command mode: captured {} chars of selected text",
        selected_text.len()
    );

    // ── Step 3: Start recording ───────────────────────────────────────────────
    let rm = app.state::<Arc<AudioRecordingManager>>();
    let binding_id = "command_mode";

    if !rm.try_start_recording(binding_id) {
        emit_error(
            &app,
            "Failed to start recording (a dictation may already be in progress).",
        );
        return;
    }

    info!(
        "Command mode: recording started, max {} s",
        COMMAND_MAX_DURATION_SECS
    );

    // Notify frontend so it can show a "speak now / countdown" overlay.
    let _ = app.emit(
        "command-mode-started",
        serde_json::json!({ "max_duration_secs": COMMAND_MAX_DURATION_SECS }),
    );

    // ── Step 4: Record for up to COMMAND_MAX_DURATION_SECS ────────────────────
    tokio::time::sleep(Duration::from_secs(COMMAND_MAX_DURATION_SECS)).await;

    // ── Step 5: Stop recording and collect samples ────────────────────────────
    let samples = match rm.stop_recording(binding_id) {
        Some(s) if !s.is_empty() => s,
        _ => {
            emit_error(&app, "No audio captured for the command.");
            emit_finished(&app);
            return;
        }
    };

    info!(
        "Command mode: {} samples captured ({:.1} s)",
        samples.len(),
        samples.len() as f32 / 16_000.0
    );

    let _ = app.emit("command-mode-processing", ());

    // ── Step 6: Transcribe locally ────────────────────────────────────────────
    let tm = Arc::clone(&*app.state::<Arc<TranscriptionManager>>());
    let command_text = match tokio::task::spawn_blocking(move || tm.transcribe(samples)).await {
        Ok(Ok(text)) if !text.trim().is_empty() => text.trim().to_string(),
        Ok(Ok(_)) => {
            emit_error(&app, "Voice command not recognized. Please try again.");
            emit_finished(&app);
            return;
        }
        Ok(Err(e)) => {
            error!("Command mode transcription error: {}", e);
            emit_error(&app, "Error transcribing the command.");
            emit_finished(&app);
            return;
        }
        Err(e) => {
            error!("Command mode transcription task panicked: {}", e);
            emit_finished(&app);
            return;
        }
    };

    info!("Command mode: transcribed command = «{}»", command_text);

    // ── Step 7: LLM transform ─────────────────────────────────────────────────
    let settings = get_settings(&app);

    let provider = match settings.active_post_process_provider().cloned() {
        Some(p) => p,
        None => {
            emit_error(&app, "No LLM provider configured.");
            emit_finished(&app);
            return;
        }
    };

    let model = settings
        .post_process_models
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();

    if model.trim().is_empty() {
        emit_error(
            &app,
            "No LLM model configured. Choose a model in Settings → Dictation.",
        );
        emit_finished(&app);
        return;
    }

    let api_key = settings
        .post_process_api_keys
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();

    let system_prompt = "Tu es un assistant d'édition de texte. \
        L'utilisateur te fournit un texte sélectionné et une commande vocale. \
        Applique la commande au texte et retourne UNIQUEMENT le texte résultant, \
        sans explication, sans guillemets, sans balises markdown. \
        Retourne seulement le texte transformé, rien d'autre."
        .to_string();

    let user_message = format!(
        "Texte sélectionné :\n{}\n\nCommande : {}",
        selected_text.trim(),
        command_text
    );

    debug!(
        "Command mode: calling LLM ({} / {}), user message {} chars",
        provider.id,
        model,
        user_message.len()
    );

    let llm_result = crate::llm_client::send_chat_completion_with_schema(
        &provider,
        api_key,
        &model,
        user_message,
        Some(system_prompt),
        None, // free-form text output — no JSON schema needed
    )
    .await;

    let transformed = match llm_result {
        Ok(Some(text)) if !text.trim().is_empty() => text.trim().to_string(),
        Ok(Some(_)) | Ok(None) => {
            emit_error(&app, "Le LLM n'a retourné aucun résultat.");
            emit_finished(&app);
            return;
        }
        Err(e) => {
            error!("Command mode LLM call failed: {}", e);
            emit_error(&app, format!("Erreur LLM : {}", e));
            emit_finished(&app);
            return;
        }
    };

    info!("Command mode: LLM returned {} chars", transformed.len());

    // ── Step 8: Paste result ──────────────────────────────────────────────────
    match crate::clipboard::paste(transformed, app.clone()) {
        Ok(()) => {
            info!("Command mode: result pasted successfully");
        }
        Err(e) => {
            error!("Command mode paste failed: {}", e);
            emit_error(&app, format!("Erreur lors du collage : {}", e));
        }
    }

    emit_finished(&app);
}
