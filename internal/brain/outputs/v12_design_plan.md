# Vocalype Brain â€” V12 Design Plan
# Continuous Improvement Loop

Date: 2026-04-26
Task type: planning_only
Author: Vocalype Brain
Status: DESIGN â€” awaiting founder approval

---

## 1. What V12 Should Do

V12 is the Brain's first **continuous improvement loop**: it takes a confirmed
bottleneck, proposes a safe minimal change, oversees its implementation,
measures the result, and feeds the outcome back into the Brain's knowledge layer.

V12 does not diagnose. Diagnosis is V11's job. V12 receives a confirmed root
cause and a fix target, then executes the full propose â†’ implement â†’ test â†’
compare â†’ learn cycle.

**V12 mandate â€” in order:**

| Phase | Action | Output |
|---|---|---|
| 1 â€” Propose | Write `handoff_task.md` for the paste delay floor change | `outputs/handoff_task.md` |
| 2 â€” Gate | Await founder approval of proposal before any implementation | founder sign-off in session |
| 3 â€” Implement | V11 generates implementation package; implementation model executes one-line change | `clipboard.rs:120` modified |
| 4 â€” Test | Founder manually tests paste across 5â€“10 Windows apps per protocol | test checklist signed off |
| 5 â€” Measure | Record â‰¥5 new `paste_latency_ms` benchmark observations | appended to `benchmark_observations.jsonl` |
| 6 â€” Compare | Run `generate_unified_report.py`; confirm `paste_latency_ms` improvement | `unified_weekly_report.md` updated |
| 7 â€” Learn | Record outcome in `wins.md` or `lessons_learned.md`; update V10 diagnosis layer | brain memory updated |

V12 is designed to be **repeatable**: once the paste fix cycle closes, the same
loop applies to the next confirmed bottleneck (RAM growth, idle inference loop,
inference latency). V12 is not paste-specific â€” it is a reusable improvement
scaffold.

---

## 2. What V12 Must NOT Do

| Forbidden action | Why |
|---|---|
| Directly implement the paste fix without a written proposal | Operating contract: propose before implement (Section 2, step sequence) |
| Skip founder approval between proposal and implementation | Approval is a hard gate â€” V11 Gate G6 blocks impl without `handoff_task.md` |
| Set the restore floor to 0ms or remove Sleep 2 entirely | 0ms risks paste failures on Electron apps â€” comments in clipboard.rs confirm this is real |
| Assume the fix is safe for all apps without testing | Electron apps (Slack, Teams) have slow clipboard consumption â€” empirical testing required |
| Claim the fix is "done" based on code change alone | "Fixed" = `paste_latency_ms < 300ms` in â‰¥5 new benchmark observations |
| Merge proposal + implementation into one commit | Operating contract: one task = one commit |
| Touch `src-tauri/` before Gate G6 is satisfied | `handoff_task.md` must exist and be approved first |
| Propose changes to Sleep 1 (60ms) as the primary target | Sleep 1 saves 60ms; Sleep 2 (450ms floor) is the dominant target |
| Modify the idle inference loop as part of this experiment | Separate problem â€” Track B, not part of PB-1 scope |
| Auto-commit or auto-deploy any change | Founder approves all commits explicitly â€” operating contract Section 3 |
| Widen scope to other clipboard.rs changes in the same experiment | One bottleneck = one experiment; don't bundle unrelated changes |

---

## 3. Exact Input Files

All inputs are read-only. V12 never modifies these.

