# handoff_task.md — Paste Delay Floor Reduction (V12 Experiment 1)

Date: 2026-04-26
Task type: implementation_task
Prepared by: Vocalype Brain (V12 Phase 1)
Supersedes: prior V6 handoff task (activation UI — separate scope)
Status: AWAITING FOUNDER APPROVAL — do not implement until Section 11 is signed

---

## 1. Mission Title

**Reduce the Windows clipboard restore delay floor from 450ms to 150ms.**

This is the first V12 continuous improvement experiment. It targets the dominant
contributor to `paste_execute` latency: the hardcoded 450ms Windows restore floor
in `src-tauri/src/platform/clipboard.rs:120`.

Expected outcome: `paste_execute` latency 644ms → ~344ms (saving ~300ms, 47% reduction).

---

## 2. Task Type

`implementation_task`

All prerequisites satisfied:
- Prior diagnosis: `vocalype-brain/outputs/paste_mechanism_diagnosis.md` ✅
- Root cause confirmed: `vocalype-brain/outputs/paste_utils_diagnosis.md` ✅
- Design: `vocalype-brain/outputs/v12_design_plan.md` ✅
- Proposal written: this document ✅
- Founder approval: ⬜ (Section 11 — must be signed before implementation begins)

---

## 3. Exact Product File Allowed

```
src-tauri/src/platform/clipboard.rs
```

**This is the only file the implementation model may modify.**

No other file in `src-tauri/`, `src/`, `backend/`, or anywhere else may be
touched. If the change requires modifying any other file, **stop immediately**
and report — do not proceed.

---

## 4. Exact Code Change

### Current code (clipboard.rs:119–120, confirmed 2026-04-26)

```rust
#[cfg(target_os = "windows")]
let restore_delay_ms = paste_delay_ms.max(450);
```

### Required change

```rust
#[cfg(target_os = "windows")]
let restore_delay_ms = paste_delay_ms.max(150);
```

**Change summary:**
- Replace the integer literal `450` with `150` on line 120.
- That is the complete change — one token on one line.
- No other lines, imports, signatures, struct fields, or comments are modified.

### What must NOT change

| Element | Location | Why it must not change |
|---|---|---|
| Sleep 1 — pre-Ctrl+V | clipboard.rs:87 | 60ms propagation delay. Not the primary target. Do not touch. |
| Non-Windows restore floor | clipboard.rs:122–123 | `paste_delay_ms.max(250)` — different platform, not in scope. |
| Sleep call itself | clipboard.rs:128 | Only the floor value changes, not the sleep call. |
| All other lines in clipboard.rs | — | Not in scope. Do not touch. |
| All other files | — | Not in scope. Do not touch. |

---

## 5. Forbidden Scope

The following are **permanently forbidden** for this task. If any would be
required to complete the change, **stop and report immediately**.

```
src/                      — no frontend changes
backend/                  — no backend changes
src-tauri/src/lib.rs      — no app bootstrap changes
src-tauri/src/settings/   — no settings changes
src-tauri/src/managers/   — no manager changes
src/lib/auth/             — auth: forbidden
src/lib/license/          — license: forbidden
```

Forbidden semantic areas (regardless of file path):
```
payment logic
billing logic
security logic
audio capture runtime
secrets / .env / secret_store
translation.json
```

Additional experiment-specific restrictions:
- Do **not** change the `paste_delay_ms` default value (settings/mod.rs).
- Do **not** add a new user-facing setting for the restore delay.
- Do **not** change Sleep 1 (the 60ms pre-Ctrl+V delay at line 87).
- Do **not** change the non-Windows restore floor (line 123 — `max(250)`).
- Do **not** run `cargo fmt` or `bun run format` — do not reformat the file.
- Do **not** add comments, log messages, or documentation beyond what exists.
- Do **not** attempt further optimisation (reduce Sleep 1, try 100ms, etc.).
  This experiment tests 150ms only. Further experiments are separate tasks.

---

## 6. Benchmark Before / After Protocol

### Before state (already recorded — do not re-measure)

| Metric | Value | Sessions | SD | Source |
|---|---|---|---|---|
| `paste_execute` | ~644ms | 7 | ±1.2ms | `data/benchmark_observations.jsonl` |

### After state (record post-implementation, Phase 5)

Record **≥5 new `paste_execute` observations** after the change is applied and
all 21 app test cases have passed.

```bash
python vocalype-brain/scripts/add_benchmark_observation.py \
  --metric paste_latency_ms \
  --value <measured_ms> \
  --unit ms \
  --source manual_founder \
  --period 2026-W18 \
  --notes "post-fix floor=150ms"
```

