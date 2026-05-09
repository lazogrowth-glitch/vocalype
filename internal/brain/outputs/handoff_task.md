# handoff_task.md â€” Paste Delay Floor Reduction (V12 Experiment 1)

Date: 2026-04-26
Task type: implementation_task
Prepared by: Vocalype Brain (V12 Phase 1)
Supersedes: prior V6 handoff task (activation UI â€” separate scope)
Status: AWAITING FOUNDER APPROVAL â€” do not implement until Section 11 is signed

---

## 1. Mission Title

**Reduce the Windows clipboard restore delay floor from 450ms to 150ms.**

This is the first V12 continuous improvement experiment. It targets the dominant
contributor to `paste_execute` latency: the hardcoded 450ms Windows restore floor
in `src-tauri/src/platform/clipboard.rs:120`.

Expected outcome: `paste_execute` latency 644ms â†’ ~344ms (saving ~300ms, 47% reduction).

---

## 2. Task Type

`implementation_task`

All prerequisites satisfied:
- Prior diagnosis: `internal/brain/outputs/paste_mechanism_diagnosis.md` âœ…
- Root cause confirmed: `internal/brain/outputs/paste_utils_diagnosis.md` âœ…
- Design: `internal/brain/outputs/v12_design_plan.md` âœ…
- Proposal written: this document âœ…
- Founder approval: â¬œ (Section 11 â€” must be signed before implementation begins)

---

## 3. Exact Product File Allowed

```
src-tauri/src/platform/clipboard.rs
```

**This is the only file the implementation model may modify.**

No other file in `src-tauri/`, `src/`, `backend/`, or anywhere else may be
touched. If the change requires modifying any other file, **stop immediately**
and report â€” do not proceed.

---

## 4. Exact Code Change

### Current code (clipboard.rs:119â€“120, confirmed 2026-04-26)

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
- That is the complete change â€” one token on one line.
- No other lines, imports, signatures, struct fields, or comments are modified.

### What must NOT change

| Element | Location | Why it must not change |
|---|---|---|
| Sleep 1 â€” pre-Ctrl+V | clipboard.rs:87 | 60ms propagation delay. Not the primary target. Do not touch. |
| Non-Windows restore floor | clipboard.rs:122â€“123 | `paste_delay_ms.max(250)` â€” different platform, not in scope. |
| Sleep call itself | clipboard.rs:128 | Only the floor value changes, not the sleep call. |
| All other lines in clipboard.rs | â€” | Not in scope. Do not touch. |
| All other files | â€” | Not in scope. Do not touch. |

---

## 5. Forbidden Scope

The following are **permanently forbidden** for this task. If any would be
required to complete the change, **stop and report immediately**.

```
src/                      â€” no frontend changes
backend/                  â€” no backend changes
src-tauri/src/lib.rs      â€” no app bootstrap changes
src-tauri/src/settings/   â€” no settings changes
src-tauri/src/managers/   â€” no manager changes
src/lib/auth/             â€” auth: forbidden
src/lib/license/          â€” license: forbidden
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
- Do **not** change the non-Windows restore floor (line 123 â€” `max(250)`).
- Do **not** run `cargo fmt` or `bun run format` â€” do not reformat the file.
- Do **not** add comments, log messages, or documentation beyond what exists.
- Do **not** attempt further optimisation (reduce Sleep 1, try 100ms, etc.).
  This experiment tests 150ms only. Further experiments are separate tasks.

---

## 6. Benchmark Before / After Protocol

### Before state (already recorded â€” do not re-measure)

| Metric | Value | Sessions | SD | Source |
|---|---|---|---|---|
| `paste_execute` | ~644ms | 7 | Â±1.2ms | `data/benchmark_observations.jsonl` |

### After state (record post-implementation, Phase 5)

Record **â‰¥5 new `paste_execute` observations** after the change is applied and
all 21 app test cases have passed.

```bash
python internal/brain/scripts/add_benchmark_observation.py \
  --metric paste_latency_ms \
  --value <measured_ms> \
  --unit ms \
  --source manual_founder \
  --period 2026-W18 \
  --notes "post-fix floor=150ms"
