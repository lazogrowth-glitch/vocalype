# Vocalype V7 â€” Manual Benchmark Collection Guide

Date: 2026-04-24
Author: Vocalype Brain (V7 Phase 1 auto-collection attempt)
Status: All 6 target metrics require manual measurement.

---

## Machine Profile (auto-detected)

| Field | Value |
|---|---|
| CPU | AMD Ryzen 7 5800X 8-Core (8C / 16T) |
| RAM | 32 GB total |
| GPU | NVIDIA GeForce RTX 4060 |
| OS | Windows |
| Active model | `parakeet-tdt-0.6b-v3-multilingual` |
| Model on disk | `parakeet-tdt-0.6b-v3-int8` â€” **639.6 MB** |
| App data dir | `%APPDATA%\com.vocalype.desktop\` |
| Typical dictation length | 1.4s â€“ 5.5s (from 10 recent recordings) |

---

## Why No Metrics Were Collected Automatically

**Vocalype was not running at collection time.**

All 6 target metrics require either:
- The app to be running (RAM metrics), or
- An active dictation to have just completed (timing metrics).

No log files were found on disk. The pipeline profiler data is **in-memory only**
and is lost when the app closes.

---

## Critical Discovery: Built-in Pipeline Profiler

> **The app already times every dictation step internally. No instrumentation needed.**

The Rust runtime (`src-tauri/src/actions/profiler.rs`) records:
- `stop_recording` â€” audio capture stop time
- `chunk_finalize_and_assemble` â€” chunking assembly time
- `parakeet_full_audio_recovery` â€” recovery path time (when used)
- `total_duration_ms` â€” full pipeline duration (trigger â†’ paste)

It logs this after every dictation via:
```
[INFO] Pipeline profile [BINDING_ID] model=MODEL_ID total=Xms steps=stop_recording=Xms, ...
```

This is emitted as a Tauri event (`pipeline-profile`) and as a `log::info!` line.

**How to read it:** Run the app in dev mode. Every dictation will print the
full timing breakdown to the terminal automatically.

---

## Metric 1: `app_idle_ram_mb`

**Status: MANUAL REQUIRED** â€” App was not running at collection time.

**How to measure:**
1. Launch Vocalype normally (installed version or dev mode).
2. Wait for the "ready" state. Do NOT trigger any dictation.
3. Wait 10 seconds for memory to stabilize.
4. Open **Task Manager** â†’ Details tab â†’ find `vocalype.exe`.
5. Record the **Working Set (Memory)** column value (in MB).

**Record with:**
```
python internal/brain/scripts/add_benchmark_observation.py \
    --scenario ram_idle \
    --metric app_idle_ram_mb \
    --value <your_reading> \
    --unit mb \
    --model parakeet-tdt-0.6b-v3-multilingual \
    --device windows_ryzen7_rtx4060 \
    --notes "idle, no dictation, app version <git-sha>"
```

**Expected range:** 150â€“600 MB (model loaded in RAM).
Model file is 639.6 MB on disk â€” expect RAM footprint to be similar or higher.

---

## Metric 2: `ram_during_transcription_mb`

**Status: MANUAL REQUIRED** â€” No safe way to trigger transcription automatically.

**How to measure:**
1. Launch Vocalype. Wait for "ready" state.
2. Open **Task Manager** â†’ Details tab â†’ find `vocalype.exe`.
3. Trigger a 5â€“10 second dictation (speak clearly).
4. **While the spinner is showing** (transcribing state), note the peak RAM.
5. Record the highest value seen during transcription.

> Tip: Task Manager updates every ~1 second. You may need 2â€“3 tries to catch the peak.
> Alternative: use **Process Explorer** (Sysinternals) for smoother real-time RAM graph.

**Record with:**
```
python internal/brain/scripts/add_benchmark_observation.py \
    --scenario ram_transcription \
    --metric ram_during_transcription_mb \
    --value <peak_reading> \
    --unit mb \
    --model parakeet-tdt-0.6b-v3-multilingual \
    --device windows_ryzen7_rtx4060 \
    --notes "peak during ~Xs dictation"
```

---

## Metric 3: `ram_after_transcription_mb`

**Status: MANUAL REQUIRED** â€” Requires active dictation to have just completed.

**How to measure:**
1. After a dictation completes (text pasted), wait **5 seconds**.
2. Record the `vocalype.exe` Working Set from Task Manager.
3. Compare to `app_idle_ram_mb` â€” the delta reveals memory leaks.

**Record with:**
```
python internal/brain/scripts/add_benchmark_observation.py \
    --scenario ram_transcription \
    --metric ram_after_transcription_mb \
    --value <reading_5s_after_paste> \
    --unit mb \
    --model parakeet-tdt-0.6b-v3-multilingual \
    --device windows_ryzen7_rtx4060 \
    --notes "5s after paste complete"
```

---

## Metric 4: `model_load_time_ms`

**Status: MANUAL REQUIRED** â€” No existing log captures this on disk.

**How to measure (cold start):**
1. Make sure Vocalype is fully closed.
2. Start a stopwatch.
3. Launch Vocalype (installed version: `%LOCALAPPDATA%\vocalype\vocalype.exe`).
4. Stop the stopwatch when the UI reaches the **"ready"** state (tray icon changes / overlay is responsive).
5. Record the elapsed time in milliseconds.

> **Dev mode alternative (more precise):**
> Run `bun run tauri dev` in a terminal.
> Look for log lines like `model loaded` or the first `Pipeline profile` event.
> The model load time will appear in the step timings.

**Record with:**
```
python internal/brain/scripts/add_benchmark_observation.py \
    --scenario cold_start \
    --metric model_load_time_ms \
    --value <stopwatch_reading_ms> \
    --unit ms \
    --model parakeet-tdt-0.6b-v3-multilingual \
    --device windows_ryzen7_rtx4060 \
    --notes "cold start, app freshly closed"
