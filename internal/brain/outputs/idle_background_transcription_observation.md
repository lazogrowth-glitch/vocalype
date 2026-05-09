# Vocalype V7 â€” Idle Background Transcription Observation

Date: 2026-04-24
Task type: measurement_task / planning_only
Status: Unconfirmed hypothesis â€” observation only. Do not optimize until root cause is confirmed.
Author: Vocalype Brain

> This document does NOT recommend implementation changes.
> It records an anomalous observation and frames a safe investigation protocol.

---

## 1. Evidence Summary

**Observation source:** Founder-reported, supported by log excerpt upload
**Machine:** AMD Ryzen 7 5800X, 32 GB RAM, RTX 4060, Windows
**App state at time of observation:** Idle â€” no intentional dictation being performed

| Signal | Value | Source |
|---|---|---|
| RAM at session start (idle) | 699 MB | Task Manager, Working Set |
| RAM after ~15 minutes idle | 809 MB | Task Manager, Working Set |
| RAM growth over ~15 minutes | **+110 MB** | Delta of above two readings |
| Background inference activity | Confirmed active | Log excerpt (see Section 2) |
| Founder dictation intent | None | Founder confirmed: "no dictation was being performed" |

**Preliminary severity: HIGH.**

A 110 MB RAM increase over 15 minutes of idle â€” with no user-initiated dictation â€”
suggests the app is running inference in the background continuously.
On a 32 GB machine this is tolerable short-term but unsustainable long-term.
On a low-RAM machine (8â€“16 GB) this would cause OS memory pressure and potential crashes.

---

## 2. Log Pattern Observed

The following log pattern was uploaded by the founder from a session where no dictation
was being performed:

```
[worker] processing chunk idx=83
[worker] processing chunk idx=84
...
[worker] processing chunk idx=99
Applying low-energy boost to Parakeet V3 input
Transcription completed in ~192ms
Transcription result is empty
Applying low-energy boost to Parakeet V3 input
Transcription completed in ~229ms
Transcription result is empty
Applying low-energy boost to Parakeet V3 input
Transcription completed in ~213ms
Transcription result is empty
[...]
```

**Pattern characteristics:**
- Repeats every **~1â€“2 seconds**
- Chunk indices increment continuously (idx=83, 84, ..., 99) â€” suggesting an open audio
  stream that keeps generating chunks
- Each chunk is processed through Parakeet inference (~192â€“229ms per chunk)
- Every result is **empty** â€” the model finds no speech in the audio
- `low-energy boost` is applied to every chunk â€” suggesting the VAD (Voice Activity
  Detection) is detecting very low or no energy but inference runs anyway

**Key implication:**
The app appears to be running inference on microphone audio chunks at approximately
**0.5â€“1.0 inferences per second** while idle, even when no dictation is triggered.
Each inference takes ~200ms and produces an empty result.

This is not a one-time occurrence â€” the chunk index progression (idx=83 through 99+)
confirms it has been running continuously for a sustained period.

---

## 3. RAM Growth Observed

| Time point | RAM (Working Set) | Delta |
|---|---|---|
| App idle, initial | 699 MB | baseline |
| App idle, ~15 min later | 809 MB | **+110 MB** |

**Rate:** ~7.3 MB/minute under idle background inference conditions.

**Extrapolation (hypothesis only â€” not confirmed):**
```
15 min  â†’ +110 MB   (observed)
30 min  â†’ +220 MB   (projected at same rate)
60 min  â†’ +440 MB   (projected)
120 min â†’ +880 MB   (projected â€” would total ~1580 MB on this machine)
```

Extrapolation is linear and assumes the same background pattern continues.
This is speculative. The actual growth rate may plateau, accelerate, or be intermittent.

---

## 4. Why This May Explain the Memory Growth

The observed log pattern (continuous inference on empty chunks) could cause RAM growth
through several mechanisms:

| Mechanism | Description | Probability |
|---|---|---|
| Audio buffer accumulation | The audio capture worker accumulates chunks faster than they are cleared â€” chunks pile up in a ring buffer or unbounded Vec | **Medium-High** â€” chunk idx increments without reset |
| Inference result accumulation | Empty transcription results are stored in history or a result queue that is never drained | **Medium** â€” unknown without code inspection |
| Rust allocator fragmentation | Repeated small allocations (200ms inference cycles) fragment the Rust heap â€” OS does not reclaim freed blocks | **Low-Medium** â€” common in long-running Rust allocators |
| Audio capture open indefinitely | The microphone stream opened at app start is never closed between "ready" and actual dictation â€” all ambient audio is treated as potential input | **Medium-High** â€” explains the continuous chunk generation |
| VAD threshold too low | Voice Activity Detection threshold set low enough that silence/ambient noise triggers inference on every chunk | **Medium** â€” `low-energy boost` appears every cycle |