| File | Purpose |
|---|---|
| `internal/brain/memory/operating_contract.md` | Safety rules, stop conditions, workflow sequence |
| `internal/brain/memory/current_state.md` | Current brain phase, pending actions |
| `internal/brain/outputs/paste_mechanism_diagnosis.md` | V11 PB-1 â€” paste.rs investigation (Gate G5 prerequisite) |
| `internal/brain/outputs/paste_utils_diagnosis.md` | V11 follow-up â€” clipboard.rs root cause confirmation |
| `internal/brain/outputs/v11_closure_report.md` | V11 closure â€” improvement loop spec, safe improvement steps |
| `internal/brain/data/benchmark_observations.jsonl` | Before-state benchmark data (current `paste_latency_ms = 644ms`) |
| `src-tauri/src/platform/clipboard.rs` | Read-only â€” confirm exact line reference before proposal |

`clipboard.rs` is read-only at V12 Phase 1 (proposal writing). It is only
modified in Phase 3 (implementation), and only after Gate G6 is satisfied.

---

## 4. Exact Output Files

| File | Phase | Description |
|---|---|---|
| `internal/brain/outputs/v12_design_plan.md` | Design | This document |
| `internal/brain/outputs/handoff_task.md` | Phase 1 | Paste delay floor proposal â€” scope, change, test protocol, rollback |
| `internal/brain/data/v11_execution_log.jsonl` | Phase 3 | New record: `product_implementation` type, status COMPLETE after impl |
| `internal/brain/data/benchmark_observations.jsonl` | Phase 5 | â‰¥5 new `paste_latency_ms` observations after fix |
| `internal/brain/outputs/unified_weekly_report.md` | Phase 6 | Updated after new benchmark data â€” confirm improvement |
| `internal/brain/memory/wins.md` | Phase 7 | If improvement confirmed: before=644ms, after=Xms, floor_value=Nms |
| `internal/brain/memory/lessons_learned.md` | Phase 7 | Regardless of outcome: what the floor value test revealed |
| `internal/brain/memory/current_state.md` | Phase 7 | Updated phase after V12 closes |

**Product file modified (Phase 3 only):**
- `src-tauri/src/platform/clipboard.rs` â€” line 120 only, one-line change, `feat(app):` commit

---

## 5. Continuous Improvement Loop Format

V12 uses the Brain's standard improvement cycle from operating_contract.md Section 5:

```
CURRENT STATE
  paste_latency_ms = 644ms (confirmed, 7 sessions, Â±1.2ms)
  root cause: clipboard.rs:120 â€” paste_delay_ms.max(450)
  status: measure âœ… | diagnose âœ… | propose â¬œ | implement â¬œ | test â¬œ | compare â¬œ | learn â¬œ

PHASE 1 â€” Propose
  Write handoff_task.md
  Scope: clipboard.rs:120 only
  Change: paste_delay_ms.max(450) â†’ paste_delay_ms.max(N)
  Test values: 300, 200, 150, 100ms
  Commit type: docs(brain):

PHASE 2 â€” Gate (founder)
  Read handoff_task.md
  Approve N value or specify alternative
  No implementation until explicit approval in session

PHASE 3 â€” Implement
  V11 Gate G5: paste_mechanism_diagnosis.md exists âœ…
  V11 Gate G6: handoff_task.md exists âœ… (after Phase 1)
  V11 generates implementation mission package
  Implementation model applies change to clipboard.rs:120
  Commit type: feat(app):

PHASE 4 â€” Test
  Founder tests paste in 5â€“10 Windows apps (checklist from handoff_task.md)
  Pass: text inserted correctly, correct content, original clipboard restored
  Fail: revert to max(450), try higher floor, return to Phase 2

PHASE 5 â€” Measure
  run: python internal/brain/scripts/add_benchmark_observation.py
  record â‰¥5 new paste_latency_ms observations
  target: median < 300ms
  Commit type: data(brain):

PHASE 6 â€” Compare
  run: python internal/brain/scripts/generate_unified_report.py
  confirm: paste_latency_ms removed from "Known Product Constraints" table
  confirm: paste_latency_ms < 300ms in new data
  confirm: no regression in other metrics
  Commit type: docs(brain):

PHASE 7 â€” Learn
  Update wins.md: before=644ms, after=Xms, floor_chosen=Nms
  Update lessons_learned.md: min safe floor, which apps tested, what failed
  Update current_state.md: V12 CLOSED
  Commit type: docs(brain):
```

