# Vocalype Repo Audit

Date: 2026-04-23

Scope: audit only. No product code modified.

## Summary

Vocalype is split across:

- Desktop frontend in `src/`
- Tauri/Rust desktop backend in `src-tauri/src/`
- Python backend API in `backend/`
- Marketing site / pricing page in `index.html`

The repo already has real auth, license, billing, telemetry, model management, onboarding, and permission handling. The main product risk is not missing architecture. It is friction and coupling across three critical flows:

- account auth -> session -> license issue/refresh
- first run -> model download -> first successful dictation
- plan / quota / premium gating -> insertion behavior -> billing upgrade

## 1. Authentication / Login

Relevant files:

- [backend/app.py](/abs/path/c:/developer/sas/vocalype/backend/app.py)
- [AUTH_SETUP.md](/abs/path/c:/developer/sas/vocalype/AUTH_SETUP.md)
- [src/lib/auth/client.ts](/abs/path/c:/developer/sas/vocalype/src/lib/auth/client.ts)
- [src/hooks/useAuthFlow.ts](/abs/path/c:/developer/sas/vocalype/src/hooks/useAuthFlow.ts)
- [src/components/auth/AuthPortal.tsx](/abs/path/c:/developer/sas/vocalype/src/components/auth/AuthPortal.tsx)
- [src-tauri/src/lib.rs](/abs/path/c:/developer/sas/vocalype/src-tauri/src/lib.rs)
- [src-tauri/src/security/secret_store.rs](/abs/path/c:/developer/sas/vocalype/src-tauri/src/security/secret_store.rs)

What these likely control:

- `backend/app.py`: `/auth/register`, `/auth/login`, `/auth/session`, `/auth/refresh`, password reset, JWT issuance, refresh tokens, trial creation, rate limiting, referral stats.
- `src/lib/auth/client.ts`: browser/API client, secure token/session persistence, device ID, billing endpoints, local trial flag.
- `src/hooks/useAuthFlow.ts`: session hydration, refresh behavior, offline license fallback, checkout/portal triggers, auth error handling.
- `src/components/auth/AuthPortal.tsx`: desktop login/register UI, browser-auth open flow, activation waiting state.
- `src-tauri/src/lib.rs`: deep-link auth callback and CSRF-style `state` protection via pending auth flow.
- `src-tauri/src/security/secret_store.rs`: secure storage for auth token and auth session.

Risk level: High

Why:

- Login is coupled to browser deep-link auth, backend session refresh, and desktop secure storage.
- A successful login still does not mean the desktop is usable until license issue/refresh succeeds.
- Any desync between auth session and license bundle can create confusing "logged in but not activated" states.

Improvement opportunities:

- Make auth state and activation state visibly separate in the UI.
- Add one explicit "session valid / license valid / ready to dictate" health state.
- Log and surface auth-to-license transition failures with cleaner user-facing explanations.

## 2. License Activation

Relevant files:

- [backend/app.py](/abs/path/c:/developer/sas/vocalype/backend/app.py)
- [src-tauri/src/security/license.rs](/abs/path/c:/developer/sas/vocalype/src-tauri/src/security/license.rs)
- [src-tauri/src/security/secret_store.rs](/abs/path/c:/developer/sas/vocalype/src-tauri/src/security/secret_store.rs)
- [src-tauri/src/security/bundle_signing.rs](/abs/path/c:/developer/sas/vocalype/src-tauri/src/security/bundle_signing.rs)
- [src/lib/license/client.ts](/abs/path/c:/developer/sas/vocalype/src/lib/license/client.ts)
- [src/hooks/useAuthFlow.ts](/abs/path/c:/developer/sas/vocalype/src/hooks/useAuthFlow.ts)

What these likely control:

- `backend/app.py`: `/license/issue`, `/license/refresh`, `/license/heartbeat`, `/license/status`, anomaly reporting, device entitlement sync, signed grant/offline bundles.
- `src-tauri/src/security/license.rs`: local runtime state, plan enforcement, offline/online validity, device binding checks.
- `src-tauri/src/security/secret_store.rs`: local `license.bundle.json` read/write/delete and signature verification on read/write.
- `src/lib/license/client.ts`: frontend bridge for license issue/refresh/runtime state.
- `useAuthFlow.ts`: issues or refreshes the license after login/session restore.

