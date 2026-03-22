use crate::audio_toolkit::{
    list_input_devices, vad::SmoothedVad, AudioRecorder, AudioRecorderRuntimeError, SileroVad,
};
use crate::helpers::clamshell;
use crate::model_ids::is_parakeet_v3_model_id;
use crate::runtime_observability::{emit_runtime_error_with_context, RuntimeErrorStage};
use crate::settings::{get_settings, AppSettings};
use crate::utils;
use crate::voice_profile::current_runtime_adjustment;
use cpal::traits::HostTrait;
use log::{debug, error, info};
use parking_lot::{Mutex, RwLock};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tauri::Manager;

const WHISPER_MODEL_IDS: &[&str] = &["small", "medium", "turbo", "large"];

fn set_mute(mute: bool) {
    // Expected behavior:
    // - Windows: works on most systems using standard audio drivers.
    // - Linux: works on many systems (PipeWire, PulseAudio, ALSA),
    //   but some distros may lack the tools used.
    // - macOS: works on most standard setups via AppleScript.
    // If unsupported, fails silently.

    #[cfg(target_os = "windows")]
    {
        unsafe {
            use windows::Win32::{
                Media::Audio::{
                    eMultimedia, eRender, Endpoints::IAudioEndpointVolume, IMMDeviceEnumerator,
                    MMDeviceEnumerator,
                },
                System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED},
            };

            macro_rules! unwrap_or_return {
                ($expr:expr) => {
                    match $expr {
                        Ok(val) => val,
                        Err(_) => return,
                    }
                };
            }

            // Initialize the COM library for this thread.
            // If already initialized (e.g., by another library like Tauri), this does nothing.
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

            let all_devices: IMMDeviceEnumerator =
                unwrap_or_return!(CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL));
            let default_device =
                unwrap_or_return!(all_devices.GetDefaultAudioEndpoint(eRender, eMultimedia));
            let volume_interface = unwrap_or_return!(
                default_device.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None)
            );

            let _ = volume_interface.SetMute(mute, std::ptr::null());
        }
    }

    #[cfg(target_os = "linux")]
    {
        use std::process::Command;

        let mute_val = if mute { "1" } else { "0" };
        let amixer_state = if mute { "mute" } else { "unmute" };

        // Try multiple backends to increase compatibility
        // 1. PipeWire (wpctl)
        if Command::new("wpctl")
            .args(["set-mute", "@DEFAULT_AUDIO_SINK@", mute_val])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
        {
            return;
        }

        // 2. PulseAudio (pactl)
        if Command::new("pactl")
            .args(["set-sink-mute", "@DEFAULT_SINK@", mute_val])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
        {
            return;
        }

        // 3. ALSA (amixer)
        let _ = Command::new("amixer")
            .args(["set", "Master", amixer_state])
            .output();
    }

    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        let script = format!(
            "set volume output muted {}",
            if mute { "true" } else { "false" }
        );
        let _ = Command::new("osascript").args(["-e", &script]).output();
    }
}

/// Checks if the system is already muted by the user before we apply our own mute.
/// Returns true if the system output is muted or volume is 0.
#[cfg(target_os = "macos")]
fn is_system_already_muted() -> bool {
    use std::process::Command;

    let result = Command::new("osascript")
        .arg("-e")
        .arg("set v to (get volume settings)\nreturn (output muted of v) as text & \",\" & (output volume of v) as text")
        .output();

    match result {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let parts: Vec<&str> = stdout.trim().split(',').collect();
            if parts.len() == 2 {
                let muted = parts[0].trim() == "true";
                let volume_zero = parts[1].trim().parse::<i32>().unwrap_or(100) == 0;
                return muted || volume_zero;
            }
            false
        }
        Err(_) => false,
    }
}

#[cfg(target_os = "windows")]
fn is_system_already_muted() -> bool {
    unsafe {
        use windows::Win32::{
            Media::Audio::{
                eMultimedia, eRender, Endpoints::IAudioEndpointVolume, IMMDeviceEnumerator,
                MMDeviceEnumerator,
            },
            System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED},
        };

        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let enumerator: IMMDeviceEnumerator =
            match CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) {
                Ok(e) => e,
                Err(_) => return false,
            };
        let device = match enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia) {
            Ok(d) => d,
            Err(_) => return false,
        };
        let volume: IAudioEndpointVolume =
            match device.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None) {
                Ok(v) => v,
                Err(_) => return false,
            };

        volume.GetMute().unwrap_or(false.into()).as_bool()
    }
}

