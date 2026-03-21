use super::*;

const ADAPTIVE_PROFILE_SCHEMA_VERSION: u16 = 4;
const THERMAL_DEGRADED_CELSIUS: f32 = 75.0;
const TURBO_POLICY_COOLDOWN_MS: u64 = 24 * 60 * 60 * 1000;
const ADAPTIVE_PROFILE_BENCH_STALE_MS: u64 = 30 * 24 * 60 * 60 * 1000;
const BACKEND_VERSION: &str = "whisper-adaptive-v2";

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[derive(Debug, Clone, Copy)]
struct RuntimePowerSnapshot {
    on_battery: Option<bool>,
    power_mode: PowerMode,
    thermal_degraded: bool,
    captured_at_ms: u64,
}

#[derive(Debug, Clone)]
struct GpuSnapshot {
    detected: bool,
    kind: GpuKind,
    name: Option<String>,
}

impl Default for GpuSnapshot {
    fn default() -> Self {
        Self {
            detected: false,
            kind: GpuKind::Unknown,
            name: None,
        }
    }
}

#[derive(Debug, Clone)]
struct NpuSnapshot {
    detected: bool,
    kind: NpuKind,
    name: Option<String>,
    copilot_plus: bool,
}

impl Default for NpuSnapshot {
    fn default() -> Self {
        Self {
            detected: false,
            kind: NpuKind::None,
            name: None,
            copilot_plus: false,
        }
    }
}

#[cfg(target_os = "windows")]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Win32VideoController {
    name: Option<String>,
    adapter_compatibility: Option<String>,
    pnp_device_id: Option<String>,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Win32PnPEntity {
    name: Option<String>,
    manufacturer: Option<String>,
    pnp_class: Option<String>,
    device_id: Option<String>,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct ThermalZoneInfo {
    current_temperature: Option<u32>,
    critical_trip_point: Option<u32>,
    passive_trip_point: Option<u32>,
}

fn gpu_kind_rank(kind: GpuKind) -> u8 {
    match kind {
        GpuKind::None => 0,
        GpuKind::Unknown => 1,
        GpuKind::Integrated => 2,
        GpuKind::Dedicated => 3,
    }
}

fn gpu_kind_label(kind: GpuKind) -> &'static str {
    match kind {
        GpuKind::None => "none",
        GpuKind::Integrated => "integrated",
        GpuKind::Dedicated => "dedicated",
        GpuKind::Unknown => "unknown",
    }
}

fn npu_kind_rank(kind: NpuKind) -> u8 {
    match kind {
        NpuKind::None => 0,
        NpuKind::Unknown => 1,
        NpuKind::Intel | NpuKind::Amd | NpuKind::Qualcomm => 2,
    }
}

fn npu_kind_label(kind: NpuKind) -> &'static str {
    match kind {
        NpuKind::None => "none",
        NpuKind::Qualcomm => "qualcomm",
        NpuKind::Intel => "intel",
        NpuKind::Amd => "amd",
        NpuKind::Unknown => "unknown",
    }
}

fn is_probable_copilot_plus_cpu(cpu_brand_upper: &str, npu_kind: NpuKind) -> bool {
    match npu_kind {
        NpuKind::Qualcomm => cpu_brand_upper.contains("SNAPDRAGON X"),
        NpuKind::Intel => {
            cpu_brand_upper.contains("CORE ULTRA")
                && ["226V", "228V", "236V", "238V", "258V", "268V", "288V"]
                    .iter()
                    .any(|needle| cpu_brand_upper.contains(needle))
        }
        NpuKind::Amd => cpu_brand_upper.contains("RYZEN AI"),
        NpuKind::None | NpuKind::Unknown => false,
    }
}

