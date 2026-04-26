# Idle Background Inference Loop — Diagnosis Result

Date: 2026-04-26
Task type: measurement_task / result_recording
Source: Investigation mission + local settings inspection
Author: Claude Code (Sonnet 4.6)

---

## Setting Inspection Result

**File inspected:** `%APPDATA%\com.vocalype.desktop\settings_store.json`

| Field | Value |
|---|---|
| `wake_word_enabled` | **false** |
| `always_on_microphone` | **true** |
| `model_unload_timeout` | **"never"** |
| `selected_model` | `parakeet-tdt-0.6b-v3-multilingual` |

No secrets, auth tokens, license data, or private user data were read or reported.

---

## Root Cause Confirmation

### RC-1 — Wake-word idle inference loop

**Status: NOT CONFIRMED for this machine.**

`wake_word_enabled = false` means the wake-word poll thread (`run_wake_word_loop`) is
never started. The silence-gate fix (Fix A from the diagnosis) is a valid architectural
improvement but is NOT the cause of the observed behaviour on the founder's machine.

### RC-2 — Stuck recording session

**Status: CONFIRMED as primary cause for this machine.**

`always_on_microphone = true` means the microphone stream is permanently open. When a
recording session is started (hotkey press), the chunking sampler runs continuously until
`snapshot_recording()` returns `None`. The observed log pattern:

```
[worker] processing chunk idx=83..99
Applying low-energy boost to Parakeet V3 input
Transcription completed in ~192-229ms
Transcription result is empty
```

is produced by the chunking worker in `actions/transcribe.rs:846`, which only runs
during an active recording session. Chunk idx=83–99 confirms the session had been
running for a very long time (many VAD-gated ambient audio cycles).

With `always_on_microphone = true`, the Silero VAD (threshold=0.28, hangover=20 frames
= 600 ms for Parakeet V3, defined in `managers/audio.rs:255–261`) occasionally classifies
ambient noise as speech during the hangover window. These frames accumulate in
`processed_samples`. Once enough speech-classified samples reach the chunk interval
(`PARAKEET_V3_MULTI_CHUNK_INTERVAL_SAMPLES = 8 × 16,000 = 128,000 samples`, from
`chunking.rs:53`), a chunk is dispatched and inference runs. Each chunk of ambient audio
returns an empty result.

**The recording session was never stopped.** The stop was either:
- Never triggered (user left a recording running)
- Silently dropped by the binding_id mismatch guard at `transcribe.rs:1169–1176`
- Interrupted during wake-word auto-stop (unlikely — wake_word is disabled)

### RAM Growth for this machine

With `model_unload_timeout = "never"`, the Parakeet V3 model stays resident by design.
RAM growth comes from:
1. Per-chunk heap allocations in the stuck worker (Vec copies + Parakeet ONNX tensors)
2. `processed_samples` slowly growing as VAD-classified ambient frames accumulate
   (bounded by `MAX_PROCESSED_SAMPLES = 16,000 × 300 = 4.8M samples = ~19 MB` at
   `recorder.rs:424`, but drain keeps it trimmed)
3. Windows heap fragmentation from repeated ~500 KB–3 MB allocation/free cycles

---

## Decision

| Question | Answer |
|---|---|
| `wake_word_enabled` | **false** |
| Setting source | `%APPDATA%\com.vocalype.desktop\settings_store.json` |
| RC-1 (wake-word loop) confirmed active? | **No** |
| RC-2 (stuck recording session) still relevant? | **Yes — primary cause** |

**Recommendation: Investigate stuck recording session (RC-2) before any wake-word patch.**

### Next action

**Task type:** `investigation_only` → then `implementation_task`

**Focus:** Why does a recording session fail to stop cleanly?

**Investigation targets (read-only):**

1. `src-tauri/src/actions/transcribe.rs:1149–1176` — `stop_transcription_action`: the
   binding_id mismatch guard silently ignores stops when the active binding doesn't match.
   If the coordinator's `active_binding_id` is stale or mismatched, stop is a no-op.

2. `src-tauri/src/runtime/transcription_coordinator.rs` — `send_input` debounce at line
   121: if two stop signals arrive within 30 ms (`DEBOUNCE = Duration::from_millis(30)`),
   the second is dropped. A rapid double-press could miss the stop.

3. Sampler termination: the sampler exits only when `snapshot_recording()` returns `None`.
   If `RecordingState` never returns to `Idle`, the sampler runs forever. This would
   happen if `stop_recording()` in `audio.rs:791` never gets called.

**Minimum safe fix (plain English, no code):**
Add a maximum session duration guard in the chunking sampler thread — if the session has
been running for more than N minutes (suggested: 10 minutes) and has produced zero
non-empty chunks in the last 2 minutes, send the `None` sentinel and exit. This is a
defensive backstop against stuck sessions; it does not fix the root cause (why stop is
missed) but prevents unbounded RAM growth.

**Additional improvement (valid regardless of this machine's settings):**
Fix A (silence gate before wake-word inference) from the diagnosis remains valid as a
general architectural improvement for all machines where `wake_word_enabled = true`.
File for future implementation, not immediate.

---

## Files Modified by This Mission

- `vocalype-brain/outputs/idle_background_transcription_diagnosis.md` — written (previous step)
- `vocalype-brain/outputs/idle_background_diagnosis_result.md` — this file
- `vocalype-brain/data/results.jsonl` — new entry appended
- `vocalype-brain/outputs/results_report.md` — updated
- `vocalype-brain/memory/current_state.md` — updated
- `vocalype-brain/memory/lessons_learned.md` — new entry

---

*No product code modified. No src-tauri/, src/, backend/ files touched.*
*Founder review required before implementation is authorized.*
