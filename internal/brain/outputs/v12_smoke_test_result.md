# V12 Smoke Test Result

Date: 2026-04-27
Product commit: `f842401` â€” `perf(app): reduce Windows paste restore delay floor`
Patch: `paste_delay_ms.max(450)` â†’ `paste_delay_ms.max(150)` at `clipboard.rs:120`
Decision: **PROVISIONAL_KEEP** (maintained)

---

## Smoke Test Matrix â€” 21 Cases

| App | Category | T1 (short) | T2 (medium) | T3 (long) | Result |
|---|---|---|---|---|---|
| Notepad | Native Win32 | PASS | PASS | PASS | âœ… |
| VS Code | Electron | PASS | PASS | PASS | âœ… |
| Chrome | Blink browser | PASS | PASS | PASS | âœ… |
| Gmail | Web (Chrome) | PASS | PASS | PASS | âœ… |
| Slack | Electron | PASS | PASS | PASS | âœ… |
| Teams | Electron | PASS | PASS | PASS | âœ… |
| Word | Office/Win32 | PASS | PASS | PASS | âœ… |

**Total: 21/21 cases passed. 0 failures. 0 clipboard restore failures.**

---

## Observations

- No paste failure observed in any app or any test case
- No clipboard restore failure observed (user clipboard content preserved correctly)
- All app categories tested: native Win32, Electron, Blink browser, Office

---

## Decision: PROVISIONAL_KEEP (maintained)

The full 21-case smoke test matrix has passed. The patch is stable across all tested app targets.

**PROVISIONAL_KEEP** is maintained (not yet upgraded to FULL_KEEP) because:
- â‰¥5 post-fix `paste_latency_ms` benchmark observations not yet recorded
- Quantitative confirmation that median latency < 420ms is still pending

### Upgrade path to FULL_KEEP

Record â‰¥5 post-fix observations:

```
python internal/brain/scripts/add_benchmark_observation.py \
  --metric paste_latency_ms --value <measured_ms> \
  --unit ms --source manual_founder \
  --notes "post-fix floor=150ms" \
  --period 2026-W17
```

Then re-run the agent:
```
python internal/brain/scripts/run_operating_agent.py
```

The agent will select `paste_latency_pending_benchmarks` as the remaining data_entry task until benchmarks are recorded.

### Rollback (still armed)

If a regression appears before benchmarks are complete:
```
git checkout -- src-tauri/src/platform/clipboard.rs
cargo build --release
```

---

## Lifecycle State After This Record

| Bottleneck | Before | After |
|---|---|---|
| `paste_latency_pending_benchmarks` | `NEW` | `PATCH_SHIPPED` |

`PATCH_SHIPPED` means: the agent will not re-generate a new investigation mission for this bottleneck.
The bottleneck is considered handled at the smoke-test level.
It upgrades to `VERIFIED_KEEP` when post-fix benchmarks confirm median < 420ms.

---

## Product Code Touched

**No.** This record is Brain-memory-only. No product files modified.
Patch `f842401` was committed in a previous session â€” not touched here.

---

## Files Modified (this session)

- `internal/brain/data/results.jsonl` â€” appended V12 smoke test result entry
- `internal/brain/outputs/results_report.md` â€” added "Latest Result" section
- `internal/brain/outputs/v12_smoke_test_result.md` â€” this file (new)
- `internal/brain/memory/lessons_learned.md` â€” appended smoke test lesson
- `internal/brain/memory/current_state.md` â€” updated V12 smoke test status
