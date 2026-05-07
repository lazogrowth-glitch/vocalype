mod actions;
pub mod audio_toolkit;
pub mod cli;
mod commands;
pub mod error;
pub mod eval;
mod helpers;
mod managers;
mod settings;
mod shortcut;
mod tray;

// Organised sub-modules

/// LLM provider clients (Gemini, OpenAI-compatible, prompt builder).
mod llm;
/// Platform abstraction (keyboard, clipboard, overlay, audio feedback, signals).
mod platform;
/// Text processing pipeline (filler, dictionary, punctuation, LLM cleanup).
mod processing;
/// Application runtime core (adaptive engine, transcription lifecycle, VAD).
mod runtime;
/// Security subsystem (license, integrity, crypto, keyring).
mod security;

// Backward-compatible re-exports
// `pub use` ensures existing `use crate::X::SomeType` imports in sub-modules
// continue to resolve without changes.

// processing
pub use processing::{
    code_dictation, correction_tracker, dictionary, filler, post_processing, punctuation,
};
// security
pub use security::{bundle_signing, integrity, license, model_crypto, secret_store};
// llm
pub use llm::{gemini_client, llama_server, llm_client, prompt_builder};
// runtime
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
pub use runtime::apple_intelligence;
pub use runtime::{
    chunking, command_mode, context_detector, model_ids, parakeet_quality, parakeet_text,
    runtime_observability, session_glossary, session_keyterms, startup_warmup, telemetry,
    transcription_confidence, transcription_coordinator, vocabulary_store, voice_feedback,
    voice_profile, wake_word,
};
// platform
pub use platform::signal_handle;
pub use platform::{audio_feedback, clipboard, input, overlay, utils};

pub use cli::CliArgs;
#[cfg(debug_assertions)]
use specta_typescript::{BigIntExportBehavior, Typescript};
use tauri_specta::{collect_commands, Builder};

use env_filter::Builder as EnvFilterBuilder;
use managers::audio::AudioRecordingManager;
use managers::history::HistoryManager;
use managers::meetings::MeetingManager;
use managers::model::ModelManager;
use managers::notes::NoteManager;
use managers::transcription::TranscriptionManager;
use rand::{distributions::Alphanumeric, Rng};
#[cfg(unix)]
use signal_hook::consts::{SIGUSR1, SIGUSR2};
#[cfg(unix)]
use signal_hook::iterator::Signals;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tauri::image::Image;
pub use transcription_coordinator::TranscriptionCoordinator;

use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Listener, Manager};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_log::{Builder as LogBuilder, RotationStrategy, Target, TargetKind};

use crate::settings::{get_settings_fast, refresh_adaptive_profile_if_needed};

#[cfg(target_os = "windows")]
use std::ptr::NonNull;
#[cfg(target_os = "windows")]
use windows::core::BOOL;
#[cfg(target_os = "windows")]
use windows::Win32::Foundation::{HWND, LPARAM};
#[cfg(target_os = "windows")]
use windows::Win32::System::Threading::GetCurrentProcessId;
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{
    BringWindowToTop, EnumWindows, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
    IsWindowVisible, SetForegroundWindow, SetWindowPos, ShowWindow, SWP_NOZORDER, SW_RESTORE,
    SW_SHOW,
};

// Global atomic to store the file log level filter
// We use u8 to store the log::LevelFilter as a number
pub static FILE_LOG_LEVEL: AtomicU8 = AtomicU8::new(log::LevelFilter::Info as u8);

// Pending deep-link auth token: stored here when the deep link fires before
// the frontend is ready, then flushed once "desktop-ui-ready" is received.
static PENDING_DEEP_LINK_TOKEN: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

// Auth flow state: generated when the desktop app opens the browser for login.
// Deep-link callbacks are only accepted while the matching state is pending
// (within a 5-minute window), preventing rogue vocalype:// URL injection attacks.
struct PendingAuthFlow {
    started_at: std::time::Instant,
    state: String,
}

static PENDING_AUTH_FLOW: std::sync::Mutex<Option<PendingAuthFlow>> = std::sync::Mutex::new(None);

// Cached tray visibility flag to avoid store access in on_window_event (which can deadlock)
pub static TRAY_ICON_ENABLED: AtomicBool = AtomicBool::new(true);
pub static USER_REQUESTED_APP_EXIT: AtomicBool = AtomicBool::new(false);
pub static TRAY_ICON_READY: AtomicBool = AtomicBool::new(false);
pub static SHOULD_SHOW_MAIN_WINDOW_ON_READY: AtomicBool = AtomicBool::new(false);
static FRONTEND_UI_READY: AtomicBool = AtomicBool::new(false);
static BACKGROUND_LEAN_LAUNCH: AtomicBool = AtomicBool::new(false);

const MAIN_WINDOW_WIDTH: f64 = 1348.0;
const MAIN_WINDOW_HEIGHT: f64 = 875.0;
const MIN_MAIN_WINDOW_WIDTH: f64 = 760.0;
const MIN_MAIN_WINDOW_HEIGHT: f64 = 540.0;
const MAX_MAIN_WINDOW_SCALE: f64 = 1.0;
const LAUNCH_HIDDEN_WORKSPACES_ENABLED: bool = false;

fn create_browser_auth_state() -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(48)
        .map(char::from)
        .collect()
}

fn extract_auth_callback_payload(raw_url: &str) -> Option<(String, String)> {
    let parsed = url::Url::parse(raw_url).ok()?;
    if parsed.scheme() != "vocalype" || parsed.host_str() != Some("auth-callback") {
        return None;
    }

    let mut token = None;
    let mut state = None;
    for (key, value) in parsed.query_pairs() {
        match key.as_ref() {
            "token" if !value.is_empty() => token = Some(value.into_owned()),
            "state" if !value.is_empty() => state = Some(value.into_owned()),
            _ => {}
        }
    }

    Some((token?, state?))
}

fn consume_pending_auth_flow(returned_state: &str) -> bool {
    PENDING_AUTH_FLOW.lock().ok().map_or(false, |mut guard| {
        let Some(flow) = guard.take() else {
            log::warn!("[auth] deep-link callback received but no pending auth flow found");
            return false;
        };

        let elapsed = flow.started_at.elapsed();
        let window = std::time::Duration::from_secs(300);

        if elapsed >= window {
            log::warn!(
                "[auth] deep-link auth flow expired after {:.1}s (limit=300s) — possible replay or delayed callback",
                elapsed.as_secs_f32()
            );
            return false;
        }

        if flow.state != returned_state {
            log::warn!(
                "[auth] deep-link state mismatch — possible CSRF attempt (expected={}, got={})",
                flow.state,
                returned_state
            );
            return false;
        }

        true
    })
}

fn clamp_f64(value: f64, min: f64, max: f64) -> f64 {
    value.max(min).min(max)
}