#[cfg(target_os = "linux")]
fn is_system_already_muted() -> bool {
    false
}

const WHISPER_SAMPLE_RATE: usize = 16000;

/// Linear gain applied to every audio sample when whisper mode is active.
/// ×4.0 ≈ +12 dB — enough to bring a whispered voice to near-normal levels
/// while still leaving headroom before the [-1, 1] clamp fires.
const WHISPER_MODE_GAIN: f32 = 4.0;

/* ──────────────────────────────────────────────────────────────── */

#[derive(Clone, Debug)]
pub enum RecordingState {
    Idle,
    Recording { binding_id: String },
}

#[derive(Clone, Debug)]
pub enum MicrophoneMode {
    AlwaysOn,
    OnDemand,
}

/* ──────────────────────────────────────────────────────────────── */

fn create_audio_recorder(
    vad_path: &str,
    app_handle: &tauri::AppHandle,
    is_paused: Arc<AtomicBool>,
    selected_model_id: &str,
    gain: f32,
    last_error: Arc<Mutex<Option<String>>>,
) -> Result<AudioRecorder, anyhow::Error> {
    let is_parakeet_v3 = is_parakeet_v3_model_id(selected_model_id);
    let (vad_threshold, prefill_frames, mut hangover_frames, onset_frames) = if is_parakeet_v3 {
        // Parakeet V3 is sensitive to clipped speech on short dictation.
        // Use a less aggressive profile to reduce dropped words.
        (0.24, 20, 20, 1)
    } else {
        (0.30, 15, 15, 2)
    };

    if !is_parakeet_v3 && WHISPER_MODEL_IDS.contains(&selected_model_id) {
        if let Some(adjustment) = current_runtime_adjustment(app_handle, selected_model_id, 10, 500)
        {
            hangover_frames = ((hangover_frames as i16)
                + i16::from(adjustment.vad_hangover_frames_delta))
            .clamp(8, 28) as usize;
            debug!(
                "Voice profile adjusted VAD hangover for model {} to {} frames ({:?})",
                selected_model_id, hangover_frames, adjustment.reason
            );
        }
    }

    let silero = SileroVad::new(vad_path, vad_threshold)
        .map_err(|e| anyhow::anyhow!("Failed to create SileroVad: {}", e))?;
    let smoothed_vad = SmoothedVad::new(
        Box::new(silero),
        prefill_frames,
        hangover_frames,
        onset_frames,
    );

    // Recorder with VAD plus a spectrum-level callback that forwards updates to
    // the frontend.
    let recorder = AudioRecorder::new()
        .map_err(|e| anyhow::anyhow!("Failed to create AudioRecorder: {}", e))?
        .with_vad(Box::new(smoothed_vad))
        .with_gain(gain)
        .with_pause_flag(is_paused.clone())
        .with_level_callback({
            let app_handle = app_handle.clone();
            let is_paused = is_paused.clone();
            move |levels| {
                if is_paused.load(Ordering::Relaxed) {
                    let zero_levels = vec![0.0f32; levels.len()];
                    utils::emit_levels(&app_handle, &zero_levels);
                } else {
                    utils::emit_levels(&app_handle, &levels);
                }
            }
        })
        .with_error_callback({
            let app_handle = app_handle.clone();
            let last_error = Arc::clone(&last_error);
            move |runtime_error| {
                let (code, stage, message): (&str, RuntimeErrorStage, String) = match runtime_error
                {
                    AudioRecorderRuntimeError::StreamLost(message) => {
                        ("AUDIO_STREAM_LOST", RuntimeErrorStage::Capture, message)
                    }
                    AudioRecorderRuntimeError::VadFailed(message) => {
                        ("VAD_FAILED", RuntimeErrorStage::Vad, message)
                    }
                };
                *last_error.lock() = Some(message.clone());
                let operation_id = app_handle
                    .try_state::<crate::TranscriptionCoordinator>()
                    .and_then(|coordinator| coordinator.active_operation_id());
                let model_id = app_handle
                    .try_state::<Arc<crate::managers::transcription::TranscriptionManager>>()
                    .and_then(|manager| manager.get_current_model());
                let device_name = get_settings(&app_handle).selected_microphone.clone();
                emit_runtime_error_with_context(
                    &app_handle,
                    code,
                    stage,
                    message,
                    true,
                    operation_id,
                    device_name,
                    model_id,
                );
            }
        });

    Ok(recorder)
}

