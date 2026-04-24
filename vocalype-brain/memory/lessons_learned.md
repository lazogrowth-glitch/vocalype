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