fn resolve_main_window_size(app: &AppHandle) -> (f64, f64, f64, f64) {
    let fallback = (
        MAIN_WINDOW_WIDTH,
        MAIN_WINDOW_HEIGHT,
        MIN_MAIN_WINDOW_WIDTH,
        MIN_MAIN_WINDOW_HEIGHT,
    );
    let Some(main_window) = app.get_webview_window("main") else {
        return fallback;
    };

    let monitor = main_window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| app.primary_monitor().ok().flatten());

    let Some(monitor) = monitor else {
        return fallback;
    };

    let scale = monitor.scale_factor().max(1.0);
    let work_area = monitor.work_area();
    let work_area_width = work_area.size.width as f64 / scale;
    let work_area_height = work_area.size.height as f64 / scale;
    let design_scale =
        (work_area_width / MAIN_WINDOW_WIDTH).min(work_area_height / MAIN_WINDOW_HEIGHT);
    let snapped_scale = if (0.95..=1.08).contains(&design_scale) {
        1.0
    } else {
        design_scale
    };
    let min_width = MIN_MAIN_WINDOW_WIDTH.min(work_area_width).max(1.0);
    let min_height = MIN_MAIN_WINDOW_HEIGHT.min(work_area_height).max(1.0);
    let min_scale = (min_width / MAIN_WINDOW_WIDTH).min(min_height / MAIN_WINDOW_HEIGHT);
    let final_scale = clamp_f64(snapped_scale, min_scale, MAX_MAIN_WINDOW_SCALE);

    let width = clamp_f64(
        (MAIN_WINDOW_WIDTH * final_scale).round(),
        min_width,
        work_area_width,
    );
    let height = clamp_f64(
        (MAIN_WINDOW_HEIGHT * final_scale).round(),
        min_height,
        work_area_height,
    );

    (width, height, min_width, min_height)
}

fn level_filter_from_u8(value: u8) -> log::LevelFilter {
    match value {
        0 => log::LevelFilter::Off,
        1 => log::LevelFilter::Error,
        2 => log::LevelFilter::Warn,
        3 => log::LevelFilter::Info,
        4 => log::LevelFilter::Debug,
        5 => log::LevelFilter::Trace,
        _ => log::LevelFilter::Trace,
    }
}

fn build_console_filter() -> env_filter::Filter {
    let mut builder = EnvFilterBuilder::new();

    match std::env::var("RUST_LOG") {
        Ok(spec) if !spec.trim().is_empty() => {
            if let Err(err) = builder.try_parse(&spec) {
                log::warn!(
                    "Ignoring invalid RUST_LOG value '{}': {}. Falling back to info-level console logging",
                    spec,
                    err
                );
                builder.filter_level(log::LevelFilter::Info);
            }
        }
        _ => {
            builder.filter_level(log::LevelFilter::Info);
        }
    }

    builder.build()
}

pub(crate) fn show_main_window(app: &AppHandle) {
    schedule_microphone_standby(app, "show-main-window");
    let main_window = app.get_webview_window("main").or_else(|| {
        log::info!("Main window not found — recreating");
        SHOULD_SHOW_MAIN_WINDOW_ON_READY.store(true, Ordering::Relaxed);
        match create_main_window(app) {
            Ok(w) => Some(w),
            Err(e) => {
                log::error!("Failed to recreate main window: {}", e);
                None
            }
        }
    });

    let Some(main_window) = main_window else {
        return;
    };

    prepare_main_window_bounds(app, &main_window);
    if let Err(e) = main_window.show() {
        log::error!("Failed to show window: {}", e);
    }
    if let Err(e) = main_window.set_focus() {
        log::error!("Failed to focus window: {}", e);
    }
    #[cfg(target_os = "macos")]
    {
        if let Err(e) = app.set_activation_policy(tauri::ActivationPolicy::Regular) {
            log::error!("Failed to set activation policy to Regular: {}", e);
        }
    }
}

fn prepare_main_window_bounds(app: &AppHandle, main_window: &tauri::WebviewWindow) {
    let (width, height, min_width, min_height) = resolve_main_window_size(app);
    let _ = main_window.set_min_size(Some(tauri::Size::Logical(tauri::LogicalSize {
        width: min_width,
        height: min_height,
    })));
    let _ = main_window.set_size(tauri::Size::Logical(tauri::LogicalSize { width, height }));
    let _ = main_window.center();
}

fn prepare_main_window_before_show(app: &AppHandle) {
    if let Some(main_window) = app.get_webview_window("main") {
        prepare_main_window_bounds(app, &main_window);
    }
}

fn is_main_window_visible(app: &AppHandle) -> bool {
    let Some(main_window) = app.get_webview_window("main") else {
        return false;
    };

    main_window.is_visible().unwrap_or(false)
}

fn should_destroy_main_window_for_ram_recovery() -> bool {
    !cfg!(debug_assertions)
}

#[cfg(debug_assertions)]
fn should_open_main_window_devtools() -> bool {
    matches!(
        std::env::var("VOCALYPE_OPEN_DEVTOOLS").ok().as_deref(),
        Some("1" | "true" | "TRUE" | "yes" | "YES")
    )
}

fn schedule_microphone_standby(app: &AppHandle, reason: &'static str) {
    let app_handle = app.clone();
    thread::spawn(move || {
        let Some(audio_manager) = app_handle.try_state::<Arc<AudioRecordingManager>>() else {
            log::warn!(
                "[startup] microphone standby skipped ({}): audio manager unavailable",
                reason
            );
            return;
        };

        if audio_manager.is_microphone_stream_open() {
            log::info!(
                "[startup] microphone standby already active (reason={})",
                reason
            );
            return;
        }

        match audio_manager.start_microphone_stream() {
            Ok(()) => log::info!(
                "[startup] microphone standby ready for instant dictation (reason={})",
                reason
            ),
            Err(err) => log::warn!(
                "[startup] microphone standby failed (reason={}): {}",
                reason,
                err
            ),
        }
    });
}

fn schedule_hidden_main_window_cleanup(app: &AppHandle, delay: Duration) {
    let app_handle = app.clone();
    thread::spawn(move || {
        thread::sleep(delay);

        if !BACKGROUND_LEAN_LAUNCH.load(Ordering::Relaxed) {
            return;
        }

        let Some(main_window) = app_handle.get_webview_window("main") else {
            return;
        };

        let is_visible = main_window.is_visible().unwrap_or(true);
        if is_visible {
            return;
        }

        if !should_destroy_main_window_for_ram_recovery() {
            log::info!(
                "[startup] skipping hidden main window destroy during debug launch to avoid WebView devUrl reload issues"
            );
            return;
        }

        log::info!(
            "[startup] closing hidden main window after background bootstrap to free WebView RAM"
        );
        if let Err(err) = main_window.close() {
            log::warn!(
                "Failed to close hidden main window during background cleanup: {}",
                err
            );
        }
    });
}