```

Repeat for each of â‰¥5 dictation sessions.

### Pass criteria

| Metric | Before | Target | Acceptable range |
|---|---|---|---|
| `paste_execute` | 644ms | ~344ms | 300ms â€“ 420ms |
| Paste success rate | 100% | 100% | must remain 100% |
| Clipboard restore | 100% | 100% | must remain 100% |

A `paste_execute` result outside the acceptable range is not automatically a
failure â€” record and report it. A paste success rate below 100% **is** an
immediate failure: revert before benchmarking.

---

## 7. Test App Protocol (Phase 4 â€” run before benchmarking)

Test **all 7 apps** with **all 3 test cases** before recording any benchmark.
If any test case fails, revert immediately (Section 8) and do not proceed.

| App | Type | Risk | Reason included |
|---|---|---|---|
| Notepad | Native Win32 | Low | Baseline â€” must always pass |
| VS Code | Electron | Medium | Most common dev tool; large Vocalype user base |
| Chrome (address bar or search) | Browser | Medium | Fast clipboard; high user frequency |
| Gmail in Chrome (compose window) | Web app | Medium | Common real-world paste target |
| Slack (message input) | Electron | High | Historically slow clipboard consumption |
| Microsoft Teams (chat input) | Electron | High | Historically slow clipboard consumption |
| Microsoft Word (body text) | COM/native | Medium | Office suite; different paste path |

### Test cases per app (3 per app, 21 total)

| # | Test case | How to run | Pass criteria |
|---|---|---|---|
| T1 | Dictate a 5â€“8 word phrase | Use Vocalype normally; check insertion | Exact transcription inserted â€” no extra chars, no truncation, no old clipboard content |
| T2 | Pre-load clipboard, then dictate | Copy "CLIPBOARD_TEST_XYZ" first, then dictate | Transcription pasted correctly AND clipboard restored to "CLIPBOARD_TEST_XYZ" |
| T3 | Dictate twice in quick succession | Trigger two dictations ~2 seconds apart | Both dictations paste correctly â€” no interleaving, no duplication, no skipped paste |

**All 21 must pass before Phase 5 (benchmarking) begins.**

Record results in Section 10 (Implementation Report) of this file.

---

## 8. Rollback Rule

Revert immediately if **any** of the following occurs:

- Any of the 21 test cases fails (wrong text, missing text, old clipboard content)
- Original clipboard content not restored after any paste
- Vocalype crashes or throws an unhandled exception during paste
- `paste_execute` benchmark median â‰¥ 600ms (no improvement â€” change may not have taken effect)
- `git diff` shows more than one token changed

### Rollback command

```bash
git checkout -- src-tauri/src/platform/clipboard.rs
```

This is the only rollback action. Reverts `clipboard.rs` to the last committed
state (450ms floor). No other files affected. No build step required.

After reverting:
1. Record the failed floor value in `internal/brain/memory/lessons_learned.md`
2. Report to founder: which test case failed, which app, what was observed
3. Do not attempt to debug or fix the failure autonomously
4. Do not try a different floor value without a new founder-approved `handoff_task.md`

---

## 9. Validation Commands

Run in this exact order after applying the change:

### Step 1 â€” Confirm diff is exactly one token

```bash
git diff -- src-tauri/src/platform/clipboard.rs
```

Expected output (approximately):
```diff
-    let restore_delay_ms = paste_delay_ms.max(450);
+    let restore_delay_ms = paste_delay_ms.max(150);
```

If the diff shows **any other change**, stop, revert, and report.

### Step 2 â€” Confirm no whitespace issues

```bash
git diff --check src-tauri/src/platform/clipboard.rs
```

Expected: no output. If output appears, fix whitespace only â€” do not reformat.

### Step 3 â€” Compile check

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: `Finished` with no errors. If errors appear, **stop and revert** â€”
do not attempt to fix compile errors unrelated to this change.

### Step 4 â€” Manual paste test

Run Vocalype (dev mode or built binary). Execute all 21 test cases from
Section 7. Do not skip. Do not benchmark before this step is complete.

### Step 5 â€” Record benchmark observations

Only after all 21 test cases pass:
```bash
python internal/brain/scripts/add_benchmark_observation.py \
  --metric paste_latency_ms --value <ms> --unit ms \
  --source manual_founder --period 2026-W18 --notes "post-fix floor=150ms"