---

## 6. Patch Proposal Format (`handoff_task.md`)

`handoff_task.md` is the V12 Phase 1 output and the Gate G6 prerequisite for
V11 to generate an implementation mission package.

Required sections:

```markdown
# handoff_task.md â€” Paste Delay Floor Reduction

## Scope
- Target file: src-tauri/src/platform/clipboard.rs
- Target line: 120
- Change type: single value replacement
- No other files modified

## Current Code
#[cfg(target_os = "windows")]
let restore_delay_ms = paste_delay_ms.max(450);

## Proposed Change
#[cfg(target_os = "windows")]
let restore_delay_ms = paste_delay_ms.max(N);

where N = [approved value] ms

## Why This Change
- paste_latency_ms = 644ms baseline (7 sessions, Â±1.2ms)
- 450ms floor is the dominant contributor (69% of total latency)
- Reducing to N ms is projected to bring paste_latency_ms to:
  N=300: ~410ms | N=200: ~310ms | N=150: ~344ms | N=100: ~294ms
- Target: paste_latency_ms < 300ms

## Test Protocol
See Section: Test Protocol (below)

## Rollback Plan
git checkout -- src-tauri/src/platform/clipboard.rs
Reverts to max(450) immediately. No other files affected.

## Benchmark Measurement Plan
- Before: paste_latency_ms = 644ms (already recorded)
- After: â‰¥5 new observations via add_benchmark_observation.py
- Pass: median < 300ms, no paste failures across test suite

## Approved N Value
[founder fills this in at approval time]

## Approval
[ ] Founder approved â€” session date: ____________
```

The `handoff_task.md` must exist and be non-empty before V11 will generate an
implementation mission package. Gate G6 checks for file existence.

---

## 7. Benchmark Before/After Protocol

### Before state (already recorded)
- Metric: `paste_latency_ms`
- Value: 644ms
- Sessions: 7
- SD: Â±1.2ms
- Source: `data/benchmark_observations.jsonl`
- Method: V7 manual benchmark recorder (`add_benchmark_observation.py`)

### After state (to record in Phase 5)
Minimum 5 new observations. Each observation:
```bash
python internal/brain/scripts/add_benchmark_observation.py \
  --metric paste_latency_ms \
  --value <measured_value> \
  --unit ms \
  --source manual_founder \
  --period <YYYY-Www> \
  --notes "post-fix floor=Nms"
```

### Pass criteria
| Criterion | Pass | Fail |
|---|---|---|
| Median `paste_latency_ms` | < 300ms | â‰¥ 300ms |
| Individual observation range | â‰¥5 values below 400ms | any observation â‰¥ 600ms |
| Paste success rate (manual test) | 100% across test suite | any failure |
| Clipboard restore | original clipboard preserved in all apps | any content loss |

### Comparison method
```bash
python internal/brain/scripts/generate_unified_report.py
```
After running, `unified_weekly_report.md` should show:
- `paste_latency_ms` moved from "Known Product Constraints" to resolved
- `paste_latency_ms` improvement: 644ms â†’ Xms (delta = savings)

If the median is â‰¥ 300ms after the fix, the fix did not meet the threshold.
Trigger the rollback protocol, increase N, and repeat from Phase 2.

---

## 8. Safety Gates

V12 has 9 safety gates. All must pass before Phase 3 (implementation) begins.

