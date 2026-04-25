# Vocalype Brain — V7 Final Status Report

Date: 2026-04-24
Task type: planning_only
Author: Vocalype Brain
Status: V7 Phase 1 complete. Phase 2 not started. Baseline not locked.

> This document does NOT recommend implementation changes.
> It closes V7 Phase 1 as a measurement phase and frames what V8 must be.

---

## 1. What V7 Completed

V7 was designed to establish **baseline reality** for 5 product fundamentals:
latency, RAM, transcription quality, activation stability, and first dictation.

**What V7 fully completed:**

| Deliverable | Status | Notes |
|---|---|---|
| `v7_design_plan.md` — 13-section benchmark architecture | ✅ Done | Planning only, no scripts implied |
| `add_benchmark_observation.py` — CLI observation recorder | ✅ Done | Validated, committed |
| `review_benchmarks.py` — report generator | ✅ Done | Validated, generates benchmark_report.md |
| `manual_benchmark_needed.md` — M1 session guide | ✅ Done | Machine profile, protocol, exact commands |
| Historical data mining — SQLite history.db + WAV files | ✅ Done | 1124 records inspected, WAV durations extracted |
| Persisted log search — vocalype.log discovery | ✅ Done | 157 KB, 43 Pipeline profile entries found |
| `pipeline_logs_search_report.md` — log extraction report | ✅ Done | Step breakdowns, raw log lines, 38 complete runs |
| `benchmark_report.md` — auto-generated baseline readiness | ✅ Done | 37 observations, 2/10 metrics covered |
| `v7_bottleneck_hypothesis.md` — 10-section hypothesis report | ✅ Done | H1 paste-bound (medium-high), H2 chunk_cleanup (high) |
| `product_patch_proposal_report.md` — investigation proposal | ✅ Done | paste_execute investigation, type: investigation_only |

**What V7 did NOT complete (by design):**

| Deliverable | Status | Reason |
|---|---|---|
| `lock_benchmark_baseline.py` — Phase 2 script | ❌ Not built | 8/10 metrics still at 0 obs — premature |
| `compare_benchmarks.py` — Phase 2 script | ❌ Not built | No baseline to compare against |
| `benchmark_baseline.jsonl` — locked baseline | ❌ Not created | Requires ≥5 obs for all 10 metrics |
| M1–M7 manual sessions — RAM, WER, activation | ❌ Not run | Requires app to be running; deferred to next session |
| paste_execute root-cause investigation | ❌ Not run | Per contract: no product code inspection in planning phase |
| V7 Phase 3 — automated benchmark runner | ❌ Not designed | Requires Phase 2 first |

**V7 goal compliance:**

V7's stated purpose was: *"Measure. Do not optimize."*
That contract was honored. No product code was modified, proposed for modification,
or auto-applied at any point during V7.

---

## 2. What Real Product Measurements Were Collected

**Source:** `%LOCALAPPDATA%\com.vocalype.desktop\logs\vocalype.log` (157 KB, auto-discovered)
**Total observations recorded:** 37 (in `data/benchmark_observations.jsonl`)
**Machine:** AMD Ryzen 7 5800X, 32 GB RAM, NVIDIA RTX 4060, Windows
**Model:** `parakeet-tdt-0.6b-v3-multilingual` (639.6 MB on disk)

### Pipeline Timing (38 complete runs)

| Step | Median | Max | Consistency |
|---|---|---|---|
| `stop_recording` | 11 ms | 23 ms | Very stable |
| `chunk_finalize_and_assemble` | 303 ms | 886 ms | Variable — includes inference |
| `chunk_cleanup` (LLM optional) | 0 ms | 3320 ms | Fires 9/38 runs (24%) |
| `dictionary_replacement` (optional) | 0 ms | 446 ms | Fires 17/38 runs (45%) |
| `paste_execute` | **645 ms** | 687 ms | **Remarkably constant — ±35 ms across 38 runs** |
| **TOTAL (post-recording)** | **1043 ms** | **4747 ms** | p95 driven by chunk_cleanup |

### Per-Chunk STT Inference (63 samples)

| Stat | Value |
|---|---|
| p50 | 230 ms |
| p95 | 459 ms |
| min | 178 ms |
| max | 565 ms |
| Real-time factor | ~0.06x (well under 1.0x — faster than real time) |

### Startup Timing (7 launches, from `[startup]` log lines)

| Step | Range | Average |
|---|---|---|
| `initialize_core_logic` | 30–44 ms | 35 ms |
| `Microphone stream initialized` | 139–239 ms | 197 ms |
| Model pre-warm (async) | Not logged | Unknown |

### Audio Capture Duration (3 WAV files)