```

---

## Metric 5: `total_dictation_latency_ms`

**Status: MANUAL REQUIRED** â€” But readable from dev console automatically (no instrumentation).

### Option A â€” Dev mode terminal (recommended, precise)

1. Run `bun run tauri dev` in a terminal from the project root.
2. Trigger a normal dictation (hotkey â†’ speak â†’ release).
3. After the text pastes, look in the terminal for a log line like:

```
[INFO] Pipeline profile [xxx] model=parakeet-tdt-0.6b-v3-multilingual total=1340ms steps=stop_recording=120ms, chunk_finalize_and_assemble=890ms, ...
```

4. The `total=Xms` value IS `total_dictation_latency_ms` (pipeline start â†’ paste complete).

### Option B â€” Stopwatch (manual, installed app)

1. Open Vocalype (installed). Wait for "ready".
2. Start a stopwatch when you press the hotkey.
3. Stop the stopwatch when the text appears in the target app.
4. Record the elapsed time.

**Record with:**
```
python internal/brain/scripts/add_benchmark_observation.py \
    --scenario warm_dictation \
    --metric total_dictation_latency_ms \
    --value <value_from_log_or_stopwatch> \
    --unit ms \
    --model parakeet-tdt-0.6b-v3-multilingual \
    --device windows_ryzen7_rtx4060 \
    --notes "warm dictation, ~2s audio, dev mode log" (or "stopwatch measurement")
```

---

## Metric 6: `stt_inference_time_ms`

**Status: MANUAL REQUIRED** â€” But readable from dev console automatically.

### Dev mode terminal (recommended)

Same as Metric 5 â€” run `bun run tauri dev` and read the pipeline profile log.

The step timing for `chunk_finalize_and_assemble` or the individual Parakeet inference
step gives `stt_inference_time_ms`. Look for the inference-specific step in the log line:

```
steps=stop_recording=Xms, chunk_finalize_and_assemble=Xms (inference is inside this)
```

> Note: The current profiler aggregates chunked inference inside `chunk_finalize_and_assemble`.
> A dedicated `inference_ms` step may not be separately labelled. Record what you can read.

**Record with:**
```
python internal/brain/scripts/add_benchmark_observation.py \
    --scenario warm_dictation \
    --metric stt_inference_time_ms \
    --value <inference_step_ms_from_log> \
    --unit ms \
    --model parakeet-tdt-0.6b-v3-multilingual \
    --device windows_ryzen7_rtx4060 \
    --notes "from pipeline profile log, ~2s audio"
```

---

## Recommended Session Protocol (M1 â€” First Manual Session)

Run all of the following in one 30-minute session:

| Step | Action | Metrics collected |
|---|---|---|
| 1 | Open terminal. Run `bun run tauri dev`. | â€” |
| 2 | Wait for app to reach "ready" state. | `model_load_time_ms` (stopwatch) |
| 3 | Open Task Manager â†’ vocalype.exe â†’ record Working Set. | `app_idle_ram_mb` |
| 4 | Trigger a 3s dictation. Read terminal log. | `total_dictation_latency_ms`, `stt_inference_time_ms` |
| 5 | Record Task Manager peak during transcription. | `ram_during_transcription_mb` |
| 6 | Wait 5s after paste. Record Task Manager. | `ram_after_transcription_mb` |
| 7 | Repeat step 4 two more times (3 total warm dictations). | 2 more `total_dictation_latency_ms` samples |
| 8 | Run `python internal/brain/scripts/review_benchmarks.py`. | Updated report |

**Target after one session:** 6 metrics Ã— 1 observation = 6 total. Need 4 more sessions to reach baseline.

---

## Context: Existing Benchmark Observations

| Metric | Observations so far | Baseline ready (â‰¥5) |
|---|---|---|
| `total_dictation_latency_ms` | 1 (validation sample: 2400ms) | âŒ |
| All others | 0 | âŒ |

---

## Quick Reference: Record Command Template

```bash
python internal/brain/scripts/add_benchmark_observation.py \
    --scenario <scenario> \
    --metric <metric> \
    --value <number> \
    --unit <ms|mb|percent> \
    --model parakeet-tdt-0.6b-v3-multilingual \
    --device windows_ryzen7_rtx4060 \
    --notes "<free text>"
```

Common scenarios: `cold_start`, `warm_dictation`, `ram_idle`, `ram_transcription`, `first_dictation`
Common metrics: `total_dictation_latency_ms`, `model_load_time_ms`, `stt_inference_time_ms`,
                `app_idle_ram_mb`, `ram_during_transcription_mb`, `ram_after_transcription_mb`

---

## After Collecting â‰¥5 Observations Per Metric

Run:
```bash
python internal/brain/scripts/review_benchmarks.py
```

When all 10 priority metrics have â‰¥5 observations, the report will recommend
locking the baseline with `lock_benchmark_baseline.py --approve` (V7 Phase 2 â€” not yet built).

---

*This file is generated by Vocalype Brain â€” V7 Phase 1. Do not modify product code to collect these metrics.*