| Gate | ID | Check | Pass condition | On failure |
|---|---|---|---|---|
| Prior diagnosis exists | G-V12-1 | `outputs/paste_mechanism_diagnosis.md` exists | File present and non-empty | STOP â€” cannot propose without diagnosis |
| Root cause confirmed | G-V12-2 | `outputs/paste_utils_diagnosis.md` exists and confirms clipboard.rs:120 | File present, mentions Sleep 2 and 450ms | STOP â€” re-run diagnosis |
| Proposal written | G-V12-3 | `outputs/handoff_task.md` exists and contains approved N value | File present, `## Approved N Value` section filled | BLOCK Phase 3 â€” write proposal first |
| Founder approval | G-V12-4 | Approval checkbox in `handoff_task.md` is checked | `[x] Founder approved` with session date | BLOCK Phase 3 â€” no approval = no impl |
| Scope is single file | G-V12-5 | Implementation touches only `clipboard.rs` | diff shows only clipboard.rs:120 changed | STOP â€” reject implementation, re-scope |
| Scope is single line | G-V12-6 | Only line 120 changes in clipboard.rs | diff shows â‰¤2 lines changed (the `#[cfg]` line + the value line) | STOP â€” reject, scope too wide |
| No forbidden patterns | G-V12-7 | Implementation does not touch payment, auth, license, backend/ | `git diff --stat` shows no forbidden paths | STOP â€” reject commit |
| Test protocol complete | G-V12-8 | All apps in test checklist have been tested before claiming fix | handoff_task.md test checklist has results for all apps | BLOCK Phase 6 â€” measure only after testing |
| Benchmark observations â‰¥5 | G-V12-9 | â‰¥5 new `paste_latency_ms` records after fix | `benchmark_observations.jsonl` has â‰¥5 new post-fix records | BLOCK Phase 6 compare â€” collect more data |

---

## 9. Stop Conditions

In addition to the operating contract's standard stop conditions (S1â€“S10),
V12 adds the following experiment-specific stop conditions:

| # | Condition | Action |
|---|---|---|
| V12-S1 | paste_mechanism_diagnosis.md or paste_utils_diagnosis.md does not exist | Stop Phase 1 â€” write proposal only after both files exist |
| V12-S2 | `handoff_task.md` is written but N value is not filled in | Stop Phase 3 â€” do not generate impl package without approved N |
| V12-S3 | Implementation diff shows more than clipboard.rs:120 changed | Stop â€” reject the implementation, revert, re-scope |
| V12-S4 | Any test app fails during Phase 4 (wrong text pasted or clipboard not restored) | Stop Phase 5 â€” revert immediately before measuring |
| V12-S5 | Post-fix benchmark median â‰¥ 300ms | Stop Phase 6 â€” do not update wins.md; trigger rollback protocol |
| V12-S6 | Post-fix benchmark shows regression in another metric | Stop â€” investigate before proceeding to Phase 7 |
| V12-S7 | `allow_product_code_modifications` flag is false in brain.config.json at implementation time | Stop â€” V11 impl gate will refuse; check config before generating impl package |
| V12-S8 | Founder has not explicitly approved in the current session | Stop Phase 3 â€” approval must be live in session, not assumed from a prior session |

---

## 10. Rollback Rules

The paste delay floor change is a single-line change in a single file.
Rollback is immediate and deterministic.

### How to rollback
```bash
git checkout -- src-tauri/src/platform/clipboard.rs
```

This reverts `clipboard.rs` to the last committed state (450ms floor).
No other files are affected. No build step is required.

### When to rollback (trigger any one of these)
1. Any test app in Phase 4 produces wrong text (wrong content pasted)
2. Any test app in Phase 4 shows clipboard content not restored
3. Post-fix `paste_latency_ms` median â‰¥ 300ms (improvement threshold not met)
4. Post-fix `paste_latency_ms` individual observation â‰¥ 600ms (regression to baseline)
5. Any crash, exception, or unexpected behavior reported during testing
6. Founder decides not to proceed after seeing Phase 4 test results

### After rollback
- Record the failed floor value in `lessons_learned.md`
- Increase N to the next higher test value
- Return to Phase 2 (founder approval of new N)
- Re-run Phase 3â€“5 with new value
- Do not attempt to diagnose crash cause inside V12 â€” stop and report

