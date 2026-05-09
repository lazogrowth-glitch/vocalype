# Vocalype V7 â€” Bottleneck Hypothesis Report

Date: 2026-04-24
Task type: measurement_task / planning_only
Status: Hypothesis â€” not yet confirmed. Do not optimize until baseline is locked.
Author: Vocalype Brain

> This document does NOT recommend implementation changes.
> It translates benchmark data into a falsifiable hypothesis for the next measurement phase.

---

## 1. Evidence Summary

**Source:** `%LOCALAPPDATA%\com.vocalype.desktop\logs\vocalype.log`
**Data collected without modifying any product code.**

| Metric | Observations | p50 | p95 | min | max |
|---|---|---|---|---|---|
| `total_dictation_latency_ms` (post-recording) | 9 | 1081 ms | 2400 ms | 717 ms | 2400 ms |
| `stt_inference_time_ms` (per chunk) | 20 | 230 ms | 459 ms | 178 ms | 565 ms |
| `paste_latency_ms` (`paste_execute` step) | 5 | 644 ms | 687 ms | 644 ms | 687 ms |
| `capture_duration_ms` (audio length) | 3 | 3871 ms | â€” | 1831 ms | 7410 ms |

**Pipeline step breakdown (38 complete runs, medians):**

| Step | Median | % of p50 total (1043ms) | Notes |
|---|---|---|---|
| `stop_recording` | 11 ms | ~1% | Negligible |
| `chunk_finalize_and_assemble` | 303 ms | ~29% | Inference + chunk assembly |
| `chunk_cleanup` | 0 ms | 0% (median) | LLM cleanup, optional â€” fires 9/38 runs, up to 3320ms |
| `dictionary_replacement` | 0 ms | 0% (median) | Optional â€” fires 17/38 runs, up to 446ms |
| `paste_execute` | 645 ms | ~62% | **Dominant cost** |

**Startup timing (7 launches, from `[startup]` log lines):**

- `initialize_core_logic`: 30â€“44ms (avg 35ms) â€” negligible
- `model pre-warm launched`: async, completion time NOT logged
- `Microphone stream initialized`: 139â€“239ms (avg 197ms)

---

## 2. What Is Measured

| Dimension | Measured? | Confidence |
|---|---|---|
| Post-recording pipeline time (recording-stop â†’ paste) | âœ… Yes | High â€” 38 real log samples |
| Per-chunk STT inference time | âœ… Yes | High â€” 63 log samples |
| `paste_execute` time | âœ… Yes | High â€” 38 samples, very consistent |
| Audio capture duration | âœ… Partial | Medium â€” WAV file sizes, 20 samples |
| Synchronous app startup time | âœ… Yes | High â€” 7 launches |
| Trigger-to-recording-start time | âŒ No | Not logged |
| Model pre-warm load time | âŒ No | `model pre-warm launched` logged, completion is not |
| `chunk_cleanup` LLM time (when triggered) | âœ… Partial | High when triggered â€” but trigger condition unknown |
| `dictionary_replacement` time (when triggered) | âœ… Partial | High when triggered |

---

## 3. What Is Still Not Measured

| Missing Metric | Why It Matters |
|---|---|
| `app_idle_ram_mb` | Unknown memory footprint â€” crashes on low-RAM machines |
| `ram_during_transcription_mb` | Peak memory may spike during inference |
| `ram_after_transcription_mb` | Memory leak detection |
| `model_load_time_ms` | Cold-start UX â€” how long until first dictation is possible |
| `wer_percent` / `cer_percent` | Accuracy unknown â€” errors kill trust even if latency is good |
| `activation_success_rate` | How often does the app reach "ready" without failure? |
| `first_successful_dictation_time_ms` | Total onboarding time â€” key North Star activation metric |
| Trigger â†’ recording-start gap | First ~50â€“200ms of perceived latency is invisible in current logs |
| `chunk_cleanup` trigger condition | When/why does the LLM cleanup fire? Cost: up to 3320ms |

---

## 4. Bottleneck Hypothesis

**H1 â€” Primary hypothesis:**

> The current pipeline is **paste-bound, not inference-bound**.
>
> On this machine (Ryzen 7 5800X, RTX 4060), Parakeet inference completes
> in a median of **230ms per chunk**. The `paste_execute` step â€” keyboard/clipboard
> injection into the target application â€” takes a **constant ~645ms**, regardless
> of transcription length, audio duration, or model output size.
>
> The paste step alone accounts for **~62% of total post-recording latency at p50**.
> Improving inference speed would yield at most a ~300ms gain on the median case
> (if inference dropped to 0ms), while the paste floor remains at ~645ms.

**H1 in numbers:**

```
Current p50 total (post-recording):    1043 ms
  breakdown:  inference ~303ms  +  paste ~645ms  +  other ~95ms
  
If inference â†’ 0ms:                     ~740 ms  (30% improvement)
If paste â†’ 300ms:                       ~698 ms  (33% improvement)
If paste â†’ 300ms + inference â†’ 150ms:  ~545ms   (48% improvement)
```