```

### Step 6 â€” Commit (feat(app): only)

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
| HC-S1 | `clipboard.rs` not found at `src-tauri/src/platform/clipboard.rs` | Stop â€” file structure may have changed; report |
| HC-S2 | Line 120 does not contain `paste_delay_ms.max(450)` | Stop â€” source changed since diagnosis; report actual content |
| HC-S3 | Change requires more than one line or more than one file | Stop â€” scope wider than expected; report |
| HC-S4 | `cargo check` fails | Stop â€” do not commit; revert; report full error |
| HC-S5 | Any of the 21 test cases fails | Stop â€” revert immediately; record which app and case failed |
| HC-S6 | Post-fix benchmark median â‰¥ 600ms | Stop â€” revert; change may not have taken effect; report |
| HC-S7 | Temptation to also reduce Sleep 1 or try 100ms | Stop â€” scope-creep; this experiment is 150ms floor only |
| HC-S8 | Section 11 (Founder Approval) is blank | Stop â€” do not implement; approval is the primary gate |
| HC-S9 | `git diff --stat` shows files other than clipboard.rs | Stop â€” do not commit; revert all changes; report |

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
  [ ] FAILED â€” error:

Test results â€” all 21 test cases:

  Notepad:
    T1 (dictate phrase):       [ ] PASS  [ ] FAIL â€” notes:
    T2 (clipboard restore):    [ ] PASS  [ ] FAIL â€” notes:
    T3 (quick succession):     [ ] PASS  [ ] FAIL â€” notes:

  VS Code:
    T1: [ ] PASS  [ ] FAIL â€” notes:
    T2: [ ] PASS  [ ] FAIL â€” notes:
    T3: [ ] PASS  [ ] FAIL â€” notes:

  Chrome:
    T1: [ ] PASS  [ ] FAIL â€” notes:
    T2: [ ] PASS  [ ] FAIL â€” notes:
    T3: [ ] PASS  [ ] FAIL â€” notes:

  Gmail in Chrome:
    T1: [ ] PASS  [ ] FAIL â€” notes:
    T2: [ ] PASS  [ ] FAIL â€” notes:
    T3: [ ] PASS  [ ] FAIL â€” notes:

  Slack:
    T1: [ ] PASS  [ ] FAIL â€” notes:
    T2: [ ] PASS  [ ] FAIL â€” notes:
    T3: [ ] PASS  [ ] FAIL â€” notes:

  Teams:
    T1: [ ] PASS  [ ] FAIL â€” notes:
    T2: [ ] PASS  [ ] FAIL â€” notes:
    T3: [ ] PASS  [ ] FAIL â€” notes:

  Word:
    T1: [ ] PASS  [ ] FAIL â€” notes:
    T2: [ ] PASS  [ ] FAIL â€” notes:
    T3: [ ] PASS  [ ] FAIL â€” notes:

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

Rollback triggered: [ ] YES â€” reason:    [ ] NO

Product code touched:
  src-tauri/src/platform/clipboard.rs â€” line 120 only

Safe to proceed to Phase 6 (compare + learn): [ ] YES  [ ] NO
```

---

## 12. Founder Approval

**This section must be completed before any implementation begins.**
The implementation model must read this section first. If it is blank, stop.

```
Proposed change:   paste_delay_ms.max(450)  â†’  paste_delay_ms.max(150)
File:              src-tauri/src/platform/clipboard.rs
Line:              120
Context:           Windows-only (#[cfg(target_os = "windows")])
Experiment:        V12 Experiment 1 â€” Windows restore delay floor
Expected outcome:  paste_execute 644ms â†’ ~344ms

[ ] I approve this change for implementation.
    Session date:     ____________________
    Approved N value: 150ms   (or specify alternative: _____ms)

Notes (optional):
```

---

*Gate G6 is now satisfied â€” `handoff_task.md` exists.*
*V11 can generate an implementation mission package once Section 12 is signed.*
*Implementation is blocked until the Founder Approval checkbox is checked.*
