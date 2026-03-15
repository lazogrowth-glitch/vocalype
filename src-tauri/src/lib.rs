mod actions;
mod adaptive_runtime;
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
mod apple_intelligence;
mod audio_feedback;
pub mod audio_toolkit;
pub mod cli;
mod clipboard;
mod commands;
mod context_detector;
pub mod gemini_client;
mod helpers;
mod input;
mod llm_client;
mod managers;
mod overlay;
mod prompt_builder;
mod runtime_observability;
mod settings;
mod shortcut;
mod signal_handle;
mod transcription_coordinator;
mod tray;
mod tray_i18n;
mod utils;
mod vocabulary_store;
mod voice_profile;

pub use cli::CliArgs;
#[cfg(debug_assertions)]
use specta_typescript::{BigIntExportBehavior, Typescript};
use tauri_specta::{collect_commands, Builder};

use env_filter::Builder as EnvFilterBuilder;
use managers::audio::AudioRecordingManager;
use managers::history::HistoryManager;
use managers::model::ModelManager;
use managers::transcription::TranscriptionManager;
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
use tauri_plugin_log::{Builder as LogBuilder, RotationStrategy, Target, TargetKind};

use crate::settings::get_settings;
use adaptive_runtime::maybe_schedule_whisper_calibration;

// Global atomic to store the file log level filter
// We use u8 to store the log::LevelFilter as a number
pub static FILE_LOG_LEVEL: AtomicU8 = AtomicU8::new(log::LevelFilter::Debug as u8);

// Cached tray visibility flag to avoid store access in on_window_event (which can deadlock)
pub static TRAY_ICON_ENABLED: AtomicBool = AtomicBool::new(true);

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
    if let Some(main_window) = app.get_webview_window("main") {
        // First, ensure the window is visible
        if let Err(e) = main_window.show() {
            log::error!("Failed to show window: {}", e);
        }
        // Then, bring it to the front and give it focus
        if let Err(e) = main_window.set_focus() {
            log::error!("Failed to focus window: {}", e);
        }
        // Optional: On macOS, ensure the app becomes active if it was an accessory
        #[cfg(target_os = "macos")]
        {
            if let Err(e) = app.set_activation_policy(tauri::ActivationPolicy::Regular) {
                log::error!("Failed to set activation policy to Regular: {}", e);
            }
        }
    } else {
        log::error!("Main window not found.");
    }
}

fn initialize_core_logic(app_handle: &AppHandle) -> Result<(), String> {
    // Note: Enigo (keyboard/mouse simulation) is NOT initialized here.
    // The frontend is responsible for calling the `initialize_enigo` command
    // after onboarding completes. This avoids triggering permission dialogs
    // on macOS before the user is ready.

    // Initialize the managers
    let recording_manager = Arc::new(
        AudioRecordingManager::new(app_handle)
            .map_err(|err| format!("Failed to initialize recording manager: {}", err))?,
    );
    let model_manager = Arc::new(
        ModelManager::new(app_handle)
            .map_err(|err| format!("Failed to initialize model manager: {}", err))?,
    );
    let transcription_manager = Arc::new(
        TranscriptionManager::new(app_handle, model_manager.clone())
            .map_err(|err| format!("Failed to initialize transcription manager: {}", err))?,
    );
    let history_manager = Arc::new(
        HistoryManager::new(app_handle)
            .map_err(|err| format!("Failed to initialize history manager: {}", err))?,
    );

    // Add managers to Tauri's managed state
    app_handle.manage(recording_manager.clone());
    app_handle.manage(model_manager.clone());
    app_handle.manage(transcription_manager.clone());
    app_handle.manage(history_manager.clone());

    {
        let app_handle = app_handle.clone();
        let model_manager = model_manager.clone();
        let transcription_manager = transcription_manager.clone();
        thread::spawn(move || {
            thread::sleep(Duration::from_secs(2));

            let settings = settings::get_settings(&app_handle);
            if settings.selected_model.is_empty()
                || settings.model_unload_timeout == settings::ModelUnloadTimeout::Immediately
            {
                return;
            }

            let is_downloaded = model_manager
                .get_model_info(&settings.selected_model)
                .map(|model| model.is_downloaded)
                .unwrap_or(false);

            if is_downloaded {
                log::info!("Preloading selected model {}", settings.selected_model);
                transcription_manager.initiate_model_load();
            }
        });
    }

    {
        let app_handle = app_handle.clone();
        let model_manager = model_manager.clone();
        thread::spawn(move || {
            thread::sleep(Duration::from_secs(3));
            maybe_schedule_whisper_calibration(&app_handle, model_manager, "small");
        });
    }

    {
        let app_handle = app_handle.clone();
        let model_manager = model_manager.clone();
        thread::spawn(move || {
            thread::sleep(Duration::from_secs(5));
            maybe_schedule_whisper_calibration(&app_handle, model_manager.clone(), "turbo");
            maybe_schedule_whisper_calibration(&app_handle, model_manager, "large");
        });
    }

    // Note: Shortcuts are NOT initialized here.
    // The frontend is responsible for calling the `initialize_shortcuts` command
    // after permissions are confirmed (on macOS) or after onboarding completes.
    // This matches the pattern used for Enigo initialization.

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
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app_handle)
                .map_err(|err| format!("Failed to build tray icon: {}", err))?;
            app_handle.manage(tray);

            // Initialize tray menu with idle state
            utils::update_tray_menu(app_handle, &utils::TrayIconState::Idle, None);
        }
        Err(err) => {
            log::error!("{}", err);
        }
    }

    // Apply show_tray_icon setting and cache it in the atomic flag
    let settings = settings::get_settings(app_handle);
    TRAY_ICON_ENABLED.store(settings.show_tray_icon, Ordering::Relaxed);
    if !settings.show_tray_icon {
        tray::set_tray_visibility(app_handle, false);
    }

    // Refresh tray menu when model state changes
    let app_handle_for_listener = app_handle.clone();
    app_handle.listen("model-state-changed", move |_| {
        tray::update_tray_menu(&app_handle_for_listener, &tray::TrayIconState::Idle, None);
    });

    sync_autostart_state(app_handle);

    // Create the recording overlay window (hidden by default)
    utils::create_recording_overlay(app_handle);

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

        if let Err(err) = autostart_manager.disable() {
            log::warn!("Failed to disable autostart for debug build: {}", err);
        }

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
            log::warn!("Failed to sync autostart setting: {}", err);
        }
    }
}

