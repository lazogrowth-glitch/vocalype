# First Successful Dictation Plan

Date: 2026-04-23

## 1. Current Flow Summary

Current frontend flow, as implemented today:

1. `App.tsx` loads auth state through `useAuthFlow()`.
2. If `authLoading` is true, the app shows a generic loading screen.
3. If there is no usable session or no usable license runtime state, `AuthPortal.tsx` is shown.
4. `AuthPortal.tsx` displays a high-level activation message based on `activationStatus` and may auto-refresh the session.
5. Once a valid runtime license exists, `App.tsx` allows entry into onboarding or the main app.
6. `useOnboarding.ts` gates first-run model setup:
   - if access is ready and models are initialized, onboarding becomes either `first-run` or `done`
7. If onboarding is `first-run`, `FirstRunDownload.tsx` takes over and auto-downloads/selects the default model.
8. After onboarding completes, the app shell opens and a first-launch hint appears until a transcription lifecycle event dismisses it.

In short:

- auth and license readiness decide whether the user can enter
- first-run model readiness decides whether the user sees onboarding
- first successful dictation itself is implied by later runtime events, not represented as one explicit UI state

## 2. Where the First Successful Dictation State Is Represented

It is currently represented indirectly across several frontend places:

- [src/hooks/useAuthFlow.ts](/abs/path/c:/developer/sas/vocalype/src/hooks/useAuthFlow.ts)
  - derives `activationStatus`
  - determines whether the user is logged out, checking activation, inactive, failed, or ready
- [src/App.tsx](/abs/path/c:/developer/sas/vocalype/src/App.tsx)
  - gates the user into:
    - auth screen
    - onboarding
    - main app
  - shows `activation-banner` when account access exists but runtime access is still pending
  - shows the first-launch hint after app entry
- [src/components/auth/AuthPortal.tsx](/abs/path/c:/developer/sas/vocalype/src/components/auth/AuthPortal.tsx)
  - shows current activation message and next action before app entry
- [src/hooks/useOnboarding.ts](/abs/path/c:/developer/sas/vocalype/src/hooks/useOnboarding.ts)
  - decides whether first-run onboarding is still blocking the user
- [src/components/onboarding/FirstRunDownload.tsx](/abs/path/c:/developer/sas/vocalype/src/components/onboarding/FirstRunDownload.tsx)
  - shows model download / extraction / activation progress
- [src/components/MachineStatusBar.tsx](/abs/path/c:/developer/sas/vocalype/src/components/MachineStatusBar.tsx)
  - shows machine/runtime health, but not a clear first-dictation readiness path

There is no single explicit frontend state like:

- ready to dictate
- model still preparing
- permissions still needed
- now try first dictation

That gap is the core clarity problem.

## 3. Current Confusing States or Messages

Main confusion points observed from the current frontend:

1. Auth success does not clearly transition into “next step toward first dictation”.
   - `AuthPortal` explains activation, but not what comes immediately after activation.

2. `App.tsx` uses several internal gates, but the user sees them as disconnected screens:
   - loading
   - activation
   - model download
   - app shell

3. `activation-banner` appears after app entry when activation is still pending.
   - This is useful, but it does not explain whether the user can already dictiate, wait, or do something else.

4. `FirstRunDownload.tsx` is clear about model download progress, but it is isolated from the prior activation state.
   - The user does not get one consistent “you are on step X of first dictation readiness” story.

5. The first-launch hint appears only after entering the app.
   - It helps with the shortcut, but it is not framed as the final step of the first successful dictation journey.

6. `MachineStatusBar.tsx` shows runtime/machine information, but not “you are ready for your first dictation”.

## 4. Minimal Proposed UI/State Change

Keep the change frontend-only and small.

Proposed minimal change:

Add one lightweight “first dictation readiness” layer in the UI, without changing auth, license, payment, or backend logic.

Specifically:

1. In `AuthPortal.tsx`
   - add a compact checklist / progress panel under the current account status
   - show 3 simple readiness items:
     - Account connected
     - Activation validated
     - Model ready
   - only show the states that can already be inferred from existing frontend state
   - for blocked states, show one plain next step, not multiple branching instructions

2. In `App.tsx`
   - reuse the existing `activation-banner` area or nearby top-of-app space to make the transition clearer:
     - if activation is still pending, say the app is preparing access
     - if onboarding is `first-run`, frame `FirstRunDownload` as the final preparation step before first dictation
     - once onboarding is done and the first-launch hint is visible, make that hint explicitly about completing the first dictation

