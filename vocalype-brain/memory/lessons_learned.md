# Lessons Learned

Record implementation lessons that should change how Vocalype Brain plans future work.

For each lesson, capture:

- Date
- What was attempted
- What happened
- Why it mattered
- What to repeat or avoid next time

- Night Shift correctly prioritized first successful dictation.
- Codex implemented a safe frontend-only clarity improvement.
- Future UI clarity tasks should prefer frontend-only scope before backend/auth/Rust changes.
- Night Shift initially proposed too many sensitive files; future task generation should narrow scope.

- 2026-04-24 V3.5 lesson: Approved patch application must require explicit --approve and must refuse patches without Apply Instructions.

## 2026-04-26 — Idle Background Inference Loop: Confirm Settings Before Proposing Fix

**What was attempted:** Read-only investigation of the idle background inference loop.
Diagnosed two root causes (RC-1: wake-word silence gate missing; RC-2: stuck recording
session). Then confirmed local settings before recommending a fix path.

**What happened:**
- RC-1 (wake-word) was the leading hypothesis from the observation file.
- Settings inspection revealed `wake_word_enabled = false` — RC-1 is NOT active on this machine.
- `always_on_microphone = true` + VAD hangover (600 ms, threshold 0.28) causes ambient
  noise to slowly accumulate as "speech" frames in a stuck recording session.
- The `[worker] processing chunk idx=83..99` pattern is from `actions/transcribe.rs:846`
  — only active during a live recording session, not from wake-word.
- The stop signal was silently dropped (binding_id mismatch guard at `transcribe.rs:1169`
  is the most likely candidate) or the user left a recording running unintentionally.

**Why it mattered:**
If the settings check had been skipped, a silence-gate patch to `wake_word.rs` would have
been implemented for a bug that does not exist on this machine. The fix would have been
correct in principle but wasted. The real fix target is the stuck-session stop path.

**Lessons:**
1. **Always inspect local settings before writing a product patch proposal.** Hypotheses
   built from log patterns can point to wrong code paths when a feature is disabled.
2. **`wake_word_enabled` gates all wake-word activity.** If false, `run_wake_word_loop`
   never starts. Silence-gate and last_activity fixes are only needed when it is true.
3. **`always_on_microphone = true` keeps the VAD running.** When a recording session is
   stuck, ambient noise frames accumulate at the VAD hangover rate (600 ms at threshold
   0.28). This is slow but continuous — consistent with +7 MB/min growth.
4. **`model_unload_timeout = "never"` is intentional on this machine.** Do not treat it
   as a bug — the 500 MB model RAM footprint is by design for this user.
5. **The stop path is load-bearing.** A recording that never stops will run indefinitely
   until app restart. The binding_id mismatch guard (`transcribe.rs:1169`) is a silent
   no-op path that must be understood before writing a defensive timeout.
6. **Diagnosis before implementation is mandatory for Rust audio runtime changes.** The
   operating contract rule ("measure → diagnose → propose → implement small → test") is
   not bureaucracy — it prevented implementing the wrong fix here.

---

## 2026-04-26 — V12 Closure: Construction vs. Operating Mode

**What was attempted:** Closed V12 as the final Brain construction version and declared Operating Mode.

**What happened:**
- 12 construction versions (V1–V12) were built over the course of this session series.
- Each version added one layer: patches, handoffs, benchmarks, business metrics, content, decisions, missions, improvement loops.
- By V12, the Brain had more infrastructure than real data to run through it.
- V8 had 0 business observations. V9 had 0 content performance observations. V10 was choosing actions from structural priors.
- The decision to enter Operating Mode was correct: additional infrastructure would not improve the Brain's outputs; real data would.

**Why it mattered:**
Building the brain before getting users is a classic founder trap: optimising a system that has no input signal. The brain is now complete. Every further improvement requires real data — users, conversions, content performance — not another version.

