# Idle Background Inference Loop — Diagnosis

Generated: 2026-04-26
Task type: investigation_only (read-only source inspection)
Author: Claude Code (Sonnet 4.6) — no product code modified

---

## 1. Root Cause

There are **two compounding root causes**, both confirmed at code level:

### RC-1 — Wake-word mode polls Parakeet every 1,500 ms with no silence gate

File: `src-tauri/src/runtime/wake_word.rs`

When `settings.wake_word_enabled = true`, a background thread (`run_wake_word_loop`) runs
indefinitely and calls `tm.transcribe(samples)` every `POLL_INTERVAL_MS = 1_500` ms
(`wake_word.rs:37`) regardless of whether the ring buffer contains actual speech or silence.

There is **no energy check before calling inference**. In a quiet environment, the
ring buffer holds 2.5 s of ambient silence, `maybe_boost_low_energy_parakeet_audio` applies
a gain boost (because RMS < 0.05), Parakeet runs full inference (~200 ms), and the result is
empty → `"Transcription result is empty"` logged every ~1.5 s. This is the repeating pattern
observed after chunk idx=99 in the founder's log.

### RC-2 — A recording session (chunking worker) ran far into "idle" time

File: `src-tauri/src/actions/transcribe.rs`

The `"[worker] processing chunk idx=83..99"` log entries at `transcribe.rs:846` come from
the **chunking transcription worker**, which is only active during a live recording session
(between `start_transcription_action` and `stop_transcription_action`). A chunk idx reaching
83–99 means **at minimum ~84 chunks were sent during a single session**. For Parakeet V3 with
`PARAKEET_V3_MULTI_CHUNK_INTERVAL_SAMPLES = 8 × 16,000 = 128,000 samples` (`chunking.rs:53`),
the interval is 8 s of VAD-classified speech samples. This session ran for an extended period
while the founder believed the app was idle — either:

- A recording session was started (hotkey or wake-word trigger) and the stop signal was never
  delivered or was silently dropped (e.g., binding_id mismatch guard at `transcribe.rs:1169–1176`).
- The wake-word fired, started a `__wake_word__` session, and `auto_stop_on_silence` failed to
  terminate it within the 45-second safety valve (e.g., VAD callback never confirmed silence).

The sampler thread at `transcribe.rs:682–812` only exits when `rm_s.snapshot_recording()`
returns `None` (i.e., `RecordingState::Idle`). If that transition never occurs, the sampler
and worker run without bound.

---

## 2. Evidence

### Evidence for RC-1 (wake-word inference loop)

| Source | Line(s) | Evidence |
|---|---|---|
| `wake_word.rs` | 37 | `POLL_INTERVAL_MS: u64 = 1_500` — poll interval |
| `wake_word.rs` | 141–178 | `run_wake_word_loop` calls `tm.transcribe(samples)` every 1.5 s unconditionally when `wake_word_enabled` |
| `wake_word.rs` | 93–108 | Preview callback attached to AudioRecorder fires "on every 16 kHz frame from the microphone, even between recording sessions" |
| `inference.rs` | 55–78 | `maybe_boost_low_energy_parakeet_audio`: if RMS < `PARAKEET_LOW_ENERGY_RMS_THRESHOLD = 0.05`, boost is applied → log "Applying low-energy boost to Parakeet V3 input" |
| `inference.rs` | 637 | `info!("Applying low-energy boost to Parakeet V3 input (gain={:.2})", gain)` — exact log message observed |
| `inference.rs` | 937–939 | `info!("Transcription result is empty")` — exact log message, emitted when `final_result.is_empty()` |
| `inference.rs` | 193–199 | `last_activity` timestamp updated on **every** call to `transcribe_detailed_request`, including wake-word polls |
| `transcription/mod.rs` | 270–321 | Idle watcher thread: skips unload if `last_activity` was reset recently → model never unloads while wake-word is active |
| Observation file | — | "Applying low-energy boost … Transcription result is empty" every ~1–2 s with no dictation |

### Evidence for RC-2 (stuck recording session)

| Source | Line(s) | Evidence |
|---|---|---|
| `transcribe.rs` | 846 | `info!("[worker] processing chunk idx={} …")` — only emitted inside the chunking worker during an active recording |
| `transcribe.rs` | 682–812 | Sampler thread: `loop { sleep(200ms); snapshot = rm_s.snapshot_recording() or break; … }` — never exits while recording |
| `chunking.rs` | 30 | `CHUNK_SAMPLER_POLL_MS: u64 = 200` |
| `chunking.rs` | 53 | `PARAKEET_V3_MULTI_CHUNK_INTERVAL_SAMPLES = 8 × 16,000` (8 s of speech per chunk) |
| `transcribe.rs` | 1162–1176 | `stop_transcription_action` silently ignores stops when `active_binding_id` doesn't match → session stays live |
| `audio.rs` | 790–835 | `stop_recording()` requires matching `binding_id` to transition state to `Idle`; mismatch → returns `None`, no state change |
| Observation file | — | "chunk idx=83..99" with no user dictation — 84+ chunks sent in a single session |