3. Avoid new business logic.
   - derive display-only readiness text from already existing signals:
     - `activationStatus`
     - `licenseState`
     - `onboardingStep`
     - first-run model download state already inside `FirstRunDownload`

4. Do not add a new backend state machine.
   - only add clearer presentation of the current frontend state sequence

This keeps the change low-risk because it improves the user narrative, not the auth/license runtime behavior.

## 5. Exact Files That Would Be Changed

Primary likely changes:

- [src/components/auth/AuthPortal.tsx](/abs/path/c:/developer/sas/vocalype/src/components/auth/AuthPortal.tsx)
  - add the small readiness panel and clearer “next step” copy
- [src/App.tsx](/abs/path/c:/developer/sas/vocalype/src/App.tsx)
  - tighten the activation/onboarding/first-dictation transition messaging

Possible small supporting change only if needed:

- [src/hooks/useAuthFlow.ts](/abs/path/c:/developer/sas/vocalype/src/hooks/useAuthFlow.ts)
  - only if one extra display-oriented derived status is needed
  - avoid touching auth behavior itself

Optional but probably unnecessary for the first pass:

- [src/components/onboarding/FirstRunDownload.tsx](/abs/path/c:/developer/sas/vocalype/src/components/onboarding/FirstRunDownload.tsx)
  - only if the subtitle needs one extra sentence connecting model download to first dictation

Inspected but not recommended for the initial small change:

- [src/components/MachineStatusBar.tsx](/abs/path/c:/developer/sas/vocalype/src/components/MachineStatusBar.tsx)
  - useful context, but not the best place for the first low-risk improvement

## 6. Files Explicitly Not To Touch

Do not touch:

- [backend/app.py](/abs/path/c:/developer/sas/vocalype/backend/app.py)
- [src-tauri/src/security/secret_store.rs](/abs/path/c:/developer/sas/vocalype/src-tauri/src/security/secret_store.rs)
- [src-tauri/src/lib.rs](/abs/path/c:/developer/sas/vocalype/src-tauri/src/lib.rs)
- [src/lib/auth/client.ts](/abs/path/c:/developer/sas/vocalype/src/lib/auth/client.ts)
- [src/lib/license/client.ts](/abs/path/c:/developer/sas/vocalype/src/lib/license/client.ts)
- payment / billing backend or subscription logic
- license validation logic
- translation files, unless a tiny unavoidable string move is required later

Also avoid touching:

- Rust dictation runtime
- backend auth endpoints
- billing state handling
- device binding or secret storage

## 7. Risk Level

Low

Why:

- frontend-only
- presentation/state-clarity oriented
- no backend changes
- no auth logic changes
- no license logic changes
- no payment logic changes
- no runtime dictation path changes

## 8. Manual Test Plan

1. Logged out
   - Launch with no stored session
   - Confirm auth screen clearly shows the user is still at step 1

2. Logged in, activation checking
   - Use a valid account and normal desktop auth callback
   - Confirm UI clearly shows:
     - account connected
     - activation checking
     - not ready to dictate yet

3. Subscription inactive
   - Use a session with `has_access = false`
   - Confirm UI clearly shows the blocker is subscription/access, not generic setup

4. Activation ready, first-run model setup pending
   - Use a valid session with valid runtime access and first-run model flow
   - Confirm the UI makes it obvious that model preparation is the last setup step before first dictation

5. App entered, first-launch hint visible
   - Confirm the hint clearly encourages the first dictation attempt instead of reading like a generic shortcut tip

6. Regression check
   - Login
   - logout
   - activation refresh
   - first-run model download
   - app entry
   - none of these should change behavior, only copy/state clarity

## 9. Rollback Plan

Rollback is simple:

1. remove the readiness panel or extra UI copy from `AuthPortal.tsx`
2. revert the small transition messaging change in `App.tsx`
3. revert any tiny display-only helper added in `useAuthFlow.ts`

No backend rollback, data rollback, migration, or entitlement rollback is needed.

## 10. Expected Impact

Expected impact: High for clarity, low for technical risk.

Why:

- reduces the chance that a user feels “stuck between login and usable dictation”
- connects activation and first-run model preparation into one understandable journey
- increases the odds that the user attempts the first dictation instead of waiting or giving up
- supports the north-star activation event without changing sensitive systems

This is the smallest credible improvement that should make first successful dictation feel more understandable without widening scope into auth, billing, Rust runtime, or backend logic.
