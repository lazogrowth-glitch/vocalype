# First Improvement Plan

Date: 2026-04-23

## 1. Problem

The desktop auth / activation screen does not clearly separate these states:

- logged out
- logged in but license not yet issued
- logged in but license refresh failed
- logged in but subscription access is inactive
- logged in and ready

Right now, a user can successfully authenticate and still not understand why Vocalype is not ready for first dictation. The current error mapping also collapses many license and activation failures into generic account-access language.

## 2. Why It Matters

First successful dictation depends on a chain:

- auth session
- license issue or refresh
- valid runtime license
- model readiness
- permissions

If the activation step is unclear, users get stuck before they ever reach dictation. This is a high-impact bottleneck because it blocks the core product promise before the user can experience value.

## 3. Exact Files to Change

- [src/hooks/useAuthFlow.ts](/abs/path/c:/developer/sas/vocalype/src/hooks/useAuthFlow.ts)
- [src/components/auth/AuthPortal.tsx](/abs/path/c:/developer/sas/vocalype/src/components/auth/AuthPortal.tsx)
- [src/lib/userFacingErrors.ts](/abs/path/c:/developer/sas/vocalype/src/lib/userFacingErrors.ts)

Optional but likely useful if copy should be localized properly:

- [src/i18n/locales/en/translation.json](/abs/path/c:/developer/sas/vocalype/src/i18n/locales/en/translation.json)
- [src/i18n/locales/fr/translation.json](/abs/path/c:/developer/sas/vocalype/src/i18n/locales/fr/translation.json)

## 4. Proposed Change

Add a small explicit activation-status layer in the frontend only.

In practice:

- In `useAuthFlow.ts`, derive one lightweight activation status from `session` and `licenseState`, such as:
  - `logged_out`
  - `checking_activation`
  - `activation_failed`
  - `subscription_inactive`
  - `ready`
- In `AuthPortal.tsx`, replace the current broad status text with a clearer status message and one next step per state.
- In `userFacingErrors.ts`, add more precise activation/license message handling for cases like:
  - no stored license bundle
  - premium access required
  - subscription inactive
  - activation failed
  - reconnect to validate subscription

This keeps the change low-risk because it does not alter backend auth, license issuance, Tauri commands, or dictation runtime. It only improves how the current state is explained to the user.

## 5. Risk Level

Low

Reason:

- frontend-only
- no product runtime logic change
- no backend change
- no license enforcement change
- no dictation pipeline change

## 6. Manual Test Plan

1. Logged out state:
   - Launch the app with no stored session.
   - Confirm the screen clearly says login is required.

2. Logged in, activation in progress:
   - Log in with a valid account and simulate the normal post-login refresh path.
   - Confirm the screen says account is detected and activation is being checked.

3. License missing or activation failure:
   - Force `licenseClient.getRuntimeState()` to return expired or missing bundle state.
   - Confirm the UI shows a clear activation-specific error instead of a generic account message.

4. Subscription inactive:
   - Use an account/session with `subscription.has_access = false`.
   - Confirm the UI clearly indicates billing/subscription is the blocker.

5. Ready state:
   - Use a valid session and valid license runtime state.
   - Confirm the auth screen disappears and the user can proceed to onboarding or app usage as before.

6. Regression check:
   - Verify browser login, logout, and checkout actions still work.

## 7. Rollback Plan

Rollback is simple:

- revert the frontend status-copy changes in `useAuthFlow.ts`
- revert the UI rendering changes in `AuthPortal.tsx`
- revert the new activation-specific message mapping in `userFacingErrors.ts`

No data migration or backend rollback is needed.

## 8. Expected Impact

Expected impact: High

Why:

- reduces confusion in the activation step before first dictation
- improves the chance that a newly authenticated user understands the next action
- lowers support burden around “I logged in but Vocalype still doesn’t work”
- directly supports first successful dictation without changing risky runtime systems