### Test values ladder (lowest risk to highest risk)
Try in this order if a lower value fails:
```
300ms â†’ 200ms â†’ 150ms â†’ 100ms
            â†‘ start here
```
Starting at 150ms is recommended: Electron app safe lower bound is estimated
at 150â€“200ms based on similar implementations. 100ms may fail Slack/Teams.
Starting lower than 100ms is not recommended without further diagnosis.

---

## 11. How to Decide Keep vs Revert

| Outcome | Decision | Action |
|---|---|---|
| All Phase 4 apps pass AND post-fix median < 300ms | **KEEP** | Proceed to Phase 6 compare |
| All Phase 4 apps pass BUT post-fix median â‰¥ 300ms | **REVERT and try lower N** | N saved time but not enough â€” try 100ms or 50ms |
| Any Phase 4 app fails (wrong paste or clipboard loss) | **REVERT immediately** | Try higher N â€” increase by 50ms and re-test |
| Post-fix median < 300ms but one observation â‰¥ 600ms | **INVESTIGATE first** | Outlier may be measurement error â€” run 3 more observations before deciding |
| Any crash or exception | **REVERT immediately** | Stop V12, report to founder â€” this is a V11-level investigation |

**Decision formula:**
```
keep = all_apps_passed AND median_paste_ms < 300
```

If `keep = false`, revert before any further action. Do not record a win for a
partial improvement.

---

## 12. How to Record Lessons Learned

Lessons are recorded **regardless of outcome** â€” a failed test is as valuable as a success.

### On success (keep = true)
Update `memory/wins.md`:
```markdown
## paste_latency_ms reduction â€” [date]
- before: 644ms (7 sessions, Â±1.2ms)
- after: Xms (N observations post-fix)
- floor value chosen: Nms
- apps tested: [list]
- all passed: yes
- improvement: 644ms â†’ Xms = -Yms (-Z%)
```

Update `memory/lessons_learned.md`:
```markdown
## paste restore floor â€” minimum safe value
- 450ms was the original Windows floor (clipboard.rs:120)
- Nms was the minimum safe value across [apps tested]
- Apps that were close to failing: [list if any â€” e.g. "Slack passed at 150ms but was borderline"]
- Electron app behavior: [observation]
- Sleep 1 (60ms pre-Ctrl+V) was not tested â€” still at default
```

### On failure (keep = false)
Update `memory/lessons_learned.md`:
```markdown
## paste restore floor â€” failed experiment: floor=Nms
- Tested floor value: Nms
- Failed app: [app name]
- Failure mode: [wrong text pasted | clipboard not restored | paste did nothing]
- Conclusion: Nms is below safe minimum for [app]
- Next test value: N+50ms
```

Do NOT update `wins.md` on failure.
Do update `lessons_learned.md` â€” failures teach the safe lower bound.

---

## 13. First Target Experiment: Paste Delay Floor

This is the concrete first experiment V12 will execute.

### Target
```
File:    src-tauri/src/platform/clipboard.rs
Line:    120
Current: let restore_delay_ms = paste_delay_ms.max(450);
Change:  let restore_delay_ms = paste_delay_ms.max(N);
```

### Recommended starting N
**150ms** â€” rationale:
- At 150ms: total latency = 60 + 150 + 134 = ~344ms (above 300ms threshold)
- At 100ms: total latency = 60 + max(60,100) + 134 = ~294ms (just below threshold)
- 150ms is more conservative; use it to validate app compatibility first
- If 150ms passes all apps â†’ try 100ms in a second experiment for full threshold clearance
- If 100ms fails any app â†’ 150ms is the confirmed safe floor and ~344ms is the achievable target

### Test app list (Phase 4)
Minimum 5 apps. Recommended 7:

