# Product Patch Proposal — Stuck Recording Session (RC-2)

Generated: 2026-04-26
Task type: proposal_task
Author: Claude Code (Sonnet 4.6) — no product code modified
Source: idle_background_transcription_diagnosis.md + idle_background_diagnosis_result.md

---

## Mission Answer — 10 Required Questions

### Q1. What exact bug is suspected?

A recording session starts normally (via hotkey or other trigger) but never receives — or
never successfully processes — a stop signal. The chunking sampler thread
(`actions/transcribe.rs:682–812`) continues polling `snapshot_recording()` every 200 ms
indefinitely because the `AudioRecordingManager` never returns to `RecordingState::Idle`.

While the session is stuck, the Silero VAD (threshold=0.28, hangover=20 frames = 600 ms
at Parakeet V3's sample rate) occasionally classifies ambient noise frames as speech. Once
accumulated samples reach `PARAKEET_V3_MULTI_CHUNK_INTERVAL_SAMPLES = 128,000 samples`
(8 s of classified speech), the worker fires a chunk, runs full Parakeet inference (~200 ms),
and gets an empty result. This repeats until app restart, producing:
- Continuous CPU load (~200 ms/cycle out of every 8 s of ambient accumulation)
- Heap fragmentation from repeated ~500 KB–3 MB allocation/free cycles
- `[worker] processing chunk idx=N` logs with N far beyond any real dictation

**Confirmed for this machine:** `wake_word_enabled=false`, `always_on_microphone=true`. RC-1
(wake-word idle inference) is NOT active. RC-2 is the sole cause of the observed behaviour.

---

### Q2. What code path ignores the stop signal?

There are three possible drop paths, ordered from most likely to least:

**Path 2A — User-side: no stop was ever sent**
The recording was left running (user walked away, forgot to stop, or expected auto-stop).
When `always_on_microphone=true` and `wake_word_enabled=false`, there is no automatic
session termination — the session runs until an explicit stop signal is delivered.

**Path 2B — Binding_id guard at `transcribe.rs:1169–1176`**
```
if coordinator.active_binding_id().as_deref() != Some(binding_id) {
    debug!("Ignoring stop for '{}' because active binding is {:?}", binding_id, ...);
    return; // SILENT DROP — no error, no user feedback
}
```
This guard is logically correct for preventing cross-binding confusion. However, if the
coordinator's `active_binding_id` is cleared (e.g., via `notify_cancel()`) before the stop
signal arrives, the guard silently no-ops and the `ChunkingHandle` that holds the sampler
thread and `chunk_tx` channel is never dropped. The sampler keeps running.

**Path 2C — Coordinator debounce at `transcription_coordinator.rs:14`**
`DEBOUNCE = Duration::from_millis(30)` applies to `is_pressed=true` events. A stop triggered
within 30 ms of a prior press event could be dropped. This is an edge case (rapid double-press)
and unlikely to be the primary cause here.

**Currently confirmed code path:** Path 2B is the candidate most supported by the log
evidence (chunk idx reaching 83–99 without any interim stop). Path 2A cannot be ruled out
without additional logging. Path 2C is unlikely at this scale.

---

### Q3. What is the smallest safe change that would fix or meaningfully contain this bug?

Two sequential patches, applied in order:

**Patch 1 (Logging — zero blast radius):**
Promote the `debug!` at `transcribe.rs:1170` to `warn!`. Add a `warn!` immediately after
the sampler loop exits (`transcribe.rs:812`) if `chunk_count > N` (e.g., >20 chunks)
indicating an abnormally long session. Add a `warn!` in the sampler loop when the session
has run for more than `MAX_SESSION_WARN_MINS` (e.g., 5 minutes) without a non-empty chunk.

These log changes produce zero behaviour change. They make Path 2B visible in production
logs and confirm whether a stop signal was attempted (and silently dropped) or never sent.

**Patch 2 (Defensive timeout — low blast radius, conditioned on Patch 1 data):**
In the sampler thread (`transcribe.rs:~700`), track session start time and consecutive
empty-chunk count. If `elapsed > MAX_SESSION_DURATION` (suggested: 10 minutes) AND
`consecutive_empty_chunks > MAX_EMPTY_CHUNKS` (suggested: 30 = ~4 minutes of ambient),
break out of the sampler loop, send `None` on `chunk_tx`, and log a `warn!`.

The `None` sentinel terminates the worker thread. The sampler join at `transcribe.rs:1307`
then completes. This does NOT clean up coordinator state (the coordinator's
`active_binding_id` and `state` machine remain stale). A separate coordinator reset call
would be needed for a complete fix — but the RAM growth and CPU loop are fully stopped.

---

### Q4. Which fix type is recommended?

**Option D — A + B in sequence (logging first, defensive timeout second)**

Rationale:
- Option A alone (logging only) is insufficient as a permanent fix but is necessary to
  confirm which drop path (2A vs 2B) is actually occurring. Without logs, Patch 2 is
  designed against an unconfirmed hypothesis.
- Option B alone (defensive timeout) is safe but incomplete: it stops the RAM growth but
  does not diagnose whether a stop was attempted (Path 2B) or never sent (Path 2A).
- Option C (binding_id mismatch handling) is high-risk: changing the binding_id guard's
  behaviour could allow cross-binding session state corruption. This is not recommended
  without deep coordinator flow analysis.
- **Option D**: Ship Patch 1 (logging, zero risk), collect 1–2 actual stuck-session events
  in logs, confirm the drop path, then ship Patch 2 (defensive timeout) with correct
  parameters tuned to real session duration data.

---

### Q5. What are the exact target files and line ranges?

**Patch 1 (Logging):**
| File | Lines | Change |
|---|---|---|
| `src-tauri/src/actions/transcribe.rs` | 1169–1170 | Promote `debug!` → `warn!`, add binding_id context |
| `src-tauri/src/actions/transcribe.rs` | ~810–812 | Add `warn!` if session produced >20 chunks |
| `src-tauri/src/actions/transcribe.rs` | ~700–715 | Add session start timestamp, warn after 5 min + all-empty |

**Patch 2 (Defensive timeout, conditioned on Patch 1):**
| File | Lines | Change |
|---|---|---|
| `src-tauri/src/actions/transcribe.rs` | ~700–715 | Add `session_start`, `consecutive_empty`, `total_chunks` counters |
| `src-tauri/src/actions/transcribe.rs` | ~780–810 | Add elapsed + consecutive-empty break condition; send `None` on `chunk_tx` |

No other files require changes for either patch.

**Forbidden files — confirmed NOT in scope:**
- `src-tauri/src/managers/audio.rs` — not touched
- `src-tauri/src/runtime/wake_word.rs` — not touched (RC-1 only)
- `src-tauri/src/managers/transcription/inference.rs` — not touched
- `src/` (all frontend files) — not touched
- `backend/` — not touched
- Auth, license, payment files — not touched

---

### Q6. What tests or validation confirm the fix works?

**Patch 1 validation:**
1. Build with `cargo check` + `cargo build --release` — no compilation errors.
2. Start Vocalype with `--log-level debug` or equivalent.
3. Start a recording session via hotkey, do NOT press stop.
4. After 5 minutes of ambient audio → verify `warn!` log appears in app logs.
5. After 2B scenario: if stop is sent while coordinator binding_id is stale → verify
   `warn!` appears at the drop point (replaces the silent `debug!`).

**Patch 2 validation:**
1. Start a recording session, do NOT stop it for >10 minutes.
2. Confirm that after `MAX_SESSION_DURATION` elapsed AND `MAX_EMPTY_CHUNKS` consecutive
   empty results, the sampler exits and the worker terminates.
3. Verify RAM stops growing after termination.
4. Verify subsequent recording sessions start and stop normally (no state corruption).
5. Confirm a normal 30-second dictation session is NOT prematurely terminated.

**Edge case that must NOT break:**
- A legitimate long recording session (dictating a long document, 10+ minutes of actual
  speech) must NOT be terminated. The `consecutive_empty_chunks` counter resets on every
  non-empty chunk, so active dictation keeps the session alive.

---

### Q7. What is the rollback plan?

```
git checkout -- src-tauri/src/actions/transcribe.rs
cargo build --release
```

Both patches are confined to a single file. Rollback is one command, compile-time safe.

**No data files change.** No settings files change. No other Rust files change.

If Patch 2 terminates a legitimate long dictation prematurely, the user observes a silent
stop. They restart the recording. This is annoying but recoverable, and the `warn!` log
(from Patch 1) will have captured the event for analysis.

---

### Q8. What are the risks?

| Risk | Likelihood | Severity | Mitigation |
|---|---|---|---|
| Patch 1 (logging) breaks compilation | Very low | Low | `cargo check` before commit |
| Patch 1 introduces log spam in normal sessions | Very low | Low | Only fires on >20 chunks or >5 min — normal sessions never reach this |
| Patch 2 terminates a legitimate very-long dictation (>10 min, all speech) | Very low | Medium | `consecutive_empty_chunks` resets on every non-empty result; real speech produces non-empty results |
| Patch 2 does not clean up coordinator state | Medium | Low | RAM growth and CPU loop stop; coordinator state is stale but causes no crash — next session resets it via `start_transcription_action` |
| Patch 2 sends `None` on `chunk_tx` after it has already been closed | Low | Low | `chunk_tx.send(None)` returns `Err(SendError)` if the worker is already done; this should be handled by a `let _ = ...` wrapper |
| Wrong `MAX_SESSION_DURATION` threshold chosen | Medium | Low | Patch 1 data informs the right value; 10 minutes is a safe conservative starting point |

**Files with forbidden scope:** None touched. Risk is isolated to audio runtime only.

---

### Q9. What is the current approval status?

**Status: PROPOSED — awaiting founder review before any implementation.**

This proposal is text-only. No product code has been changed. No `src-tauri/` files have
been modified. Implementation requires explicit founder approval and a separate handoff mission.

**Approval gate criteria:**
1. Founder reads this proposal and `idle_background_diagnosis_result.md`
2. Founder agrees with Option D (log first, timeout second) sequencing
3. Founder authorizes Patch 1 implementation (logging-only, zero blast radius)
4. After Patch 1 ships and 1–2 stuck-session events are captured in logs → re-evaluate
5. Founder authorizes Patch 2 if log evidence confirms Path 2B or informs timeout parameters

**Patch 1 alone can be approved independently.** Patch 2 should NOT be approved until
Patch 1 data is available.

---

### Q10. Should implementation be approved now or should another read-only investigation happen first?

**Patch 1 (logging): Approved to implement now** — pending founder sign-off.
- Zero behaviour change. Zero blast radius. The logs will answer the remaining open question
  (Path 2A vs Path 2B). The investigation at code level is complete.
- No additional read-only investigation is needed before Patch 1.

**Patch 2 (defensive timeout): Defer until Patch 1 data is available.**
- The correct values for `MAX_SESSION_DURATION` and `MAX_EMPTY_CHUNKS` cannot be chosen
  without observing actual stuck-session data. Patch 2 is sound in design but should be
  parameterized using real log evidence.
- Expected wait: 1–3 occurrences of the stuck-session event after Patch 1 ships.

---

## Implementation Mission Package (for when Patch 1 is approved)

**Task type:** `implementation_task`
**Target:** `src-tauri/src/actions/transcribe.rs`
**Change summary:** Promote 1 `debug!` to `warn!`, add 2 new `warn!` log lines, add
session duration tracking variables.
**Estimated diff size:** ~15–20 lines added/changed
**No new dependencies.** No new Tauri commands. No schema changes.

**Exact changes (plain English, not code):**

1. At `transcribe.rs:1170` — change `debug!("Ignoring stop for '{}'...")` to
   `warn!("Ignoring stop for '{}' — active binding is {:?}; stop signal dropped", ...)`

2. In the sampler loop setup (~line 700) — add three variables:
   - `session_start: Instant = Instant::now()`
   - `consecutive_empty_chunks: u64 = 0`
   - `total_chunks_sent: u64 = 0`
   These are `let mut` locals in the sampler thread, no state sharing needed.

3. In the sampler loop body where chunk intervals are checked (~line 780) — after the chunk
   count check, add:
   - If `elapsed_minutes >= 5` AND `total_chunks_sent > 0` AND `consecutive_empty_chunks == total_chunks_sent`:
     `warn!("Recording session running {} min with all-empty chunks — possible stuck session", elapsed)`

4. At the bottom of the sampler loop (~line 809) — after the sample collection:
   - Update `consecutive_empty_chunks` on empty chunk result, reset on non-empty.

5. At the sampler loop end (~line 811) — just before the `break`:
   - Add: if `total_chunks_sent > 20`: `warn!("Sampler exiting after {} chunks — normal if long session, unexpected if idle", total_chunks_sent)`

**Commit message:** `diag(transcribe): add warn logs for stuck recording session detection`

---

## Summary

| Question | Answer |
|---|---|
| Bug confirmed? | Yes — RC-2, stuck recording session |
| Primary drop path | 2A (no stop sent) or 2B (binding_id guard silent drop) — unresolved |
| Smallest safe fix | Patch 1: logging (zero risk). Patch 2: sampler timeout (low risk, defer) |
| Fix type | D — A + B in sequence |
| Target file | `src-tauri/src/actions/transcribe.rs` only |
| Forbidden files touched? | No |
| Rollback | `git checkout -- src-tauri/src/actions/transcribe.rs` |
| Risk | Low (Patch 1), Low-Medium (Patch 2) |
| Current status | **PROPOSED** — awaiting founder approval |
| Approve now? | Patch 1 YES (when founder ready). Patch 2 NO (wait for Patch 1 data) |

---

*No product code modified. No src-tauri/ files changed.*
*This file is a Brain-only proposal. Founder review required before implementation.*
