# Vocalype Brain — Product Patch Proposal

Date: 2026-04-24T09:51:04

## Selected Task

**Fix: First successful dictation**
Source: night_shift

## Why It Matters

Users may get stuck before experiencing the core product promise, blocking activation and impacting the North Star metric of successful dictations.

## Target Files

- `src/components/auth/AuthPortal.tsx`
- `src/hooks/useAuthFlow.ts`

Sensitive files involved: No
Risk: low

## Proposed Changes

- Implement distinct visual states for each activation phase (logged out, license pending, subscription inactive, ready) with clear error messaging.

## Validation Plan

Check if users can clearly see their activation status and proceed to dictation without errors.

## Risks

- Auth/activation UI is shared across all user states — keep changes narrow
- Any user-facing string changes should use i18n keys, not hardcoded text
- Do not modify auth state logic, only UI rendering and error text
- Revert immediately if manual test shows regression in any activation state

## Rollback Plan

```
git checkout -- src/components/auth/AuthPortal.tsx src/hooks/useAuthFlow.ts
```

## Human Approval Required

**This proposal must be reviewed and approved by the founder before implementation.**

Steps:
1. Read the Exact Prompt below.
2. Confirm the approved scope matches the intended change.
3. Confirm the forbidden scope excludes all sensitive files.
4. Copy the prompt to Codex or Claude Code for implementation.
5. Review the diff before committing.
6. Run lint and manual test scenarios after applying.

## Exact Prompt For Claude/Codex

```
# Mission — Implement Approved Vocalype Product Change

Task: Fix: First successful dictation

## Problem

The desktop auth/activation screen does not clearly separate states like logged out, license not issued, and subscription inactive, leading to confusion during first dictation.

## Why It Matters

Users may get stuck before experiencing the core product promise, blocking activation and impacting the North Star metric of successful dictations.

## Approved Scope

- src/components/auth/AuthPortal.tsx
- src/hooks/useAuthFlow.ts

## Forbidden Scope

- backend/
- src-tauri/
- src/lib/auth/client.ts
- src/lib/license/client.ts
- payment or billing logic
- auth logic changes
- license validation logic
- Rust dictation runtime
- translation files

## Implementation Constraints

- Keep the change small and measurable
- Frontend-only — do not touch backend, auth client, license client, or Rust
- No new dependencies
- Use existing i18n keys if modifying user-facing strings, or add new keys correctly
- Do not widen scope beyond the approved files above

## Validation

- Check if users can clearly see their activation status and proceed to dictation without errors.
- Run: npm run lint
- Manual test scenarios from outputs/measure_activation_failure_points.md Section 6

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

- Every file changed
- Commands run and whether they passed
- Exact UI/copy changes made
- Manual test results for all activation states
- Remaining risks or limitations
```