| Stat | Value |
|---|---|
| min | 1831 ms |
| median | 3871 ms |
| max | 7410 ms |

---

## 3. What Benchmark Baselines Are Ready

A baseline is ready when ≥5 observations exist for a metric.

| Metric | Observations | Baseline Ready | Notes |
|---|---|---|---|
| `total_dictation_latency_ms` | **9** | ✅ **Yes** | p50=1043ms, p95=2405ms, min=717ms |
| `stt_inference_time_ms` | **20** | ✅ **Yes** | p50=230ms, p95=459ms, min=178ms |
| `paste_latency_ms` (extra, not priority) | 5 | ✅ Yes (extra) | mean=652ms, range 618–687ms |
| `capture_duration_ms` (extra, partial) | 3 | ❌ No | Only 3 samples — not priority metric |

**2 of 10 priority metrics are at baseline.**

---

## 4. What Benchmark Baselines Are Still Missing

| Metric | Observations | Gap | How to Collect |
|---|---|---|---|
| `model_load_time_ms` | 0 | 5 needed | Cold start stopwatch — app launch → "ready" |
| `app_idle_ram_mb` | 0 | 5 needed | Task Manager → vocalype.exe → Working Set (no dictation) |
| `ram_during_transcription_mb` | 0 | 5 needed | Task Manager peak during spinner |
| `ram_after_transcription_mb` | 0 | 5 needed | Task Manager 5s after paste |
| `wer_percent` | 0 | 5 needed | Dictate 5 known French phrases; compare output |
| `cer_percent` | 0 | 5 needed | Same as WER, character-level |
| `first_successful_dictation_time_ms` | 0 | 5 needed | Fresh session — app open → first successful paste |
| `activation_success_rate` | 0 | 5 needed | Run 5 launches; count how many reach "ready" without retry |

**8 of 10 priority metrics have 0 observations.**

All 8 require the app to be running. They cannot be collected from persisted logs.
They require a ~30-minute manual session (M1 protocol in `manual_benchmark_needed.md`).

---

## 5. What Product Insight Was Discovered

**Primary insight (H1 — confirmed medium-high confidence):**

> The Vocalype dictation pipeline on this machine is **paste-bound, not inference-bound.**

```
Pipeline p50 breakdown (38 runs):
  inference (chunk_finalize)  303 ms   29%
  paste_execute               645 ms   62%  ← DOMINANT
  other                        95 ms    9%
  TOTAL                      1043 ms  100%
```

Parakeet inference completes in a median of **230 ms per chunk** — a real-time factor
of ~0.06x. The model is fast. The bottleneck is clipboard/keyboard injection.

**Theoretical impact:**
```
If inference → 0 ms:               ~740 ms  (+30% gain)
If paste     → 300 ms:             ~698 ms  (+33% gain)
If paste     → 100 ms:             ~450 ms  (+57% gain)  ← highest leverage
```

Improving inference speed (model quantization, batching, etc.) has *lower expected
impact* than addressing the paste mechanism. This is a non-obvious, data-driven
finding that changes optimization priority.

**Secondary insight (H2 — high confidence):**

> `chunk_cleanup` is the **tail-latency driver.** It fires in 24% of runs
> (9/38) and accounts for 100% of p95+ outliers.

```
When chunk_cleanup = 0 ms: p95 ≈ 1550 ms
When chunk_cleanup fires:  p95 → 2405–4747 ms
```

The trigger condition for chunk_cleanup is not yet known from logs alone.

**What this means for product strategy:**

The two highest-impact optimization targets are:
1. `paste_execute` — constant 645ms overhead, reducible without any model change
2. `chunk_cleanup` — 24% of runs hit tail latency; fixing trigger condition or gating
   would bring p95 from ~2400ms to ~1550ms

Neither should be touched until (a) the mechanism is understood at code level and
(b) the baseline is fully locked.

---

## 6. What Product Patch Proposal Was Generated

**Title:** `Investigate: paste_execute latency (645ms constant)`
**Type:** `investigation_only` — read-only source inspection
**File:** `vocalype-brain/outputs/product_patch_proposal_report.md`
**JSONL:** `vocalype-brain/data/product_patch_proposals.jsonl` (2nd entry)

The proposal authorizes a read-only investigation of:
- `src-tauri/src/actions/paste.rs` — full paste mechanism
- `src-tauri/Cargo.toml` + `Cargo.lock` — Enigo version
- `src-tauri/src/actions/profiler.rs` — timing window boundaries

It answers 6 diagnostic questions:
1. What Enigo method is called for each plan type?
2. Is there a `sleep()` or deliberate delay in the paste path?
3. What Enigo version is in use?
4. Does the paste_execute window include clipboard write + key injection?
5. Is ClipboardOnlyBasic also ~645ms?
6. Is there a rate-limit, debounce, or settle-wait?

