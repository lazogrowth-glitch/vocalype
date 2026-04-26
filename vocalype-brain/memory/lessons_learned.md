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
