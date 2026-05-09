# Activation Failure Points â€” Measurement Plan

Date: 2026-04-24
Source: Vocalype Brain V2 measurement task
Status: Plan only â€” no product code modified

---

## 1. Activation Flow Steps

All states a user passes through from install to first dictation:

| Step | State | Trigger |
|---|---|---|
| 1 | App launched, no stored token | `authLoading = true`, `refreshSession()` runs |
| 2 | `logged_out` | No token found â†’ `applySession(null)` |
| 3 | User opens login via browser | Deep link or form flow starts |
| 4 | Auth callback received | Token stored via deep link â†’ `handleDeepLinkAuth()` |
| 5 | Session fetched | `authClient.getSession(token)` called |
| 6 | `checking_activation` | Session set, license sync starts (`syncLicenseForSession`) |
| 7a | License issued/refreshed OK | `licenseState.state = "online_valid"` or `"offline_valid"` â†’ `ready` |
| 7b | Subscription inactive | `session.subscription.has_access = false` â†’ `subscription_inactive` |
| 7c | License sync fails (403) | `licenseState` cleared â†’ `activation_failed` |
| 7d | License sync fails (network) | May silently fall through to `offline_valid` or `activation_failed` |
| 8 | `ready` | App unlocked, model download starts (if first run) |
| 9 | Model downloaded + extracted | First dictation becomes possible |

Source files:
- `src/hooks/useAuthFlow.ts` â€” `deriveActivationStatus`, `refreshSession`, `syncLicenseForSession`
- `src/components/auth/AuthPortal.tsx` â€” `getStatusText`, `getReadinessRows`

---

## 2. Where Users May Hesitate or Fail

Identified friction points, in order of likely impact:

### F1 â€” `activation_failed` state with no actionable guidance
- **What happens:** User sees "Compte detecte, mais l'activation sur ce PC n'a pas abouti."
- **Problem:** No reason given. No clear next step beyond "Relancez la verification."
- **Code location:** `AuthPortal.tsx:145`, `getStatusText` switch, `getReadinessRows` next step label
- **Why it's risky:** User may think it's their fault, close the app, or abandon.

### F2 â€” `checking_activation` with no timeout or progress indicator
- **What happens:** `authLoading || authSubmitting` keeps showing spinner indefinitely if backend is slow.
- **Problem:** No timeout UI. User has no signal that something is wrong vs. just slow.
- **Code location:** `useAuthFlow.ts:51`, `deriveActivationStatus`

### F3 â€” `subscription_inactive` â†’ billing CTA goes to external browser
- **What happens:** User must click a button, open a browser, subscribe, return to app.
- **Problem:** Context switch. If checkout URL fails (network, auth error), user is stuck.
- **Code location:** `AuthPortal.tsx:99` (`onStartCheckout`), `useAuthFlow.ts:250-257`

### F4 â€” Silent suppression of `no stored license bundle` error
- **What happens:** `isExpectedMissingLicenseMessage` returns `true` â†’ error is suppressed â†’ user sees no feedback.
- **Problem:** Silent failure â€” user doesn't know activation is stalled on missing bundle.
- **Code location:** `useAuthFlow.ts:18-26`, `useAuthFlow.ts:180-185`, `useAuthFlow.ts:303-309`

### F5 â€” Deep link auth failure (browser callback never arrives)
- **What happens:** User opens browser for login but never returns (timeout, browser blocks callback, state mismatch).
- **Problem:** `setAuthSubmitting(true)` stays true, user is stuck on spinner indefinitely.
- **Code location:** `useAuthFlow.ts:290-328`, `AuthPortal.tsx:110-114`

### F6 â€” Token expired at launch â†’ silent refresh attempt â†’ falls through to logout
- **What happens:** Access token is 401 â†’ tries refresh token â†’ if that fails â†’ tries offline license â†’ if that fails â†’ clears everything.
- **Problem:** User who was previously active gets silently logged out with no explanation.
- **Code location:** `useAuthFlow.ts:196-245`, toast at line 219 is shown only in `offline_valid` branch

### F7 â€” `activation_failed` due to integrity anomaly
- **What happens:** `runtime.integrity_anomalies` detected â†’ anomaly reported silently â†’ but user still sees `activation_failed` UI.
- **Problem:** No UI surface for this specific failure cause.
- **Code location:** `useAuthFlow.ts:501-536`

---

## 3. Existing Files Likely Involved

Inspect only â€” do not modify.

| File | Role |
|---|---|
| `src/hooks/useAuthFlow.ts` | State machine, all activation logic, license sync |
| `src/components/auth/AuthPortal.tsx` | UI rendering for all activation states |
| `src/lib/userFacingErrors.ts` | Error message classification and translation |
| `src/App.tsx` | Passes `activationStatus` to `AuthPortal` (line 474) |
| `src/lib/auth/client.ts` | Auth API calls, token storage |
| `src/lib/license/client.ts` | License issue/refresh/runtime state |

---

## 4. Proposed Metrics

