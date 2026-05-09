# Vocalype Brain â€” V7 Design Plan
# Real Product Benchmark Loop

Date: 2026-04-24
Task type: planning_only
Status: design document only â€” no scripts implemented yet
Author: Vocalype Brain

---

## 1. What V7 Should Measure

V7 establishes **baseline reality** before any optimization decision.
Its purpose is to answer: "What does Vocalype actually do today, in numbers?"

Without a baseline, every optimization is a guess.
With a baseline, every change can be compared: before vs. after.

V7 measures five product fundamentals in this priority order:

| Priority | Fundamental | Why it matters |
|---|---|---|
| 1 | First successful dictation | North Star activation event â€” blocks all downstream value |
| 2 | Stability | Crashes, hung states, permission failures destroy trust before value |
| 3 | Transcription errors | Wrong text = no trust = no retention |
| 4 | Transcription latency | Slow feedback loop = users give up |
| 5 | RAM usage | High memory = crashes on low-end machines, background conflicts |

V7 does NOT optimize. It only measures, records, and reports.
V8 will use V7 baselines to drive optimization proposals.

---

## 2. First-Principles Dictation Pipeline Breakdown

Every dictation passes through this pipeline. Each stage has measurable latency.

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚ STAGE 1 â€” Activation                                            â”‚
â”‚  User opens app â†’ auth/license check â†’ status reaches "ready"  â”‚
â”‚  Measured: time from app launch to first "ready" state          â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                               â†“
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚ STAGE 2 â€” Trigger                                               â”‚
â”‚  User triggers dictation (hotkey / overlay click)               â”‚
â”‚  Measured: time from trigger to first audio capture frame       â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                               â†“
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚ STAGE 3 â€” Audio Capture                                         â”‚
â”‚  Microphone open â†’ VAD detection â†’ silence end detection        â”‚
â”‚  Measured: capture duration, VAD confidence, silence threshold  â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                               â†“
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚ STAGE 4 â€” Preprocessing                                         â”‚
â”‚  Raw audio â†’ resampling â†’ normalization â†’ model input format    â”‚
â”‚  Measured: preprocessing wall-clock time                        â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                               â†“
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚ STAGE 5 â€” Model Load / Warmup                                   â”‚
â”‚  Is model already loaded? First-run load vs. warm inference     â”‚
â”‚  Measured: cold load time, warm inference ready time            â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                               â†“
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚ STAGE 6 â€” STT Inference                                         â”‚
â”‚  Audio tensor â†’ Parakeet model â†’ raw token output              â”‚
â”‚  Measured: inference wall-clock time, real-time factor (RTF)    â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                               â†“
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚ STAGE 7 â€” Post-processing                                       â”‚
â”‚  Tokens â†’ text â†’ punctuation â†’ formatting                       â”‚
â”‚  Measured: post-processing wall-clock time                      â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                               â†“
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚ STAGE 8 â€” Output / Paste                                        â”‚
â”‚  Text â†’ clipboard injection or native paste                     â”‚
â”‚  Measured: paste success/failure, injection latency             â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜

TOTAL PERCEIVED LATENCY = trigger â†’ paste complete
CRITICAL PATH = stages 4 + 5 (cold) + 6
```

---

## 3. Exact Metrics

### 3A â€” Transcription Latency

| Metric | Unit | Description |
|---|---|---|
| `trigger_to_capture_ms` | ms | Hotkey/click â†’ first audio frame |
| `capture_duration_ms` | ms | Duration of captured audio |
| `preprocessing_ms` | ms | Audio â†’ model input |
| `model_cold_load_ms` | ms | First-run model load from disk (cold) |
| `model_warm_ready_ms` | ms | Warm inference ready time (subsequent runs) |
| `inference_ms` | ms | STT inference wall-clock time |
| `real_time_factor` | ratio | inference_ms / capture_duration_ms (target < 1.0) |
| `postprocessing_ms` | ms | Token â†’ final text |
| `paste_ms` | ms | Text â†’ output injected |
| `total_perceived_latency_ms` | ms | trigger â†’ paste complete (primary metric) |

**Target baseline:** unknown. Measure first, set targets after.

### 3B â€” RAM Usage

| Metric | Unit | Description |
|---|---|---|
| `idle_ram_mb` | MB | App open, no dictation in progress |
| `ram_at_inference_mb` | MB | Peak RAM during STT inference |
| `ram_after_inference_mb` | MB | RAM 5s after inference completes |
| `model_loaded_ram_mb` | MB | RAM contribution of loaded model weights |
| `ram_delta_per_dictation_mb` | MB | Difference between idle and peak (leak indicator) |

**Target baseline:** unknown. Measure first.

### 3C â€” Transcription Quality

| Metric | Unit | Test case |
|---|---|---|
| `wer_french_short` | % WER | 5 French sentences, <10s each |
| `wer_english_short` | % WER | 5 English sentences, <10s each |
| `wer_quebec_accent` | % WER | 5 QuÃ©bÃ©cois phrases |
| `wer_code_dictation` | % WER | 5 code-like phrases (variable names, functions) |
| `punctuation_accuracy` | % correct | Commas, periods, question marks in 10 sentences |
| `proper_noun_accuracy` | % correct | 10 proper nouns (names, places, brands) |
| `noise_robustness` | % WER delta | WER in quiet vs. light background noise |

WER = Word Error Rate = (substitutions + deletions + insertions) / reference words Ã— 100

### 3D â€” Activation / Stability

| Metric | Unit | Description |
|---|---|---|
| `activation_success_rate` | % | Sessions reaching "ready" / total sessions |
| `activation_time_ms` | ms | App launch â†’ first "ready" state |
| `activation_failed_rate` | % | Sessions hitting "activation_failed" |
| `permission_prompt_rate` | % | Sessions requiring permission re-approval |
| `crash_rate_per_100_sessions` | count | Crashes per 100 dictation sessions |
| `model_ready_time_ms` | ms | Time from "ready" to first inference available |
| `checking_activation_timeout_rate` | % | Sessions where spinner never resolves |

### 3E â€” First Successful Dictation

| Metric | Unit | Description |
|---|---|---|
| `first_dictation_attempt_success_rate` | % | First ever dictation succeeds |
| `steps_to_first_dictation` | count | Actions required before first successful dictation |
| `first_dictation_total_time_ms` | ms | App install â†’ first successful paste |
| `abandonment_at_activation_rate` | % | Users who quit at activation screen |

---

## 4. Manual Benchmark Format (Phase 1)

Before automated benchmarks exist, the founder runs manual tests and records
results in a structured JSONL log.

### Manual benchmark session protocol

1. Close all other apps. Reboot if measuring cold state.
2. Open the app. Start a stopwatch.
3. Record each observation using the format below.
4. Append the record to `data/benchmark_observations.jsonl`.
5. After 5+ sessions, run `review_benchmarks.py` (V7 script, not yet built) to see trends.

### Manual observation record format

```json
{
  "date": "2026-04-24T14:00:00",
  "session_id": "manual-001",
  "observer": "founder",
  "machine": "Windows 11, 16GB RAM, Ryzen 7",
  "app_version": "git-sha",
  "cold_start": true,
  "activation_status_reached": "ready",
  "activation_time_ms": 4200,
  "trigger_to_paste_ms": 1850,
  "inference_ms": 980,
  "wer_test_phrase": "Bonjour, je m'appelle Jean.",
  "wer_reference": "Bonjour, je m'appelle Jean.",
  "wer_hypothesis": "Bonjour je m'appelle Jean",
  "wer_score": 0.14,
  "ram_idle_mb": 312,
  "ram_peak_mb": 580,
  "crash": false,
  "notes": "Activation spinner ran ~3.8s before ready. Paste was instant."
}
```

### Manual test scenarios (minimum 5 per session)

| # | Test | What to measure |
|---|---|---|
| M1 | Cold start â†’ activation â†’ first dictation | activation_time_ms, first_dictation_total_time_ms |
| M2 | Warm start â†’ dictation â†’ paste | trigger_to_paste_ms, inference_ms |
| M3 | Short French phrase (5â€“8 words) | wer_french_short |
| M4 | Short English phrase (5â€“8 words) | wer_english_short |
| M5 | Code-like phrase ("fonction handleRetry") | wer_code_dictation |
| M6 | Trigger activation_failed intentionally (disconnect internet) | activation_failed_rate, retry button behaviour |
| M7 | 10 consecutive dictations, record RAM before/after | ram_delta_per_dictation_mb (leak check) |

---

## 5. Future Automatic Benchmark Format (Phase 2)

Once manual baselines exist, V7 Phase 2 implements automatic measurement.

### Automatic benchmark architecture

```
benchmark_runner.py
  â”œâ”€â”€ reads: data/benchmark_config.json (test cases, reference texts)
  â”œâ”€â”€ controls: app via Tauri CLI flags or IPC (read-only, no product code change)
  â”œâ”€â”€ records: data/benchmark_results.jsonl (one record per test)
  â”œâ”€â”€ reports: outputs/benchmark_report.md
  â””â”€â”€ compares: against baseline in data/benchmark_baseline.jsonl