#[cfg(target_os = "windows")]
fn classify_windows_gpu(controller: &Win32VideoController) -> GpuKind {
    let text = format!(
        "{} {} {}",
        controller.name.as_deref().unwrap_or_default(),
        controller
            .adapter_compatibility
            .as_deref()
            .unwrap_or_default(),
        controller.pnp_device_id.as_deref().unwrap_or_default()
    )
    .to_uppercase();

    if text.trim().is_empty() || text.contains("MICROSOFT BASIC") {
        return GpuKind::Unknown;
    }

    let dedicated_markers = [
        "NVIDIA",
        "GEFORCE",
        "RTX",
        "GTX",
        "QUADRO",
        "TESLA",
        "TITAN",
        "RADEON RX",
        "RADEON PRO",
        " AMD RX",
        " AMD PRO",
        "INTEL ARC",
    ];
    if dedicated_markers.iter().any(|needle| text.contains(needle)) {
        return GpuKind::Dedicated;
    }

    let integrated_markers = [
        "INTEL",
        "UHD",
        "IRIS",
        "HD GRAPHICS",
        "RADEON GRAPHICS",
        "VEGA 8",
        "VEGA 7",
        "680M",
        "780M",
    ];
    if integrated_markers
        .iter()
        .any(|needle| text.contains(needle))
    {
        return GpuKind::Integrated;
    }

    GpuKind::Unknown
}

#[cfg(target_os = "windows")]
fn classify_windows_npu(entity: &Win32PnPEntity) -> Option<NpuKind> {
    let text = format!(
        "{} {} {} {}",
        entity.name.as_deref().unwrap_or_default(),
        entity.manufacturer.as_deref().unwrap_or_default(),
        entity.pnp_class.as_deref().unwrap_or_default(),
        entity.device_id.as_deref().unwrap_or_default()
    )
    .to_uppercase();

    let has_npu_markers = [
        "NPU",
        "AI BOOST",
        "HEXAGON",
        "RYZEN AI",
        "AMD IPU",
        "IPU DEVICE",
        "NEURAL PROCESSING",
    ]
    .iter()
    .any(|needle| text.contains(needle));

    if !has_npu_markers {
        return None;
    }

    if text.contains("QUALCOMM") || text.contains("HEXAGON") {
        return Some(NpuKind::Qualcomm);
    }

    if text.contains("INTEL") || text.contains("AI BOOST") {
        return Some(NpuKind::Intel);
    }

    if text.contains("AMD") || text.contains("RYZEN AI") || text.contains("AMD IPU") {
        return Some(NpuKind::Amd);
    }

    Some(NpuKind::Unknown)
}

#[cfg(target_os = "windows")]
fn open_wmi_com_library() -> Option<wmi::COMLibrary> {
    use wmi::COMLibrary;

    match COMLibrary::without_security() {
        Ok(value) => Some(value),
        Err(err) => {
            debug!(
                "Falling back to assumed COM initialization for WMI access: {}",
                err
            );
            Some(unsafe { COMLibrary::assume_initialized() })
        }
    }
}

