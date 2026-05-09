# Wins

Record actions, experiments, content, and product changes that worked.

For each win, capture:

- Date
- What shipped
- Metric improved
- Why it worked
- How to repeat it

Starter patterns to watch:

- Short demos that show speech turning into text in real apps
- Clear privacy/offline messaging
- Reduced steps to first successful dictation
- Benchmark-driven model changes

- 2026-04-23: Safe frontend-only clarity improvements can improve first successful dictation without touching backend/auth/Rust layers.

- 2026-04-24: Safe frontend-only clarity improvements can improve first successful dictation without touching backend/auth/Rust layers.

- 2026-04-24 V6 win: Full V6 handoff loop validated end to end. Brain generated a scoped handoff task → Claude implemented only `AuthPortal.tsx` → hooks passed → clean commit. `activation_failed` state now has an active retry button and guaranteed error message. No sensitive files touched.

## 2026-04-26 — V12 Experiment 1: Windows Paste Restore Delay (PROVISIONAL)

**What shipped:** `paste_delay_ms.max(450)` → `paste_delay_ms.max(150)` in `clipboard.rs:120`.
One line. One token. Windows-only. Commit `f842401`.

**Metric improved (projected):** `paste_execute` ~644ms → ~344ms (~300ms saved, 47% reduction).
Formal benchmark confirmation pending (≥5 post-fix observations not yet recorded).

**Smoke test result:** 12/21 cases passed, 0 failures. Notepad, VS Code, Chrome, Gmail all clear.
Slack, Teams, Word deferred by founder decision. Decision: PROVISIONAL_KEEP.

**Why it worked:**
- Root cause was a hardcoded sleep, not inherent OS latency — a fixed value could simply be reduced.
- The ±1.2ms SD across 7 baseline sessions made the before-state highly precise, making any after-state change easy to detect.
- The V11 diagnosis was complete before V12 touched a single line — no guessing, no exploratory changes.
- Single-file, single-line scope meant `cargo check` + visual diff was sufficient validation.
- VS Code (Electron) passing at 150ms suggests the floor is safe for the majority of the user base.

**How to repeat it (template for next bottleneck):**
1. V11 confirms exact line + exact value in a read-only investigation
2. V12 proposes N value with empirical rationale (not gut feel)
3. Founder approves before any code change
4. Implementation is 1 token — diff is readable in 3 seconds
5. Test protocol covers the specific risk category (Electron apps for clipboard timing)
6. Benchmark before/after with same methodology (same script, same metric name)

**Status:** PROVISIONAL — upgrades to FULL_WIN when Slack + Teams + Word pass and benchmarks confirm median < 420ms.