**Most likely combination:**
The microphone is open continuously from "ready" state (ambient audio â†’ chunks).
VAD threshold allows chunks with near-zero energy to pass through (hence `low-energy boost`).
Each chunk runs Parakeet inference (~200ms, ~4â€“6% of real-time CPU/GPU).
Something in the result handling path (result buffer, history append, or audio buffer)
accumulates memory with each empty-result inference cycle.

---

## 5. Why This Is NOT Confirmed Yet

**This is an observation, not a diagnosis.**

| Unknown | Why it matters |
|---|---|
| Whether the microphone stream is intentionally open | The app may be designed to keep the mic open for low-latency activation â€” or it may be a bug where the stream never closes after a previous dictation |
| What happens to empty Transcription results | Are they stored in `transcription_history`? In a queue? Discarded? Unknown without code inspection |
| Whether chunk idx resets on each dictation | A single-session idx=83â€“99 may represent one long audio capture session, not multiple separate runs |
| Whether the RAM growth is from the audio buffer, the result buffer, or both | Task Manager shows total Working Set â€” it cannot distinguish between model memory, audio buffer, and result cache |
| Whether `low-energy boost` is the cause or a symptom | It may be a legitimate pre-processing step for quiet environments, not a sign of a bug |
| Whether this happens on all installs or only this machine | Microphone sensitivity, VAD calibration, and ambient noise levels affect chunk generation rate |

**1 observation is not a pattern.** This report records the observation.
It does not recommend any code change.

---

## 6. What NOT to Change Yet

| Area | Why not yet |
|---|---|
| VAD threshold | Raising it might fix the symptom but not the root cause â€” and could break low-volume dictation |
| Audio capture / microphone open/close logic | Root cause unknown â€” changing this could break dictation reliability |
| Parakeet inference pipeline | Inference itself is not the bug â€” it's being called unexpectedly, not broken |
| Chunk processing worker | The worker is functioning as designed â€” it processes what the audio capture sends |
| `chunk_cleanup` LLM step | Already known outlier driver â€” unrelated to this new observation |
| Empty-result handler | Do not add early-exit logic without understanding what consumes empty results |
| RAM allocation / Rust allocator | Not actionable without profiler data |

**The operating contract stop condition is clear:**
> Do not optimize until the mechanism is confirmed at code level via read-only inspection.

---

## 7. Candidate Areas to Investigate â€” Read-Only Only

In priority order. No code changes permitted.

### 7A â€” Audio capture lifecycle (highest priority)

**File:** `src-tauri/src/managers/audio.rs` (or equivalent)
**Questions:**
- When is the microphone stream opened? At app start? At dictation trigger? At "ready" state?
- When is it closed? After paste? After timeout? Never?
- Is there a condition where the stream stays open between dictations?

**Expected output:** A note confirming whether the mic is open continuously or per-dictation.

### 7B â€” VAD / chunk filtering

**File:** `src-tauri/src/managers/` (VAD manager or audio preprocessing)
**Questions:**
- What is the energy threshold for passing a chunk to inference?
- Does `low-energy boost` indicate the chunk would normally be filtered but is boosted anyway?
- What is the `min_energy` or `vad_threshold` config value?

**Expected output:** The config value and the code path that applies `low-energy boost`.

### 7C â€” Chunk worker loop and termination condition

**File:** `src-tauri/src/actions/transcribe.rs` or worker module
**Questions:**
- What is the termination condition for the chunk processing loop?
- Does the loop stop when no dictation is active, or does it run until the stream closes?
- Is there a `stop_signal` or `cancel_token` that should halt the worker between dictations?

**Expected output:** The loop structure and its stop condition.

### 7D â€” Empty result handling

**File:** `src-tauri/src/actions/transcribe.rs`, history manager
**Questions:**
- Are empty `Transcription result is empty` results written to `transcription_history`?
- Is there a growing buffer of empty results being held in memory?
- Does `chunk_cleanup` fire on empty results (would explain 24% fire rate in pipeline logs)?

**Expected output:** Whether empty results are stored, queued, or discarded.

### 7E â€” RAM growth measurement confirmation

**Manual action (no code inspection):**
1. Launch app. Record RAM (T=0).
2. Wait 5 minutes idle. Record RAM (T=5).
3. Wait 10 more minutes idle. Record RAM (T=15).
4. Compare growth rate.
5. Close Vocalype. Check if RAM is released to OS.

This confirms whether the growth is continuous, plateaus, or is a one-time spike.

---

## 8. Safe Next Measurement Protocol

Run the following before any code inspection or change:

### Phase A â€” Confirm the RAM growth pattern (manual, ~20 minutes)

