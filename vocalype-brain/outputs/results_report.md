# Vocalype Brain — Results Report

Date: 2026-04-24

## Recent Results

- 2026-04-23T20:40:50: Frontend clarity pass for first successful dictation -> needs_manual_test
- 2026-04-23T20:41:08: Frontend clarity pass for first successful dictation -> needs_manual_test
- 2026-04-24T08:59:22: Frontend clarity pass for first successful dictation -> keep
- 2026-04-24T09:09:56: Frontend clarity pass for first successful dictation -> keep
- 2026-04-24T09:43:29: Frontend clarity pass for first successful dictation -> keep
- 2026-04-24T13:18:23: Fix: First successful dictation — activation_failed retry state -> keep

## Latest Result — V6 Handoff Validation

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

- Run manual test: all 5 activation states to confirm retry button and fallback message work.
- Plan V7: Real Product Benchmark Loop.