fn schedule_background_model_unload_check(app: &AppHandle, delay: Duration, reason: &'static str) {
    let app_handle = app.clone();
    thread::spawn(move || {
        thread::sleep(delay);
        if let Some(transcription_manager) = app_handle.try_state::<Arc<TranscriptionManager>>() {
            log::info!("[startup] probing background model unload after {}", reason);
            transcription_manager.maybe_unload_immediately(reason);
        }
    });
}

fn schedule_input_runtime_init(app: &AppHandle, reason: &'static str) {
    let app_handle = app.clone();
    thread::spawn(move || {
        #[cfg(not(target_os = "macos"))]
        {
            if let Err(err) = commands::initialize_enigo(app_handle.clone()) {
                log::warn!(
                    "[startup] input runtime could not initialize Enigo yet (reason={}): {}",
                    reason,
                    err
                );
            }
        }

        if let Err(err) = commands::initialize_shortcuts(app_handle.clone()) {
            log::warn!(
                "[startup] input runtime could not initialize shortcuts yet (reason={}): {}",
                reason,
                err
            );
        } else {
            log::info!("[startup] input runtime ready (reason={})", reason);
        }
    });
}

fn create_main_window(app: &AppHandle) -> Result<tauri::WebviewWindow, tauri::Error> {
    tauri::WebviewWindowBuilder::new(
        app,
        "main",
        tauri::WebviewUrl::App("desktop/index.html".into()),
    )
    .title("Vocalype")
    .inner_size(MAIN_WINDOW_WIDTH, MAIN_WINDOW_HEIGHT)
    .min_inner_size(MIN_MAIN_WINDOW_WIDTH, MIN_MAIN_WINDOW_HEIGHT)
    .decorations(false)
    .resizable(true)
    .maximizable(true)
    .center()
    .visible(false)
    .build()
}

fn ensure_main_window(app: &AppHandle) -> Result<tauri::WebviewWindow, tauri::Error> {
    if let Some(window) = app.get_webview_window("main") {
        return Ok(window);
    }

    create_main_window(app)
}

#[cfg(target_os = "windows")]
fn force_show_native_main_window() -> bool {
    const MAX_WINDOW_TITLE_LEN: i32 = 512;

    struct NativeWindowShowState {
        expected_process_id: u32,
        shown: bool,
    }

    unsafe fn read_window_title(hwnd: HWND) -> Option<String> {
        let len = GetWindowTextLengthW(hwnd);
        if len <= 0 || len > MAX_WINDOW_TITLE_LEN {
            return None;
        }

        let mut buffer = vec![0u16; len as usize + 1];
        let copied = GetWindowTextW(hwnd, &mut buffer);
        if copied <= 0 || copied > len {
            return None;
        }

        Some(String::from_utf16_lossy(&buffer[..copied as usize]))
    }

    unsafe fn state_from_lparam(lparam: LPARAM) -> Option<NonNull<NativeWindowShowState>> {
        NonNull::new(lparam.0 as *mut NativeWindowShowState)
    }

    unsafe extern "system" fn enum_windows_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let Some(mut state_ptr) = state_from_lparam(lparam) else {
            return false.into();
        };
        let state = state_ptr.as_mut();

        let mut process_id = 0u32;
        let _ = GetWindowThreadProcessId(hwnd, Some(&mut process_id));
        if process_id != state.expected_process_id {
            return true.into();
        }

        let Some(title) = read_window_title(hwnd) else {
            return true.into();
        };

        if title != "Vocalype" {
            return true.into();
        }

        let _ = ShowWindow(hwnd, SW_RESTORE);
        let _ = ShowWindow(hwnd, SW_SHOW);
        let _ = SetWindowPos(
            hwnd,
            None,
            120,
            120,
            MIN_MAIN_WINDOW_WIDTH as i32,
            MIN_MAIN_WINDOW_HEIGHT as i32,
            SWP_NOZORDER,
        );
        let _ = BringWindowToTop(hwnd);
        let _ = SetForegroundWindow(hwnd);
        state.shown = IsWindowVisible(hwnd).as_bool();
        false.into()
    }

    let mut state = NativeWindowShowState {
        expected_process_id: unsafe { GetCurrentProcessId() },
        shown: false,
    };
    unsafe {
        let _ = EnumWindows(
            Some(enum_windows_proc),
            LPARAM((&mut state as *mut NativeWindowShowState) as isize),
        );
    }
    state.shown
}

#[cfg(target_os = "windows")]
fn main_window_needs_native_recovery(app: &AppHandle) -> bool {
    let Some(main_window) = app.get_webview_window("main") else {
        return false;
    };

    match main_window.is_visible() {
        Ok(is_visible) => !is_visible,
        Err(err) => {
            log::warn!(
                "Failed to read main window visibility on Windows: {}. Falling back to native recovery.",
                err
            );
            true
        }
    }
}