/* ──────────────────────────────────────────────────────────────── */

#[derive(Clone)]
pub struct AudioRecordingManager {
    state: Arc<RwLock<RecordingState>>,
    mode: Arc<RwLock<MicrophoneMode>>,
    app_handle: tauri::AppHandle,

    recorder: Arc<Mutex<Option<AudioRecorder>>>,
    is_open: Arc<Mutex<bool>>,
    is_recording: Arc<Mutex<bool>>,
    is_paused: Arc<AtomicBool>,
    did_mute: Arc<Mutex<bool>>,
    /// When true the recorder is opened with `WHISPER_MODE_GAIN` instead of 1.0.
    whisper_mode: Arc<AtomicBool>,
    last_error: Arc<Mutex<Option<String>>>,
    last_device_resolution: Arc<Mutex<Option<String>>>,
}

impl AudioRecordingManager {
    /* ---------- construction ------------------------------------------------ */

    pub fn new(app: &tauri::AppHandle) -> Result<Self, anyhow::Error> {
        let settings = get_settings(app);
        let mode = if settings.always_on_microphone {
            MicrophoneMode::AlwaysOn
        } else {
            MicrophoneMode::OnDemand
        };

        let manager = Self {
            state: Arc::new(RwLock::new(RecordingState::Idle)),
            mode: Arc::new(RwLock::new(mode.clone())),
            app_handle: app.clone(),

            recorder: Arc::new(Mutex::new(None)),
            is_open: Arc::new(Mutex::new(false)),
            is_recording: Arc::new(Mutex::new(false)),
            is_paused: Arc::new(AtomicBool::new(false)),
            did_mute: Arc::new(Mutex::new(false)),
            whisper_mode: Arc::new(AtomicBool::new(settings.whisper_mode)),
            last_error: Arc::new(Mutex::new(None)),
            last_device_resolution: Arc::new(Mutex::new(None)),
        };

        Ok(manager)
    }

    /* ---------- helper methods --------------------------------------------- */

    fn set_last_error(&self, error: Option<String>) {
        *self.last_error.lock() = error;
    }

    fn set_last_device_resolution(&self, resolution: Option<String>) {
        *self.last_device_resolution.lock() = resolution;
    }

