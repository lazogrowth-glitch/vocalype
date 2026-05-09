# V12 Experiment 1 â€” Paste Restore Delay Floor Reduction
# Result Report

Date: 2026-04-26
Experiment: V12 Continuous Improvement Loop â€” Phase 4 smoke test complete
Product commit: f842401 â€” perf(app): reduce Windows paste restore delay floor
Status: **PROVISIONAL_KEEP** â€” smoke tests passed, full matrix + benchmarks pending

---

## 1. Patch Summary

| Field | Value |
|---|---|
| File | `src-tauri/src/platform/clipboard.rs` |
| Line | 120 |
| Change | `paste_delay_ms.max(450)` â†’ `paste_delay_ms.max(150)` |
| Scope | Windows-only (`#[cfg(target_os = "windows")]`) |
| Other lines touched | None |
| Other files touched | None |
| Commit | `f842401` |

---

## 2. Manual Smoke Test Results

Tested by: Founder
Date: 2026-04-26
Build: `f842401` (post-fix)

### Test matrix

| App | T1 â€” Dictate phrase | T2 â€” Clipboard restore | T3 â€” Quick succession | Result |
|---|---|---|---|---|
| Notepad | âœ… PASS | âœ… PASS | âœ… PASS | âœ… PASS |
| VS Code | âœ… PASS | âœ… PASS | âœ… PASS | âœ… PASS |
| Chrome | âœ… PASS | âœ… PASS | âœ… PASS | âœ… PASS |
| Gmail in Chrome | âœ… PASS | âœ… PASS | âœ… PASS | âœ… PASS |
| Slack | â¬œ PENDING | â¬œ PENDING | â¬œ PENDING | â¬œ PENDING |
| Teams | â¬œ PENDING | â¬œ PENDING | â¬œ PENDING | â¬œ PENDING |
| Word | â¬œ PENDING | â¬œ PENDING | â¬œ PENDING | â¬œ PENDING |

**Apps tested:** 4 / 7
**Test cases completed:** 12 / 21
**Failures observed:** 0

### Observations
- No paste failure observed in any tested app
- No clipboard restoration failure observed
- Behaviour subjectively snappier â€” paste perceived as noticeably faster
- Electron apps (Slack, Teams) not yet tested â€” highest risk category

---

## 3. Keep / Revert Decision

**Decision: PROVISIONAL_KEEP**

Rationale:
- 4 out of 7 apps passed all 3 test cases with 0 failures
- Tested apps cover: native Win32 (Notepad), Electron (VS Code), browser (Chrome), web app (Gmail)
- VS Code is Electron-based and passed â€” partial validation for Electron clipboard consumption at 150ms
- Rollback condition NOT triggered: no paste failure, no clipboard loss, no crash
- Remaining risk: Slack and Teams use a different Electron IPC path than VS Code and may have slower clipboard consumption

**This decision becomes FULL_KEEP when:**
1. âœ… Slack, Teams, and Word all pass all 3 test cases (7 remaining test cases)
2. âœ… â‰¥5 formal `paste_latency_ms` benchmark observations recorded post-fix
3. âœ… Benchmark median confirms improvement (target: < 420ms, stretch: < 300ms)

**Rollback trigger (still active):**
If Slack, Teams, or Word fails any test case â†’ immediate revert:
```bash
git checkout -- src-tauri/src/platform/clipboard.rs
```

---

## 4. Expected Latency Change

| Component | Before | After (150ms floor) |
|---|---|---|
| Sleep 1 â€” pre-Ctrl+V | 60ms | 60ms (unchanged) |
| Sleep 2 â€” Windows restore floor | 450ms | 150ms |
| Overhead (cursor ctx, clipboard I/O, Ctrl+V) | ~134ms | ~134ms (unchanged) |
| **Total `paste_execute`** | **~644ms** | **~344ms** |
| **Projected saving** | â€” | **~300ms (47%)** |

Formal measurement still required to confirm. The Â±1.2ms SD of the before state
means the after state should also be tight â€” expected cluster around 344ms Â± ~5ms.

---

## 5. Remaining Steps Before V12 Can Close

| Step | Status | Action |
|---|---|---|
| Phase 4 â€” complete test matrix | â¬œ PENDING | Test Slack (3 cases), Teams (3 cases), Word (1 case) |
| Phase 5 â€” record â‰¥5 post-fix benchmarks | â¬œ PENDING | Run `add_benchmark_observation.py` with `--notes "post-fix floor=150ms"` |
| Phase 6 â€” compare + unified report | â¬œ PENDING | Run `generate_unified_report.py`, confirm paste_latency_ms improvement |
| Phase 7 â€” record win + lessons | â¬œ PENDING | Update `wins.md` and `lessons_learned.md` after full confirmation |
| V12 closure report | â¬œ PENDING | After all above complete |

**V12 cannot be closed yet.** Phases 5â€“7 are pending. The experiment is on track
but requires the founder to complete the remaining 7 test cases and 5 benchmarks.

---

## 6. Benchmark Observations Status

**Before state (locked):**
- `paste_latency_ms` baseline: 644ms median (7 sessions, Â±1.2ms)
- Source: `data/benchmark_observations.jsonl`

**After state (pending):**
- Observations recorded post-fix: **0**
- Observations needed: **â‰¥5**
- Command:
```bash
python internal/brain/scripts/add_benchmark_observation.py \
  --metric paste_latency_ms \
  --value <measured_ms> \
  --unit ms \
  --source manual_founder \
  --period 2026-W18 \
  --notes "post-fix floor=150ms"
```

Do not record benchmarks until Slack and Teams test cases are complete. If either
fails â†’ revert first, then the post-fix baseline never gets recorded.

---

## 7. Next Action

**Immediate (founder â€” before next Brain session):**

1. Open Vocalype (built from commit `f842401`)
2. Open Slack â†’ run T1, T2, T3 â†’ record pass/fail
3. Open Teams â†’ run T1, T2, T3 â†’ record pass/fail
4. Open Word â†’ run T1, T2, T3 â†’ record pass/fail
5. If all 7 remaining cases pass â†’ record â‰¥5 `paste_latency_ms` benchmarks
6. If any case fails â†’ `git checkout -- src-tauri/src/platform/clipboard.rs`

**Next Brain session (after Phase 4 + 5 complete):**
- Record V12 Phase 6 comparison (generate_unified_report.py)
- Record V12 Phase 7 win/lesson
- Write V12 closure report
- Close V12 and re-run V10 to identify next bottleneck

---

## 8. Product Code Safety

- Only `src-tauri/src/platform/clipboard.rs` was modified
- Change is exactly 1 token on 1 line
- Non-Windows behavior unchanged (line 123 `max(250)` untouched)
- Sleep 1 (line 87, 60ms pre-Ctrl+V) untouched
- `cargo check` passed with no errors
- `git diff --check` passed with no whitespace errors
- Rollback is a single `git checkout --` command