```

**Key constraint:** The benchmark runner reads from the app via existing CLI/IPC interfaces.
It does NOT instrument product code. If instrumentation is needed, it is a separate
V7.5 task requiring explicit founder approval and a `feat(app):` commit.

### Automatic benchmark record format

```json
{
  "date": "2026-04-24T14:00:00",
  "session_id": "auto-001",
  "runner": "benchmark_runner.py",
  "app_version": "706d6c0",
  "test_id": "latency_warm_french_short",
  "metric": "trigger_to_paste_ms",
  "value": 1340,
  "baseline": 1850,
  "delta_ms": -510,
  "delta_pct": -27.6,
  "pass": true,
  "threshold": 2000
}
```

---

## 6. Input Files

| Input | Path | Purpose |
|---|---|---|
| Brain config | `internal/brain/config/brain.config.json` | Safety rules |
| Benchmark config | `internal/brain/data/benchmark_config.json` | Test cases, thresholds (V7 Phase 2) |
| Manual observations | `internal/brain/data/benchmark_observations.jsonl` | Founder-recorded sessions |
| Baseline snapshot | `internal/brain/data/benchmark_baseline.jsonl` | Locked baseline for comparison |
| Applied patches log | `internal/brain/data/applied_patches.jsonl` | Link benchmark to product change |
| Handoff tasks log | `internal/brain/data/handoff_tasks.jsonl` | V6 benchmark_scope field drives which tests to run |

---

## 7. Output Files

| Output | Path | Written by |
|---|---|---|
| Manual observations | `internal/brain/data/benchmark_observations.jsonl` | Founder (manual) |
| Automatic results | `internal/brain/data/benchmark_results.jsonl` | `benchmark_runner.py` (Phase 2) |
| Baseline snapshot | `internal/brain/data/benchmark_baseline.jsonl` | `lock_benchmark_baseline.py` (Phase 2) |
| Benchmark report | `internal/brain/outputs/benchmark_report.md` | `review_benchmarks.py` |
| Comparison report | `internal/brain/outputs/benchmark_comparison.md` | `compare_benchmarks.py` (Phase 2) |

---

## 8. Data Formats

### `benchmark_observations.jsonl`
One JSON object per line. Fields:
```
date, session_id, observer, machine, app_version, cold_start,
activation_status_reached, activation_time_ms,
trigger_to_paste_ms, inference_ms,
wer_test_phrase, wer_reference, wer_hypothesis, wer_score,
ram_idle_mb, ram_peak_mb,
crash, notes
```
All timing fields are integers (milliseconds). All rate fields are floats (0.0â€“1.0).
Unknown values use `null`, not `0` or `""`.

### `benchmark_baseline.jsonl`
One record per metric. Locked by the founder after â‰¥5 manual sessions.
```json
{
  "date_locked": "2026-04-24",
  "locked_by": "founder",
  "metric": "trigger_to_paste_ms",
  "baseline_value": 1850,
  "sample_count": 7,
  "p50": 1820,
  "p95": 2100,
  "machine": "Windows 11, 16GB RAM, Ryzen 7",
  "app_version": "706d6c0"
}
```

### `benchmark_results.jsonl` (Phase 2)
One record per automated test run (see Section 5 for full format).

---

## 9. Safety Gates

All gates apply to both manual and automatic benchmark modes.

| Gate | Check | Failure action |
|---|---|---|
| G1 â€” Read-only | Benchmark scripts never write to `src/`, `src-tauri/`, `backend/` | Abort â€” log safety violation |
| G2 â€” No instrumentation | Benchmark runner does not modify product source to add timing hooks | Stop â€” flag as separate task |
| G3 â€” No model side-effects | Benchmark does not change model weights, config, or runtime state | Abort |
| G4 â€” No auth/license writes | Benchmark does not store credentials, tokens, or license data | Abort |
| G5 â€” Baseline locked | Comparison reports require a locked baseline; refuse if missing | Warn â€” run Phase 1 first |
| G6 â€” App version tagged | Every result record must include the `app_version` (git SHA) | Warn â€” record is unreliable |
| G7 â€” Observer identified | Manual records must identify `observer: "founder"` or named person | Warn â€” data provenance unclear |

---

## 10. Stop Conditions

| # | Condition | Action |
|---|---|---|
| S1 | No manual observations exist yet | Stop Phase 2 â€” complete â‰¥5 manual sessions first |
| S2 | Baseline not locked | Stop comparison reports â€” `lock_benchmark_baseline.py` must run first |
| S3 | Benchmark script would write to product files | Abort â€” log refusal |
| S4 | App version unknown (no git SHA) | Warn and record `app_version: "unknown"` â€” do not abort, but flag |
| S5 | WER test phrase and reference phrase are identical | Stop â€” trivial test, not meaningful |
| S6 | RAM delta per dictation > 50 MB across 5 sessions | Flag as memory leak â€” do not optimize until diagnosed |
| S7 | crash_rate_per_100_sessions > 5 | Stop other benchmark phases â€” stability must be fixed first |
| S8 | Benchmark runner requests product file write | Abort â€” gate G1 violation |
| S9 | Founder requests automated benchmark before manual baseline exists | Stop â€” manual first, automated second |

---

## 11. Future Implementation Steps

When the founder approves this design, the next tasks are:

### V7 Phase 1 â€” Manual Baseline (no scripts needed)

1. Founder runs â‰¥5 manual benchmark sessions using the M1â€“M7 test protocol (Section 4).
2. Records are appended to `data/benchmark_observations.jsonl` manually or via a simple append helper.
3. After â‰¥5 sessions, build `review_benchmarks.py`:
   - Reads `data/benchmark_observations.jsonl`
   - Computes p50/p95 for each metric
   - Writes `outputs/benchmark_report.md`
   - No product code touched

### V7 Phase 2 â€” Baseline Lock and Comparison (after Phase 1)

4. Build `lock_benchmark_baseline.py`:
   - Reads `data/benchmark_observations.jsonl`
   - Writes `data/benchmark_baseline.jsonl` (locked snapshot)
   - Founder approves with `--approve` flag
5. Build `compare_benchmarks.py`:
   - Reads a new `data/benchmark_results.jsonl` and the locked baseline
   - Computes delta per metric
   - Writes `outputs/benchmark_comparison.md`
   - Flags regressions (delta > +10% on latency, +5% on WER, +20% on RAM)

### V7 Phase 3 â€” Automated Runner (after Phase 2, separate planning_only task)

6. Design `benchmark_runner.py` â€” uses existing CLI/IPC interfaces only, no product instrumentation.
   - This is a separate `planning_only` design task before any implementation.

### File scaffold for Phase 1

Files to create before first manual session:
- `internal/brain/data/benchmark_observations.jsonl` (empty)
- `internal/brain/data/benchmark_baseline.jsonl` (empty)
- `internal/brain/data/benchmark_results.jsonl` (empty)
- `internal/brain/data/benchmark_config.json` (thresholds config)
- `internal/brain/outputs/benchmark_report.md` (empty placeholder)

---

## 12. Validation Commands for Future V7 Implementation

```bash
# After Phase 1 â€” review manual observations
python internal/brain/scripts/review_benchmarks.py