    fn get_effective_microphone_device(
        &self,
        settings: &AppSettings,
    ) -> Result<Option<cpal::Device>, anyhow::Error> {
        // Check if we're in clamshell mode and have a clamshell microphone configured
        let use_clamshell_mic = if let Ok(is_clamshell) = clamshell::is_clamshell() {
            is_clamshell && settings.clamshell_microphone.is_some()
        } else {
            false
        };

        let (device_name, device_index) = if use_clamshell_mic {
            (
                settings.clamshell_microphone.as_ref(),
                settings.clamshell_microphone_index.as_ref(),
            )
        } else {
            (
                settings.selected_microphone.as_ref(),
                settings.selected_microphone_index.as_ref(),
            )
        };

        if device_name.is_none() && device_index.is_none() {
            self.set_last_device_resolution(Some("default-device".to_string()));
            return Ok(None);
        }

        let devices = list_input_devices()
            .map_err(|e| anyhow::anyhow!("Failed to list audio input devices: {}", e))?;
        if let Some(device_index) = device_index {
            if let Some(device) = devices.iter().find(|d| &d.index == device_index) {
                if let Some(device_name) = device_name {
                    if &device.name != device_name {
                        return Err(anyhow::anyhow!(
                            "Selected microphone '{}' moved or changed; expected '{}' at index '{}'",
                            device.name,
                            device_name,
                            device_index
                        ));
                    }
                }
                self.set_last_device_resolution(Some(format!("index:{}", device_index)));
                return Ok(Some(device.device.clone()));
            }
            if let Some(device_name) = device_name {
                let matching_by_name: Vec<_> =
                    devices.iter().filter(|d| &d.name == device_name).collect();
                return match matching_by_name.len() {
                    1 => {
                        self.set_last_device_resolution(Some(format!(
                            "name-fallback:{}",
                            device_name
                        )));
                        Ok(Some(matching_by_name[0].device.clone()))
                    }
                    0 => Err(anyhow::anyhow!(
                        "Selected microphone '{}' is no longer available",
                        device_name
                    )),
                    count => Err(anyhow::anyhow!(
                        "Selected microphone '{}' is ambiguous ({} matching devices)",
                        device_name,
                        count
                    )),
                };
            }
            return Err(anyhow::anyhow!(
                "Selected microphone index '{}' is no longer available",
                device_index
            ));
        }

        let Some(device_name) = device_name else {
            self.set_last_device_resolution(Some("default-device".to_string()));
            return Ok(None);
        };

        let matching: Vec<_> = devices
            .into_iter()
            .filter(|d| d.name == *device_name)
            .collect();

        match matching.len() {
            0 => Err(anyhow::anyhow!(
                "Selected microphone '{}' is no longer available",
                device_name
            )),
            1 => {
                self.set_last_device_resolution(Some(format!("name:{}", device_name)));
                Ok(matching.into_iter().next().map(|device| device.device))
            }
            count => Err(anyhow::anyhow!(
                "Selected microphone '{}' is ambiguous ({} matching devices)",
                device_name,
                count
            )),
        }
    }

    /* ---------- microphone life-cycle -------------------------------------- */

    /// Applies mute if mute_while_recording is enabled and stream is open.
    /// Skips muting (and later unmuting) if the system was already muted by the user.
    pub fn apply_mute(&self) {
        let settings = get_settings(&self.app_handle);
        let mut did_mute_guard = self.did_mute.lock();

        if settings.mute_while_recording && *self.is_open.lock() {
            if is_system_already_muted() {
                debug!("System already muted by user, skipping app mute");
                return;
            }
            set_mute(true);
            *did_mute_guard = true;
            debug!("Mute applied");
        }
    }

    /// Removes mute if it was applied
    pub fn remove_mute(&self) {
        let mut did_mute_guard = self.did_mute.lock();
        if *did_mute_guard {
            set_mute(false);
            *did_mute_guard = false;
            debug!("Mute removed");
        }
    }

    pub fn start_microphone_stream(&self) -> Result<(), anyhow::Error> {
        self.set_last_error(None);
        let mut open_flag = self.is_open.lock();
        if *open_flag {
            debug!("Microphone stream already active");
            return Ok(());
        }

        let start_time = Instant::now();

        // Don't mute immediately - caller will handle muting after audio feedback
        let mut did_mute_guard = self.did_mute.lock();
        *did_mute_guard = false;

        let vad_path = self
            .app_handle
            .path()
            .resolve(
                "resources/models/silero_vad_v4.onnx",
                tauri::path::BaseDirectory::Resource,
            )
            .map_err(|e| anyhow::anyhow!("Failed to resolve VAD path: {}", e))?;
        let settings = get_settings(&self.app_handle);
        let mut recorder_opt = self.recorder.lock();

        // Recreate the recorder every time we (re)open the stream so model-dependent
        // VAD tuning follows the currently selected model.
        let gain = if self.whisper_mode.load(Ordering::Relaxed) {
            WHISPER_MODE_GAIN
        } else {
            1.0
        };
        *recorder_opt = Some(create_audio_recorder(
            vad_path
                .to_str()
                .ok_or_else(|| anyhow::anyhow!("VAD model path contains non-UTF8 characters"))?,
            &self.app_handle,
            Arc::clone(&self.is_paused),
            &settings.selected_model,
            gain,
            Arc::clone(&self.last_error),
        )?);

        // Get the selected device from settings, considering clamshell mode
        let selected_device = self.get_effective_microphone_device(&settings)?;

        if let Some(rec) = recorder_opt.as_mut() {
            rec.open(selected_device).map_err(|e| {
                let message = format!("Failed to open recorder: {}", e);
                self.set_last_error(Some(message.clone()));
                anyhow::anyhow!(message)
            })?;
        }

        *open_flag = true;
        info!(
            "Microphone stream initialized in {:?}",
            start_time.elapsed()
        );
        Ok(())
    }