```
1. Launch Vocalype. Wait for "ready".
2. Immediately open Task Manager â†’ vocalype.exe â†’ Working Set.
3. Record: app_idle_ram_mb at T=0.
4. Set a timer for 5 minutes. Do not interact with Vocalype.
5. Record: app_idle_ram_mb at T=5min.
6. Wait another 10 minutes. Record: app_idle_ram_mb at T=15min.
7. Record with:
   python internal/brain/scripts/add_benchmark_observation.py \
       --scenario possible_idle_background_transcription_loop \
       --metric app_idle_ram_mb \
       --value <reading> \
       --unit mb \
       --device windows_ryzen7_rtx4060 \
       --notes "idle T=Xmin, no dictation"
8. Check if vocalype.log is being written to during the idle period.
   (File size should grow if background inference is active.)
```

### Phase B â€” Log volume confirmation (no app interaction, 2 minutes)

```
1. While app is idle, check vocalype.log file size.
2. Wait 2 minutes.
3. Check vocalype.log file size again.
4. If file size grew: background inference is active and logging.
5. Record: note the growth rate in bytes/minute.
```

### Phase C â€” Confirm chunk_cleanup trigger correlation (analysis only)

```
1. Search vocalype.log for the time-of-day range when background inference was observed.
2. Check whether the idle background chunks appear in Pipeline profile entries.
3. If they do: background inference IS being counted in total_dictation_latency_ms.
   If they do not: it is a separate worker loop outside the profiler.
```

---

## 9. Recommended Next Handoff Type

**Type:** `investigation_only` (read-only source inspection)

**Scope:**
1. Read `src-tauri/src/managers/audio.rs` (or equivalent audio manager) in full.
   Answer: when is the mic opened and closed?
2. Read the VAD/chunk filtering path for the `low-energy boost` log line.
   Answer: what energy threshold gates chunkâ†’inference?
3. Read the chunk worker loop termination condition.
   Answer: does the worker run continuously when no dictation is active?

**Output:** `internal/brain/outputs/idle_background_transcription_diagnosis.md`
â€” answers to the 3 questions above, with file:line citations.

**What it is NOT:** An implementation task. No code changes.

**How to trigger when ready:**
```
Read-only investigation: idle background transcription loop in Vocalype.

Files to read (read-only, no changes):
  src-tauri/src/managers/audio.rs (or audio manager equivalent)
  src-tauri/src/managers/ â€” any VAD, chunk, or microphone manager
  src-tauri/src/actions/transcribe.rs â€” chunk worker loop structure

Questions to answer:
  1. When is the microphone stream opened? When is it closed?
     Is it open continuously between dictations?
  2. What is the energy threshold for chunkâ†’inference?
     What does 'low-energy boost' do and when does it apply?
  3. What is the termination condition for the chunk processing worker loop?
     Does it stop when no dictation is active?
  4. Are empty Transcription results stored anywhere (history, queue, buffer)?

Output: idle_background_transcription_diagnosis.md
Do NOT modify any file. Read-only.
```

---

## 10. Stop Conditions

**Do not investigate source code until:**
- [ ] RAM growth pattern confirmed across â‰¥3 timed readings (Phase A above)
- [ ] Log growth during idle confirmed (Phase B above)
- [ ] Founder confirms the background inference observation is reproducible

**Do not propose any code change until:**
- [ ] Source inspection confirms the audio stream lifecycle (Section 7A)
- [ ] Empty result handling is understood (Section 7D)
- [ ] V7 baseline is locked (all 10 priority metrics â‰¥5 obs)
- [ ] The change scope can be expressed as a single narrow file change
- [ ] Founder approves investigation handoff explicitly

**Do not treat this as higher priority than V7 baseline completion:**
- The existing paste_execute proposal (product_patch_proposal_report.md) remains valid
- This new observation adds an additional investigation candidate
- Both are blocked until baseline is locked

---

## Summary Card

```
IDLE BACKGROUND TRANSCRIPTION OBSERVATION (2026-04-24)
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
Device:   Windows, Ryzen 7 5800X, RTX 4060
App state: Idle â€” no intentional dictation

RAM:
  699 MB â†’ 809 MB over ~15 minutes idle
  +110 MB growth, ~7 MB/min rate
  No dictation performed by founder

Log pattern (while idle):
  [worker] processing chunk idx=83..99 (continuously)
  Applying low-energy boost to Parakeet V3 input
  Transcription completed in ~192-229ms
  Transcription result is empty
  â†³ Repeating every ~1-2 seconds

Hypothesis:
  Microphone stream may be open continuously from "ready" state.
  VAD allows low-energy ambient chunks through to inference.
  Something in result/buffer handling accumulates per empty-result cycle.

Confidence: LOW â€” 1 observation, root cause unknown at code level

PRIORITY vs paste_execute:
  This is a NEW candidate, equally important to investigate.
  Neither should be optimized before baseline is locked.

NEXT ACTION:
  Confirm RAM growth pattern across â‰¥3 timed readings (Phase A).
  Confirm log file grows during idle (Phase B).
  Then run read-only source inspection (Section 9).
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
```

---

*This report is measurement_task / planning_only. No product code was modified or proposed.*
*Source: founder observation, Task Manager readings, uploaded log excerpt.*
*Observations recorded in: `data/benchmark_observations.jsonl`*