Risk level: Critical

Why:

- License is the real gate before dictation can start.
- Premium/basic behavior depends on runtime license state, not just auth session.
- Errors here can block first use even when login worked.

Improvement opportunities:

- Add a deterministic activation state machine test matrix.
- Improve error copy for "no stored license bundle", device mismatch, expired bundle, premium required, and backend 403.
- Add telemetry around issue -> refresh -> usable runtime state transitions.

## 3. Where Dictation Starts

Relevant files:

- [src-tauri/src/shortcut/handler.rs](/abs/path/c:/developer/sas/vocalype/src-tauri/src/shortcut/handler.rs)
- [src-tauri/src/actions/transcribe.rs](/abs/path/c:/developer/sas/vocalype/src-tauri/src/actions/transcribe.rs)
- [src-tauri/src/lib.rs](/abs/path/c:/developer/sas/vocalype/src-tauri/src/lib.rs)
- [src-tauri/src/managers/audio.rs](/abs/path/c:/developer/sas/vocalype/src-tauri/src/managers/audio.rs)
- [src-tauri/src/runtime/transcription_coordinator.rs](/abs/path/c:/developer/sas/vocalype/src-tauri/src/runtime/transcription_coordinator.rs)

What these likely control:

- `shortcut/handler.rs`: routes transcribe shortcut events into the coordinator.
- `actions/transcribe.rs`: real dictation pipeline start, license gate, quota gate, microphone start, overlay, model load warmup, transcription, post-processing, insertion, history save.
- `managers/audio.rs`: microphone and recording session lifecycle.
- `runtime/transcription_coordinator.rs`: active operation and lifecycle coordination.

Risk level: Critical

Why:

- This is the product promise path.
- It mixes shortcut handling, license checks, quota checks, warmup, microphone state, model state, overlays, transcription, post-processing, paste, and history in one runtime path.

Improvement opportunities:

- Add explicit instrumentation for time-to-first-recording and time-to-first-paste.
- Extract a smaller state model for "blocked by warmup", "blocked by mic", "blocked by license", "quota exceeded", "transcribing", "pasting".
- Add founder-readable diagnostics when dictation start fails.

## 4. Model Selection / Settings

Relevant files:

- [src/components/settings/models/ModelsSettings.tsx](/abs/path/c:/developer/sas/vocalype/src/components/settings/models/ModelsSettings.tsx)
- [src/stores/modelStore.ts](/abs/path/c:/developer/sas/vocalype/src/stores/modelStore.ts)
- [src-tauri/src/managers/model.rs](/abs/path/c:/developer/sas/vocalype/src-tauri/src/managers/model.rs)
- [src-tauri/resources/model_catalog.json](/abs/path/c:/developer/sas/vocalype/src-tauri/resources/model_catalog.json)
- [src-tauri/resources/default_settings.json](/abs/path/c:/developer/sas/vocalype/src-tauri/resources/default_settings.json)
- [src-tauri/src/settings/mod.rs](/abs/path/c:/developer/sas/vocalype/src-tauri/src/settings/mod.rs)

What these likely control:

- `ModelsSettings.tsx`: visible model UI, active model switching, download/delete/cancel, cloud STT key prompts.
- `modelStore.ts`: frontend model lifecycle state, first-run detection, download progress listeners, select/download/delete actions.
- `managers/model.rs`: catalog, download, extraction, validation, runtime model path, cache, delete, recommendation flags.
- `model_catalog.json`: bundled and downloadable model definitions and metadata.

Risk level: High

Why:

- Model download and selection directly block first-run activation.
- There is strong complexity in local model lifecycle, extraction, validation, cloud STT keys, and adaptive runtime profile behavior.

Improvement opportunities:

- Surface "recommended for first run" more clearly.
- Record model download failures and extraction failures as product events.
- Add a simpler first-run path that chooses one known-good local model and hides the rest until after first success.

## 5. Onboarding / First-Run UX

Relevant files:

- [src/App.tsx](/abs/path/c:/developer/sas/vocalype/src/App.tsx)
- [src/hooks/useOnboarding.ts](/abs/path/c:/developer/sas/vocalype/src/hooks/useOnboarding.ts)
- [src/components/onboarding/FirstRunDownload.tsx](/abs/path/c:/developer/sas/vocalype/src/components/onboarding/FirstRunDownload.tsx)
- [src/components/onboarding/TrialWelcomeModal.tsx](/abs/path/c:/developer/sas/vocalype/src/components/onboarding/TrialWelcomeModal.tsx)
- [src/components/settings/app-context/VoiceToCodeOnboarding.tsx](/abs/path/c:/developer/sas/vocalype/src/components/settings/app-context/VoiceToCodeOnboarding.tsx)
- [src/stores/modelStore.ts](/abs/path/c:/developer/sas/vocalype/src/stores/modelStore.ts)
- [src/stores/settingsStore.ts](/abs/path/c:/developer/sas/vocalype/src/stores/settingsStore.ts)

What these likely control:

- `App.tsx` + `useOnboarding.ts`: gate the app behind auth/access and first-run model availability.
- `FirstRunDownload.tsx`: auto-download and auto-select the first model.
- `TrialWelcomeModal.tsx`: premium trial messaging after registration.
- `VoiceToCodeOnboarding.tsx`: optional post-processing / local LLM onboarding flow.

Risk level: High

Why:

- First run is tightly coupled to model availability, account access, and implicit activation.
- Auto-download is efficient but brittle if the chosen model or network fails.

Improvement opportunities:

- Add a clearer stepper: account ready, permissions ready, model ready, first dictation ready.
- Show one recovery action when first-run model activation fails.
- Distinguish "downloading model" from "activated and ready".

## 6. Error Messages

Relevant files:

- [src/lib/userFacingErrors.ts](/abs/path/c:/developer/sas/vocalype/src/lib/userFacingErrors.ts)
- [src/hooks/useAuthFlow.ts](/abs/path/c:/developer/sas/vocalype/src/hooks/useAuthFlow.ts)
- [src-tauri/src/actions/transcribe.rs](/abs/path/c:/developer/sas/vocalype/src-tauri/src/actions/transcribe.rs)
- [src-tauri/src/commands/mod.rs](/abs/path/c:/developer/sas/vocalype/src-tauri/src/commands/mod.rs)
- [backend/app.py](/abs/path/c:/developer/sas/vocalype/backend/app.py)
- [src/i18n/locales/en/translation.json](/abs/path/c:/developer/sas/vocalype/src/i18n/locales/en/translation.json)

What these likely control:

- `userFacingErrors.ts`: main frontend sanitizer and mapper from technical error to user-friendly text.
- `useAuthFlow.ts`: auth, license, quota, and premium toast handling.
- `actions/transcribe.rs`: runtime error classification for microphone and empty transcript cases.
- `backend/app.py`: API error payloads for auth, license, quota, and billing.

Risk level: High

Why:

- Errors originate from three layers: backend API, desktop Rust runtime, and frontend mapping.
- There is visible mixed-language output and some raw technical strings still escape into UX.

Improvement opportunities:

- Standardize error codes across backend and desktop runtime.
- Ensure all user-visible messages route through i18n.
- Add one canonical mapping table for activation, mic, model, quota, and billing failures.

## 7. Website / Landing / Pricing

Relevant files:

- [index.html](/abs/path/c:/developer/sas/vocalype/index.html)
- [public/](/abs/path/c:/developer/sas/vocalype/public)
- [src/components/settings/billing/BillingSettings.tsx](/abs/path/c:/developer/sas/vocalype/src/components/settings/billing/BillingSettings.tsx)
- [AUTH_SETUP.md](/abs/path/c:/developer/sas/vocalype/AUTH_SETUP.md)

What these likely control:

- `index.html`: landing page, hero, feature positioning, privacy claims, pricing, FAQs, CTA copy.
- `BillingSettings.tsx`: in-app billing/subscription panel and upgrade/manage actions.

Risk level: Medium

Why:

- The marketing page exists and includes pricing/trial language, but repo separation between desktop and site is still somewhat loose.
- Messaging must stay aligned with actual trial, basic, premium, and injection behavior.

Improvement opportunities:

- Verify that pricing promises in `index.html` match current backend entitlements and weekly quota behavior.
- Add explicit "basic copies to clipboard / premium injects directly" messaging where needed.