**Lessons:**
1. **Infrastructure without data is a model, not a system.** The Brain can only be as good as the observations flowing into it. V8/V9 with zero real records means V10 is deciding on structure, not signal.
2. **Stop building when the loop is complete.** The improvement loop ran end-to-end in V12. That is the stopping condition for construction. More versions would be scope creep.
3. **PROVISIONAL_KEEP is a legitimate decision.** Entering Operating Mode with an incomplete test matrix is an honest trade-off, not a failure. Record the deferred items, keep the rollback armed, move on.
4. **The highest-leverage action after building is getting users.** Not more Brain sessions. Not V13. Users, data, and the weekly operating rhythm.
5. **Construction phases have natural end points.** V12 ending the construction phase is not a milestone to celebrate — it is a transition to start. The real work begins in Operating Mode.

## 2026-04-26 — V12 Experiment 1: Windows Paste Restore Delay Floor

**What was attempted:** Reduced Windows clipboard restore delay floor from 450ms to 150ms
(`clipboard.rs:120`). One-line change, Windows-only, no other files. V12 Phase 1–4 executed.

**What happened:**
- Change applied cleanly: 1 token, 1 line, `cargo check` passed in 11.58s.
- Founder smoke tests (4/7 apps): Notepad, VS Code, Chrome, Gmail all passed all 3 test cases.
- Slack, Teams, and Word not yet tested — pending.
- No paste failure, no clipboard restore failure in tested apps.
- Decision: PROVISIONAL_KEEP pending Electron app (Slack/Teams) and Word validation.

**Why it mattered:**
- First V12 continuous improvement experiment on a confirmed Rust-level bottleneck.
- Validated that the full propose → approve → implement → test loop works for product Rust changes.
- VS Code (Electron) passing at 150ms is encouraging — partial Electron validation.

**Lessons:**
1. **150ms Windows restore floor is safe for native apps and Blink-based apps.** Notepad, VS Code (Electron), Chrome, Gmail all pass. This was the most important early signal.
2. **VS Code passing at 150ms partially validates the Electron path**, but Slack and Teams use a different IPC model — they must be tested independently before claiming Electron safety.
3. **One-line Rust changes still require manual paste testing.** `cargo check` confirms compilation; it cannot confirm OS clipboard timing behaviour. The test protocol (21 cases) is load-bearing, not optional.
4. **The V12 loop structure worked.** Diagnosis (V11) → proposal (`handoff_task.md`) → approval gate → implement → test → measure is the correct sequence for OS-level timing changes.
5. **Do not record post-fix benchmarks before Electron app tests complete.** If Slack or Teams fails, the change must be reverted, making any recorded benchmarks meaningless.
6. **Provisional KEEP is the correct intermediate state.** Smoke test pass ≠ full validation. Recording `provisional_keep` preserves the signal without overclaiming.

## 2026-04-26 — RC-2 Patch 1: Log First, Then Fix

**What was attempted:** Logging-only diagnostic patch to `src-tauri/src/actions/transcribe.rs`
to diagnose why a recording session can keep running after the user stops dictating.

**What happened:**
- 5 targeted changes: 2 log-level promotions (`debug` → `info`/`warn`), 3 new log lines.
- `cargo check` passed in 11.10 s. No other files changed. Translation check 16/16.
- The binding_id mismatch guard (Path 2B) was previously a silent `debug!` — now a `warn!`.
  If a stop signal is ever dropped by that guard, it will appear in app logs immediately.
- The sampler exit log makes it possible to confirm whether the sampler was still running
  at the time of a stuck-session event (by its absence in logs).

**Why it mattered:**
Patch 2 (defensive sampler timeout) requires knowing correct threshold values. A 10-minute
timeout chosen without log data could terminate legitimate long dictations. The logging patch
collects exactly the data needed — session duration and chunk count at the time of the event.
Shipping Patch 2 without this data would be guessing.

**Lessons:**
1. **Promote silent debug guards to warn before fixing them.** The binding_id mismatch
   `debug!` at `transcribe.rs:1170` was invisible in normal log levels. Promoting it to
   `warn!` costs nothing and immediately surfaces the drop if it occurs.