fn initialize_core_logic(app_handle: &AppHandle) -> Result<(), String> {
    TRAY_ICON_READY.store(false, Ordering::Relaxed);

    let t_total = std::time::Instant::now();
    log::info!("[startup] initialize_core_logic â€” start");

    // Input runtime bootstrapping is centralized at startup.
    // On macOS we still avoid eager Enigo init before permissions are granted,
    // but other platforms no longer wait for a frontend-side first-use path.

    // Initialize the managers
    let t = std::time::Instant::now();
    let recording_manager = Arc::new(
        AudioRecordingManager::new(app_handle)
            .map_err(|err| format!("Failed to initialize recording manager: {}", err))?,
    );
    log::info!(
        "[startup] AudioRecordingManager::new â€” {}ms",
        t.elapsed().as_millis()
    );

    let t = std::time::Instant::now();
    let model_manager = Arc::new(
        ModelManager::new(app_handle)
            .map_err(|err| format!("Failed to initialize model manager: {}", err))?,
    );
    log::info!(
        "[startup] ModelManager::new â€” {}ms",
        t.elapsed().as_millis()
    );

    let t = std::time::Instant::now();
    let transcription_manager = Arc::new(
        TranscriptionManager::new(app_handle, model_manager.clone())
            .map_err(|err| format!("Failed to initialize transcription manager: {}", err))?,
    );
    log::info!(
        "[startup] TranscriptionManager::new â€” {}ms",
        t.elapsed().as_millis()
    );

    let t = std::time::Instant::now();
    let history_manager = Arc::new(
        HistoryManager::new(app_handle)
            .map_err(|err| format!("Failed to initialize history manager: {}", err))?,
    );
    log::info!(
        "[startup] HistoryManager::new â€” {}ms",
        t.elapsed().as_millis()
    );

    let t = std::time::Instant::now();
    let dictionary_manager = dictionary::DictionaryManager::new(app_handle);
    log::info!(
        "[startup] DictionaryManager::new â€” {}ms",
        t.elapsed().as_millis()
    );

    let t = std::time::Instant::now();
    let correction_tracker = correction_tracker::CorrectionTracker::new(app_handle);
    log::info!(
        "[startup] CorrectionTracker::new â€” {}ms",
        t.elapsed().as_millis()
    );

    // Add managers to Tauri's managed state
    app_handle.manage(recording_manager.clone());
    app_handle.manage(model_manager.clone());
    app_handle.manage(transcription_manager.clone());
    app_handle.manage(history_manager.clone());
    app_handle.manage(dictionary_manager);
    app_handle.manage(correction_tracker);

    if LAUNCH_HIDDEN_WORKSPACES_ENABLED {
        let t = std::time::Instant::now();
        let note_manager = Arc::new(
            NoteManager::new(app_handle)
                .map_err(|err| format!("Failed to initialize note manager: {}", err))?,
        );
        log::info!("[startup] NoteManager::new {}ms", t.elapsed().as_millis());
        app_handle.manage(note_manager);

        let t = std::time::Instant::now();
        let meeting_manager = Arc::new(
            MeetingManager::new(app_handle)
                .map_err(|err| format!("Failed to initialize meeting manager: {}", err))?,
        );
        log::info!(
            "[startup] MeetingManager::new {}ms",
            t.elapsed().as_millis()
        );
        app_handle.manage(meeting_manager);
    } else {
        log::info!("[startup] launch-hidden workspace managers skipped");
    }

    log::info!(
        "[startup] skipping eager adaptive Whisper calibration; calibration remains on-demand"
    );

    // Note: Shortcuts are NOT initialized here.
    // Shortcut bootstrapping is now centralized too. The frontend can still call
    // the idempotent commands later, but startup no longer depends on that path.

    #[cfg(unix)]
    match Signals::new(&[SIGUSR1, SIGUSR2]) {
        Ok(signals) => {
            signal_handle::setup_signal_handler(app_handle.clone(), signals);
        }
        Err(err) => {
            log::error!("Failed to initialize Unix signal handlers: {}", err);
        }
    }

    // Apply macOS Accessory policy if starting hidden and tray is available.
    // If the tray icon is disabled, keep the dock icon so the user can reopen.
    #[cfg(target_os = "macos")]
    {
        let settings = settings::get_settings(app_handle);
        if settings.start_hidden && settings.show_tray_icon {
            let _ = app_handle.set_activation_policy(tauri::ActivationPolicy::Accessory);
        }
    }
    // Get the current theme to set the appropriate initial icon
    let initial_theme = tray::get_current_theme(app_handle);

    // Choose the appropriate initial icon based on theme
    let initial_icon_path = tray::get_icon_path(initial_theme, tray::TrayIconState::Idle);

    let tray_icon_result = app_handle
        .path()
        .resolve(initial_icon_path, tauri::path::BaseDirectory::Resource)
        .map_err(|err| {
            format!(
                "Failed to resolve tray icon '{}': {}",
                initial_icon_path, err
            )
        })
        .and_then(|path| {
            Image::from_path(path)
                .map_err(|err| format!("Failed to load tray icon '{}': {}", initial_icon_path, err))
        });

    match tray_icon_result {
        Ok(icon) => {
            let tray = TrayIconBuilder::new()
                .icon(icon)
                .show_menu_on_left_click(true)
                .icon_as_template(true)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "settings" => {
                        show_main_window(app);
                    }
                    "check_updates" => {
                        let settings = settings::get_settings(app);
                        if settings.update_checks_enabled {
                            show_main_window(app);
                            let _ = app.emit("check-for-updates", ());
                        }
                    }
                    "copy_last_transcript" => {
                        tray::copy_last_transcript(app);
                    }
                    "unload_model" => {
                        let transcription_manager = app.state::<Arc<TranscriptionManager>>();
                        if !transcription_manager.is_model_loaded() {
                            log::warn!("No model is currently loaded.");
                            return;
                        }
                        match transcription_manager.unload_model() {
                            Ok(()) => log::info!("Model unloaded via tray."),
                            Err(e) => log::error!("Failed to unload model via tray: {}", e),
                        }
                    }
                    "cancel" => {
                        use crate::utils::cancel_current_operation;

                        // Use centralized cancellation that handles all operations
                        cancel_current_operation(app);
                    }
                    "quit" => {
                        USER_REQUESTED_APP_EXIT.store(true, Ordering::Relaxed);
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app_handle)
                .map_err(|err| format!("Failed to build tray icon: {}", err))?;
            app_handle.manage(tray);
            TRAY_ICON_READY.store(true, Ordering::Relaxed);

            // Initialize tray menu with idle state
            utils::update_tray_menu(app_handle, &utils::TrayIconState::Idle, None);
        }
        Err(err) => {
            TRAY_ICON_READY.store(false, Ordering::Relaxed);
            log::error!("{}", err);
        }
    }

    // Apply show_tray_icon setting and cache it in the atomic flag
    let settings = settings::get_settings(app_handle);
    TRAY_ICON_ENABLED.store(settings.show_tray_icon, Ordering::Relaxed);
    if !settings.show_tray_icon {
        TRAY_ICON_READY.store(false, Ordering::Relaxed);
        tray::set_tray_visibility(app_handle, false);
    }

    // Refresh tray menu when model state changes
    let app_handle_for_listener = app_handle.clone();
    app_handle.listen("model-state-changed", move |_| {
        tray::update_tray_menu(&app_handle_for_listener, &tray::TrayIconState::Idle, None);
    });

    sync_autostart_state(app_handle);

    log::info!(
        "[startup] initialize_core_logic â€” TOTAL {}ms",
        t_total.elapsed().as_millis()
    );
    Ok(())
}

fn sync_autostart_state(app_handle: &AppHandle) {
    let autostart_manager = app_handle.autolaunch();

    #[cfg(debug_assertions)]
    {
        let mut settings = settings::get_settings(app_handle);

        if settings.autostart_enabled {
            log::warn!(
                "Autostart was enabled from a debug build. Disabling it to avoid launching a development executable at login."
            );
            settings.autostart_enabled = false;
            settings::write_settings(app_handle, settings);
        }

        let _ = autostart_manager.disable();

        return;
    }

    #[cfg(not(debug_assertions))]
    {
        let settings = settings::get_settings(app_handle);

        let result = if settings.autostart_enabled {
            autostart_manager.enable()
        } else {
            autostart_manager.disable()
        };

        if let Err(err) = result {
            let err_text = err.to_string();
            if !settings.autostart_enabled && err_text.contains("os error 2") {
                log::info!(
                    "Autostart entry already absent while syncing disabled state; skipping noisy warning."
                );
            } else {
                log::warn!("Failed to sync autostart setting: {}", err);
            }
        }
    }
}