| App | Type | Risk level | Why included |
|---|---|---|---|
| Notepad | Native Win32 | Low | Baseline; should always pass |
| VS Code | Electron | Medium | Most common dev tool; large user base |
| Chrome (address bar) | Browser/Blink | Medium | Fast clipboard consumption |
| Gmail in Chrome | Web app | Medium | Text input via browser |
| Slack | Electron | High | Historically slow clipboard consumption |
| Microsoft Teams | Electron | High | Historically slow clipboard consumption |
| Microsoft Word | COM/native | Medium | Office suite; different paste path |

### Test cases per app (3 per app)
For each app, run all 3 test cases:

| # | Test case | Pass criteria |
|---|---|---|
| T1 | Dictate 5-word phrase, check pasted text | Exact match â€” no extra characters, no truncation |
| T2 | Dictate with existing text in clipboard | Original clipboard content preserved after paste |
| T3 | Dictate twice in quick succession | Both pastes correct, no interleaving or duplication |

**Total: 7 apps Ã— 3 test cases = 21 test cases**

A single failure in any of the 21 test cases triggers the rollback protocol.

### Expected outcome
```
150ms floor â†’ paste_latency_ms â‰ˆ 344ms   (improvement: 300ms saved, 47%)
100ms floor â†’ paste_latency_ms â‰ˆ 294ms   (improvement: 350ms saved, 54%) â€” meets threshold
```

The 300ms threshold is met only at ~100ms floor. V12 should start at 150ms for
safety, confirm all 21 test cases pass, then propose a second experiment at 100ms
if the founder wants to reach the 300ms threshold.

---

## 14. Future Implementation Steps

After the paste delay floor experiment closes, V12 (or V13) applies the same
loop to the next confirmed bottleneck. V10 weekly action will re-run after V12
closes and surface the next priority.

Expected next bottleneck candidates (from V11 data):

| Bottleneck | Metric | Current value | Source |
|---|---|---|---|
| RAM growth (idle loop) | `ram_mb` | +110MB / 15 min | benchmark_observations.jsonl line 43 |
| STT inference latency | `stt_inference_time_ms` | 178â€“253ms / chunk | per-chunk inference logs |
| Idle background transcription | `idle_loop_active` | confirmed running | paste_mechanism_diagnosis.md |

**RAM growth (idle loop)** is the most likely next priority after paste is fixed.
V11 Track B (`idle_background_transcription_diagnosis.md`) covers this.
V12 does NOT investigate this â€” that is a separate V11 Track B investigation.

**Loop format for future bottlenecks:**
The same 7-phase loop applies. The only per-experiment specifics are:
1. The target file and line in `handoff_task.md`
2. The test protocol (apps + test cases relevant to the change)
3. The benchmark metric (e.g., `ram_mb` instead of `paste_latency_ms`)
4. The rollback command (same pattern: `git checkout -- <file>`)

---

## 15. Validation Commands

### Phase 1 validation (proposal written)
```bash
# Confirm handoff_task.md exists and has required sections
python -c "
import pathlib
f = pathlib.Path('internal/brain/outputs/handoff_task.md').read_text()
required = ['## Scope', '## Current Code', '## Proposed Change', '## Test Protocol', '## Rollback Plan', '## Benchmark Measurement Plan', '## Approved N Value']
missing = [s for s in required if s not in f]
print('PASS' if not missing else f'MISSING: {missing}')
"
```

### Phase 3 validation (implementation applied)
```bash
# Confirm only clipboard.rs changed and only line 120
git diff --stat
git diff src-tauri/src/platform/clipboard.rs
# Expected: exactly 1 line changed (the max(450) value)
```

### Phase 5 validation (benchmark recorded)
```bash
# Confirm â‰¥5 new post-fix observations exist
python -c "
import json, pathlib
records = [json.loads(l) for l in pathlib.Path('internal/brain/data/benchmark_observations.jsonl').read_text().splitlines() if l.strip()]
post_fix = [r for r in records if r.get('metric') == 'paste_latency_ms' and 'post-fix' in r.get('notes', '')]
print(f'Post-fix observations: {len(post_fix)} (need â‰¥5)')
"
```

