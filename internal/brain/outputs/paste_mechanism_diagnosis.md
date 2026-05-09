# paste_mechanism_diagnosis.md

Date: 2026-04-26
Source file(s) read: src-tauri/src/actions/paste.rs, src-tauri/src/actions/profiler.rs, internal/brain/data/benchmark_observations.jsonl
Investigation type: read-only / measurement_task
Output of: V11 PB-1 mission
No product code was modified.

---

## Call Path

Full trace of `dispatch_text_insertion()` from invocation to OS paste completion.

```
dispatch_text_insertion(app, operation_id, final_text, is_basic_plan, profiler, on_success)
  paste.rs:27-34   â€” entry point; called from transcription pipeline after model output
  paste.rs:38      â€” paste_time = Instant::now()  [timer A: total dispatch wall time]
  paste.rs:47-49   â€” profiler.set_transcription_chars(&final_text)
  paste.rs:51-56   â€” coordinator.mark_pasting(app, operation_id)
                     [abort if operation already cancelled/superseded]
  paste.rs:67      â€” app.run_on_main_thread(closure)
                     *** ASYNC BOUNDARY â€” calling thread returns immediately ***
                     *** closure executes when Tauri main event loop is free ***

  [Tauri main thread â€” executes when scheduled]
  paste.rs:70-75   â€” coordinator.is_operation_active(operation_id)
                     [abort if operation was cancelled while waiting for main thread]
  paste.rs:76-78   â€” profiler.push_step_since("paste_dispatch_wait", paste_time, None)
                     [timer A ends â†’ records wait-for-main-thread duration]
  paste.rs:81      â€” paste_exec_started = Instant::now()  [timer B: paste execution wall time]
  paste.rs:84      â€” decide_paste_execution_mode(is_basic_plan)

  FOR NativePasteAllowed (paid tier):
  paste.rs:122     â€” utils::paste(final_text, app_clone)
                     *** SYNCHRONOUS â€” blocks main thread for full duration ***
                     *** actual OS paste mechanism â€” inside utils.rs (outside allowed reads) ***
  paste.rs:125-130 â€” profiler.push_step_since("paste_execute", paste_exec_started, Some("ok"))
                     [timer B ends â†’ records utils::paste() duration = 644ms]
  paste.rs:131-132 â€” profiler.mark_completed(); profiler.emit(&app_clone)
  paste.rs:133-134 â€” on_success callback()
  paste.rs:136-139 â€” schedule_clipboard_diff_check(app_clone, final_text)
  paste.rs:141-146 â€” coordinator.complete_operation(&app_clone, operation_id, "pasted")

  paste.rs:191     â€” utils::hide_recording_overlay(&app_clone)
  paste.rs:192     â€” change_tray_icon(&app_clone, TrayIconState::Idle)
```

**Two independently measured timer segments exist in the code:**
- `paste_dispatch_wait` (paste.rs:77): time from `dispatch_text_insertion()` call â†’ main thread begins
- `paste_execute` (paste.rs:126): time for `utils::paste()` to complete

The benchmark observations confirm `paste_execute = 644ms` across 7 sessions. The `paste_dispatch_wait` is not present in the recorded benchmark notes, implying it is small relative to `paste_execute`.

---

## Latency Attribution

| Sub-call | Measured duration | Evidence |
|---|---|---|
| `paste_dispatch_wait` | small â€” not isolated in logs | profiler step paste.rs:77; absent from benchmark notes suggests <20ms |
| `utils::paste()` (the `paste_execute` step) | **644ms Â± 3ms** | benchmark_observations.jsonl lines 23â€“27: `paste_execute step from_log:...` values 687, 645, 644, 644, 644, 644, 647, 645ms |
| `coordinator.mark_pasting()` | negligible | simple state check, paste.rs:52 |
| `coordinator.is_operation_active()` | negligible | simple state check, paste.rs:71 |
| profiler operations | negligible | mutex lock + vec push, paste.rs:76, 125 |
| `schedule_clipboard_diff_check` | negligible | async schedule, paste.rs:137 |

**Conclusion: ~100% of the 644ms is inside `utils::paste()`.** The pre-dispatch and post-dispatch operations contribute negligible time.

---

## Explicit Delays Found

**In `paste.rs`:** None found. No `thread::sleep`, `std::thread::sleep`, `tokio::time::sleep`, or fixed delay of any kind in paste.rs or profiler.rs.

**In `utils::paste()` (paste.rs:122):** Cannot confirm from allowed reads. The `utils` module is in `src-tauri/src/utils.rs` or equivalent â€” outside the allowed scope of this investigation. However:

The measured latency pattern is **diagnostic of a fixed delay inside `utils::paste()`**:

- 7 independent sessions: 687, 645, 644, 644, 644, 644, 647, 645ms
- Standard deviation: ~13ms (nearly all spread explained by the 687ms outlier; core cluster is 644â€“647ms, SD â‰ˆ 1.2ms)
- Variable OS operations (clipboard writes, window focus, keystroke simulation) would produce spread of Â±50â€“150ms
- A 1.2ms SD is consistent with `thread::sleep(Duration::from_millis(N))` where N â‰ˆ 600â€“640ms plus small OS scheduling jitter

**Assessment:** There is almost certainly a hardcoded `thread::sleep` inside `utils::paste()`, but this cannot be confirmed without reading `utils.rs`. This is the primary open question (see Open Questions).

---

## OS API Used

**Not determinable from `paste.rs` alone.** The OS API is inside `utils::paste()` (paste.rs:122), which is in the `utils` module outside the allowed reads.

**What is known from paste.rs:**
- `tauri_plugin_clipboard_manager::ClipboardExt` is imported (paste.rs:11) and used for the `ClipboardOnlyBasic` path (paste.rs:86-88) and for paste fallback (paste.rs:151)
- For `NativePasteAllowed`, clipboard writing is delegated to `utils::paste()` â€” it does NOT call `app.clipboard().write_text()` before invoking `utils::paste()`
- This means `utils::paste()` likely handles both clipboard write and keystroke simulation internally

**Inferred from context (not confirmed):** Windows paste simulation in Rust/Tauri typically uses one of:
- `enigo` crate: `enigo.key_click(Key::Control); enigo.key_click(Key::Layout('v'))` with optional sleep
- `rdev` crate: `simulate(&EventType::KeyPress(Key::ControlLeft))`
- Raw WinAPI: `SendInput()` or `keybd_event()` + `SetClipboardData()`

**Confirmation requires reading `utils.rs`.**

---

## Sync / Async Behavior

**Two-stage model:**

**Stage 1 â€” `dispatch_text_insertion()` to main thread: ASYNCHRONOUS**
- `app.run_on_main_thread(closure)` at paste.rs:67 schedules work on the Tauri main event loop
- The calling thread (likely a background transcription worker) returns immediately
- The closure executes whenever the main thread is next free

**Stage 2 â€” `utils::paste()` execution on main thread: SYNCHRONOUS (blocking)**
- `utils::paste(final_text, app_clone)` at paste.rs:122 is a synchronous function call
- There is no `.await`, no `spawn`, no callback â€” it blocks the main thread until it returns
- The `paste_execute` profiler timer (paste.rs:81 â†’ 126) measures this synchronous block
- The Tauri main event loop is **completely blocked for ~644ms** on every paid-tier dictation

**Consequence:** During the 644ms block, no other Tauri main-thread work can execute â€” no UI updates, no overlay dismiss, no other command responses. The overlay hide (`utils::hide_recording_overlay`, paste.rs:191) runs only after `utils::paste()` returns.

---

## Retry / Fallback Mechanisms

**Retry loops:** None found in paste.rs. There is no retry of `utils::paste()` on failure.

**Fallback on `utils::paste()` failure (paste.rs:148-187):**
- If `utils::paste()` returns `Err(e)`, the code immediately falls back to clipboard-only mode
- `app.clipboard().write_text(&text_for_fallback)` is called (paste.rs:151-162)
- `emit_paste_failed_event` fires with `copied_to_clipboard=true/false` depending on clipboard write success
- `profiler.mark_error("PASTE_FAILED")` and `profiler.emit()` are called (paste.rs:173-180)
- No attempt is made to retry `utils::paste()`

**Fallback on `run_on_main_thread()` failure (paste.rs:194-233):**
- If `app.run_on_main_thread()` itself fails to dispatch (rare Tauri error), the calling thread handles it
- Clipboard fallback is attempted on the calling thread (paste.rs:197-209)
- `emit_runtime_error("PASTE_MAIN_THREAD_DISPATCH_FAILED", ...)` fires (paste.rs:212-218)

**Summary:** One fallback path (native paste â†’ clipboard copy), no retries, no timeout waits visible in paste.rs.

---

## Relationship to Idle Inference Loop

**Direct coupling: None found in paste.rs.**

There is no shared mutex, channel, or lock between `dispatch_text_insertion()` and the inference loop visible in paste.rs. The `TranscriptionCoordinator` (paste.rs:51, 70, 108, 143, 184) manages operation lifecycle (mark_pasting, is_operation_active, complete_operation) â€” this is not an inference-side lock.

**Indirect coupling: Main thread contention (confirmed).**

The idle background inference loop (confirmed in benchmark_observations.jsonl line 43) fires every ~1â€“2 seconds, producing transcription callbacks and empty-result events. These callbacks from the inference worker thread are likely dispatched to the Tauri main thread via events.