    pub fn preflight_microphone(&self) -> Result<(), anyhow::Error> {
        let settings = get_settings(&self.app_handle);
        if settings.selected_microphone.is_some() || settings.clamshell_microphone.is_some() {
            let _ = self.get_effective_microphone_device(&settings)?;
            return Ok(());
        }

        let host = crate::audio_toolkit::get_cpal_host();
        host.default_input_device()
            .ok_or_else(|| anyhow::anyhow!("No input device found"))?;
        self.set_last_device_resolution(Some("default-device".to_string()));
        Ok(())
    }

    pub fn stop_microphone_stream(&self) {
        let mut open_flag = self.is_open.lock();
        if !*open_flag {
            return;
        }

        let mut did_mute_guard = self.did_mute.lock();
        if *did_mute_guard {
            set_mute(false);
        }
        *did_mute_guard = false;

        if let Some(rec) = self.recorder.lock().as_mut() {
            // If still recording, stop first.
            if *self.is_recording.lock() {
                let _ = rec.stop();
                *self.is_recording.lock() = false;
                *self.state.write() = RecordingState::Idle;
            }
            let _ = rec.close();
        }

        *open_flag = false;
        debug!("Microphone stream stopped");
    }

    /* ---------- mode switching --------------------------------------------- */

    pub fn update_mode(&self, new_mode: MicrophoneMode) -> Result<(), anyhow::Error> {
        if self.is_recording() {
            return Err(anyhow::anyhow!(
                "Cannot change microphone mode while a dictation session is active"
            ));
        }
        let mode_guard = self.mode.read();
        let cur_mode = mode_guard.clone();

        match (cur_mode, &new_mode) {
            (MicrophoneMode::AlwaysOn, MicrophoneMode::OnDemand) => {
                if matches!(*self.state.read(), RecordingState::Idle) {
                    drop(mode_guard);
                    self.stop_microphone_stream();
                }
            }
            (MicrophoneMode::OnDemand, MicrophoneMode::AlwaysOn) => {
                drop(mode_guard);
                self.start_microphone_stream()?;
            }
            _ => {}
        }

        *self.mode.write() = new_mode;
        Ok(())
    }

    /* ---------- recording --------------------------------------------------- */

    pub fn toggle_pause(&self) -> bool {
        let prev = self.is_paused.fetch_xor(true, Ordering::Relaxed);
        let new_state = !prev;
        if new_state {
            debug!("Recording paused");
        } else {
            debug!("Recording resumed");
        }
        new_state
    }

    pub fn try_start_recording(&self, binding_id: &str) -> bool {
        self.is_paused.store(false, Ordering::Relaxed);
        self.set_last_error(None);
        let mut state = self.state.write();

        if let RecordingState::Idle = *state {
            // Ensure microphone is open in on-demand mode
            if matches!(*self.mode.read(), MicrophoneMode::OnDemand) {
                if let Err(e) = self.start_microphone_stream() {
                    error!("Failed to open microphone stream: {e}");
                    self.set_last_error(Some(e.to_string()));
                    return false;
                }
            }

            if let Some(rec) = self.recorder.lock().as_ref() {
                if rec.start().is_ok() {
                    *self.is_recording.lock() = true;
                    *state = RecordingState::Recording {
                        binding_id: binding_id.to_string(),
                    };
                    debug!("Recording started for binding {binding_id}");
                    return true;
                }
            }
            let message = "Recorder not available".to_string();
            error!("{}", message);
            self.set_last_error(Some(message));
            false
        } else {
            false
        }
    }

    pub fn update_selected_device(&self) -> Result<(), anyhow::Error> {
        if self.is_recording() {
            return Err(anyhow::anyhow!(
                "Cannot change microphone device while a dictation session is active"
            ));
        }
        // If currently open, restart the microphone stream to use the new device
        if *self.is_open.lock() {
            self.stop_microphone_stream();
            self.start_microphone_stream()?;
        } else if matches!(*self.mode.read(), MicrophoneMode::AlwaysOn) {
            self.start_microphone_stream()?;
        }
        Ok(())
    }