## 8. Telemetry / Analytics

Relevant files:

- [src-tauri/src/runtime/telemetry.rs](/abs/path/c:/developer/sas/vocalype/src-tauri/src/runtime/telemetry.rs)
- [src-tauri/src/lib.rs](/abs/path/c:/developer/sas/vocalype/src-tauri/src/lib.rs)
- [src-tauri/src/commands/report.rs](/abs/path/c:/developer/sas/vocalype/src-tauri/src/commands/report.rs)
- [src-tauri/src/managers/history.rs](/abs/path/c:/developer/sas/vocalype/src-tauri/src/managers/history.rs)

What these likely control:

- `runtime/telemetry.rs`: append-only local JSONL telemetry for transcription sessions and chunks.
- `lib.rs`: telemetry initialization into app log dir.
- `commands/report.rs` + `history.rs`: local usage analytics, weekly report, all-time stats.

Risk level: Medium

Why:

- Telemetry is local and privacy-aware, which is strong.
- But product-growth metrics like first successful dictation and activation funnel are not obviously wired into one clean event model.

Improvement opportunities:

- Add local event markers for first successful dictation, first paste, first quota hit, first premium gate, first checkout click.
- Add a single local founder report for activation funnel drop-off.

## 9. Payment / Subscription Logic

Relevant files:

- [backend/app.py](/abs/path/c:/developer/sas/vocalype/backend/app.py)
- [backend/requirements.txt](/abs/path/c:/developer/sas/vocalype/backend/requirements.txt)
- [src/lib/auth/client.ts](/abs/path/c:/developer/sas/vocalype/src/lib/auth/client.ts)
- [src/hooks/useAuthFlow.ts](/abs/path/c:/developer/sas/vocalype/src/hooks/useAuthFlow.ts)
- [src/components/settings/billing/BillingSettings.tsx](/abs/path/c:/developer/sas/vocalype/src/components/settings/billing/BillingSettings.tsx)
- [src/lib/subscription/context.ts](/abs/path/c:/developer/sas/vocalype/src/lib/subscription/context.ts)

What these likely control:

- `backend/app.py`: Stripe checkout, billing portal, webhook subscription updates, trial state, status and quota shaping in session payload.
- `auth/client.ts`: frontend calls to `/billing/checkout` and `/billing/portal`.
- `useAuthFlow.ts`: checkout and billing portal triggers from desktop app.
- `BillingSettings.tsx`: in-app UI to upgrade or manage subscription.

Risk level: High

Why:

- Payment state influences access, quota, and plan UX.
- Trial, basic, premium, billing portal, and quota behavior must stay perfectly aligned between backend session payload and desktop UX.

Improvement opportunities:

- Add stronger integration tests around Stripe webhook status mapping to actual desktop-access outcomes.
- Add one billing-state smoke test for trialing, active, canceled, past_due, inactive.

## 10. Permissions

Relevant files:

- [src/components/AccessibilityPermissions.tsx](/abs/path/c:/developer/sas/vocalype/src/components/AccessibilityPermissions.tsx)
- [src-tauri/src/commands/mod.rs](/abs/path/c:/developer/sas/vocalype/src-tauri/src/commands/mod.rs)
- [src-tauri/src/lib.rs](/abs/path/c:/developer/sas/vocalype/src-tauri/src/lib.rs)
- [src-tauri/Info.plist](/abs/path/c:/developer/sas/vocalype/src-tauri/Info.plist)
- [src-tauri/Entitlements.plist](/abs/path/c:/developer/sas/vocalype/src-tauri/Entitlements.plist)
- [src-tauri/capabilities/default.json](/abs/path/c:/developer/sas/vocalype/src-tauri/capabilities/default.json)
- [src/i18n/locales/en/translation.json](/abs/path/c:/developer/sas/vocalype/src/i18n/locales/en/translation.json)

What these likely control:

- `AccessibilityPermissions.tsx`: frontend macOS accessibility permission request/check UI.
- `commands/mod.rs`: deferred initialization of Enigo and shortcuts after permissions are granted.
- `lib.rs`: delayed startup init to avoid early permission prompts.
- `Info.plist` / `Entitlements.plist`: OS-level microphone and accessibility-related permission descriptions.