#[cfg(debug_assertions)]
fn should_export_typescript_bindings() -> bool {
    !matches!(
        std::env::var("VOCALYPE_EXPORT_BINDINGS").as_deref(),
        Ok("0") | Ok("false") | Ok("FALSE") | Ok("no") | Ok("NO")
    )
}

#[tauri::command]
#[specta::specta]
fn trigger_update_check(app: AppHandle) -> Result<(), String> {
    let settings = settings::get_settings(&app);
    if !settings.update_checks_enabled {
        return Ok(());
    }
    app.emit("check-for-updates", ())
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run(cli_args: CliArgs) {
    // Parse console logging directives from RUST_LOG, falling back to info-level logging
    // when the variable is unset
    let console_filter = build_console_filter();

    let specta_builder = Builder::<tauri::Wry>::new().commands(collect_commands![
        shortcut::change_binding,
        shortcut::reset_binding,
        shortcut::change_ptt_setting,
        shortcut::change_audio_feedback_setting,
        shortcut::change_audio_feedback_volume_setting,
        shortcut::change_sound_theme_setting,
        shortcut::change_start_hidden_setting,
        shortcut::change_autostart_setting,
        shortcut::change_translate_to_english_setting,
        shortcut::change_selected_language_setting,
        shortcut::change_overlay_position_setting,
        shortcut::change_debug_mode_setting,
        shortcut::change_word_correction_threshold_setting,
        shortcut::change_adaptive_vocabulary_enabled_setting,
        shortcut::change_adaptive_voice_profile_enabled_setting,
        shortcut::change_paste_method_setting,
        shortcut::get_available_typing_tools,
        shortcut::change_typing_tool_setting,
        shortcut::change_external_script_path_setting,
        shortcut::change_clipboard_handling_setting,
        shortcut::change_auto_submit_setting,
        shortcut::change_auto_submit_key_setting,
        shortcut::change_post_process_enabled_setting,
        shortcut::change_experimental_enabled_setting,
        shortcut::change_post_process_base_url_setting,
        shortcut::change_post_process_api_key_setting,
        shortcut::change_post_process_model_setting,
        shortcut::set_post_process_provider,
        shortcut::fetch_post_process_models,
        shortcut::add_post_process_prompt,
        shortcut::update_post_process_prompt,
        shortcut::delete_post_process_prompt,
        shortcut::set_post_process_selected_prompt,
        shortcut::add_post_process_action,
        shortcut::update_post_process_action,
        shortcut::delete_post_process_action,
        shortcut::add_saved_processing_model,
        shortcut::delete_saved_processing_model,
        shortcut::update_custom_words,
        shortcut::suspend_binding,
        shortcut::resume_binding,
        shortcut::change_mute_while_recording_setting,
        shortcut::change_append_trailing_space_setting,
        shortcut::change_app_language_setting,
        shortcut::change_update_checks_setting,
        shortcut::change_keyboard_implementation_setting,
        shortcut::get_keyboard_implementation,
        shortcut::change_show_tray_icon_setting,
        shortcut::change_wake_word_enabled_setting,
        shortcut::native_shortcut_capture::start_native_shortcut_capture_recording,
        shortcut::native_shortcut_capture::stop_native_shortcut_capture_recording,
        trigger_update_check,
        commands::cancel_operation,
        commands::toggle_pause,
        commands::get_app_dir_path,
        commands::get_app_settings,
        commands::get_default_settings,
        commands::get_startup_warmup_status,
        commands::get_log_dir_path,
        commands::set_log_level,
        commands::open_recordings_folder,
        commands::open_log_dir,
        commands::open_app_data_dir,
        commands::export_settings,
        commands::import_settings,
        commands::get_machine_device_id,
        integrity::get_integrity_snapshot,
        license::get_license_runtime_state,
        commands::load_secure_auth_token,
        commands::store_secure_auth_token,
        commands::check_apple_intelligence_available,
        commands::initialize_enigo,
        commands::initialize_shortcuts,
        commands::get_runtime_diagnostics,
        commands::export_runtime_diagnostics,
        commands::submit_voice_feedback_command,
        commands::list_voice_feedback_command,
        commands::summarize_voice_feedback_command,
        commands::get_current_app_context,
        commands::get_adaptive_runtime_profile,
        commands::models::get_available_models,
        commands::models::get_model_info,
        commands::models::download_model,
        commands::models::delete_model,
        commands::models::cancel_download,
        commands::models::set_active_model,
        commands::models::get_current_model,
        commands::models::get_transcription_model_status,
        commands::models::is_model_loading,
        commands::models::has_any_models_available,
        commands::models::has_any_models_or_downloads,
        commands::audio::update_microphone_mode,
        commands::audio::get_microphone_mode,
        commands::audio::get_available_microphones,
        commands::audio::set_selected_microphone,
        commands::audio::get_selected_microphone,
        commands::audio::get_available_output_devices,
        commands::audio::set_selected_output_device,
        commands::audio::get_selected_output_device,
        commands::audio::play_test_sound,
        commands::audio::check_custom_sounds,
        commands::audio::set_clamshell_microphone,
        commands::audio::get_clamshell_microphone,
        commands::audio::is_recording,
        commands::transcription::set_model_unload_timeout,
        commands::transcription::get_model_load_status,
        commands::transcription::unload_model_manually,
        commands::transcription::trigger_transcription_binding,
        commands::history::get_history_entries,
        commands::history::get_history_entries_paginated,
        commands::history::toggle_history_entry_saved,
        commands::history::get_audio_file_path,
        commands::history::delete_history_entry,
        commands::history::update_history_limit,
        commands::history::update_recording_retention_period,
        commands::history::reprocess_history_entry,
        commands::history::apply_history_post_process_action,
        commands::history::clear_history_post_process_action,
        commands::history::get_history_stats,
        commands::history::export_history_entries,
        commands::history::transcribe_audio_file,
        commands::history::transcribe_audio_file_detailed,
        commands::history::update_history_entry_text,
        commands::history::clear_all_history,
        commands::notes::get_notes,
        commands::notes::create_note,
        commands::notes::duplicate_note,
        commands::notes::update_note,
        commands::notes::set_note_pinned,
        commands::notes::set_note_archived,
        commands::notes::set_note_category,
        commands::notes::delete_note,
        commands::notes::search_notes,
        commands::notes::export_note,
        commands::notes::summarize_note,
        commands::notes::extract_note_actions,
        commands::notes::generate_note_title,
        commands::notes::close_note,
        commands::notes::set_active_note,
        commands::meetings::get_meetings,
        commands::meetings::create_meeting,
        commands::meetings::duplicate_meeting,
        commands::meetings::update_meeting,
        commands::meetings::set_meeting_pinned,
        commands::meetings::set_meeting_archived,
        commands::meetings::set_meeting_category,
        commands::meetings::delete_meeting,
        commands::meetings::search_meetings,
        commands::meetings::export_meeting,
        commands::meetings::summarize_meeting,
        commands::meetings::extract_meeting_actions,
        commands::meetings::generate_meeting_title,
        commands::meetings::generate_meeting_chapter_titles,
        commands::meetings::detect_active_meeting_app,
        commands::meetings::close_meeting,
        commands::meetings::set_active_meeting,
        commands::dictionary::get_dictionary,
        commands::dictionary::add_dictionary_entry,
        commands::dictionary::remove_dictionary_entry,
        commands::dictionary::update_dictionary_entry,
        commands::dictionary::clear_dictionary,
        commands::dictionary::export_dictionary,
        commands::dictionary::import_dictionary,
        commands::corrections::analyze_correction,
        commands::corrections::record_correction,
        commands::corrections::get_learning_stats,
        commands::corrections::get_user_profile,
        commands::corrections::sync_dictionary_to_profile,
        commands::corrections::remove_profile_term,
        commands::report::get_weekly_report,
        commands::snippets::get_voice_snippets,
        commands::snippets::add_voice_snippet,
        commands::snippets::remove_voice_snippet,
        commands::snippets::update_voice_snippet,
        commands::app_context::get_recent_apps,
        commands::app_context::list_app_context_overrides,
        commands::app_context::set_app_context_override,
        commands::app_context::remove_app_context_override,
        commands::app_context::set_app_context_enabled,
        secret_store::get_secure_auth_token,
        secret_store::set_secure_auth_token,
        secret_store::clear_secure_auth_token,
        secret_store::get_secure_auth_session,
        secret_store::set_secure_auth_session,
        secret_store::clear_secure_auth_session,
        secret_store::get_secure_license_bundle,
        secret_store::set_secure_license_bundle,
        secret_store::clear_secure_license_bundle,
        helpers::clamshell::is_laptop,
        commands::start_browser_auth,
        commands::ollama::check_ollama_status,
        commands::ollama::start_ollama_serve,
        commands::ollama::pull_ollama_model,
        commands::ollama::warmup_ollama_model,
        commands::llama_server::setup_llama_server,
        commands::llama_server::check_llama_server_status,
        commands::llama_server::stop_llama_server,
    ]);

    #[cfg(debug_assertions)]
    if should_export_typescript_bindings() {
        specta_builder
            .export(
                Typescript::default().bigint(BigIntExportBehavior::Number),
                "../src/bindings.ts",
            )
            .unwrap_or_else(|err| eprintln!("Failed to export typescript bindings: {}", err));
    }

    let builder = tauri::Builder::default()
        .device_event_filter(tauri::DeviceEventFilter::Always)
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            LogBuilder::new()
                .level(log::LevelFilter::Trace) // Set to most verbose level globally
                .max_file_size(500_000)
                .rotation_strategy(RotationStrategy::KeepOne)
                .clear_targets()
                .targets([
                    // Console output respects RUST_LOG environment variable
                    Target::new(TargetKind::Stdout).filter({
                        let console_filter = console_filter.clone();
                        move |metadata| console_filter.enabled(metadata)
                    }),
                    // File logs respect the user's settings (stored in FILE_LOG_LEVEL atomic)
                    Target::new(TargetKind::LogDir {
                        file_name: Some("vocalype".into()),
                    })
                    .filter(|metadata| {
                        let file_level = FILE_LOG_LEVEL.load(Ordering::Relaxed);
                        metadata.level() <= level_filter_from_u8(file_level)
                    }),
                ])
                .build(),
        );

    #[cfg(target_os = "macos")]
    {
        builder = builder.plugin(tauri_nspanel::init());
    }

    let app = builder
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // Check if a deep link URL was passed (deep-link plugin forwards it here on Windows)
            if let Some(raw_url) = args.iter().find(|a| a.starts_with("vocalype://")) {
                if let Some((token, state)) = extract_auth_callback_payload(raw_url) {
                    if !consume_pending_auth_flow(&state) {
                        log::warn!("Deep link auth rejected: no active login flow or state mismatch (possible CSRF attempt)");
                        show_main_window(app);
                        return;
                    }
                    log::info!("Deep link auth via single-instance, forwarding token before showing app");
                    // Store as backup only if the frontend listener may not be ready yet.
                    if !FRONTEND_UI_READY.load(Ordering::Relaxed) {
                        if let Ok(mut guard) = PENDING_DEEP_LINK_TOKEN.lock() {
                            *guard = Some(token.clone());
                        }
                    }
                    if app.emit("deep-link-auth", token.clone()).is_err() {
                        if let Ok(mut guard) = PENDING_DEEP_LINK_TOKEN.lock() {
                            *guard = Some(token);
                        }
                    }
                    return;
                }
                show_main_window(app);
                return;
            }
            if args.iter().any(|a| a == "--toggle-transcription") {
                signal_handle::send_transcription_input(app, "transcribe", "CLI");
            } else if args.iter().any(|a| a == "--toggle-post-process") {
                signal_handle::send_transcription_input(app, "transcribe_with_post_process", "CLI");
            } else if args.iter().any(|a| a == "--cancel") {
                crate::utils::cancel_current_operation(app);
            } else {
                show_main_window(app);
            }
        }))
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_macos_permissions::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .on_page_load(|webview, payload| {
            if webview.label() != "main" {
                return;
            }

            log::info!(
                "Main webview page load {:?}: {}",
                payload.event(),
                payload.url()
            );

            if payload.event() == tauri::webview::PageLoadEvent::Finished {
                if SHOULD_SHOW_MAIN_WINDOW_ON_READY.load(Ordering::Relaxed) {
                    log::info!(
                        "Main webview finished loading before frontend-ready; preparing main window bounds"
                    );
                    prepare_main_window_before_show(&webview.app_handle());
                }

                #[cfg(debug_assertions)]
                {
                    if should_open_main_window_devtools() {
                        webview.open_devtools();
                        log::info!("Opened devtools for the main webview");
                    }
                }
            }
        })
        .manage(cli_args.clone())
        .setup(move |app| {
            log::info!("[startup] setup() â€” start");

            // Fast read â€” no WMI hardware detection, returns instantly.
            let t = std::time::Instant::now();
            let mut settings = get_settings_fast(&app.handle());
            log::info!("[startup] get_settings_fast â€” {}ms", t.elapsed().as_millis());

            // CLI --debug flag overrides debug_mode and log level (runtime-only, not persisted)
            if cli_args.debug {
                settings.debug_mode = true;
                settings.log_level = settings::LogLevel::Trace;
            }

            let tauri_log_level: tauri_plugin_log::LogLevel = settings.log_level.into();
            let file_log_level: log::Level = tauri_log_level.into();
            // Store the file log level in the atomic for the filter to use
            FILE_LOG_LEVEL.store(file_log_level.to_level_filter() as u8, Ordering::Relaxed);
            let app_handle = app.handle().clone();
            app.manage(TranscriptionCoordinator::new(app_handle.clone()));
            app.manage(chunking::ActiveChunkingHandle(std::sync::Mutex::new(None)));
            app.manage(chunking::ActiveWorkerCancelFlag(std::sync::Mutex::new(None)));
            app.manage(context_detector::ActiveAppContextState(std::sync::Mutex::new(
                context_detector::ActiveAppContextSnapshot::default(),
            )));
            app.manage(vocabulary_store::VocabularyStoreState(std::sync::Mutex::new(
                vocabulary_store::VocabularyStore::load(&app_handle),
            )));
            app.manage(session_glossary::SessionGlossaryState(std::sync::Mutex::new(
                session_glossary::SessionGlossary::new(),
            )));
            // Passive Session Glossary: watch clipboard every 2 s in code context.
            session_glossary::spawn_clipboard_watcher(app_handle.clone(), 2000);
            // Embedded llama-server process handle.
            app.manage(llama_server::LlamaServerState::new());
            app.manage(voice_profile::VoiceProfileState(std::sync::Mutex::new(
                voice_profile::VoiceProfile::load(&app_handle),
            )));
            app.manage(runtime::parakeet_quality::ParakeetDiagnosticsState::new());
            app.manage(runtime_observability::RuntimeObservabilityState::new());

            // Transcription telemetry â€” append-only JSONL log for diagnostics.
            {
                use std::sync::Arc;
                let tel = app_handle
                    .path()
                    .app_log_dir()
                    .ok()
                    .map(|d| {
                        telemetry::TranscriptionTelemetry::new(
                            &d.join("transcription_telemetry.jsonl"),
                        )
                    })
                    .unwrap_or_else(telemetry::TranscriptionTelemetry::disabled);
                if let Some(p) = &tel.log_path {
                    log::info!("[telemetry] logging to {}", p.display());
                }
                app.manage(Arc::new(tel));
            }

            // Must be managed before the "desktop-ui-ready" listener fires
            // (listener calls ensure_startup_warmup which accesses this state).
            app.manage(startup_warmup::StartupWarmupState::new(
                startup_warmup::initial_status(&app_handle),
            ));

            let app_handle_for_ready = app_handle.clone();
            app_handle.listen("desktop-ui-ready", move |_| {
                FRONTEND_UI_READY.store(true, Ordering::Relaxed);

                // Flush any deep-link token that arrived before the frontend was ready
                let pending_deep_link_token = PENDING_DEEP_LINK_TOKEN
                    .lock()
                    .ok()
                    .and_then(|mut guard| guard.take());

                if let Some(token) = pending_deep_link_token {
                    SHOULD_SHOW_MAIN_WINDOW_ON_READY.store(false, Ordering::Relaxed);
                    log::info!("Flushing pending deep-link auth token to frontend");
                    let _ = app_handle_for_ready.emit("deep-link-auth", token);
                } else if SHOULD_SHOW_MAIN_WINDOW_ON_READY.swap(false, Ordering::Relaxed) {
                    log::info!("Frontend reported ready; showing main window");
                    show_main_window(&app_handle_for_ready);
                }

                log::info!(
                    "[startup] skipping desktop-ui-ready warmup; speech engine remains on-demand"
                );

                // CrÃ©er les overlays aprÃ¨s que l'UI est visible â€” Ã©vite de bloquer le dÃ©marrage
                // (~150ms chacun). Idempotent : les fonctions vÃ©rifient si la fenÃªtre existe dÃ©jÃ .
                log::info!(
                    "[startup] recording overlay creation deferred until first overlay use"
                );
                let overlay_app_handle = app_handle_for_ready.clone();
                thread::spawn(move || {
                    thread::sleep(Duration::from_millis(250));
                    crate::overlay::create_recording_overlay(&overlay_app_handle);
                    log::info!(
                        "[startup] recording overlay pre-created after desktop-ui-ready"
                    );
                });

                if BACKGROUND_LEAN_LAUNCH.load(Ordering::Relaxed) {
                    schedule_hidden_main_window_cleanup(
                        &app_handle_for_ready,
                        Duration::from_secs(8),
                    );
                }
            });

            let app_handle_for_auth_ready = app_handle.clone();
            app_handle.listen("desktop-auth-ready", move |_| {
                log::info!("Frontend completed desktop auth; showing main window");
                show_main_window(&app_handle_for_auth_ready);
            });

            let t = std::time::Instant::now();
            initialize_core_logic(&app_handle)?;
            startup_warmup::refresh_startup_warmup_status(
                &app_handle,
                "core-logic-initialized",
            );
            log::info!("[startup] initialize_core_logic (outer) â€” {}ms", t.elapsed().as_millis());

            // DÃ©marrer le chargement modÃ¨le + micro dÃ¨s maintenant â€” en parallÃ¨le du chargement
            // de la webview (~3s en dev, ~500ms en prod). Quand desktop-ui-ready arrive, le modÃ¨le
            // est dÃ©jÃ  chargÃ© ou en cours de chargement â†’ l'app s'affiche prÃªte immÃ©diatement.
            // Pre-download LLM binary + model in background so it's ready when the user activates the feature.
            log::info!(
                "[startup] skipping eager llama prefetch; LLM assets remain on-demand"
            );

            // Register vocalype:// URL scheme (needed on Windows/Linux in dev)
            #[cfg(not(target_os = "macos"))]
            if let Err(e) = app.deep_link().register("vocalype") {
                log::warn!("Failed to register vocalype:// scheme: {}", e);
            }

            // Handle incoming deep links (e.g. vocalype://auth-callback?token=xxx)
            let handle_for_deeplink = app_handle.clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    if url.scheme() == "vocalype" {
                        let host = url.host_str().unwrap_or("");
                        if host == "auth-callback" {
                            let token_opt = url
                                .query_pairs()
                                .find(|(k, _)| k == "token")
                                .map(|(_, v)| v.into_owned());
                            let state_opt = url
                                .query_pairs()
                                .find(|(k, _)| k == "state")
                                .map(|(_, v)| v.into_owned());
                            if let (Some(token), Some(state)) = (token_opt, state_opt) {
                                if !consume_pending_auth_flow(&state) {
                                    log::warn!("Deep link auth rejected: no active login flow or state mismatch (possible CSRF attempt)");
                                    show_main_window(&handle_for_deeplink);
                                    break;
                                }
                                log::info!("Deep link auth received; forwarding token before showing app");
                                // Try to emit immediately (app already running case).
                                // If the frontend isn't ready yet, store for later flush.
                                if handle_for_deeplink.emit("deep-link-auth", token.clone()).is_err() {
                                    if let Ok(mut guard) = PENDING_DEEP_LINK_TOKEN.lock() {
                                        *guard = Some(token);
                                    }
                                } else if !FRONTEND_UI_READY.load(Ordering::Relaxed) {
                                    // emit succeeded but frontend might still miss it if
                                    // it hasn't set up its listener â€” store as backup too.
                                    if let Ok(mut guard) = PENDING_DEEP_LINK_TOKEN.lock() {
                                        *guard = Some(token);
                                    }
                                }
                                break;
                            }
                        }
                    }
                }
            });

            // Run WMI GPU/NPU hardware detection in background so it never
            // blocks startup. The result is persisted to the settings store
            // and will be available to the model preload thread (which waits 4s).
            {
                let app_handle_bg = app_handle.clone();
                thread::spawn(move || {
                    refresh_adaptive_profile_if_needed(&app_handle_bg);
                });
            }

            // Hide tray icon if --no-tray was passed
            if cli_args.no_tray {
                tray::set_tray_visibility(&app_handle, false);
            }

            // Show the main window only after the frontend confirms it has
            // painted. This avoids the black WebView flash that happens when
            // the native window is made visible too early.
            // In debug, prefer a visible window unless the CLI explicitly asked
            // for a hidden launch. This keeps `tauri dev` from becoming
            // inaccessible because of a persisted user preference.
            let should_hide = if cfg!(debug_assertions) {
                cli_args.start_hidden
            } else {
                settings.start_hidden || cli_args.start_hidden
            };

            if cfg!(debug_assertions) && settings.start_hidden && !cli_args.start_hidden {
                log::info!(
                    "Ignoring persisted start_hidden during debug launch so the main window stays accessible"
                );
            }

            // If start_hidden but tray is disabled or failed to initialize, we
            // must show the window anyway. Otherwise the app becomes inaccessible.
            let tray_available = settings.show_tray_icon
                && !cli_args.no_tray
                && TRAY_ICON_READY.load(Ordering::Relaxed);
            if !tray_available && (settings.start_hidden || cli_args.start_hidden) {
                log::warn!(
                    "Tray unavailable while launch requested hidden; forcing main window visible"
                );
            }
            let background_lean_launch = should_hide && tray_available;
            BACKGROUND_LEAN_LAUNCH.store(background_lean_launch, Ordering::Relaxed);
            if background_lean_launch {
                log::info!(
                    "[startup] hidden tray launch detected: keeping background mode lean"
                );
                schedule_microphone_standby(&app_handle, "background-lean-launch");
                schedule_input_runtime_init(&app_handle, "background-lean-launch");
                log::info!("[startup] background lean launch skipped early model pre-warm");
            } else {
                schedule_microphone_standby(&app_handle, "interactive-launch");
                schedule_input_runtime_init(&app_handle, "interactive-launch");
                log::info!(
                    "[startup] skipping early startup warmup; speech engine remains on-demand"
                );
            }
            if !should_hide || !tray_available {
                if let Err(err) = ensure_main_window(&app_handle) {
                    log::error!("Failed to create main window during startup: {}", err);
                }
                SHOULD_SHOW_MAIN_WINDOW_ON_READY.store(true, Ordering::Relaxed);
                prepare_main_window_before_show(&app_handle);

                #[cfg(target_os = "windows")]
                if main_window_needs_native_recovery(&app_handle) {
                    log::info!("Using native Windows window recovery fallback");
                    let _ = force_show_native_main_window();
                }

                let fallback_app_handle = app_handle.clone();
                thread::spawn(move || {
                    thread::sleep(Duration::from_secs(5));
                    if SHOULD_SHOW_MAIN_WINDOW_ON_READY.swap(false, Ordering::Relaxed) {
                        show_main_window(&fallback_app_handle);
                    }
                });

                let watchdog_app_handle = app_handle.clone();
                thread::spawn(move || {
                    thread::sleep(Duration::from_secs(10));
                    if !is_main_window_visible(&watchdog_app_handle) {
                        log::warn!(
                            "[startup] visible launch watchdog did not see a main window; forcing recovery show"
                        );
                        show_main_window(&watchdog_app_handle);
                    }
                });
            }

            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                if window.label() == "main" {
                    let tray_visible = TRAY_ICON_ENABLED.load(Ordering::Relaxed)
                        && !window.app_handle().state::<CliArgs>().no_tray;
                    log::info!(
                        "[window-close] main CloseRequested tray_visible={} destroy_for_ram_recovery={} background_lean_launch={}",
                        tray_visible,
                        should_destroy_main_window_for_ram_recovery(),
                        BACKGROUND_LEAN_LAUNCH.load(Ordering::Relaxed)
                    );
                    if tray_visible {
                        api.prevent_close();
                        let _ = window.hide();
                        schedule_background_model_unload_check(
                            &window.app_handle(),
                            Duration::from_millis(500),
                            "main window hidden to tray",
                        );
                        return;
                    }
                    // No tray: must keep the window so the user can reopen the app.
                    api.prevent_close();
                    let _ = window.hide();
                    schedule_background_model_unload_check(
                        &window.app_handle(),
                        Duration::from_millis(500),
                        "main window hidden without tray",
                    );
                } else {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
            tauri::WindowEvent::ThemeChanged(theme) => {
                log::info!("Theme changed to: {:?}", theme);
                // Update tray icon to match new theme, maintaining idle state
                utils::change_tray_icon(&window.app_handle(), utils::TrayIconState::Idle);
            }
            _ => {}
        })
        .invoke_handler(specta_builder.invoke_handler())
        .build(tauri::generate_context!());

    let app = match app {
        Ok(app) => app,
        Err(err) => {
            log::error!("Error while building Tauri application: {}", err);
            return;
        }
    };

    app.run(|app, event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen { .. } = &event {
            show_main_window(app);
        }

        // Keep the process alive when the main window is destroyed but the tray is active.
        if let tauri::RunEvent::ExitRequested { api, .. } = &event {
            if TRAY_ICON_ENABLED.load(Ordering::Relaxed)
                && !USER_REQUESTED_APP_EXIT.load(Ordering::Relaxed)
            {
                api.prevent_exit();
            }
        }

        // Kill embedded llama-server on exit.
        if let tauri::RunEvent::Exit = &event {
            if let Some(state) = app.try_state::<llama_server::LlamaServerState>() {
                state.shutdown();
            }
        }

        let _ = (app, event); // suppress unused warnings on non-macOS
    });
}