| Metric | Definition | How to measure |
|---|---|---|
| `activation_success_rate` | % of launches that reach `ready` within 30s | Manual: count in app sessions or log |
| `steps_to_first_dictation` | Time (seconds) from app open to first dictation | Manual stopwatch during testing |
| `activation_failed_rate` | % of sessions that reach `activation_failed` | Log `activation_failed` occurrences |
| `checking_activation_timeout_rate` | % of sessions stuck in `checking_activation` > 15s | Manual observation or console timing |
| `silent_suppression_rate` | How often `isExpectedMissingLicenseMessage` silently eats an error | Code grep + manual test |
| `subscription_inactive_conversion_rate` | % of `subscription_inactive` sessions that complete checkout | Stripe dashboard |

---

## 5. Events That Could Be Tracked Later

(Once a tracking plan is approved by founder â€” no implementation yet.)

| Event | Trigger point | Value |
|---|---|---|
| `activation_state_entered` | Each time `deriveActivationStatus` returns a new state | Know which states users hit |
| `activation_failed_reason` | When `activation_failed` is set, include `licenseState.reason` | Know why activation fails |
| `deep_link_callback_timeout` | If no callback within N seconds | Know browser-flow abandonment rate |
| `silent_license_error_suppressed` | When `isExpectedMissingLicenseMessage` returns true | Quantify hidden failures |
| `token_refresh_failed` | When refresh token path throws | Know session expiry frequency |
| `first_dictation_ready` | When `ready` state reached for first time ever | True activation completion |

All events would be append-only to a local Brain log first â€” no third-party analytics without founder approval.

---

## 6. Manual Observation Checklist

Verify these manually without any code changes:

- [ ] Fresh install (no stored token): does the app land on `logged_out` cleanly?
- [ ] Login via browser deep link: does callback arrive and activation complete without errors?
- [ ] Login with expired subscription: does `subscription_inactive` appear with a clear message?
- [ ] Login with valid subscription: how long does `checking_activation` last before `ready`?
- [ ] Force network offline during activation: does the app gracefully handle it or freeze?
- [ ] Open app with expired access token: does silent refresh work? If not, what does user see?
- [ ] Trigger `activation_failed` (revoke license manually): is the message understandable?
- [ ] Observe `no stored license bundle` suppression: does any feedback appear to the user?
- [ ] Check model download banner: does it appear at the right time after `ready`?
- [ ] Time the full flow: install â†’ login â†’ `ready` â†’ first dictation (target < 60s)

---

## 7. Minimal Future Implementation Options

Ranked by risk (low first) and impact (high first):

| Option | Description | Risk | Impact | Files |
|---|---|---|---|---|
| A | Improve `activation_failed` message with specific reason | Low | High | `AuthPortal.tsx`, `userFacingErrors.ts` |
| B | Add a timeout (15s) to `checking_activation` spinner with a retry CTA | Low | High | `useAuthFlow.ts`, `AuthPortal.tsx` |
| C | Expose `licenseState.reason` as a debug hint in `activation_failed` UI | Low | Medium | `AuthPortal.tsx` |
| D | Add deep link timeout detection and fallback message | Medium | High | `useAuthFlow.ts`, `AuthPortal.tsx` |
| E | Log activation state transitions to a local Brain JSONL file | Medium | Medium | New Brain script only |
| F | Add first-party event tracking to Brain data layer | Medium | High | New Brain script, no product changes |
| G | Surface `isExpectedMissingLicenseMessage` suppression with a soft toast | Medium | Medium | `useAuthFlow.ts` |

**Recommended starting point:** Option A + B â€” both are frontend-only, low risk, and directly address the most common failure surfaces (F1, F2).

---

## 8. Risks

| Risk | Description | Mitigation |
|---|---|---|
| Auth logic is shared | `useAuthFlow.ts` affects every user path. Changes must be narrow. | Only modify UI text and timeout display, not auth state logic. |
| License messages are i18n | Any text change must go through translation keys | Use existing keys or add new ones correctly |
| Silent error suppression is intentional | `no stored license bundle` is suppressed for a reason (first-run) | Understand the condition before any change |
| Deep link callbacks are OS-level | Timeout detection requires careful timer management | Spike in a non-blocking branch first |
| Analytics could leak data | Any event tracking must be local-only first | Brain JSONL only â€” no third-party API without approval |

---

## 9. Recommendation

**Instrumentation is not needed yet.**

Manual observation is sufficient to validate whether F1â€“F7 are actually causing user drop-off, or whether they are edge cases. Recommended next steps:

1. Do the manual observation checklist in section 6 on a real build.
2. Record observations in `internal/brain/data/quality_observations.jsonl`.
3. If `activation_failed` or `checking_activation` timeout are confirmed as real friction points, implement Option A + B (frontend-only, low risk).
4. Defer event tracking until at least one implementation cycle has been completed and the pattern of failure is clearly established.

**Do not add analytics or event tracking until:**
- Manual observation confirms which states are actually causing drop-off.
- Founder has approved what data is acceptable to log.
- A local-only logging approach (Brain JSONL) is chosen over third-party services.
