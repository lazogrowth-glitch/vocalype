# Vocalype — Implementation Handoff Task

Date: 2026-04-24T13:18:23
Proposal: Fix: First successful dictation
Task type: implementation_task
Risk: low
Safety class: product_proposal_only

---

## Problem Statement

Implement distinct visual states for each activation phase (logged out, license pending, subscription inactive, ready) with clear error messaging.

## Why It Matters

Directly improves first successful dictation and activation success rate.

## Approved Scope

Files the implementation model is allowed to modify:

- `src/components/auth/AuthPortal.tsx`
- `src/hooks/useAuthFlow.ts`

## Forbidden Scope

Files and patterns the implementation model must never touch:

- `backend/`
- `src-tauri/`
- `src/lib/auth/client.ts`
- `src/lib/license/client.ts`
- payment or billing logic
- auth state logic (do not modify `deriveActivationStatus` or auth reducers)
- license validation logic
- Rust dictation runtime
- `translation.json` / i18n files (add new keys only via correct key registration)

## Existing Code Context

The following excerpts are extracted read-only from the current codebase.
Do not add lines that contradict what you see here.

### `src/components/auth/AuthPortal.tsx` — Current Structure

```tsx
/* eslint-disable i18next/no-literal-string */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ExternalLink, Loader2, LogOut, ShieldAlert } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { commands } from "@/bindings";
import type { AuthPayload, AuthSession } from "@/lib/auth/types";
import type { ActivationStatus } from "@/hooks/useAuthFlow";
import { getUserFacingErrorMessage } from "@/lib/userFacingErrors";
import { useModelStore } from "@/stores/modelStore";

const MODEL_ID = "parakeet-tdt-0.6b-v3-multilingual";

const ModelDownloadBadge: React.FC = () => {
  const {
    downloadingModels,
    extractingModels,
    getDownloadProgress,
    isFirstRun,
  } = useModelStore();
  const isDownloading = MODEL_ID in downloadingModels;
  const isExtracting = MODEL_ID in extractingModels;
  if (!isFirstRun && !isDownloading && !isExtracting) return null;

  const progress = getDownloadProgress(MODEL_ID);
  const pct = progress?.percentage ?? 0;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 16,
        left: "50%",
        transform: "translateX(-50%)",
        width: "min(100% - 32px, 360px)",
        zIndex: 10,
      }}
    >
      <div
        style={{
          borderRadius: 10,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(18,18,18,0.95)",
          padding: "10px 14px",
          backdropFilter: "blur(8px)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 11,
            color: "rgba(255,255,255,0.4)",
            marginBottom: 6,
          }}
        >
          <span>
            {isExtracting
              ? "Preparation du modele..."
              : "Telechargement du modele vocal"}
          </span>
          {isDownloading && !isExtracting && pct > 0 && (
            <span>{Math.round(pct)}%</span>
          )}
        </div>
        <div
          style={{
            height: 3,
            borderRadius: 99,
            background: "rgba(255,255,255,0.08)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              borderRadius: 99,
              background: "rgba(100,140,255,0.7)",
              width: isExtracting ? "100%" : `${pct}%`,
... (558 more lines not shown)
```

### `src/hooks/useAuthFlow.ts` — Current Structure

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { listen } from "@tauri-apps/api/event";
import { authClient } from "@/lib/auth/client";
import type { AuthPayload, AuthSession } from "@/lib/auth/types";
import { licenseClient } from "@/lib/license/client";
import type { LicenseRuntimeState } from "@/lib/license/types";
import { getUserFacingErrorMessage } from "@/lib/userFacingErrors";
import { useSessionRefresh } from "./useSessionRefresh";

export type ActivationStatus =
  | "logged_out"
  | "checking_activation"
  | "subscription_inactive"
  | "activation_failed"
  | "ready";

const isExpectedMissingLicenseMessage = (value: unknown) => {
  const message =
    value instanceof Error
      ? value.message
      : typeof value === "string"
        ? value
        : "";
  return message.toLowerCase().includes("no stored license bundle");
};

const deriveActivationStatus = ({
  session,
  licenseState,
  authLoading,
  authSubmitting,
  authError,
}: {
  session: AuthSession | null;
  licenseState: LicenseRuntimeState | null;
  authLoading: boolean;
  authSubmitting: boolean;
  authError: string | null;
}): ActivationStatus => {
  if (!session) return "logged_out";
  if (!session.subscription.has_access) return "subscription_inactive";

  if (
    licenseState?.state === "online_valid" ||
    licenseState?.state === "offline_valid"
  ) {
    return "ready";
  }

  if (authLoading || authSubmitting) return "checking_activation";
  if (authError || licenseState?.reason === "Activation failed") {
    return "activation_failed";
  }

  return "checking_activation";
};

export function useAuthFlow(
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  const [authLoading, setAuthLoading] = useState(true);
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [licenseState, setLicenseState] = useState<LicenseRuntimeState | null>(
    null,
  );
  const [showTrialWelcome, setShowTrialWelcome] = useState(false);
  const hasCompletedPostOnboardingInit = useRef(false);
  const trialReminderShownRef = useRef(false);

  const applySession = useCallback((nextSession: AuthSession | null) => {
    setSession(nextSession);
    setAuthError(null);

    if (nextSession) {
      void authClient.setStoredSession(nextSession);
      return;
    }
... (485 more lines not shown)
```

## Implementation Instructions

1. Implement distinct visual states for each activation phase (logged out, license pending, subscription inactive, ready) with clear error messaging.

## Constraints

- Keep the change small and measurable
- Frontend-only — do not touch backend, auth client, license client, or Rust
- No new dependencies
- Use existing i18n keys if modifying user-facing strings; register new keys correctly
- Do not widen scope beyond the approved files above
- One logical change per commit

## Validation

Check if users can clearly see their activation status and proceed to dictation without errors.

- `npm run lint`
- `npm run format`
- Manual test: all 5 activation states (logged_out, checking_activation, subscription_inactive, activation_failed, ready)
- Manual test scenarios from `outputs/measure_activation_failure_points.md` Section 6

## Rollback Plan

```
git checkout -- src/components/auth/AuthPortal.tsx src/hooks/useAuthFlow.ts
```

## Safety Rules

- Do not modify product code outside the approved scope
- Do not apply unrelated patches
- Do not deploy
- Do not delete files
- Do not use --no-verify
- Do not loosen safety rules

## What To Report After Implementation

- Every file changed (path + brief description)
- Commands run and whether they passed
- Exact UI/copy changes made
- Manual test results for all activation states
- Remaining risks or limitations
- Suggested follow-up measurement task

## Benchmark Baseline (V7 will populate)

V7 will measure these metrics before and after implementation.
Do not run benchmarks now — these are placeholders only.

| Metric | Before | After |
|---|---|---|
| dictation_latency_ms | unknown | unknown |
| transcription_error_rate | unknown | unknown |
| activation_success_rate | unknown | unknown |
| activation_failed_rate | unknown | unknown |