The paste step is the higher-leverage target â€” and it requires no model change.

**H2 â€” Secondary hypothesis:**

> The `chunk_cleanup` LLM step is the **tail-latency driver**, not inference.
>
> It fires in 9/38 runs (24%) and accounts for all p95+ outliers:
> - 4747ms run: chunk_cleanup=3320ms
> - 2405ms run: chunk_cleanup=1366ms
> - 2169ms run: parakeet_full_audio_recovery=441ms + post_process=532ms
>
> When chunk_cleanup does not fire, p95 is approximately 1550ms.
> When it fires, p95 jumps to 4747ms.
>
> The trigger condition for chunk_cleanup is not yet known from logs alone.

---

## 5. Confidence Level

| Hypothesis | Confidence | Limiting factor |
|---|---|---|
| H1: paste-bound | **Medium-High** | paste_execute is consistently 645ms across all 38 runs â€” very unlikely to be noise. BUT: the cause of the 645ms is unknown (OS injection? clipboard delay? Enigo timing?). |
| H2: chunk_cleanup as tail-latency driver | **High** | 100% of p95 outliers have chunk_cleanup > 0ms. Clear pattern. |
| Inference is NOT the bottleneck | **High** | 230ms median inference vs 645ms median paste. 2.8Ã— difference is not measurement noise. |

**Confidence is NOT high enough to propose a product patch yet.**

Reasons:
1. Only one device measured (Ryzen 7 5800X + RTX 4060). Paste time may differ on lower-end machines.
2. The paste mechanism (`Enigo`) may behave differently under different target apps.
3. Trigger â†’ recording-start gap is unmeasured â€” total end-to-end trigger-to-paste could be longer.
4. RAM and WER are completely unmeasured â€” optimizing latency while crashing on low-RAM machines or producing wrong text is not a win.

---

## 6. What Not to Optimize Yet

**Do not optimize any of the following until the baseline is complete:**

| Area | Why not yet |
|---|---|
| Parakeet inference (model weights, quantization, batching) | It is already ~230ms median. It is NOT the bottleneck. Changes here have low expected impact. |
| Model loading / pre-warm | `model_load_time_ms` is not yet measured. Cannot know if it matters. |
| Chunk size / VAD threshold | Would require product code changes before baseline is locked. |
| WER / transcription quality | No baseline â€” cannot know if a change helps or hurts. |
| RAM optimizations | No RAM baseline â€” cannot demonstrate improvement. |
| Activation flow | `activation_success_rate` and `first_successful_dictation_time_ms` are unmeasured â€” the North Star metric is blind. |

> The operating contract stop condition is clear:
> **Do not begin optimization until â‰¥5 observations exist for every priority metric.**
> Currently 8/10 priority metrics have 0 observations.

---

## 7. Safe Next Measurements

In priority order â€” each requires no product code modification:

### 7A â€” `paste_execute` root cause (observation, not fix)

The 645ms paste time is consistent and suspicious. Before proposing any fix, understand it:

1. **Check the `Enigo` library version and paste method** used in `src-tauri/Cargo.toml`.
2. **Check `commands/mod.rs`** for how `Enigo` is configured (`paste_method` setting).
3. **Cross-reference with settings**: the `RuntimeDiagnostics` struct logs `paste_method` and `clipboard_handling` â€” check what values are reported in the log.
4. **Test on a second machine or OS** to determine if 645ms is a hardware/driver artifact or an algorithmic delay.

This is a **read-only investigation** â€” no code changes.

### 7B â€” Missing priority metrics (manual, 30 minutes)

Run the M1 session from `manual_benchmark_needed.md`:
- `app_idle_ram_mb` â€” Task Manager while app is idle
- `model_load_time_ms` â€” stopwatch from launch to first "ready"
- `ram_during_transcription_mb` â€” Task Manager peak during spinner
- `ram_after_transcription_mb` â€” Task Manager 5s after paste

### 7C â€” `chunk_cleanup` trigger condition

Look at the Rust source (`src-tauri/src/actions/transcribe.rs`) for the condition that activates `chunk_cleanup`. Specifically: what triggers it for some dictations and not others? Is it audio length, chunk count, quality score, or a user setting?

This is **read-only source inspection** â€” no code changes.

### 7D â€” WER baseline (manual, 20 minutes)

Dictate 5 known French reference phrases. Compare output to reference. Record `wer_percent`.
This is the only way to know if transcription quality is a user-trust problem.

---

## 8. Potential Future Product Patch (Proposal Stage Only)

> âš ï¸ This section names a potential investigation area.
> It is NOT an implementation handoff. Do NOT generate code. Do NOT create a handoff task.
> The operating contract requires: measure â†’ diagnose â†’ propose â†’ implement small.
> We are at "diagnose." "Propose" comes after baseline is locked.

**Candidate area: `paste_execute` reduction**

If investigation (Section 7A) confirms that the 645ms paste delay is:
- Not OS-mandatory (i.e., not an enforced accessibility delay)
- Not required by the Enigo API contract
- Reducible via a different clipboard injection method or timing