#[cfg(target_os = "windows")]
fn detect_gpu_snapshot() -> GpuSnapshot {
    use std::sync::mpsc;
    use std::time::Duration;

    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(detect_gpu_snapshot_inner());
    });

    match rx.recv_timeout(Duration::from_secs(5)) {
        Ok(snapshot) => snapshot,
        Err(_) => {
            warn!("WMI GPU detection timed out, using Unknown fallback");
            GpuSnapshot {
                detected: true,
                kind: GpuKind::Unknown,
                name: None,
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn detect_gpu_snapshot_inner() -> GpuSnapshot {
    use wmi::WMIConnection;

    let Some(com) = open_wmi_com_library() else {
        return GpuSnapshot {
            detected: true,
            kind: GpuKind::Unknown,
            name: None,
        };
    };

    let connection = match WMIConnection::new(com.into()) {
        Ok(value) => value,
        Err(err) => {
            warn!("Failed to connect to WMI for GPU detection: {}", err);
            return GpuSnapshot {
                detected: true,
                kind: GpuKind::Unknown,
                name: None,
            };
        }
    };

    let controllers: Vec<Win32VideoController> = match connection
        .raw_query("SELECT Name, AdapterCompatibility, PNPDeviceID FROM Win32_VideoController")
    {
        Ok(value) => value,
        Err(err) => {
            warn!("Failed to query Win32_VideoController: {}", err);
            return GpuSnapshot {
                detected: true,
                kind: GpuKind::Unknown,
                name: None,
            };
        }
    };

    let mut best_kind = GpuKind::None;
    let mut best_name = None;
    for controller in controllers {
        let kind = classify_windows_gpu(&controller);
        if matches!(kind, GpuKind::Unknown | GpuKind::None) {
            continue;
        }
        if gpu_kind_rank(kind) > gpu_kind_rank(best_kind) {
            best_name = controller.name.clone();
            best_kind = kind;
        }
    }

    if matches!(best_kind, GpuKind::None) {
        GpuSnapshot {
            detected: false,
            kind: GpuKind::None,
            name: None,
        }
    } else {
        GpuSnapshot {
            detected: true,
            kind: best_kind,
            name: best_name,
        }
    }
}

#[cfg(target_os = "windows")]
fn detect_npu_snapshot(cpu_brand_upper: &str) -> NpuSnapshot {
    use std::sync::mpsc;
    use std::time::Duration;

    let cpu_brand_upper = cpu_brand_upper.to_owned();
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(detect_npu_snapshot_inner(&cpu_brand_upper));
    });

    match rx.recv_timeout(Duration::from_secs(5)) {
        Ok(snapshot) => snapshot,
        Err(_) => {
            warn!("WMI NPU detection timed out, using default fallback");
            NpuSnapshot::default()
        }
    }
}

#[cfg(target_os = "windows")]
fn detect_npu_snapshot_inner(cpu_brand_upper: &str) -> NpuSnapshot {
    use wmi::WMIConnection;

    let Some(com) = open_wmi_com_library() else {
        return NpuSnapshot::default();
    };

    let connection = match WMIConnection::new(com.into()) {
        Ok(value) => value,
        Err(err) => {
            warn!("Failed to connect to WMI for NPU detection: {}", err);
            return NpuSnapshot::default();
        }
    };

    let entities: Vec<Win32PnPEntity> = match connection
        .raw_query("SELECT Name, Manufacturer, PNPClass, DeviceID FROM Win32_PnPEntity WHERE PNPClass = 'System' OR PNPClass = 'Processor' OR Name LIKE '%NPU%' OR Name LIKE '%AI%' OR Name LIKE '%Neural%' OR Name LIKE '%Hexagon%' OR Name LIKE '%Ryzen AI%'")
    {
        Ok(value) => value,
        Err(err) => {
            warn!("Failed to query Win32_PnPEntity for NPU detection: {}", err);
            return NpuSnapshot::default();
        }
    };

    let mut best_kind = NpuKind::None;
    let mut best_name = None;
    for entity in entities {
        let Some(kind) = classify_windows_npu(&entity) else {
            continue;
        };
        if npu_kind_rank(kind) > npu_kind_rank(best_kind) {
            best_kind = kind;
            best_name = entity.name.clone();
        }
    }

    if matches!(best_kind, NpuKind::None) {
        return NpuSnapshot::default();
    }

    NpuSnapshot {
        detected: true,
        kind: best_kind,
        name: best_name,
        copilot_plus: is_probable_copilot_plus_cpu(cpu_brand_upper, best_kind),
    }
}

#[cfg(not(target_os = "windows"))]
fn detect_npu_snapshot(_cpu_brand_upper: &str) -> NpuSnapshot {
    NpuSnapshot::default()
}

#[cfg(not(target_os = "windows"))]
fn detect_gpu_snapshot() -> GpuSnapshot {
    GpuSnapshot {
        detected: cfg!(any(target_os = "macos", target_os = "linux")),
        kind: GpuKind::Unknown,
        name: None,
    }
}

#[cfg(target_os = "windows")]
fn detect_thermal_degraded() -> bool {
    use wmi::WMIConnection;

    let Some(com) = open_wmi_com_library() else {
        return false;
    };

    let connection = match WMIConnection::with_namespace_path("ROOT\\WMI", com.into()) {
        Ok(value) => value,
        Err(err) => {
            warn!("Failed to connect to WMI thermal namespace: {}", err);
            return false;
        }
    };

    let zones: Vec<ThermalZoneInfo> = match connection.raw_query(
        "SELECT CurrentTemperature, CriticalTripPoint, PassiveTripPoint FROM MSAcpi_ThermalZoneTemperature",
    ) {
        Ok(value) => value,
        Err(err) => {
            debug!("Thermal WMI query unavailable: {}", err);
            return false;
        }
    };

    zones.into_iter().any(|zone| {
        let current_celsius = zone
            .current_temperature
            .map(|value| (value as f32 / 10.0) - 273.15)
            .filter(|value| value.is_finite() && *value > 0.0);
        let passive_celsius = zone
            .passive_trip_point
            .map(|value| (value as f32 / 10.0) - 273.15)
            .filter(|value| value.is_finite() && *value > 0.0);
        let critical_celsius = zone
            .critical_trip_point
            .map(|value| (value as f32 / 10.0) - 273.15)
            .filter(|value| value.is_finite() && *value > 0.0);

        let Some(current_celsius) = current_celsius else {
            return false;
        };

        current_celsius >= THERMAL_DEGRADED_CELSIUS
            || passive_celsius
                .map(|passive| current_celsius >= passive - 2.0)
                .unwrap_or(false)
            || critical_celsius
                .map(|critical| current_celsius >= critical - 10.0)
                .unwrap_or(false)
    })
}

#[cfg(not(target_os = "windows"))]
fn detect_thermal_degraded() -> bool {
    false
}

#[cfg(target_os = "windows")]
fn detect_runtime_power_snapshot() -> RuntimePowerSnapshot {
    use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};

    let mut status = SYSTEM_POWER_STATUS::default();
    let captured_at_ms = now_ms();
    let result = unsafe { GetSystemPowerStatus(&mut status) };
    if result.is_ok() {
        let on_battery = match status.ACLineStatus {
            0 => Some(true),
            1 => Some(false),
            _ => None,
        };
        let power_mode = if status.SystemStatusFlag == 1 {
            PowerMode::Saver
        } else {
            PowerMode::Normal
        };
        RuntimePowerSnapshot {
            on_battery,
            power_mode,
            thermal_degraded: detect_thermal_degraded(),
            captured_at_ms,
        }
    } else {
        RuntimePowerSnapshot {
            on_battery: None,
            power_mode: PowerMode::Unknown,
            thermal_degraded: detect_thermal_degraded(),
            captured_at_ms,
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn detect_runtime_power_snapshot() -> RuntimePowerSnapshot {
    RuntimePowerSnapshot {
        on_battery: None,
        power_mode: PowerMode::Unknown,
        thermal_degraded: false,
        captured_at_ms: now_ms(),
    }
}

fn ram_score(total_memory_gb: u16) -> u8 {
    match total_memory_gb {
        0..=8 => 0,
        9..=15 => 1,
        16..=23 => 2,
        _ => 3,
    }
}

fn cpu_threads_score(logical_cores: u8) -> u8 {
    match logical_cores {
        0..=8 => 0,
        9..=12 => 1,
        13..=16 => 2,
        _ => 3,
    }
}

fn cpu_family_score(cpu_brand_upper: &str, low_power_cpu: bool) -> u8 {
    if low_power_cpu
        || ["CELERON", "PENTIUM", "N100", "N200", "ATHLON", "SILVER"]
            .iter()
            .any(|needle| cpu_brand_upper.contains(needle))
    {
        0
    } else if ["HX", "HS", "H ", "DESKTOP", "RYZEN 9", "CORE I9", "XEON"]
        .iter()
        .any(|needle| cpu_brand_upper.contains(needle))
    {
        2
    } else {
        1
    }
}

fn whisper_config(
    backend: WhisperBackendPreference,
    threads: u8,
    chunk_seconds: u8,
    overlap_ms: u16,
) -> WhisperModelAdaptiveConfig {
    WhisperModelAdaptiveConfig {
        backend,
        threads,
        chunk_seconds,
        overlap_ms,
        active_backend: backend,
        active_threads: threads,
        active_chunk_seconds: chunk_seconds,
        active_overlap_ms: overlap_ms,
        short_latency_ms: 0,
        medium_latency_ms: 0,
        long_latency_ms: 0,
        stability_score: 1.0,
        overall_score: 0.0,
        failure_count: 0,
        calibrated_phase: CalibrationPhase::None,
        unsafe_backends: Vec::new(),
        unsafe_until: None,
        last_failure_reason: None,
        last_failure_at: None,
        last_quick_bench_at: None,
        last_full_bench_at: None,
        backend_decision_reason: None,
        config_decision_reason: None,
    }
}

fn current_app_version(app: &AppHandle) -> String {
    app.package_info().version.to_string()
}

fn tier_from_score(score: f32) -> MachineTier {
    if score <= 2.0 {
        MachineTier::Low
    } else if score <= 5.0 {
        MachineTier::Medium
    } else {
        MachineTier::High
    }
}

fn detect_adaptive_machine_profile(app: &AppHandle, app_language: &str) -> AdaptiveMachineProfile {
    let mut system = sysinfo::System::new_all();
    system.refresh_cpu_all();
    system.refresh_memory();

    let power_snapshot = detect_runtime_power_snapshot();
    let gpu_snapshot = detect_gpu_snapshot();
    let cpu_brand = system
        .cpus()
        .first()
        .map(|cpu| cpu.brand().trim().to_string())
        .filter(|brand| !brand.is_empty())
        .unwrap_or_else(|| "Unknown CPU".to_string());
    let logical_cores = std::thread::available_parallelism()
        .map(|value| value.get())
        .unwrap_or(4)
        .min(u8::MAX as usize) as u8;
    let total_memory_gb = (system.total_memory() / 1024 / 1024 / 1024)
        .max(1)
        .min(u16::MAX as u64) as u16;

    let cpu_brand_upper = cpu_brand.to_uppercase();
    let low_power_cpu = [
        " CELERON", " PENTIUM", " N100", " N200", " N305", " U", " Y",
    ]
    .iter()
    .any(|needle| cpu_brand_upper.contains(needle));
    let gpu_detected = gpu_snapshot.detected;
    let npu_snapshot = detect_npu_snapshot(&cpu_brand_upper);
    let machine_score_details = {
        let ram_score = ram_score(total_memory_gb);
        let cpu_threads_score = cpu_threads_score(logical_cores);
        let cpu_family_score = cpu_family_score(&cpu_brand_upper, low_power_cpu);
        let gpu_prebench_bonus = match gpu_snapshot.kind {
            GpuKind::Dedicated => 0.10,
            GpuKind::Integrated => 0.05,
            _ => 0.0,
        };
        let npu_prebench_bonus = if npu_snapshot.copilot_plus {
            0.10
        } else if npu_snapshot.detected {
            0.05
        } else {
            0.0
        };
        let low_power_penalty = if low_power_cpu { -1.0 } else { 0.0 };
        let power_penalty = if power_snapshot.on_battery == Some(true) {
            -0.5
        } else if matches!(power_snapshot.power_mode, PowerMode::Saver) {
            -0.5
        } else {
            0.0
        };
        let thermal_penalty = if power_snapshot.thermal_degraded {
            -1.0
        } else {
            0.0
        };
        let final_score = ram_score as f32
            + cpu_threads_score as f32
            + cpu_family_score as f32
            + gpu_prebench_bonus
            + npu_prebench_bonus
            + low_power_penalty
            + power_penalty
            + thermal_penalty;
        MachineScoreDetails {
            ram_score,
            cpu_threads_score,
            cpu_family_score,
            gpu_prebench_bonus,
            npu_prebench_bonus,
            low_power_penalty,
            power_penalty,
            thermal_penalty,
            final_score,
            tier_reason: format!(
                "ram={} cpu_threads={} cpu_family={} gpu_kind={} gpu_bonus={:.2} npu_kind={} npu_bonus={:.2} copilot_plus={} low_power={:.2} power={:.2} thermal={:.2}",
                ram_score,
                cpu_threads_score,
                cpu_family_score,
                gpu_kind_label(gpu_snapshot.kind),
                gpu_prebench_bonus,
                npu_kind_label(npu_snapshot.kind),
                npu_prebench_bonus,
                npu_snapshot.copilot_plus,
                low_power_penalty,
                power_penalty,
                thermal_penalty
            ),
        }
    };
    let machine_tier = tier_from_score(machine_score_details.final_score);

    let whisper = match machine_tier {
        MachineTier::Low => WhisperAdaptiveProfile {
            small: whisper_config(
                if low_power_cpu && total_memory_gb <= 8 {
                    WhisperBackendPreference::Cpu
                } else {
                    WhisperBackendPreference::Auto
                },
                6,
                12,
                500,
            ),
            medium: whisper_config(WhisperBackendPreference::Auto, 6, 10, 500),
            turbo: whisper_config(WhisperBackendPreference::Auto, 6, 12, 500),
            large: whisper_config(WhisperBackendPreference::Gpu, 4, 12, 750),
        },
        MachineTier::Medium => WhisperAdaptiveProfile {
            small: whisper_config(WhisperBackendPreference::Auto, 8, 10, 500),
            medium: whisper_config(WhisperBackendPreference::Auto, 6, 8, 500),
            turbo: whisper_config(WhisperBackendPreference::Auto, 8, 10, 500),
            large: whisper_config(WhisperBackendPreference::Gpu, 4, 10, 750),
        },
        MachineTier::High => WhisperAdaptiveProfile {
            small: whisper_config(WhisperBackendPreference::Auto, 8, 8, 500),
            medium: whisper_config(WhisperBackendPreference::Auto, 8, 8, 500),
            turbo: whisper_config(WhisperBackendPreference::Gpu, 8, 8, 500),
            large: whisper_config(WhisperBackendPreference::Gpu, 6, 10, 750),
        },
    };

    AdaptiveMachineProfile {
        profile_schema_version: ADAPTIVE_PROFILE_SCHEMA_VERSION,
        app_version: current_app_version(app),
        backend_version: BACKEND_VERSION.to_string(),
        machine_score_details,
        machine_tier,
        cpu_brand,
        logical_cores,
        total_memory_gb,
        low_power_cpu,
        gpu_detected,
        gpu_kind: gpu_snapshot.kind,
        gpu_name: gpu_snapshot.name,
        npu_detected: npu_snapshot.detected,
        npu_kind: npu_snapshot.kind,
        npu_name: npu_snapshot.name,
        copilot_plus_detected: npu_snapshot.copilot_plus,
        on_battery: power_snapshot.on_battery,
        power_mode: power_snapshot.power_mode,
        thermal_degraded: power_snapshot.thermal_degraded,
        runtime_power_snapshot_at: Some(power_snapshot.captured_at_ms),
        recommended_model_id: preferred_model_for_locale(app_language),
        secondary_model_id: secondary_model_for_locale(app_language, machine_tier),
        active_runtime_model_id: None,
        recommended_backend: None,
        active_backend: None,
        calibrated_models: Vec::new(),
        bench_phase: BenchPhase::None,
        bench_completed_at: None,
        last_quick_bench_at: None,
        last_full_bench_at: None,
        calibration_state: AdaptiveCalibrationState::Idle,
        calibration_reason: None,
        large_skip_reason: None,
        whisper,
    }
}

fn profile_is_stale(profile: &AdaptiveMachineProfile, app: &AppHandle) -> bool {
    if profile.profile_schema_version < ADAPTIVE_PROFILE_SCHEMA_VERSION {
        return true;
    }

    if profile.app_version != current_app_version(app) || profile.backend_version != BACKEND_VERSION
    {
        return true;
    }

    profile
        .bench_completed_at
        .map(|timestamp| now_ms().saturating_sub(timestamp) > ADAPTIVE_PROFILE_BENCH_STALE_MS)
        .unwrap_or(false)
}

fn merge_whisper_profile(
    mut base: AdaptiveMachineProfile,
    existing: AdaptiveMachineProfile,
) -> AdaptiveMachineProfile {
    base.whisper = existing.whisper;
    base.calibrated_models = existing.calibrated_models;
    base.bench_phase = existing.bench_phase;
    base.bench_completed_at = existing.bench_completed_at;
    base.last_quick_bench_at = existing.last_quick_bench_at;
    base.last_full_bench_at = existing.last_full_bench_at;
    base.calibration_state = existing.calibration_state;
    base.calibration_reason = existing.calibration_reason;
    base.large_skip_reason = existing.large_skip_reason;
    base.active_runtime_model_id = existing.active_runtime_model_id;
    base.recommended_backend = existing.recommended_backend;
    base.active_backend = existing.active_backend;
    base
}

fn normalize_adaptive_profile(profile: &mut AdaptiveMachineProfile) {
    let turbo = &mut profile.whisper.turbo;
    for entry in &mut turbo.unsafe_backends {
        let capped_until = entry.failed_at_ms.saturating_add(TURBO_POLICY_COOLDOWN_MS);
        if entry.unsafe_until_ms > capped_until {
            entry.unsafe_until_ms = capped_until;
        }
    }
    turbo.unsafe_until = turbo
        .unsafe_backends
        .iter()
        .map(|entry| entry.unsafe_until_ms)
        .max();
}

fn profile_needs_turbo_cooldown_normalization(profile: &AdaptiveMachineProfile) -> bool {
    profile.whisper.turbo.unsafe_backends.iter().any(|entry| {
        entry.unsafe_until_ms > entry.failed_at_ms.saturating_add(TURBO_POLICY_COOLDOWN_MS)
    })
}

pub(crate) fn ensure_adaptive_profile(app: &AppHandle, settings: &mut AppSettings) -> bool {
    let mut changed = false;
    let needs_new_profile = !settings.adaptive_profile_applied
        || settings.adaptive_machine_profile.is_none()
        || settings
            .adaptive_machine_profile
            .as_ref()
            .map(|profile| profile_is_stale(profile, app))
            .unwrap_or(true);

    if needs_new_profile {
        // Full hardware detection (WMI GPU/NPU/thermal) — only when profile is missing or stale.
        let mut detected = detect_adaptive_machine_profile(app, &settings.app_language);
        if let Some(existing) = settings.adaptive_machine_profile.clone() {
            detected = merge_whisper_profile(detected, existing);
        }
        normalize_adaptive_profile(&mut detected);
        settings.adaptive_machine_profile = Some(detected);
        settings.adaptive_profile_applied = true;
        changed = true;
    } else if let Some(existing) = settings.adaptive_machine_profile.as_mut() {
        // Profile is fresh — apply only cheap metadata updates, no WMI re-detection.
        let current_selected_model = settings.selected_model.clone();
        let new_recommended = preferred_model_for_locale(&settings.app_language);
        let new_secondary =
            secondary_model_for_locale(&settings.app_language, existing.machine_tier);
        let has_diff = existing.profile_schema_version != ADAPTIVE_PROFILE_SCHEMA_VERSION
            || existing.app_version != current_app_version(app)
            || existing.backend_version != BACKEND_VERSION
            || existing.recommended_model_id != new_recommended
            || existing.secondary_model_id != new_secondary
            || profile_needs_turbo_cooldown_normalization(existing)
            || (!current_selected_model.is_empty()
                && existing.active_runtime_model_id.as_deref()
                    != Some(current_selected_model.as_str()));

        if has_diff {
            existing.profile_schema_version = ADAPTIVE_PROFILE_SCHEMA_VERSION;
            existing.app_version = current_app_version(app);
            existing.backend_version = BACKEND_VERSION.to_string();
            existing.recommended_model_id = new_recommended;
            existing.secondary_model_id = new_secondary;
            if !current_selected_model.is_empty() {
                existing.active_runtime_model_id = Some(current_selected_model);
            }
            normalize_adaptive_profile(existing);
            changed = true;
        }
    }

    changed
}
