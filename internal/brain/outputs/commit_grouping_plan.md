# Vocalype Brain â€” Commit Grouping Plan

Date: 2026-04-24

## Overview

The current worktree can be split into two logical commits without obvious cross-contamination between Brain/tooling changes and product/frontend changes.

Recommended grouping:

- Commit A: Vocalype Brain V1/V2 tooling and launchers
- Commit B: First successful dictation clarity UI

## Commit A Title

`feat(brain): add Vocalype Brain tooling, reports, and launchers`

## Commit A Files

These files belong to the Brain/tooling checkpoint:

- `internal/brain/`
- `Lancer_Vocalype_Brain.bat`
- `Stop_Vocalype_Brain.bat`
- `Voir_Rapport_Vocalype_Brain.bat`

## Commit A Description

This commit should capture the operational intelligence system and its tooling surface:

- Brain folder structure
- configs, memory, data, outputs, schemas
- local LLM orchestration
- model router
- Night Shift
- quality loop
- review loops
- approved task executor
- Windows launchers

This is a tooling/platform commit, not a product feature commit.

## Commit B Title

`feat(app): clarify first successful dictation readiness UI`

## Commit B Files

These files belong to the product/frontend checkpoint:

- `src/App.tsx`
- `src/components/auth/AuthPortal.tsx`
- `src/components/onboarding/FirstRunDownload.tsx`
- `src/hooks/useAuthFlow.ts`
- `src/hooks/useAuthFlow.test.ts`
- `src/lib/userFacingErrors.ts`
- `src/lib/userFacingErrors.test.ts`

## Commit B Description

This commit should capture the first successful dictation clarity pass:

- clearer readiness and activation messaging in `AuthPortal`
- clearer first-launch guidance in `App`
- clearer first-run framing in `FirstRunDownload`
- explicit frontend activation status exposure in `useAuthFlow`
- clearer user-facing activation/subscription error wording
- focused frontend test coverage for the new states and messages

## File-by-File Confirmation

### Commit A confirmed

- `Lancer_Vocalype_Brain.bat`
  - pure launcher for Night Shift
- `Stop_Vocalype_Brain.bat`
  - pure launcher for graceful stop request
- `Voir_Rapport_Vocalype_Brain.bat`
  - pure launcher for report viewing
- `internal/brain/`
  - all current contents are Brain/tooling/reporting assets and scripts

### Commit B confirmed

- `src/App.tsx`
  - passes `activationStatus` into `AuthPortal`
  - adds clearer first-launch dictation hint copy
- `src/components/auth/AuthPortal.tsx`
  - adds readiness panel and clearer activation state copy
- `src/components/onboarding/FirstRunDownload.tsx`
  - adds one final-preparation sentence for first dictation
- `src/hooks/useAuthFlow.ts`
  - adds `ActivationStatus` and frontend status derivation
- `src/hooks/useAuthFlow.test.ts`
  - adds assertions for activation state behavior
- `src/lib/userFacingErrors.ts`
  - clarifies inactive-subscription and activation-failed wording
- `src/lib/userFacingErrors.test.ts`
  - adds test coverage for the new error mapping

## Any Mixed Files Or Risks

No file appears to contain both Brain/tooling changes and product/frontend changes.

So there is no obvious A/B mixed file that must be manually split across commits.

That said, there are two scope notes for Commit B:

1. `src/hooks/useAuthFlow.ts`
   - This is slightly broader than a pure presentational UI change because it adds a derived frontend activation state.
   - Still belongs in Commit B because it directly supports the readiness UI and does not change backend, payment, or Rust logic.

2. `src/lib/userFacingErrors.ts`
   - This also widens the footprint beyond only visual components.
   - Still belongs in Commit B because it is part of the same user-facing clarity improvement.

Minor follow-up note:

- `src/App.tsx` and `src/components/onboarding/FirstRunDownload.tsx` add `/* eslint-disable i18next/no-literal-string */`
- This does not make them mixed files, but it is worth reviewing later if you want to keep i18n lint discipline tighter.

## Recommended Commit Order

Recommended order:

1. Commit A first
2. Commit B second

Reason:

- Commit A checkpoints the large Brain/tooling surface cleanly
- Commit B then becomes a focused product diff that is much easier to review

## Exact Git Add Commands

Commit A:

```bash
git add internal/brain Lancer_Vocalype_Brain.bat Stop_Vocalype_Brain.bat Voir_Rapport_Vocalype_Brain.bat
```

Commit B:

```bash
git add src/App.tsx src/components/auth/AuthPortal.tsx src/components/onboarding/FirstRunDownload.tsx src/hooks/useAuthFlow.ts src/hooks/useAuthFlow.test.ts src/lib/userFacingErrors.ts src/lib/userFacingErrors.test.ts
```

## Exact Commit Messages

Commit A:

```txt
feat(brain): add Vocalype Brain tooling, reports, and launchers
```

Commit B:

```txt
feat(app): clarify first successful dictation readiness UI
```

## Final Recommendation

This worktree is ready for a two-commit checkpoint with the grouping above.

I do not currently see a strong reason to manually split any file further before those two commits.
