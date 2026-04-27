# Vocalype Brain — Results Report

Date: 2026-04-26

## Recent Results

- 2026-04-23T20:40:50: Frontend clarity pass for first successful dictation -> needs_manual_test
- 2026-04-23T20:41:08: Frontend clarity pass for first successful dictation -> needs_manual_test
- 2026-04-24T08:59:22: Frontend clarity pass for first successful dictation -> keep
- 2026-04-24T09:09:56: Frontend clarity pass for first successful dictation -> keep
- 2026-04-24T09:43:29: Frontend clarity pass for first successful dictation -> keep
- 2026-04-24T13:18:23: Fix: First successful dictation — activation_failed retry state -> keep
- 2026-04-26T00:00:00: V12 Experiment 1 — Windows paste restore delay floor 450ms → 150ms -> **provisional_keep** (Slack/Teams/Word + benchmarks pending)
- 2026-04-26T00:00:00: RC-2 Patch 1 — stuck recording diagnostic logs -> **keep**

## Latest Result — RC-2 Patch 1: Stuck Recording Diagnostic Logs (KEEP)

**Task:** Add logging-only instrumentation to diagnose stuck recording session (RC-2)
**Source:** Claude Code implementation mission (Operating Mode, founder approved)
**Product commit:** `0820936` — `chore(app): add stuck recording diagnostic logs`
**Files changed:** `src-tauri/src/actions/transcribe.rs` only
**Product code touched:** Yes — approved single file, logging-only

**What was added:**

| Log | Level | Location | Condition |
|---|---|---|---|
| `stop_transcription_action called binding={id}` | `info` | `stop_transcription_action` entry | Always |
| `binding_id mismatch — received='{x}' active={y}; stop signal dropped` | `warn` | binding_id guard | When mismatch occurs |
| `[sampler] still running after {N}s ({M} chunks dispatched) — possible stuck session` | `warn` | sampler loop | ≥300 s elapsed, then every 60 s |
| `[sampler] exiting — ran {N}s, {M} chunks dispatched` | `info` | sampler exit | Always |

**Behavior changed:** No. Pure logging. No control flow change. No new dependencies.

**Checks passed:**
- `cargo check` — Finished dev profile in 11.10s, 0 errors ✅
- `git diff --check` — whitespace-ok ✅
- Translation check — 16/16 languages ✅

**Decision: KEEP**

**Recommended next step:**
Run Vocalype normally until the stuck-session issue reproduces (mic runs without user dictating,
RAM growing). Then inspect app logs for:
1. Did `warn! stop_transcription_action: binding_id mismatch` appear? → Path 2B confirmed
2. Did `warn! [sampler] still running after 300s` appear? → RC-2 active, sampler still alive
3. Did `info! [sampler] exiting` appear shortly after a stop? → session stopped cleanly

This log evidence determines parameters for Patch 2 (defensive sampler timeout).

---

## Previous Latest Result — Idle Background Inference Loop Diagnosis (KEEP)

**Task:** Idle background inference loop / RAM growth — read-only investigation + settings confirmation
**Source:** Claude Code investigation mission (Operating Mode)
**Brain files:** `idle_background_transcription_diagnosis.md`, `idle_background_diagnosis_result.md`
**Product code touched:** None

**What was found:**

Local settings (`%APPDATA%\com.vocalype.desktop\settings_store.json`):
- `wake_word_enabled = false` — RC-1 (wake-word silence-gate) NOT active on this machine
- `always_on_microphone = true` — mic stream permanently open
- `model_unload_timeout = "never"` — model resident by design
- `selected_model = parakeet-tdt-0.6b-v3-multilingual`

**Root cause confirmed:** RC-2 — stuck recording session (chunking worker).
The `[worker] processing chunk idx=83..99` pattern comes from `actions/transcribe.rs:846`
and is only active during a live recording. The session never received a stop signal,
so the VAD-gated chunking sampler ran indefinitely on ambient audio.

**Key code paths confirmed:**
- Sampler exits only when `snapshot_recording()` returns `None` (`transcribe.rs:685–688`)
- Silent drop path: `stop_transcription_action` ignores stops when `active_binding_id` mismatches (`transcribe.rs:1169–1176`)
- VAD hangover = 600 ms at Parakeet V3 threshold 0.28 → ambient noise accumulates slowly

**Decision: KEEP**
Diagnosis is complete and confirmed. Separate implementation mission needed.

**Recommended next step:**
Investigate the stop path (binding_id mismatch) then implement a defensive sampler timeout
as the minimum safe fix. Wake-word silence gate (Fix A) is a valid future improvement
for machines where `wake_word_enabled = true`.

---

## Previous Latest Result — V12 Experiment 1 (PROVISIONAL_KEEP)