Repeat for each of ≥5 dictation sessions.

### Pass criteria

| Metric | Before | Target | Acceptable range |
|---|---|---|---|
| `paste_execute` | 644ms | ~344ms | 300ms – 420ms |
| Paste success rate | 100% | 100% | must remain 100% |
| Clipboard restore | 100% | 100% | must remain 100% |

A `paste_execute` result outside the acceptable range is not automatically a
failure — record and report it. A paste success rate below 100% **is** an
immediate failure: revert before benchmarking.

---

## 7. Test App Protocol (Phase 4 — run before benchmarking)

Test **all 7 apps** with **all 3 test cases** before recording any benchmark.
If any test case fails, revert immediately (Section 8) and do not proceed.

| App | Type | Risk | Reason included |
|---|---|---|---|
| Notepad | Native Win32 | Low | Baseline — must always pass |
| VS Code | Electron | Medium | Most common dev tool; large Vocalype user base |
| Chrome (address bar or search) | Browser | Medium | Fast clipboard; high user frequency |
| Gmail in Chrome (compose window) | Web app | Medium | Common real-world paste target |
| Slack (message input) | Electron | High | Historically slow clipboard consumption |
| Microsoft Teams (chat input) | Electron | High | Historically slow clipboard consumption |
| Microsoft Word (body text) | COM/native | Medium | Office suite; different paste path |

### Test cases per app (3 per app, 21 total)

| # | Test case | How to run | Pass criteria |
|---|---|---|---|
| T1 | Dictate a 5–8 word phrase | Use Vocalype normally; check insertion | Exact transcription inserted — no extra chars, no truncation, no old clipboard content |
| T2 | Pre-load clipboard, then dictate | Copy "CLIPBOARD_TEST_XYZ" first, then dictate | Transcription pasted correctly AND clipboard restored to "CLIPBOARD_TEST_XYZ" |
| T3 | Dictate twice in quick succession | Trigger two dictations ~2 seconds apart | Both dictations paste correctly — no interleaving, no duplication, no skipped paste |

**All 21 must pass before Phase 5 (benchmarking) begins.**

Record results in Section 10 (Implementation Report) of this file.

---

## 8. Rollback Rule

Revert immediately if **any** of the following occurs:

- Any of the 21 test cases fails (wrong text, missing text, old clipboard content)
- Original clipboard content not restored after any paste
- Vocalype crashes or throws an unhandled exception during paste
- `paste_execute` benchmark median ≥ 600ms (no improvement — change may not have taken effect)
- `git diff` shows more than one token changed

### Rollback command

```bash
git checkout -- src-tauri/src/platform/clipboard.rs
```

This is the only rollback action. Reverts `clipboard.rs` to the last committed
state (450ms floor). No other files affected. No build step required.

After reverting:
1. Record the failed floor value in `vocalype-brain/memory/lessons_learned.md`
2. Report to founder: which test case failed, which app, what was observed
3. Do not attempt to debug or fix the failure autonomously
4. Do not try a different floor value without a new founder-approved `handoff_task.md`

---

## 9. Validation Commands

Run in this exact order after applying the change:

### Step 1 — Confirm diff is exactly one token

```bash
git diff -- src-tauri/src/platform/clipboard.rs
```

Expected output (approximately):
```diff
-    let restore_delay_ms = paste_delay_ms.max(450);
+    let restore_delay_ms = paste_delay_ms.max(150);
```

If the diff shows **any other change**, stop, revert, and report.

### Step 2 — Confirm no whitespace issues

```bash
git diff --check src-tauri/src/platform/clipboard.rs
```

Expected: no output. If output appears, fix whitespace only — do not reformat.

### Step 3 — Compile check

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: `Finished` with no errors. If errors appear, **stop and revert** —
do not attempt to fix compile errors unrelated to this change.

### Step 4 — Manual paste test

Run Vocalype (dev mode or built binary). Execute all 21 test cases from
Section 7. Do not skip. Do not benchmark before this step is complete.

### Step 5 — Record benchmark observations

Only after all 21 test cases pass:
```bash
python vocalype-brain/scripts/add_benchmark_observation.py \
  --metric paste_latency_ms --value <ms> --unit ms \
  --source manual_founder --period 2026-W18 --notes "post-fix floor=150ms"
```

### Step 6 — Commit (feat(app): only)

```bash
git add src-tauri/src/platform/clipboard.rs
git diff --stat   # confirm only clipboard.rs
git commit -m "feat(app): reduce Windows clipboard restore delay floor to 150ms"
```

