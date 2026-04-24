# Vocalype Brain — Worktree Status Report

Date: 2026-04-24

## 1. All Changed Files

From `git status --short`:

- `src/App.tsx`
- `src/components/auth/AuthPortal.tsx`
- `src/components/onboarding/FirstRunDownload.tsx`
- `src/hooks/useAuthFlow.test.ts`
- `src/hooks/useAuthFlow.ts`
- `src/lib/userFacingErrors.ts`
- `Lancer_Vocalype_Brain.bat`
- `Stop_Vocalype_Brain.bat`
- `Voir_Rapport_Vocalype_Brain.bat`
- `src/lib/userFacingErrors.test.ts`
- `vocalype-brain/`

From `git diff --stat`:

- `src/App.tsx` — 8 lines changed
- `src/components/auth/AuthPortal.tsx` — 158 lines changed
- `src/components/onboarding/FirstRunDownload.tsx` — 5 lines changed
- `src/hooks/useAuthFlow.test.ts` — 23 lines changed
- `src/hooks/useAuthFlow.ts` — 47 lines changed
- `src/lib/userFacingErrors.ts` — 19 lines changed

Note: `git diff --stat` only reports tracked file diffs, so it does not include the untracked launcher files, the new `src/lib/userFacingErrors.test.ts`, or the untracked `vocalype-brain/` directory.

## 2. Which Changes Belong To Vocalype Brain

These clearly belong to Vocalype Brain and supporting tooling:

- `vocalype-brain/`
- `Lancer_Vocalype_Brain.bat`
- `Stop_Vocalype_Brain.bat`
- `Voir_Rapport_Vocalype_Brain.bat`

These are operational tooling changes, not product feature changes.

## 3. Which Changes Belong To Product Code

These are product/frontend code changes:

- `src/App.tsx`
- `src/components/auth/AuthPortal.tsx`
- `src/components/onboarding/FirstRunDownload.tsx`
- `src/hooks/useAuthFlow.ts`
- `src/hooks/useAuthFlow.test.ts`
- `src/lib/userFacingErrors.ts`
- `src/lib/userFacingErrors.test.ts`

## 4. Which Changes Likely Belong To The First Successful Dictation Clarity Implementation

These strongly match the previously implemented clarity pass:

- `src/App.tsx`
  - likely first-launch hint clarity
- `src/components/auth/AuthPortal.tsx`
  - likely activation/readiness state messaging
- `src/components/onboarding/FirstRunDownload.tsx`
  - likely onboarding subtitle or readiness framing
- `src/hooks/useAuthFlow.ts`
  - likely auth/activation UI state exposure used by the clarity UI
- `src/hooks/useAuthFlow.test.ts`
  - likely test coverage for the new frontend auth/readiness states
- `src/lib/userFacingErrors.ts`
  - likely clearer user-facing activation/error wording
- `src/lib/userFacingErrors.test.ts`
  - likely test coverage for clearer error mapping

## 5. Which Changes Are Unrelated Or Unclear

Probably unrelated to the product change itself:

- `vocalype-brain/`
- `Lancer_Vocalype_Brain.bat`
- `Stop_Vocalype_Brain.bat`
- `Voir_Rapport_Vocalype_Brain.bat`

Potentially broader than the originally approved minimal frontend scope:

- `src/hooks/useAuthFlow.ts`
- `src/hooks/useAuthFlow.test.ts`
- `src/lib/userFacingErrors.ts`
- `src/lib/userFacingErrors.test.ts`

These are still plausibly connected to the clarity implementation, but they go beyond the smallest surface of just `AuthPortal.tsx`, `App.tsx`, and optional onboarding copy. So they are not clearly unrelated, but they do widen the footprint.

## 6. Recommended Next Action

Recommended next action: `commit current changes`

Reason:

- the current worktree contains a coherent product change set related to first successful dictation clarity
- it also contains a large untracked `vocalype-brain/` toolchain and launcher set
- starting another product task now would stack new changes on top of an already mixed worktree
- the safest move before another product change is to checkpoint this state intentionally

If committing everything together feels too broad, the next safest human decision would be to split Brain/tooling changes from product/frontend changes before continuing. But the main recommendation is still to checkpoint the current state before more product edits.

## 7. Any Risk If We Implement Another Task Now

Yes, there is meaningful risk.

Main risks:

- scope confusion: a new task could get mixed with the existing first-successful-dictation clarity changes
- review difficulty: it will become harder to tell which diff belongs to which decision
- rollback difficulty: reverting a future task could accidentally disturb the current clarity work
- test ambiguity: if something breaks, it will be harder to isolate whether the cause was the current clarity change or the next task
- implementation pressure: the existing worktree already includes both product code and a large new Brain/tooling surface

Bottom line:

Continuing with another product implementation right now is possible, but not clean. The repo is not in the best state for a second product change without first checkpointing or otherwise separating the current work.