#[cfg(debug_assertions)]
fn should_export_typescript_bindings() -> bool {
    matches!(
        std::env::var("VOCALTYPE_EXPORT_BINDINGS").as_deref(),
        Ok("1") | Ok("true") | Ok("TRUE") | Ok("yes") | Ok("YES")
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
        shortcut::change_long_audio_model_setting,
        shortcut::change_long_audio_threshold_setting,
        shortcut::handy_keys::start_handy_keys_recording,
        shortcut::handy_keys::stop_handy_keys_recording,
        trigger_update_check,
        commands::cancel_operation,
        commands::toggle_pause,
        commands::get_app_dir_path,
        commands::get_app_settings,
        commands::get_default_settings,
        commands::get_log_dir_path,
        commands::set_log_level,
        commands::open_recordings_folder,
        commands::open_log_dir,
        commands::open_app_data_dir,
        commands::export_settings,
        commands::import_settings,
        commands::check_apple_intelligence_available,
        commands::initialize_enigo,
        commands::initialize_shortcuts,
        commands::get_runtime_diagnostics,
        commands::export_runtime_diagnostics,
        commands::get_current_app_context,
        commands::get_adaptive_runtime_profile,
        commands::get_adaptive_calibration_state,
        commands::recalibrate_whisper_model_command,
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
        commands::history::get_history_entries,
        commands::history::toggle_history_entry_saved,
        commands::history::get_audio_file_path,
        commands::history::delete_history_entry,
        commands::history::update_history_limit,
        commands::history::update_recording_retention_period,
        commands::history::reprocess_history_entry,
        commands::gemini::change_gemini_api_key_setting,
        commands::gemini::change_gemini_model_setting,
        helpers::clamshell::is_laptop,
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
                        file_name: Some("vocaltype".into()),
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
        .manage(cli_args.clone())
        .setup(move |app| {
            let mut settings = get_settings(&app.handle());

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
            app.manage(actions::ActiveActionState(std::sync::Mutex::new(None)));
            app.manage(actions::ActiveChunkingHandle(std::sync::Mutex::new(None)));
            app.manage(context_detector::ActiveAppContextState(std::sync::Mutex::new(
                context_detector::ActiveAppContextSnapshot::default(),
            )));
            app.manage(vocabulary_store::VocabularyStoreState(std::sync::Mutex::new(
                vocabulary_store::VocabularyStore::load(&app_handle),
            )));
            app.manage(voice_profile::VoiceProfileState(std::sync::Mutex::new(
                voice_profile::VoiceProfile::load(&app_handle),
            )));
            app.manage(runtime_observability::RuntimeObservabilityState::new());

            initialize_core_logic(&app_handle)?;

            // Hide tray icon if --no-tray was passed
            if cli_args.no_tray {
                tray::set_tray_visibility(&app_handle, false);
            }

            // Show main window only if not starting hidden
            // CLI --start-hidden flag overrides the setting
            let should_hide = settings.start_hidden || cli_args.start_hidden;

            // If start_hidden but tray is disabled, we must show the window
            // anyway. Without a tray icon, the dock is the only way back in.
            let tray_available = settings.show_tray_icon && !cli_args.no_tray;
            if !should_hide || !tray_available {
                if let Some(main_window) = app_handle.get_webview_window("main") {
                    if let Err(err) = main_window.show() {
                        log::error!("Failed to show main window during setup: {}", err);
                    }
                    if let Err(err) = main_window.set_focus() {
                        log::error!("Failed to focus main window during setup: {}", err);
                    }
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _res = window.hide();

                #[cfg(target_os = "macos")]
                {
                    let tray_visible = TRAY_ICON_ENABLED.load(Ordering::Relaxed)
                        && !window.app_handle().state::<CliArgs>().no_tray;
                    if tray_visible {
                        // Tray is available: hide the dock icon, app lives in the tray
                        let res = window
                            .app_handle()
                            .set_activation_policy(tauri::ActivationPolicy::Accessory);
                        if let Err(e) = res {
                            log::error!("Failed to set activation policy: {}", e);
                        }
                    }
                    // No tray: keep the dock icon visible so the user can reopen
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
        let _ = (app, event); // suppress unused warnings on non-macOS
    });
}