Risk level: High

Why:

- Permissions directly affect whether dictated text can be inserted.
- A user can successfully log in and download a model but still fail the real promise if permissions are missing.

Improvement opportunities:

- Add one explicit permission readiness screen in first-run flow.
- Track permission denial separately from microphone/model/auth failures.
- On macOS, make "grant accessibility then continue" a guided loop with a success check.

## Top 10 Recommended Tasks

1. Add a single activation state machine covering auth session, license bundle, permissions, model readiness, and first successful dictation.
2. Instrument and surface `first successful dictation` and `first paste` as local founder-readable metrics.
3. Add deterministic tests for auth -> license issue -> offline fallback -> logout -> refresh flows.
4. Improve activation error copy so users can tell whether failure is auth, license, model, microphone, or permissions.
5. Simplify first-run onboarding into one guided path with explicit checkpoints instead of implicit transitions.
6. Add telemetry markers for quota hits, premium gate triggers, checkout clicks, and billing portal opens.
7. Add tests for basic-plan behavior to confirm clipboard fallback is always used and premium-only insertion is enforced correctly.
8. Verify that `index.html` pricing/trial promises always match backend billing and quota behavior.
9. Add end-to-end tests for microphone permission denied, missing accessibility permission, and missing model cases.
10. Add a repo-level founder report that maps the top runtime failure modes blocking first successful dictation.

## Tests That Should Be Added

- Auth backend tests:
  - register starts trial
  - login returns token + refresh token + subscription payload
  - refresh rejects stale token version
  - billing webhook updates subscription status correctly

- License tests:
  - issue succeeds for valid trial/basic/premium session
  - refresh returns valid online/offline bundle
  - device mismatch is rejected
  - expired bundle moves runtime state to expired
  - premium-only actions fail cleanly on basic plan

- Desktop integration tests:
  - successful login then license issue leads to usable runtime state
  - offline-valid bundle keeps app usable when session expires
  - no stored license bundle shows clean activation recovery path

- Dictation runtime tests:
  - transcribe shortcut starts operation only when access is valid
  - microphone missing emits the right runtime error code
  - no speech does not paste
  - successful transcription saves history and inserts text
  - basic quota exceeded emits the correct event and blocks dictation

- Onboarding tests:
  - first run with no models shows `FirstRunDownload`
  - model download success auto-selects model and completes onboarding
  - model download failure shows recoverable user message

- Permissions tests:
  - macOS accessibility denied keeps insertion blocked with actionable UI
  - `initialize_enigo` and `initialize_shortcuts` behave correctly before and after permission grant

- Billing UI tests:
  - trialing/basic/premium/past_due states render the right CTA
  - checkout and portal open actions are wired only when expected

## High-Risk Areas

- [src/hooks/useAuthFlow.ts](/abs/path/c:/developer/sas/vocalype/src/hooks/useAuthFlow.ts): central coupling point for auth, license, offline fallback, billing CTAs, and premium gates.
- [src-tauri/src/actions/transcribe.rs](/abs/path/c:/developer/sas/vocalype/src-tauri/src/actions/transcribe.rs): core promise path with many gates and side effects.
- [backend/app.py](/abs/path/c:/developer/sas/vocalype/backend/app.py): auth, trial, quota, license, Stripe, referrals, admin endpoints in one service file.
- [src-tauri/src/managers/model.rs](/abs/path/c:/developer/sas/vocalype/src-tauri/src/managers/model.rs): large model lifecycle surface with download/extract/validation/delete/runtime cache.
- [src-tauri/src/security/license.rs](/abs/path/c:/developer/sas/vocalype/src-tauri/src/security/license.rs): runtime entitlement enforcement with device binding and offline behavior.

## Final Take

The repo already contains the primitives needed for Vocalype Brain to become repo-aware and useful:

- real auth and billing backend
- real desktop license enforcement
- real first-run onboarding path
- real local telemetry and usage history
- real premium/basic gating

The best immediate Brain tasks are not broad feature ideation. They are activation-focused audits and measurable improvements around:

- first successful dictation
- activation clarity
- permissions clarity
- model setup reliability
- billing/trial conversion handoff