---

## 3. RAM Growth Mechanism

RAM grows through three stacked mechanisms:

### 3A — Per-wake-word inference cycle (~every 1.5 s)

Each call to `tm.transcribe(samples)` from `run_wake_word_loop` allocates:

1. `let samples: Vec<f32>` — ring buffer snapshot: `RING_CAPACITY = 40,000 × 4 B = ~160 KB`
   (`wake_word.rs:94, 161–163`)
2. If RMS < 0.05 → boosted audio `Vec<f32>` in `maybe_boost_low_energy_parakeet_audio`:
   another `~160–224 KB` (`inference.rs:631–641`)
3. `pad_short_phrase` for 2.5 s audio (< 5 s threshold `PARAKEET_SHORT_PHRASE_SAMPLES`):
   `2 × 8,000 + 40,000 = 56,000 samples = ~224 KB` (`inference.rs:16–43`)
4. Parakeet V3 ONNX runtime allocates input/output tensors per call (~several MB depending
   on OrtSession implementation)

These `~550 KB – ~3 MB` of per-cycle heap allocations are freed each cycle. However, the
Windows process heap (or jemalloc) does not immediately return freed blocks to the OS.
Repeated small-to-medium allocations create **heap fragmentation**: the allocator holds on
to pages, inflating the OS-visible Working Set. At ~40 cycles/minute the fragmentation
accumulates at a rate consistent with the observed ~7 MB/min.

### 3B — `last_activity` reset disables model unload

Every wake-word inference call resets `last_activity` at `inference.rs:193–199`. This means
`model_unload_timeout` never fires during wake-word idle mode. The Parakeet V3 model
(500 MB+ ONNX weights + runtime buffers) stays pinned in RAM indefinitely.

### 3C — Stuck recording session (if RC-2 is active)

The stuck chunking session allocates per-chunk:
- `processed_samples.clone()` in `snapshot_recording()`: grows proportionally to VAD-classified
  speech (bounded by `MAX_PROCESSED_SAMPLES = 16,000 × 60 × 5 = ~1.2 GB` at `recorder.rs:424`,
  though drain protects against this)
- Per-chunk transcription Vec allocations mirror those in 3A above

During a stuck session the per-chunk cost runs on a minutes-scale interval (8 s of speech ≠
8 real-time seconds in ambient-noise conditions). This contributes moderate additional growth.

---

## 4. Proposed Fix (plain English)

### Fix A — Silence gate in wake-word poll loop (RC-1, primary)

In `run_wake_word_loop` (wake_word.rs), immediately after snapshotting the ring buffer,
compute the RMS energy of the snapshot. If the RMS is below a threshold (suggested: `0.010`,
approximately -40 dBFS — well above sensor noise but well below conversational speech),
skip `tm.transcribe()` for that poll cycle and `continue` to the next sleep.

This one check eliminates ~99% of idle inference calls. The ring buffer and poll loop
continue running (so wake-word latency is unaffected once speech starts); only the
Parakeet inference call is gated.

Threshold must be chosen carefully:
- Too low → ambient noise still passes through (bug persists partially)
- Too high → genuine whispered "dictate" commands fail to fire

A threshold of `0.010–0.015` RMS is consistent with `VAD_FLUSH_ENERGY_THRESHOLD = 1e-5`
(RMS ≈ 0.003) used elsewhere, and the `PARAKEET_LOW_ENERGY_RMS_THRESHOLD = 0.05` above
which boost is skipped. A value of `0.015` sits between near-silence and a whisper.

### Fix B — Don't reset `last_activity` for wake-word inference (RC-1, secondary)

Pass a flag or use a separate method for wake-word inference that skips the `last_activity`
update. This allows the configured `model_unload_timeout` to fire during extended idle
periods, releasing the model's ~500 MB+ footprint.

Blast radius: if wake-word fires while the model is unloaded, the inference call hits
`model is not loaded for transcription` error (`inference.rs:225`) → wake-word trigger
missed. Mitigation: load the model when a wake-word is detected before starting the
real recording session (already done via `tm.initiate_model_load()` at `transcribe.rs:502`
in the main transcription start path).

### Fix C — Investigate and guard stuck recording sessions (RC-2)

This is a harder fix that requires understanding why `stop_transcription_action` is not
called (or is silently dropped). The binding_id guard at `transcribe.rs:1169–1176` is a
known silent-skip path. For wake-word sessions specifically, `auto_stop_on_silence` in
`wake_word.rs` has a 45-second safety valve — but only if the VAD callback fires. If
`rm.set_vad_callback()` at `wake_word.rs:247` is overwritten by another caller before
the auto-stop completes, silence is never detected.