    pub fn is_microphone_stream_open(&self) -> bool {
        *self.is_open.lock()
    }

    pub fn stop_recording(&self, binding_id: &str) -> Option<Vec<f32>> {
        self.is_paused.store(false, Ordering::Relaxed);
        let mut state = self.state.write();

        match *state {
            RecordingState::Recording {
                binding_id: ref active,
            } if active == binding_id => {
                *state = RecordingState::Idle;
                drop(state);

                let samples = if let Some(rec) = self.recorder.lock().as_ref() {
                    match rec.stop() {
                        Ok(buf) => buf,
                        Err(e) => {
                            error!("stop() failed: {e}");
                            Vec::new()
                        }
                    }
                } else {
                    error!("Recorder not available");
                    Vec::new()
                };

                *self.is_recording.lock() = false;

                // In on-demand mode turn the mic off again
                if matches!(*self.mode.read(), MicrophoneMode::OnDemand) {
                    self.stop_microphone_stream();
                }

                // Pad if very short
                let s_len = samples.len();
                // debug!("Got {} samples", s_len);
                if s_len < WHISPER_SAMPLE_RATE && s_len > 0 {
                    let mut padded = samples;
                    padded.resize(WHISPER_SAMPLE_RATE * 5 / 4, 0.0);
                    Some(padded)
                } else {
                    Some(samples)
                }
            }
            _ => None,
        }
    }
    pub fn is_recording(&self) -> bool {
        matches!(*self.state.read(), RecordingState::Recording { .. })
    }

    pub fn is_paused(&self) -> bool {
        self.is_paused.load(Ordering::Relaxed)
    }

    /// Returns `true` when whisper mode (gain boost) is currently active.
    pub fn is_whisper_mode(&self) -> bool {
        self.whisper_mode.load(Ordering::Relaxed)
    }

    /// Toggle whisper mode on or off.
    ///
    /// In **AlwaysOn** mode the microphone stream is restarted immediately so
    /// the new gain takes effect without waiting for the next recording.
    /// In **OnDemand** mode the change is picked up the next time the stream
    /// is opened (i.e. on the next recording).
    pub fn set_whisper_mode(&self, enabled: bool) -> Result<(), anyhow::Error> {
        self.whisper_mode.store(enabled, Ordering::Relaxed);
        info!(
            "Whisper mode {}",
            if enabled { "enabled" } else { "disabled" }
        );

        if self.is_recording() {
            debug!("Whisper mode change deferred until the next recorder reopen");
            return Ok(());
        }

        // In AlwaysOn mode restart the stream so the gain applies immediately.
        if matches!(*self.mode.read(), MicrophoneMode::AlwaysOn) && *self.is_open.lock() {
            self.stop_microphone_stream();
            self.start_microphone_stream()?;
        }

        Ok(())
    }

    /// Returns a copy of all samples recorded so far without stopping the recording.
    /// Returns None if not currently recording.
    pub fn snapshot_recording(&self) -> Option<Vec<f32>> {
        if !matches!(*self.state.read(), RecordingState::Recording { .. }) {
            return None;
        }
        self.recorder.lock().as_ref()?.snapshot().ok()
    }

    /// Cancel any ongoing recording without returning audio samples
    pub fn cancel_recording(&self) {
        self.is_paused.store(false, Ordering::Relaxed);
        let mut state = self.state.write();

        if let RecordingState::Recording { .. } = *state {
            *state = RecordingState::Idle;
            drop(state);

            if let Some(rec) = self.recorder.lock().as_ref() {
                let _ = rec.stop(); // Discard the result
            }

            *self.is_recording.lock() = false;

            // In on-demand mode turn the mic off again
            if matches!(*self.mode.read(), MicrophoneMode::OnDemand) {
                self.stop_microphone_stream();
            }
        }
    }

    pub fn last_error_message(&self) -> Option<String> {
        self.last_error.lock().clone()
    }

    pub fn last_device_resolution(&self) -> Option<String> {
        self.last_device_resolution.lock().clone()
    }
}
