# Vocalype Brain — Results Report

Date: 2026-04-24

## Recent Results

- 2026-04-23T20:40:50: Frontend clarity pass for first successful dictation -> needs_manual_test
- 2026-04-23T20:41:08: Frontend clarity pass for first successful dictation -> needs_manual_test
- 2026-04-24T08:59:22: Frontend clarity pass for first successful dictation -> keep
- 2026-04-24T09:09:56: Frontend clarity pass for first successful dictation -> keep
- 2026-04-24T09:43:29: Frontend clarity pass for first successful dictation -> keep

## Repeated Wins

- Clear privacy/offline messaging
- Reduced steps to first successful dictation
- Benchmark-driven model changes
- 2026-04-23: Safe frontend-only clarity improvements can improve first successful dictation without touching backend/auth/Rust layers.
- 2026-04-24: Safe frontend-only clarity improvements can improve first successful dictation without touching backend/auth/Rust layers.

## Repeated Mistakes

- Do not polish invisible features before fixing activation.
- Do not publish generic startup content when a product demo would be clearer.
- Do not change model defaults without benchmarks.
- 2026-04-23: Night Shift should narrow frontend clarity tasks before suggesting sensitive backend, auth, or Rust files.
- 2026-04-24: Night Shift should narrow frontend clarity tasks before suggesting sensitive backend, auth, or Rust files.

## Top Lessons

- Night Shift correctly prioritized first successful dictation.
- Codex implemented a safe frontend-only clarity improvement.
- Future UI clarity tasks should prefer frontend-only scope before backend/auth/Rust changes.
- Night Shift initially proposed too many sensitive files; future task generation should narrow scope.
- 2026-04-24 V3.5 lesson: Approved patch application must require explicit --approve and must refuse patches without Apply Instructions.

## Recommended Changes to Night Shift Behavior

- Prefer frontend-only scope first for UI clarity tasks.
- Narrow proposed files to the smallest safe surface before suggesting implementation.
- Keep quality and activation observations attached to the next proposal.

## Recommended Next Action

- Run the pending manual test scenarios before approving the result as keep.