2. **Logging-only patches are zero-risk, zero-blast-radius instrument insertions.** They
   should be the default first step for any Rust audio-runtime investigation where the
   root cause is unconfirmed between multiple hypotheses.
3. **Sequence: log → observe → confirm → parameterize → fix.** For timing-sensitive Rust
   code, never jump directly to a defensive timeout without observing at least one real
   instance of the bug in instrumented logs.
4. **Worker exit logs already existed** (`[worker] received None sentinel — exiting`,
   `[worker] cancel_flag set — exiting`). Always read the existing log coverage before
   adding new ones — avoids duplicate instrumentation.

---

## 2026-04-27 — V12 Smoke Test: Full Matrix Validates 150ms Floor

**What was attempted:** Smoke-tested the V12 paste delay patch (450ms → 150ms floor) across
all 7 app targets: Notepad, VS Code, Chrome, Gmail, Slack, Teams, Word (21 cases total).

**What happened:**
- All 21 cases passed. No paste failure. No clipboard restore failure.
- Electron apps (VS Code, Slack, Teams) all passed — the earlier concern about Slack/Teams IPC
  model was resolved by direct testing.
- Word (Office/Win32) also passed — no conflict with Office clipboard API at 150ms floor.
- Decision remains PROVISIONAL_KEEP (not upgraded to FULL_KEEP) because ≥5 post-fix
  `paste_latency_ms` benchmark observations are still needed to confirm median < 420ms.

**Why it mattered:**
The prior V12 result was incomplete — Slack, Teams, and Word were deferred. This session
closes the smoke test phase. The patch is now confirmed stable across every major Windows
app category (native, Electron, browser, Office). The remaining validation is quantitative
(latency benchmarks), not qualitative (pass/fail smoke tests).

**Lessons:**
1. **Full smoke test coverage matters — don't defer Electron until last.** VS Code (Electron)
   passing early was encouraging but insufficient. Slack and Teams have different IPC models
   and must be tested directly. Both passed at 150ms, confirming the floor is safe for all
   Electron variants tested.
2. **150ms is safe for Office apps.** Word uses a native Win32 clipboard API that could have
   been sensitive to short delays. It was not — all 3 cases passed cleanly.
3. **PROVISIONAL_KEEP → FULL_KEEP requires benchmark evidence, not just smoke tests.**
   Smoke tests confirm absence of regression. Benchmarks confirm presence of improvement.
   Both are required to close a performance patch cleanly.
4. **Record smoke test results before recording benchmarks.** The lifecycle state
   `PATCH_SHIPPED` correctly blocks re-investigation, while benchmarks in a separate step
   provide the final quantitative gate for FULL_KEEP.

---

## 2026-04-24 — V6 Handoff Validation

**What was attempted:** V6 Product Implementation Handoff Loop generated a scoped task from the approved "Fix: First successful dictation" proposal. Claude implemented it, then committed.

**What happened:**
- V6 generated `outputs/handoff_task.md` with inlined code context, forbidden scope, and V7 benchmark placeholders.
- Implementation touched only `src/components/auth/AuthPortal.tsx` — added retry button and fallback error for `activation_failed` state.
- `bun run format` reformatted many out-of-scope files. These were cleaned with `git restore` before commit.
- All hooks passed: Prettier, ESLint, translation check (16/16 languages).

**Why it mattered:** First full V6 loop validation. Proved the measure → propose → handoff → implement → commit chain works end to end.

**Lessons:**
1. V6 handoff successfully converted a product patch proposal into a scoped, safe implementation task.
2. Always run `git diff --stat` before committing — formatter tools can silently modify out-of-scope files.
3. For activation UI fixes, frontend-only `AuthPortal.tsx` changes are sufficient when `useAuthFlow` already exposes the required callback (`onRefreshSession`). No hook changes needed.
4. Handoff scope rules held: no backend, no auth client, no license client, no Rust modified.