**This proposal does NOT authorize any code change.**
The investigation must complete before any implementation handoff can be created.

**Stop conditions for the proposal (7 gates, currently 0/7 met):**
- [ ] Investigation report confirms paste mechanism (read-only)
- [ ] Baseline locked (all 10 priority metrics ≥5 obs)
- [ ] paste_latency confirmed on ≥2 device profiles
- [ ] paste_success_rate measured (currently unmeasured)
- [ ] chunk_cleanup trigger condition understood
- [ ] founder approves implementation handoff
- [ ] V7 Phase 2 complete (compare_benchmarks.py built)

---

## 7. Is V7 Complete Enough to Move to V8?

**Verdict: NO. V7 Phase 1 is complete. V7 Phase 2 has not started.**

Per the V7 design plan (Section 13e), V8 must not be designed until:

| V8 gate | Status |
|---|---|
| ≥5 V7 manual benchmark sessions complete | ❌ Not met — 8/10 metrics at 0 obs |
| V7 baseline locked in `benchmark_baseline.jsonl` | ❌ Not met — requires script + ≥5 obs per metric |
| At least one product change benchmarked before AND after | ❌ Not met — no patches applied |

**What IS complete:**

V7 Phase 1 achieved more than originally planned because the persisted log file
was discovered, providing 38 complete pipeline profile runs without any manual
session being required. This is a genuine win: two priority metrics are at baseline,
a bottleneck hypothesis exists at medium-high confidence, and an investigation proposal
is written and ready.

**Phase 1 was designed for 5 manual sessions before any script was built.**
What happened instead was better: automated log mining gave 38 runs instantly,
and the bottleneck was identified from real data.

**However**, RAM, WER, activation, and model load time are still at 0 observations.
These are not optional — they are priority metrics that could reveal a worse problem
than paste latency (e.g., memory leaks, crashes on low-end hardware, poor French WER).

---

## 8. What V8 Should Be

V8 is not yet ready to be designed. This section describes what it should contain
once V7 Phase 2 is complete and the baseline is locked.

**V8 primary goal:**
Connect V7 product measurements to **business outcomes**.

A latency improvement that does not improve retention is not a business win.
V8's job is to answer: "Did this product change move the North Star metric?"

**V8 components:**

| Component | What it does |
|---|---|
| `benchmark_baseline.jsonl` (from V7 Phase 2) | Locked before/after reference point |
| Business metric baseline | retention_rate, activation_rate, dictations_per_week — from Supabase |
| `compare_benchmarks.py` (from V7 Phase 2) | Before/after delta per product metric |
| V8 correlation layer | Join benchmark delta to business metric delta by git SHA + deploy date |
| V8 win/regression report | Did benchmark improvement correlate with business metric improvement? |

**V8 first candidate (if paste investigation succeeds):**
Apply paste_execute optimization → re-run benchmarks → compare to V7 baseline → 
check if latency improvement correlates with user retention improvement in Supabase.

**V8 must NOT:**
- Assume a product benchmark win = a business win
- Be designed before V7 Phase 2 is complete
- Skip the baseline-lock step

---

## 9. What Should NOT Be Done Yet

| Action | Why not |
|---|---|
| Implement paste_execute optimization | Root cause unknown. Investigation not run. |
| Investigate `chunk_cleanup` trigger | Baseline not locked. 8/10 metrics unmeasured. |
| Optimize Parakeet inference (quantization, batching) | It is NOT the bottleneck. 230ms median. Low impact. |
| Lock baseline (`lock_benchmark_baseline.py`) | Script not yet built. 8/10 metrics still at 0 obs. |
| Run `compare_benchmarks.py` | Script not yet built. |
| Design V8 | V7 Phase 2 gates not met. |
| Add instrumentation to product code | Brain cannot modify product code. Separate V7.5 task if needed. |
| Modify WER evaluation methods | No reference baseline exists yet. |
| Optimize model load time | `model_load_time_ms` is unmeasured — may not be a problem. |
| Run automated benchmark runner | Phase 3 not designed. Manual baseline first. |

---

## 10. Recommended Exact Next Phase

**Phase: V7 Phase 1 Completion — Manual Metric Collection**

This is the only unblocked next step. It requires ~30 minutes and no code changes.

### Immediate next action: M1 Manual Session

Run the following in one session:

```
Step 1:  Launch Vocalype in dev mode:
           bun run tauri dev
         
         Start a stopwatch immediately at launch.
         Stop the stopwatch when the UI reaches "ready" state.
         Record as model_load_time_ms.

Step 2:  Open Task Manager → Details tab → vocalype.exe
         Record Working Set (Memory) while app is idle (no dictation).
         Record as app_idle_ram_mb.

Step 3:  Trigger a 3–5s dictation.
         While the spinner shows (transcribing), note peak RAM in Task Manager.
         Record as ram_during_transcription_mb.

Step 4:  5 seconds after the text pastes, record RAM in Task Manager.
         Record as ram_after_transcription_mb.

Step 5:  Dictate 5 known French reference phrases.
         Compare output text to reference.
         Record wer_percent for each phrase, then average.

Step 6:  Close and relaunch app 5 times. 
         Count how many launches reach "ready" without retry.
         Record as activation_success_rate (e.g., 5/5 = 1.0).

Step 7:  Record all observations using:
           python vocalype-brain/scripts/add_benchmark_observation.py \
               --scenario <scenario> \
               --metric <metric> \
               --value <value> \
               --unit <ms|mb|percent> \
               --device windows_ryzen7_rtx4060 \
               --model parakeet-tdt-0.6b-v3-multilingual

Step 8:  After all observations recorded:
           python vocalype-brain/scripts/review_benchmarks.py
         Check how many of the 10 priority metrics now have ≥5 observations.
```

### After M1 session: V7 Phase 2

Once all 10 priority metrics have ≥5 observations:

```
1. Build lock_benchmark_baseline.py (new script — not yet created)
2. Run: python vocalype-brain/scripts/lock_benchmark_baseline.py
3. Run: python vocalype-brain/scripts/lock_benchmark_baseline.py --approve
   This creates data/benchmark_baseline.jsonl — the locked V7 baseline.
4. Build compare_benchmarks.py (new script — not yet created)
```

### After Phase 2: Run paste_execute investigation

```
Trigger the approved investigation from product_patch_proposal_report.md Section 10.
Read paste.rs in full.
Output: vocalype-brain/outputs/paste_mechanism_diagnosis.md
```

### After paste investigation: V8 planning

Only after:
- [ ] All 10 priority metrics at ≥5 observations
- [ ] Baseline locked
- [ ] paste_execute root cause confirmed
- [ ] Founder approves implementation handoff

---

## Summary Card

```
V7 FINAL STATUS (2026-04-24)
────────────────────────────────────────────────────────────────
Phase 1:   COMPLETE (scripts built, 37 obs, 2/10 metrics ready)
Phase 2:   NOT STARTED (lock_benchmark_baseline.py not built)
Baseline:  NOT LOCKED
V8 gates:  0/3 met

Key product insight discovered:
  Pipeline is PASTE-BOUND, not inference-bound
  paste_execute = 645ms constant = 62% of p50 latency
  Inference = 230ms median (fast — not the bottleneck)
  Tail latency cause: chunk_cleanup (fires 24%, up to 3320ms)

Metrics at baseline:
  total_dictation_latency_ms   ✅  p50=1043ms  (9 obs)
  stt_inference_time_ms        ✅  p50=230ms   (20 obs)

Metrics missing (0 obs):
  model_load_time_ms           ❌
  app_idle_ram_mb              ❌
  ram_during_transcription_mb  ❌
  ram_after_transcription_mb   ❌
  wer_percent                  ❌
  cer_percent                  ❌
  first_successful_dictation_time_ms  ❌
  activation_success_rate      ❌

Product code touched: NO (never, throughout V7)
Investigation proposals: 1 (paste_execute — investigation_only, pending)
Commits (brain): 7 (design → scripts → data → reports → hypothesis → proposal)

NEXT ACTION:
  Run M1 manual session (~30 min) to collect 8 missing metrics.
  Then build lock_benchmark_baseline.py (V7 Phase 2).
  Then run paste_execute investigation (read-only).
  Then design V8 (not yet).
────────────────────────────────────────────────────────────────
```

---

## Commit History (V7 Brain Work)

| Commit | Description |
|---|---|
| (early) | feat(brain): V7 design plan |
| (early) | feat(brain): add V7 Phase 1 manual benchmark recorder |
| aa7607d | feat(brain): add V7 manual benchmark discovery report |
| dc97d12 | feat(brain): commit V7 historical benchmark observations |
| f759ae4 | feat(brain): commit V7 persisted PipelineProfiler benchmark results |
| 2604546 | feat(brain): add V7 bottleneck hypothesis report |
| 4e75109 | feat(brain): add V7 paste_execute investigation proposal |
| (this) | docs(brain): V7 final status report |

**Product code commits during V7: 0.**

---

*This report is planning_only. No product code was modified or proposed for modification.*
*All measurements derived from: `%LOCALAPPDATA%\com.vocalype.desktop\logs\vocalype.log`,*
*`data/benchmark_observations.jsonl`, WAV file metadata, SQLite history.db.*