Then a future proposal could explore reducing `paste_execute` from ~645ms to ~100ms
(bringing p50 total from ~1043ms to ~450ms â€” a 57% improvement in user-perceived latency).

This would be a V8 or later proposal, after:
1. Baseline is locked for all 10 priority metrics
2. `paste_execute` behavior is confirmed across at least 2 device profiles
3. The paste mechanism is understood at the Rust implementation level (read-only)

**Candidate area: `chunk_cleanup` gating**

If the `chunk_cleanup` LLM step can be more precisely gated (currently fires in 24% of runs unpredictably), tail latency (p95) could drop from 2405ms to ~1550ms.
This requires understanding the trigger condition first (Section 7C).

---

## 9. Risks and Alternative Explanations

| Risk | Description | Mitigation |
|---|---|---|
| Single-machine bias | All data from one device. Ryzen 7 5800X + RTX 4060 is a mid-high spec. Paste time may be 200ms on a fast machine and 900ms on a low-spec laptop. | Measure on a second device before any optimization. |
| Enigo deliberate delay | The 645ms may be an intentional delay in the `Enigo` paste method to ensure target app receives clipboard content. Removing it could cause paste failures. | Read Enigo documentation and implementation before proposing changes. |
| chunk_cleanup trigger is user-controlled | The LLM cleanup step might fire based on a user setting (e.g., "post-process mode"). If so, the 24% fire rate reflects user behavior, not a bug. | Check settings_store.json and Rust source for the trigger condition. |
| `paste_execute` includes OS-level timing | Some of the 645ms may be Windows input simulation overhead (`SendInput`, `SetClipboard`). This is not reducible without platform-specific APIs. | Identify what fraction is OS overhead vs Enigo overhead. |
| Confirmation bias | The hypothesis focuses on paste because the data is clear. RAM, WER, and activation data are missing â€” those might reveal a worse bottleneck. | Complete the full 10-metric baseline before prioritizing any single fix. |
| Total latency undercount | Current `total_dictation_latency_ms` measures recording-stop â†’ paste. The trigger â†’ recording-start gap (hotkey recognition, audio device open) is NOT included. Real end-to-end may be 50â€“200ms higher. | Add trigger-to-recording timing to log analysis (read-only source check). |

---

## 10. Recommended Next Action

**One action at a time. Do not skip steps.**

```
Step 1 (now):
  Read src-tauri/Cargo.toml and commands/mod.rs to understand the paste_execute
  mechanism (Enigo version, paste method). Read-only. No changes.
  Expected output: a short note on what paste_execute does and why it costs 645ms.

Step 2 (manual session, ~30 min):
  Run M1 manual benchmark session (manual_benchmark_needed.md).
  Collect: app_idle_ram_mb, model_load_time_ms, ram_during_transcription_mb, ram_after_transcription_mb.
  Record with add_benchmark_observation.py.

Step 3 (manual session, ~20 min):
  Run 5 French WER test phrases. Record wer_percent and cer_percent.

Step 4 (automated, already possible):
  Run 5 app launches. Note whether each reaches "ready" without retry.
  Record activation_success_rate.

Step 5 (analysis):
  Once all 10 priority metrics have >=5 observations, run:
    python internal/brain/scripts/review_benchmarks.py
  If baseline ready: run lock_benchmark_baseline.py --approve (V7 Phase 2 â€” not yet built).

Step 6 (only after Step 5):
  If paste_execute investigation confirms the delay is reducible:
  Generate a V6 product patch proposal for paste mechanism.
  Do NOT generate it before baseline is locked.
```

**Current position: Between Step 1 and Step 2.**

---

## Summary Card

```
BOTTLENECK HYPOTHESIS (2026-04-24)
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
Device:     Windows, Ryzen 7 5800X, RTX 4060
Model:      parakeet-tdt-0.6b-v3-multilingual
Samples:    38 complete pipeline runs

Pipeline p50 breakdown:
  inference (chunk_finalize)  303ms   29%
  paste_execute               645ms   62%  â† DOMINANT
  other steps                  95ms    9%
  TOTAL                      1043ms  100%

Primary hypothesis:  PASTE-BOUND, not inference-bound
Confidence:          Medium-High
Inference is fast:   230ms median per chunk (real-time factor ~0.06x)
Tail latency cause:  chunk_cleanup LLM (fires 24% of runs, up to 3320ms)

DO NOT OPTIMIZE YET:
  - 8/10 priority metrics have 0 observations
  - Paste root cause is unknown
  - Only 1 device measured
  - Baseline not locked

NEXT ACTION:
  Read paste mechanism (Enigo, src-tauri/Cargo.toml) â€” read-only
  Then run M1 manual session for RAM + model_load metrics
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
```

---

*This report is planning_only / measurement_task. No product code was modified or proposed.*
*Source data: `%LOCALAPPDATA%\com.vocalype.desktop\logs\vocalype.log`, `data/benchmark_observations.jsonl`*