### Phase 6 validation (comparison run)
```bash
python internal/brain/scripts/generate_unified_report.py
# Check outputs/unified_weekly_report.md:
# - paste_latency_ms should no longer appear in Known Product Constraints
# - improvement delta should show 644ms â†’ Xms
```

### Phase 7 validation (lessons recorded)
```bash
# Confirm wins.md or lessons_learned.md was updated
git diff internal/brain/memory/wins.md internal/brain/memory/lessons_learned.md
# At least one should be non-empty diff
```

---

## 16. Exact Next Prompt for V12 Phase 1 (Minimal Implementation)

Use the following prompt verbatim to begin V12 Phase 1:

---

```
Read and follow:
- internal/brain/memory/operating_contract.md
- internal/brain/memory/current_state.md
- internal/brain/outputs/v12_design_plan.md
- internal/brain/outputs/paste_utils_diagnosis.md

Mission:
V12 Phase 1 â€” Write the paste delay floor reduction proposal.

Task type:
proposal_task.
No product code changes.
Do not edit clipboard.rs.

Goal:
Write outputs/handoff_task.md for the clipboard.rs:120 paste delay floor change.

The handoff_task.md must include ALL of these sections:
1. ## Scope â€” target file, line, change type, no other files
2. ## Current Code â€” exact clipboard.rs:120 snippet (read clipboard.rs to confirm)
3. ## Proposed Change â€” paste_delay_ms.max(450) â†’ paste_delay_ms.max(150)
4. ## Why This Change â€” latency math showing 644ms â†’ ~344ms at 150ms floor
5. ## Test Protocol â€” 7 apps Ã— 3 test cases = 21 test cases (from v12_design_plan.md Section 13)
6. ## Rollback Plan â€” git checkout -- src-tauri/src/platform/clipboard.rs
7. ## Benchmark Measurement Plan â€” before=644ms already recorded, after=â‰¥5 new observations
8. ## Approved N Value â€” leave blank for founder to fill
9. ## Approval â€” [ ] Founder approved checkbox

Rules:
- Read clipboard.rs:120 before writing â€” confirm exact current code.
- Do not modify clipboard.rs.
- Do not implement the change.
- Only write inside internal/brain/.
- Starting N value: 150ms (conservative â€” see design plan Section 13 for rationale).
- If clipboard.rs line reference has shifted, update the line number in the proposal.

After writing, run:
git status --short

Report:
- handoff_task.md sections confirmed
- clipboard.rs:120 current code (as read)
- proposed change
- V12 Phase 2 gate status (what founder must do next)
- final git status
- product code touched yes/no
```

---

## V12 Entry Gate Checklist

Before V12 Phase 1 begins:

| Gate | Status |
|---|---|
| paste_mechanism_diagnosis.md exists | âœ… `outputs/paste_mechanism_diagnosis.md` |
| paste_utils_diagnosis.md exists | âœ… `outputs/paste_utils_diagnosis.md` |
| Root cause confirmed at clipboard.rs:120 | âœ… `paste_delay_ms.max(450)` confirmed |
| v11_closure_report.md exists | âœ… `outputs/v11_closure_report.md` |
| v12_design_plan.md exists | âœ… this document |
| handoff_task.md exists | â¬œ to be created in Phase 1 |
| Founder approval on file | â¬œ to be collected in Phase 2 |
| V11 impl package generated | â¬œ after Gate G6 passes |

V12 Phase 1 is ready to begin. No blocking dependencies.

---

*V12 design complete. The Brain knows what to change, where to change it,*
*how to validate it safely, and how to measure whether it worked.*
*The only remaining actions are: write the proposal, get approval, implement, test, measure.*