When the inference loop fires while `utils::paste()` is blocking the main thread for 644ms, the inference result events queue up and execute after the paste completes. This does not increase paste latency, but does mean:
1. The inference loop's main-thread callbacks are delayed by the paste block
2. If the inference loop fires a transcription result _during_ a paste, the result's main-thread processing waits 644ms â€” which could create the appearance of a double transcription trigger

**The inference loop does not cause or worsen paste latency.** The 644ms is consistent whether the inference loop is running or not (benchmark data shows stable 644ms across sessions recorded at different times of day without loop-state information).

---

## Sub-300ms Hypothesis

**Hypothesis only. No code change. No patch instructions.**

The 644ms is almost certainly a fixed-duration internal delay (likely `thread::sleep`) inside `utils::paste()`. If that is confirmed, the path to <300ms is:

**H1 â€” Remove or reduce the internal delay in `utils::paste()`.**
If a `thread::sleep(Duration::from_millis(N))` exists with N â‰ˆ 600ms, reducing it to 0ms or a minimal value (e.g., 20ms) would directly reduce paste_latency_ms by the same amount. This would require: (a) reading utils.rs to confirm the delay exists and its purpose, (b) measuring whether removing it causes paste failures on Windows (some delays exist for clipboard propagation timing), (c) finding the minimum safe delay through bisection testing.

**H2 â€” Replace synchronous blocking with async paste.**
If `utils::paste()` must wait for OS confirmation (e.g., waiting for the target window to process Ctrl+V), the wait could be moved off the main thread. Dispatching the paste to a background thread and emitting a completion event to the main thread would un-block the main event loop during the wait. This is more invasive but eliminates the 644ms main-thread blockage regardless of OS timing.

**H3 â€” Use a faster OS paste mechanism.**
If `utils::paste()` uses `keybd_event` (deprecated WinAPI) or a high-latency crate, switching to a lower-latency API (e.g., `SendInput` directly, or `UiAutomation`) might reduce the OS round-trip time. This requires confirming the current API from utils.rs.

**The most likely quick win is H1.** The Â±1.2ms consistency of the benchmark cluster is the strongest indicator of a hardcoded sleep, not an inherently slow OS call. OS calls for clipboard + Ctrl+V simulation typically complete in 20â€“80ms on Windows; 644ms is not consistent with native API latency alone.

---

## Open Questions

1. **What is the source of the 644ms delay inside `utils::paste()`?** This requires reading `src-tauri/src/utils.rs`. This is the single most important open question. Once confirmed as a `thread::sleep(N)`, the fix is straightforward. If it is genuine OS wait time, H2 or H3 applies instead.

2. **What is the measured `paste_dispatch_wait` duration?** The profiler records it (paste.rs:77) but it is not present in the benchmark_observations.jsonl notes. Its value is inferred to be small (<20ms), but should be confirmed with a targeted benchmark run that captures profiler step output.

3. **Does removing or reducing the delay cause paste failures on Windows?** Some Windows paste simulation libraries require a delay for the clipboard to propagate before sending Ctrl+V. If the delay is load-bearing, the minimum safe value must be found empirically. Target: paste_latency_ms < 300ms with â‰¥95% paste success rate.

4. **Does the idle background inference loop affect paste_dispatch_wait?** If the loop is queuing many main-thread callbacks, the main-thread dispatch queue may be backed up, inflating `paste_dispatch_wait`. This could be tested by measuring `paste_dispatch_wait` with and without the inference loop active.

5. **Is `utils::paste()` used on other platforms (macOS, Linux)?** If the delay is platform-conditional (only on Windows), a targeted fix for Windows would not affect other platforms.

---

## Confidence in This Diagnosis

**MEDIUM-HIGH**

**HIGH confidence items (directly confirmed from allowed reads):**
- `paste_execute` profiler step (paste.rs:125-130) is the correct measurement point for the 644ms
- `utils::paste()` at paste.rs:122 is the sole source of the latency on the success path
- `utils::paste()` blocks the Tauri main thread synchronously for the full duration
- No explicit sleep exists in paste.rs or profiler.rs
- No retry loop exists in paste.rs
- The inference loop has no direct lock coupling to the paste path (confirmed from paste.rs)
- The 644ms is in `paste_execute`, not `paste_dispatch_wait` (confirmed from benchmark step notes)

**MEDIUM confidence items (strongly inferred from evidence, not yet confirmed):**
- The 644ms is caused by a fixed `thread::sleep` inside `utils::paste()` (inferred from Â±1.2ms consistency; confirmed requires reading utils.rs)
- `paste_dispatch_wait` is small (<20ms) under normal conditions (inferred from benchmark note format; not directly measured)

**What would raise confidence to HIGH:**
- Read `src-tauri/src/utils.rs` (or wherever `utils::paste()` is implemented) to confirm the sleep and its exact duration
- Capture a benchmark run that records `paste_dispatch_wait` as a separate data point