# After Phase 1 â€” lock baseline (requires --approve)
python internal/brain/scripts/lock_benchmark_baseline.py
python internal/brain/scripts/lock_benchmark_baseline.py --approve

# After Phase 2 â€” compare new results to baseline
python internal/brain/scripts/compare_benchmarks.py

# Compile check (after scripts are built)
python -m py_compile internal/brain/scripts/review_benchmarks.py
python -m py_compile internal/brain/scripts/lock_benchmark_baseline.py
python -m py_compile internal/brain/scripts/compare_benchmarks.py

# Confirm product code untouched
git diff src/
git diff src-tauri/
git diff backend/

# Confirm output files written
cat internal/brain/outputs/benchmark_report.md
cat internal/brain/outputs/benchmark_comparison.md
```

---

## 13. How V7 Prepares V8 Business Metrics Loop

V7 measures product fundamentals (latency, RAM, errors, activation).
V8 will connect those fundamentals to **business outcomes**.

V7 prepares V8 by:

### 13a â€” Benchmark scope field in handoff records
V6 already writes `benchmark_scope` to `data/handoff_tasks.jsonl`.
V7 reads this field to know which benchmark dimensions apply to each change.
V8 will read V7 benchmark results alongside conversion/retention data to
compute: "did this product change move the business metric?"

### 13b â€” app_version tagging
Every V7 benchmark record includes the `app_version` (git SHA).
V8 can join benchmark results to deployment events and business metrics
by matching git SHA â†’ deploy date â†’ conversion/retention window.

### 13c â€” Metric taxonomy alignment
V7 metric names are chosen to map cleanly to V8 business questions:

| V7 metric | V8 business question |
|---|---|
| `first_dictation_attempt_success_rate` | What % of new users activate on day 1? |
| `activation_failed_rate` | What % of sessions fail before first value? |
| `total_perceived_latency_ms` | Is speed a reason users churn? |
| `wer_french_short` | Is accuracy a reason French users churn? |
| `ram_delta_per_dictation_mb` | Are crashes on low-end machines blocking market segments? |

### 13d â€” What V8 must NOT inherit from V7
V8 must not assume correlation = causation.
A latency improvement that does not improve retention is not a business win.
V8 will require: baseline benchmark + business metric baseline + post-change
comparison of both, before declaring a win.

### 13e â€” Stop condition for V8
V8 must not be designed until:
1. â‰¥5 V7 manual benchmark sessions are complete.
2. V7 baseline is locked in `data/benchmark_baseline.jsonl`.
3. At least one product change has been benchmarked before and after.

---

## Summary

V7 is the measurement foundation that makes all future optimization trustworthy.

**What it does:** Measures the 5 product fundamentals in numbers, before any
optimization starts. Manual first, automated later.

**What it does not do:** Optimize, modify product code, instrument Rust runtime,
or run business metrics analysis (that is V8).

**Critical path:**
1. Run â‰¥5 manual sessions (Section 4, M1â€“M7 protocol)
2. Build `review_benchmarks.py` (reads observations, writes report)
3. Lock baseline with `lock_benchmark_baseline.py --approve`
4. After every V6 handoff product change: re-run benchmarks, compare to baseline

**The rule:**
> What is not measured cannot be optimized cleanly.
> V7 is what makes the rest of the system honest.