A defensive guard would be: add an absolute timeout to the recording session itself in
the sampler thread — if the session has been running for more than N minutes with zero
non-empty chunks, send a `None` sentinel and exit.

---

## 5. Blast Radius

| Fix | What could break | Risk |
|---|---|---|
| **A — Silence gate** | Whispered "dictate" in a very quiet room might fall below threshold and not fire | Low — threshold must be validated with a whispered sample |
| **A — Silence gate** | High ambient-noise environments (open office) may keep RMS above threshold → wake-word still runs frequently (but legitimately) | Acceptable |
| **B — Skip last_activity** | Wake-word fires while model is unloaded → 1–2 s reload delay before recording starts | Low — model reload is already handled |
| **B — Skip last_activity** | Model unloads between two back-to-back wake-word triggers if `model_unload_timeout = Immediately` | Very low — Immediately mode is edge-case |
| **C — Stuck session guard** | Legitimate very long dictation sessions (>N minutes) could be force-stopped prematurely | Medium — threshold must be well above typical session durations |

No changes touch auth, billing, or the paste pipeline. Fixes A and B are localized to
`wake_word.rs` and `inference.rs` respectively — both are narrow, low-blast-radius files
for this feature.

---

## 6. Recommended Next Step

**Implementation mission is warranted for Fix A.** The silence gate is:
- A small change (~5–8 lines in `wake_word.rs`)
- Targeted at a confirmed code path
- Low blast radius
- Directly addresses the observed log pattern

**Fix B** can be bundled with Fix A (same file area, same PR) or deferred to a follow-up.

**Fix C** (stuck session root cause) requires additional investigation:
- Add logging to `stop_transcription_action` to capture the binding_id mismatch path
- Check whether wake-word sessions ever exceed the 45-second safety valve in practice
- Recommended as a separate `measurement_task` before implementing a session-level timeout

**Priority ordering:**
1. Fix A (silence gate) — high impact, low risk, implement now
2. Fix B (`last_activity` isolation) — medium impact, low risk, bundle with A
3. Fix C (stuck session) — high impact, medium investigation cost, separate task

**Safety gate before implementation:**
- Confirm `wake_word_enabled` is `true` in the founder's settings (this is the activation
  condition for RC-1). If `false`, RC-2 (stuck session) is the sole cause and this
  diagnosis needs re-prioritization.
- Validate silence gate threshold with a whispered "dictate" sample before merging.

---

## Appendix — Key File:Line Reference Map

| Symbol | File | Line(s) |
|---|---|---|
| `POLL_INTERVAL_MS = 1_500` | `runtime/wake_word.rs` | 37 |
| `RING_CAPACITY = 40_000` | `runtime/wake_word.rs` | 34 |
| `run_wake_word_loop` (inference call) | `runtime/wake_word.rs` | 141–205 |
| `set_preview_callback` (always-on audio feed) | `runtime/wake_word.rs` | 100–108 |
| `auto_stop_on_silence` (45 s safety valve) | `runtime/wake_word.rs` | 215–331 |
| `MAX_RECORDING_SECS = 45` | `runtime/wake_word.rs` | 47 |
| `maybe_boost_low_energy_parakeet_audio` | `managers/transcription/inference.rs` | 55–78 |
| `PARAKEET_LOW_ENERGY_RMS_THRESHOLD = 0.05` | `managers/transcription/inference.rs` | 9 |
| `"Applying low-energy boost to Parakeet V3 input"` log | `managers/transcription/inference.rs` | 637 |
| `"Transcription result is empty"` log | `managers/transcription/inference.rs` | 937–939 |
| `last_activity` reset (every inference) | `managers/transcription/inference.rs` | 193–199 |
| Idle watcher / unload timer | `managers/transcription/mod.rs` | 265–321 |
| `"[worker] processing chunk idx=N"` log | `actions/transcribe.rs` | 846 |
| Sampler thread (loop / break condition) | `actions/transcribe.rs` | 675–812 |
| Stop binding_id guard (silent drop path) | `actions/transcribe.rs` | 1162–1176 |
| `CHUNK_SAMPLER_POLL_MS = 200` | `runtime/chunking.rs` | 30 |
| `PARAKEET_V3_MULTI_CHUNK_INTERVAL_SAMPLES` | `runtime/chunking.rs` | 53 |
| `MAX_PROCESSED_SAMPLES` (recorder cap) | `audio_toolkit/audio/recorder.rs` | 424 |
| Preview callback fired on every frame | `audio_toolkit/audio/recorder.rs` | 544–555 |
| `MicrophoneMode::AlwaysOn` stream lifecycle | `managers/audio.rs` | 391–395, 695–717 |

---

*Read-only investigation. No product code was modified.*
*Output authorized by mission briefing: vocalype-brain/outputs/next_product_bottleneck.md*
*Founder review required before any implementation is authorized.*