---

## 10. Stop Conditions

Stop immediately and report when any of the following is true:

| # | Condition | Action |
|---|---|---|
| HC-S1 | `clipboard.rs` not found at `src-tauri/src/platform/clipboard.rs` | Stop — file structure may have changed; report |
| HC-S2 | Line 120 does not contain `paste_delay_ms.max(450)` | Stop — source changed since diagnosis; report actual content |
| HC-S3 | Change requires more than one line or more than one file | Stop — scope wider than expected; report |
| HC-S4 | `cargo check` fails | Stop — do not commit; revert; report full error |
| HC-S5 | Any of the 21 test cases fails | Stop — revert immediately; record which app and case failed |
| HC-S6 | Post-fix benchmark median ≥ 600ms | Stop — revert; change may not have taken effect; report |
| HC-S7 | Temptation to also reduce Sleep 1 or try 100ms | Stop — scope-creep; this experiment is 150ms floor only |
| HC-S8 | Section 11 (Founder Approval) is blank | Stop — do not implement; approval is the primary gate |
| HC-S9 | `git diff --stat` shows files other than clipboard.rs | Stop — do not commit; revert all changes; report |

---

## 11. Implementation Report

The implementation model fills in this section after completing the task.
Write "n/a" if a section does not apply. Do not leave fields blank.

```
## Implementation Report

Date:
Implementor:

Diff confirmed (paste git diff output here):


cargo check result:
  [ ] PASSED
  [ ] FAILED — error:

Test results — all 21 test cases:

  Notepad:
    T1 (dictate phrase):       [ ] PASS  [ ] FAIL — notes:
    T2 (clipboard restore):    [ ] PASS  [ ] FAIL — notes:
    T3 (quick succession):     [ ] PASS  [ ] FAIL — notes:

  VS Code:
    T1: [ ] PASS  [ ] FAIL — notes:
    T2: [ ] PASS  [ ] FAIL — notes:
    T3: [ ] PASS  [ ] FAIL — notes:

  Chrome:
    T1: [ ] PASS  [ ] FAIL — notes:
    T2: [ ] PASS  [ ] FAIL — notes:
    T3: [ ] PASS  [ ] FAIL — notes:

  Gmail in Chrome:
    T1: [ ] PASS  [ ] FAIL — notes:
    T2: [ ] PASS  [ ] FAIL — notes:
    T3: [ ] PASS  [ ] FAIL — notes:

  Slack:
    T1: [ ] PASS  [ ] FAIL — notes:
    T2: [ ] PASS  [ ] FAIL — notes:
    T3: [ ] PASS  [ ] FAIL — notes:

  Teams:
    T1: [ ] PASS  [ ] FAIL — notes:
    T2: [ ] PASS  [ ] FAIL — notes:
    T3: [ ] PASS  [ ] FAIL — notes:

  Word:
    T1: [ ] PASS  [ ] FAIL — notes:
    T2: [ ] PASS  [ ] FAIL — notes:
    T3: [ ] PASS  [ ] FAIL — notes:

All 21 passed: [ ] YES  [ ] NO

Post-fix benchmark observations:
  observation 1: ___ms
  observation 2: ___ms
  observation 3: ___ms
  observation 4: ___ms
  observation 5: ___ms
  median: ___ms

Improvement vs baseline (644ms):
  delta: ___ms    improvement: ___%

Commit hash (feat(app):):

Rollback triggered: [ ] YES — reason:    [ ] NO

Product code touched:
  src-tauri/src/platform/clipboard.rs — line 120 only

Safe to proceed to Phase 6 (compare + learn): [ ] YES  [ ] NO
```

---

## 12. Founder Approval

**This section must be completed before any implementation begins.**
The implementation model must read this section first. If it is blank, stop.

```
Proposed change:   paste_delay_ms.max(450)  →  paste_delay_ms.max(150)
File:              src-tauri/src/platform/clipboard.rs
Line:              120
Context:           Windows-only (#[cfg(target_os = "windows")])
Experiment:        V12 Experiment 1 — Windows restore delay floor
Expected outcome:  paste_execute 644ms → ~344ms

[ ] I approve this change for implementation.
    Session date:     ____________________
    Approved N value: 150ms   (or specify alternative: _____ms)

Notes (optional):
```

---

*Gate G6 is now satisfied — `handoff_task.md` exists.*
*V11 can generate an implementation mission package once Section 12 is signed.*
*Implementation is blocked until the Founder Approval checkbox is checked.*