**Task:** V12 Experiment 1 — Reduce Windows paste restore delay floor 450ms → 150ms
**Source:** V12 continuous improvement loop
**Product commit:** f842401 — perf(app): reduce Windows paste restore delay floor
**Brain commits:** 4c5d593 (handoff task), 29dc5da (V12 design), 4cafbb5 (V11 closure)
**Files changed:** `src-tauri/src/platform/clipboard.rs` line 120 only

**What shipped:**
- `paste_delay_ms.max(450)` → `paste_delay_ms.max(150)` — one token, one line
- Windows-only (`#[cfg(target_os = "windows")]`) — other platforms unchanged
- Expected saving: ~300ms (paste_execute 644ms → ~344ms)

**Smoke tests (founder, 2026-04-26):**
- Notepad ✅ | VS Code ✅ | Chrome ✅ | Gmail ✅ — all 12 cases passed
- Slack ⬜ | Teams ⬜ | Word ⬜ — 9 cases still pending

**Checks passed:**
- `git diff` — exactly 1 token changed ✅
- `git diff --check` — no whitespace issues ✅
- `cargo check` — Finished in 11.58s, no errors ✅
- Translation check — 16/16 languages complete ✅

**Decision: PROVISIONAL_KEEP**
Becomes FULL_KEEP when: Slack + Teams + Word pass all cases AND ≥5 post-fix benchmarks confirm median < 420ms.

## Previous Latest Result — V6 Handoff Validation

**Task:** Fix: First successful dictation — activation_failed retry state
**Source:** V6 handoff loop
**Brain commit:** 12b3295 feat(brain): add V6 implementation handoff loop
**Product commit:** 706d6c0 feat(app): add activation retry state for first dictation
**Files changed:** src/components/auth/AuthPortal.tsx (only)

**What shipped:**
- `activation_failed` state now shows a visible fallback error message when `authError` is null
- Active amber "Réessayer l'activation" button replaces the silent disabled spinner
- `handleRetry` resets the 8-cycle auto-refresh counter and calls `onRefreshSession()`
- No backend / auth client / license client / Rust changes

**Checks passed:**
- Prettier ✅
- ESLint — 0 errors ✅
- Translation check — 16/16 languages complete ✅
- Manual test — pending (all 5 activation states)

**Scope held:**
- Only `src/components/auth/AuthPortal.tsx` modified
- Out-of-scope Prettier formatting on other files was cleaned with `git restore` before commit

## Repeated Wins

- Clear privacy/offline messaging
- Reduced steps to first successful dictation
- Benchmark-driven model changes
- 2026-04-23: Safe frontend-only clarity improvements can improve first successful dictation without touching backend/auth/Rust layers.
- 2026-04-24: Safe frontend-only clarity improvements can improve first successful dictation without touching backend/auth/Rust layers.
- 2026-04-24 V6: Full handoff loop validated — Brain generates scoped task → implementation model executes → hooks pass → clean commit.

## Repeated Mistakes

- Do not polish invisible features before fixing activation.
- Do not publish generic startup content when a product demo would be clearer.
- Do not change model defaults without benchmarks.
- 2026-04-23: Night Shift should narrow frontend clarity tasks before suggesting sensitive backend, auth, or Rust files.
- 2026-04-24: Night Shift should narrow frontend clarity tasks before suggesting sensitive backend, auth, or Rust files.
- 2026-04-24: Always run `git diff --stat` before committing — `bun run format` silently reformats out-of-scope files.

## Top Lessons

- Night Shift correctly prioritized first successful dictation.
- Codex implemented a safe frontend-only clarity improvement.
- Future UI clarity tasks should prefer frontend-only scope before backend/auth/Rust changes.
- Night Shift initially proposed too many sensitive files; future task generation should narrow scope.
- 2026-04-24 V3.5: Approved patch application must require explicit --approve and must refuse patches without Apply Instructions.
- 2026-04-24 V6: V6 handoff converts a product proposal into a scoped implementation task. Scope rules held across the full loop.
- 2026-04-24 V6: For activation UI, `AuthPortal.tsx`-only is sufficient when `useAuthFlow` already exposes the required hook. No hook changes needed.
- 2026-04-24 V6: Formatter tools can introduce out-of-scope file changes. Always inspect `git diff --stat` before staging.

## Recommended Changes to Night Shift Behavior

- Prefer frontend-only scope first for UI clarity tasks.
- Narrow proposed files to the smallest safe surface before suggesting implementation.
- Keep quality and activation observations attached to the next proposal.

## Recommended Next Action

1. **Complete V12 Phase 4** (founder — no Brain session): Test Slack (3 cases), Teams (3 cases), Word (3 cases) with Vocalype built from `f842401`. If any fails → `git checkout -- src-tauri/src/platform/clipboard.rs`.
2. **Record V12 Phase 5 benchmarks** (founder): ≥5 `paste_latency_ms` observations via `add_benchmark_observation.py --notes "post-fix floor=150ms"`.
3. **Close V12** (Brain session): Run `generate_unified_report.py`, update `wins.md`, write V12 closure report.
